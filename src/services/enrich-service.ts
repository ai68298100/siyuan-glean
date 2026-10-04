/**
 * AI 富化管线（T-1300，D-0004/D-0007 红线）：
 * 收录/手动触发 → 取正文 → chatGPT 摘要+AI 标签 → 写 custom-clip-summary/ai-tags（永不碰手填字段）
 * → 语义查重（先查 embeddingStat.enabled，未启用/失败静默跳过）。
 * 失败一律静默：写 ai-log.json（最近 50 条）+ console，绝不阻断收录主流程。
 */
import type { Plugin } from "siyuan";
import { chatGPT } from "../api/ai";
import { chatCompletionDirect } from "../api/ai-direct";
import { embeddingStat, exportMdContent, querySql, semanticSearchBlock, type SemanticSearchHit } from "../api/client";
import { isInternalDocument } from "../domain/candidate-policy";
import { stripMarkdown } from "../domain/migrate";
import { todayStamp } from "../domain/resurface";
import { buildEnrichPrompt, isLikelyDuplicate, parseEnrichResponse, type EnrichResult } from "../domain/enrich";
import { parseClipAttrs } from "../domain/schema";
import { batchReadClipAttrs, writeClip, type WriteClipOptions } from "./clip-store";
import { normalizeSettings, type GleanSettings } from "./settings";

const LOG_FILE = "ai-log.json";
const LOG_LIMIT = 50;
const USAGE_FILE = "ai-usage.json";
const uncertainUsage = new WeakSet<Plugin>();

export interface AiLogEntry {
    at: string;
    docId: string;
    stage: string;
    message: string;
}

/** 读取最近 AI 失败日志（设置-维护查看用），新的在前。 */
export async function loadAiLog(plugin: Plugin): Promise<AiLogEntry[]> {
    try {
        const raw = await plugin.loadData(LOG_FILE);
        const entries = Array.isArray(raw) ? (raw as AiLogEntry[]) : [];
        return entries.slice(-20).reverse();
    } catch {
        return [];
    }
}

export interface AiUsage {
    date: string;
    count: number;
}

/** 今日富化次数（自动+手动合计，按日重置）。 */
export async function usageToday(plugin: Plugin): Promise<number> {
    if (uncertainUsage.has(plugin)) throw new Error("AI usage unavailable");
    const usage = await loadUsage(plugin);
    return usage.date === todayStamp() ? usage.count : 0;
}

async function loadUsage(plugin: Plugin): Promise<AiUsage> {
    const raw: unknown = await plugin.loadData(USAGE_FILE);
    if (raw === undefined || raw === null || raw === "") return { date: "", count: 0 };
    const entry = raw as Partial<AiUsage>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof entry.date !== "string" || !/^\d{8}$/.test(entry.date)
        || typeof entry.count !== "number" || !Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error("Invalid AI usage");
    const date = new Date(`${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}T12:00:00`);
    if (!Number.isFinite(date.getTime()) || todayStamp(date) !== entry.date) throw new Error("Invalid AI usage date");
    return { date: entry.date, count: entry.count };
}

async function incUsage(plugin: Plugin): Promise<number> {
    const usage = await loadUsage(plugin);
    const today = todayStamp();
    const count = usage.date === today ? usage.count + 1 : 1;
    if (!Number.isSafeInteger(count)) throw new Error("AI usage overflow");
    try { await plugin.saveData(USAGE_FILE, { date: today, count }); } catch { uncertainUsage.add(plugin); }
    try {
        const saved = await loadUsage(plugin);
        if (saved.date !== today || saved.count !== count) throw new Error("AI usage readback changed");
        uncertainUsage.delete(plugin);
    } catch (error) { uncertainUsage.add(plugin); throw error; }
    return count;
}

/** 伴读等场景共享每日额度（D-0030）：false=今日已满。调用成功后须 recordAiUsage 计数（失败不扣，与富化同语义）。 */
export async function aiQuotaAvailable(plugin: Plugin, settings: GleanSettings): Promise<boolean> {
    const used = await usageToday(plugin);
    return !(settings.ai.enrichDailyCap > 0 && used >= settings.ai.enrichDailyCap);
}

export async function recordAiUsage(plugin: Plugin): Promise<void> {
    try { await incUsage(plugin); }
    catch (error) { uncertainUsage.add(plugin); throw error; }
}

function aiEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off";
}

export function activeAiSettings(plugin: Plugin, fallback: GleanSettings): GleanSettings {
    const current = (plugin as Plugin & { settings?: unknown }).settings;
    return current && typeof current === "object" ? normalizeSettings(current) : fallback;
}

interface LogEntry {
    at: string;
    docId: string;
    stage: string;
    message: string;
}

async function appendLog(plugin: Plugin, docId: string, stage: string, message: string): Promise<void> {
    try {
        const raw = await plugin.loadData(LOG_FILE);
        const entries: LogEntry[] = Array.isArray(raw) ? raw : [];
        entries.push({ at: new Date().toISOString(), docId, stage, message: message.slice(0, 200) });
        await plugin.saveData(LOG_FILE, entries.slice(-LOG_LIMIT));
    } catch {
        // 日志本身失败就放弃，不影响主流程
    }
    console.warn(`[glean-ai] ${stage} ${docId}: ${message}`);
}

/** 伴读动作的失败留痕（D-0030）：与富化共写 ai-log.json。 */
export async function logAiEvent(plugin: Plugin, docId: string, stage: string, message: string): Promise<void> {
    await appendLog(plugin, docId, stage, message);
}

export interface DuplicateWarning {
    id: string;
    title: string;
}

export interface EnrichOutcome {
    ok: boolean;
    /** 语义查重告警（可能已有相似文章），供 UI 提示 */
    duplicates: DuplicateWarning[];
    /** 未富化的原因：off / cap / parse / error；成功为空串 */
    skipped?: string;
}

/** LLM 通道路由：custom=拾遗专用直连（失败转 reason）；siyuan=官方通道。伴读动作复用（D-0030）。 */
export async function callLLM(
    plugin: Plugin,
    settings: GleanSettings,
    msg: string
): Promise<{ ok: boolean; text?: string; reason?: string }> {
    if (settings.ai.channel === "custom") {
        return chatCompletionDirect(plugin, settings, msg);
    }
    try {
        return { ok: true, text: await chatGPT(msg) };
    } catch (error) {
        return { ok: false, reason: String((error as Error)?.message ?? error).slice(0, 160) };
    }
}

/** 单篇富化（串行队列执行）。关闭模式不调用模型；每日上限由队列内统一把守。 */
export function enrichClip(plugin: Plugin, docId: string, settings: GleanSettings, options: Pick<WriteClipOptions, "expectedAttrs" | "expectedLocation"> = {}): Promise<EnrichOutcome> {
    if (!aiEnabled(activeAiSettings(plugin, settings))) {
        return Promise.resolve({ ok: false, duplicates: [], skipped: "off" });
    }
    const expected = {
        ...(options.expectedAttrs ? { expectedAttrs: { ...options.expectedAttrs } } : {}),
        ...(options.expectedLocation ? { expectedLocation: { ...options.expectedLocation } } : {}),
    };
    return enqueueEnrich(() => enrichClipInner(plugin, docId, settings, expected));
}

async function enrichClipInner(plugin: Plugin, docId: string, settings: GleanSettings, options: Pick<WriteClipOptions, "expectedAttrs" | "expectedLocation">): Promise<EnrichOutcome> {
    let currentSettings = activeAiSettings(plugin, settings);
    if (!aiEnabled(currentSettings)) return { ok: false, duplicates: [], skipped: "off" };
    try {
        if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, duplicates: [], skipped: "cap" };
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const titleMatch = markdown.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : "";
        const plain = stripMarkdown(markdown).trim();
        if (!plain) {
            await appendLog(plugin, docId, "content", "文章正文为空，已跳过");
            return { ok: false, duplicates: [], skipped: "error" };
        }
        currentSettings = activeAiSettings(plugin, settings);
        if (!aiEnabled(currentSettings)) return { ok: false, duplicates: [], skipped: "off" };
        if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, duplicates: [], skipped: "cap" };
        currentSettings = activeAiSettings(plugin, settings);
        if (!aiEnabled(currentSettings)) return { ok: false, duplicates: [], skipped: "off" };
        const prompt = buildEnrichPrompt(title, plain);
        const llm = await callLLM(plugin, currentSettings, prompt);
        if (!llm.ok) {
            await appendLog(plugin, docId, "llm", "模型调用失败，已跳过");
            return { ok: false, duplicates: [], skipped: "error" };
        }
        await recordAiUsage(plugin);
        currentSettings = activeAiSettings(plugin, settings);
        if (!aiEnabled(currentSettings)) return { ok: false, duplicates: [], skipped: "off" };
        const parsed: EnrichResult | null = parseEnrichResponse(typeof llm.text === "string" ? llm.text : "");
        if (!parsed) {
            await appendLog(plugin, docId, "parse", "模型响应无法解析为 JSON，已跳过");
            return { ok: false, duplicates: [], skipped: "parse" };
        }
        await writeClip(plugin, docId, { summary: parsed.summary, aiTags: parsed.tags }, options);
        const duplicates = currentSettings.ai.dedupOnEnrich
            ? await findDuplicates(plugin, docId, title || parsed.summary)
            : [];
        return { ok: true, duplicates };
    } catch {
        await appendLog(plugin, docId, "enrich", "富化失败，已跳过");
        return { ok: false, duplicates: [], skipped: "error" };
    }
}

async function confirmedSemanticHits(hits: SemanticSearchHit[]): Promise<DuplicateWarning[]> {
    const ids = [...new Set(hits.map((hit) => hit.id).filter((id) => /^\d{14}-[0-9a-z]{7}$/.test(id)))];
    if (ids.length === 0) return [];
    const [pairs, docs] = await Promise.all([
        batchReadClipAttrs(ids),
        querySql<{ id: string; content: string; hpath: string; type: string }>(
            `SELECT id, content, hpath, type FROM blocks WHERE type = 'd' AND id IN (${ids.map((id) => `'${id}'`).join(",")})`
        ),
    ]);
    const attrsById = new Map(pairs.map((pair) => [pair.id, parseClipAttrs(pair.attrs)]));
    const docsById = new Map(docs.filter((doc) => doc.type === "d").map((doc) => [doc.id, doc]));
    return ids.flatMap((id) => {
        const attrs = attrsById.get(id);
        const doc = docsById.get(id);
        if (!attrs?.status || attrs.internal || attrs.excluded || !doc || isInternalDocument({ title: doc.content, hpath: doc.hpath })) return [];
        return [{ id, title: (doc.content ?? "").slice(0, 80) }];
    });
}

/** 语义查重：嵌入未启用 → 静默返回空；启用 → 语义搜索 + 标题相似过滤。 */
export async function findDuplicates(plugin: Plugin, docId: string, query: string): Promise<DuplicateWarning[]> {
    if (!query.trim()) return [];
    try {
        const stat = await embeddingStat();
        if (!stat?.enabled) return [];
        const hits = await semanticSearchBlock({ query, types: { d: true }, page: 1, pageSize: 8 });
        const confirmed = await confirmedSemanticHits(hits.filter((hit) => hit.id && hit.id !== docId));
        return confirmed.filter((hit) => isLikelyDuplicate(query, hit.title));
    } catch {
        await appendLog(plugin, docId, "dedup", "语义查重不可用，已跳过");
        return [];
    }
}

/**
 * 富化串行队列：批量收录时任务逐个执行（T-1300d），避免并发打满模型/触发限流。
 * 手动富化也走同一队列，防止对同一篇并发调用。
 */
let enrichQueue: Promise<unknown> = Promise.resolve();

export function enqueueEnrich<T>(task: () => Promise<T>): Promise<T> {
    const run = enrichQueue.then(task, task);
    enrichQueue = run.catch(() => undefined);
    return run;
}

/**
 * 收录自动富化入口（fire-and-forget）：仅在 enrichMode==="auto" 时执行；绝不阻塞收录主流程。
 * 上限在 enrichClip 内统一把守（auto 与 manual 共享额度）。
 */
export function autoEnrich(plugin: Plugin, docId: string, settings: GleanSettings): void {
    if (activeAiSettings(plugin, settings).ai.enrichMode !== "auto") return;
    // enrichClip 已负责入队；这里再次 enqueue 会让当前任务等待排在自己后面的任务，永远无法结束。
    void enrichClip(plugin, docId, settings);
}

/** 相关旧文（T-1301）：嵌入未启用返回空数组（UI 整块隐藏）。 */
export async function findRelated(
    docId: string,
    query: string,
    excludeIds: string[] = [],
    context?: { plugin: Plugin; settings: GleanSettings }
): Promise<Array<{ id: string; title: string }>> {
    if (!context || !query.trim()) return [];
    const enabled = () => {
        const current = activeAiSettings(context.plugin, context.settings);
        return aiEnabled(current) && current.ai.relatedWhileReading;
    };
    if (!enabled()) return [];
    try {
        const stat = await embeddingStat();
        if (!stat?.enabled || !enabled()) return [];
        const hits = await semanticSearchBlock({ query, types: { d: true }, page: 1, pageSize: 8 });
        const exclude = new Set([docId, ...excludeIds]);
        const confirmed = await confirmedSemanticHits(hits.filter((hit) => hit.id && !exclude.has(hit.id)));
        return enabled() ? confirmed : [];
    } catch {
        return [];
    }
}

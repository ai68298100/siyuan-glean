/**
 * AI 富化管线（T-1300，D-0004/D-0007 红线）：
 * 收录/手动触发 → 取正文 → chatGPT 摘要+AI 标签 → 写 custom-clip-summary/ai-tags（永不碰手填字段）
 * → 语义查重（先查 embeddingStat.enabled，未启用/失败静默跳过）。
 * 失败一律静默：写 ai-log.json（最近 50 条）+ console，绝不阻断收录主流程。
 */
import type { Plugin } from "siyuan";
import { chatGPT } from "../api/ai";
import { embeddingStat, exportMdContent, semanticSearchBlock } from "../api/client";
import { stripMarkdown } from "../domain/migrate";
import { todayStamp } from "../domain/resurface";
import { buildEnrichPrompt, isLikelyDuplicate, parseEnrichResponse, type EnrichResult } from "../domain/enrich";
import { writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

const LOG_FILE = "ai-log.json";
const LOG_LIMIT = 50;
const USAGE_FILE = "ai-usage.json";

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
    const usage = await loadUsage(plugin);
    return usage.date === todayStamp() ? usage.count : 0;
}

async function loadUsage(plugin: Plugin): Promise<AiUsage> {
    try {
        const raw = await plugin.loadData(USAGE_FILE);
        if (raw && typeof raw === "object" && typeof (raw as AiUsage).date === "string") return raw as AiUsage;
    } catch { /* 忽略 */ }
    return { date: "", count: 0 };
}

async function incUsage(plugin: Plugin): Promise<number> {
    const usage = await loadUsage(plugin);
    const today = todayStamp();
    const count = usage.date === today ? usage.count + 1 : 1;
    await plugin.saveData(USAGE_FILE, { date: today, count });
    return count;
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

export interface DuplicateWarning {
    id: string;
    title: string;
}

export interface EnrichOutcome {
    ok: boolean;
    /** 语义查重告警（可能已有相似文章），供 UI 提示 */
    duplicates: DuplicateWarning[];
    /** 未富化的原因（供测试与日志）：parse / error；成功为空串 */
    skipped?: string;
}

/** 单篇富化（串行队列执行）。任何失败静默返回 ok:false，不抛错；每日上限超限返回 skipped:"cap"。 */
export function enrichClip(plugin: Plugin, docId: string, settings: GleanSettings): Promise<EnrichOutcome> {
    return enqueueEnrich(() => enrichClipInner(plugin, docId, settings));
}

async function enrichClipInner(plugin: Plugin, docId: string, settings: GleanSettings): Promise<EnrichOutcome> {
    if (settings.ai.enrichDailyCap > 0 && (await usageToday(plugin)) >= settings.ai.enrichDailyCap) {
        return { ok: false, duplicates: [], skipped: "cap" };
    }
    try {
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const titleMatch = markdown.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : "";
        const plain = stripMarkdown(markdown);
        const prompt = buildEnrichPrompt(title, plain);
        const raw = await chatGPT(prompt);
        const parsed: EnrichResult | null = parseEnrichResponse(raw);
        if (!parsed) {
            await appendLog(plugin, docId, "parse", "模型响应无法解析为 JSON，已跳过");
            return { ok: false, duplicates: [], skipped: "parse" };
        }
        await writeClip(plugin, docId, { summary: parsed.summary, aiTags: parsed.tags });
        await incUsage(plugin);
        const duplicates = settings.ai.dedupOnEnrich
            ? await findDuplicates(plugin, docId, title || parsed.summary)
            : [];
        return { ok: true, duplicates };
    } catch (error) {
        await appendLog(plugin, docId, "enrich", String((error as Error)?.message ?? error));
        return { ok: false, duplicates: [], skipped: "error" };
    }
}

/** 语义查重：嵌入未启用 → 静默返回空；启用 → 语义搜索 + 标题相似过滤。 */
export async function findDuplicates(plugin: Plugin, docId: string, query: string): Promise<DuplicateWarning[]> {
    try {
        const stat = await embeddingStat();
        if (!stat?.enabled) return [];
        const hits = await semanticSearchBlock({ query, types: { d: true }, page: 1, pageSize: 8 });
        return hits
            .filter((hit) => hit.id && hit.id !== docId)
            .filter((hit) => isLikelyDuplicate(query, hit.content ?? ""))
            .map((hit) => ({ id: hit.id, title: (hit.content ?? "").slice(0, 80) }));
    } catch (error) {
        await appendLog(plugin, docId, "dedup", String((error as Error)?.message ?? error));
        return [];
    }
}

/**
 * 富化串行队列：批量收录时任务逐个执行（T-1300d），避免并发打满模型/触发限流。
 * 手动富化也走同一队列，防止对同一篇并发调用。
 */
let enrichQueue: Promise<unknown> = Promise.resolve();

function enqueueEnrich<T>(task: () => Promise<T>): Promise<T> {
    const run = enrichQueue.then(task, task);
    enrichQueue = run.catch(() => undefined);
    return run;
}

/**
 * 收录自动富化入口（fire-and-forget）：仅在 enrichMode==="auto" 时执行；绝不阻塞收录主流程。
 * 上限在 enrichClip 内统一把守（auto 与 manual 共享额度）。
 */
export function autoEnrich(plugin: Plugin, docId: string, settings: GleanSettings): void {
    if (settings.ai.enrichMode !== "auto") return;
    void enqueueEnrich(() => enrichClip(plugin, docId, settings));
}

/** 相关旧文（T-1301）：嵌入未启用返回空数组（UI 整块隐藏）。 */
export async function findRelated(
    docId: string,
    query: string,
    excludeIds: string[] = []
): Promise<Array<{ id: string; title: string }>> {
    try {
        const stat = await embeddingStat();
        if (!stat?.enabled) return [];
        const hits = await semanticSearchBlock({ query, types: { d: true }, page: 1, pageSize: 8 });
        const exclude = new Set([docId, ...excludeIds]);
        return hits
            .filter((hit) => hit.id && !exclude.has(hit.id))
            .map((hit) => ({ id: hit.id, title: (hit.content ?? "").slice(0, 80) }));
    } catch {
        return [];
    }
}

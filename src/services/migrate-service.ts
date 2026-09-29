/**
 * 存量迁移器（T-1102）：把历史剪藏文章的来源 URL/入库时间等回填为文档属性。
 * 铁律：dry-run 报告优先；分批写入（≤50/批）可中断续跑；幂等（已有 custom-clip-url 的文档跳过）；
 * 用户手填字段永不覆盖（schema 层 USER_GUARDED + 这里跳过已收录文档双保险）。
 */
import type { Plugin } from "siyuan";
import { exportMdContent, type DocRow } from "../api/client";
import { inspectCandidate, hasValidClipStatus, type CandidateEvidence, type CandidateMissing } from "../domain/candidate-policy";
import { inspectClipMarkdown } from "../domain/content";
import { ATTR, documentTimeFromId, siteFromUrl, siyuanTimestamp, type ClipContentType, type ClipTimeSource } from "../domain/schema";
import { normalizeUrl } from "../domain/url";
import { batchReadClipAttrs, captureClip, findClipUrlConflict, listAnchorDocs, scanDocScopes, writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

export type MigrateRowState = "pending" | "ok" | "skipped" | "manual" | "error";

export interface MigrateRow {
    id: string;
    title: string;
    hpath: string;
    box: string;
    /** dry-run 发现的来源 URL（空串 = 正文里没找到，回填后归入手填类） */
    url: string;
    site: string;
    words: number;
    minutes: number;
    contentType?: ClipContentType;
    time?: string;
    timeSource?: ClipTimeSource;
    /** dry-run 发现的来源证据，供预览解释候选为何出现。 */
    evidence?: CandidateEvidence[];
    /** 需要用户补齐的属性，当前为 url/status 子集。 */
    missing?: CandidateMissing[];
    /** 预览阶段的用户决策；执行之前绝不写入文档。 */
    resolution?: "url" | "local" | "exclude";
    /** URL 冲突时，用户明确允许仍保留第二份。 */
    allowDuplicate?: boolean;
    /** 已有相同来源文章的文档 ID，供 UI 打开核对。 */
    conflictDocId?: string;
    state: MigrateRowState;
    detail?: string;
}

export interface MigrateProgress {
    version: 1;
    rows: MigrateRow[];
    cursor: number;
    finished: boolean;
    startedAt: string;
    updatedAt: string;
}

const PROGRESS_FILE = "migrate-progress.json";

export async function loadMigrateProgress(plugin: Plugin): Promise<MigrateProgress | null> {
    try {
        const raw = await plugin.loadData(PROGRESS_FILE);
        if (!raw || !Array.isArray((raw as MigrateProgress).rows)) return null;
        return raw as MigrateProgress;
    } catch {
        return null;
    }
}

async function saveProgress(plugin: Plugin, progress: MigrateProgress): Promise<void> {
    progress.updatedAt = new Date().toISOString();
    await plugin.saveData(PROGRESS_FILE, progress);
}

export async function clearMigrateProgress(plugin: Plugin): Promise<void> {
    await plugin.removeData(PROGRESS_FILE);
}

/** 用户确认 dry-run 报告后才建立任务；扫描本身不写文档属性。 */
export async function startMigrateProgress(plugin: Plugin, rows: MigrateRow[]): Promise<MigrateProgress> {
    const now = new Date().toISOString();
    const progress: MigrateProgress = {
        version: 1,
        rows: rows.map((row) => ({ ...row })),
        cursor: 0,
        finished: false,
        startedAt: now,
        updatedAt: now,
    };
    await saveProgress(plugin, progress);
    return progress;
}

function retryable(row: MigrateRow): boolean {
    return row.state === "error" && (!!row.url || !!row.resolution);
}

/** 完成一次尝试后仅重排写入失败的行；扫描失败仍需重新扫描。 */
export async function retryMigrateErrors(plugin: Plugin): Promise<MigrateProgress> {
    const progress = await loadMigrateProgress(plugin);
    if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
    const first = progress.rows.findIndex(retryable);
    if (first < 0) return progress;
    for (const row of progress.rows) {
        if (retryable(row)) {
            row.state = "pending";
            delete row.detail;
        }
    }
    progress.cursor = first;
    progress.finished = false;
    await saveProgress(plugin, progress);
    return progress;
}

export type MigrateDecision =
    | { kind: "url"; url: string; allowDuplicate?: boolean }
    | { kind: "local" }
    | { kind: "exclude" };

/** dry-run 行裁决只更新内存中的执行计划，不碰文档属性或持久任务。 */
export function planMigrateRow(row: MigrateRow, decision: MigrateDecision): MigrateRow {
    if (decision.kind === "url") {
        const url = decision.url.trim();
        if (!normalizeUrl(url)) throw new Error("请输入有效的 http(s) 来源链接");
        return {
            ...row, url, site: siteFromUrl(url), state: "pending", resolution: "url",
            allowDuplicate: decision.allowDuplicate === true, conflictDocId: undefined,
            detail: undefined, missing: (row.missing ?? []).filter((item) => item !== "url"),
        };
    }
    return {
        ...row, state: "pending", resolution: decision.kind, allowDuplicate: false,
        conflictDocId: undefined, detail: undefined, missing: [],
    };
}

/** 手工裁决已保存的任务行。属性先写成功，随后同步持久任务；冲突保持待处理。 */
export async function resolveMigrateRow(
    plugin: Plugin,
    row: MigrateRow,
    decision: MigrateDecision,
): Promise<MigrateRow> {
    const progress = await loadMigrateProgress(plugin);
    if (!progress) throw new Error("请先确认迁移报告，再处理文档");
    const saved = progress.rows.find((item) => item.id === row.id);
    if (!saved) throw new Error("这篇文章不在当前迁移任务中，请重新扫描");
    if (saved.state !== "manual" && saved.state !== "error" && !(saved.state === "pending" && saved.resolution)) {
        throw new Error("这篇文章已被迁移任务处理，请刷新");
    }
    row = saved;
    const current = await batchReadClipAttrs([row.id]);
    const ial = current[0]?.attrs ?? {};
    if (decision.kind === "url") {
        const url = decision.url.trim();
        if (!normalizeUrl(url)) throw new Error("请输入有效的 http(s) 来源链接");
        if (ial[ATTR.url]) {
            // 用户在预览之后从其他入口补了来源，迁移器只修复索引，不覆盖手填值。
            await writeClip(plugin, row.id, {});
            const skipped = { ...row, state: "skipped" as const, detail: "already-clipped", conflictDocId: undefined };
            await persistResolvedRow(plugin, progress, skipped);
            return skipped;
        }
        const conflict = await findClipUrlConflict(url, row.id);
        if (conflict && !decision.allowDuplicate) {
            const unresolved: MigrateRow = {
                ...row, url, site: siteFromUrl(url), state: "manual", conflictDocId: conflict.id,
                detail: "duplicate-url", missing: (row.missing ?? []).filter((item) => item !== "url"),
            };
            await persistResolvedRow(plugin, progress, unresolved);
            return unresolved;
        }
        const markdown = (await exportMdContent(row.id))?.content ?? "";
        const metadata = inspectClipMarkdown(markdown, { url });
        if (!hasValidClipStatus(ial)) {
            const captured = await captureClip(plugin, row.id, {
                url,
                markdown,
                src: "migration",
                contentType: metadata.contentType,
                allowDuplicate: decision.allowDuplicate,
            });
            if (captured.conflict) {
                const unresolved: MigrateRow = {
                    ...row, url, site: siteFromUrl(url), state: "manual", conflictDocId: captured.conflict.id,
                    detail: "duplicate-url", missing: (row.missing ?? []).filter((item) => item !== "url"),
                };
                await persistResolvedRow(plugin, progress, unresolved);
                return unresolved;
            }
        } else {
            await writeClip(plugin, row.id, { url });
            await writeClip(plugin, row.id, {
                site: metadata.site || undefined,
                contentType: metadata.contentType,
                words: metadata.words > 0 ? metadata.words : undefined,
                minutes: metadata.minutes > 0 ? metadata.minutes : undefined,
            });
        }
        row = { ...row, url, site: metadata.site, state: "ok", resolution: undefined, conflictDocId: undefined, detail: undefined, missing: [] };
    } else if (decision.kind === "local") {
        if (ial[ATTR.url]) {
            await writeClip(plugin, row.id, {});
            const skipped = { ...row, state: "skipped" as const, detail: "already-clipped" };
            await persistResolvedRow(plugin, progress, skipped);
            return skipped;
        }
        const markdown = (await exportMdContent(row.id))?.content ?? "";
        if (!hasValidClipStatus(ial)) {
            await captureClip(plugin, row.id, { markdown, src: "migration", contentType: "local" });
        } else {
            await writeClip(plugin, row.id, { contentType: "local" });
        }
        row = { ...row, state: "ok", resolution: undefined, contentType: "local", detail: undefined, missing: [] };
    } else {
        await writeClip(plugin, row.id, { excluded: true });
        row = { ...row, state: "skipped", resolution: undefined, detail: "user-excluded", missing: [] };
    }
    await persistResolvedRow(plugin, progress, row);
    return row;
}

async function persistResolvedRow(plugin: Plugin, progress: MigrateProgress | null, row: MigrateRow): Promise<void> {
    if (progress) {
        const index = progress.rows.findIndex((item) => item.id === row.id);
        if (index >= 0) {
            progress.rows[index] = row;
            await saveProgress(plugin, progress);
        }
    }
}

async function resolvePlannedRow(plugin: Plugin, row: MigrateRow): Promise<MigrateRow> {
    if (row.resolution === "exclude") {
        await writeClip(plugin, row.id, { excluded: true });
        return { ...row, state: "skipped", resolution: undefined, detail: "user-excluded", missing: [] };
    }
    const ial = (await batchReadClipAttrs([row.id]))[0]?.attrs;
    if (!ial) throw new Error("无法读取文档属性");
    if (ial[ATTR.url]) {
        await writeClip(plugin, row.id, {});
        return { ...row, state: "skipped", resolution: undefined, detail: "already-clipped" };
    }
    const markdown = (await exportMdContent(row.id))?.content ?? "";
    if (!hasValidClipStatus(ial)) {
        await captureClip(plugin, row.id, { markdown, src: "migration", contentType: "local" });
    } else {
        await writeClip(plugin, row.id, { contentType: "local" });
    }
    return { ...row, state: "ok", resolution: undefined, contentType: "local", detail: undefined, missing: [] };
}

/**
 * dry-run：完整扫描状态/URL 次锚点、主锚点笔记本与跨笔记本 #剪藏 标签 →
 * 按文档 ID 去重 → 排除已收录 → 逐篇导出 markdown 提取 URL 候选 → 生成报告
 *（不写入任何属性）。测试替身若尚未提供 scanDocScopes，则退回旧的锚点查询。
 */
export async function buildDryRunReport(settings: GleanSettings): Promise<MigrateRow[]> {
    const scanned = typeof scanDocScopes === "function" ? await scanDocScopes(settings) : null;
    const rowsToProbe = scanned?.all ?? await listAnchorDocs(settings.anchorNotebooks, 5000);
    const attrPairs = await batchReadClipAttrs(rowsToProbe.map((row) => row.id));
    const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));

    const rows: MigrateRow[] = [];
    for (const row of rowsToProbe) {
        const ial = attrsById.get(row.id) ?? {};
        // 迁移器只回填缺来源的历史文档；URL-only 半成品留在候选区，
        // 必须经过用户显式“加入读库”才补状态，避免预览执行时悄悄入队。
        // status-only 文档仍需导出正文寻找来源。
        if (ial[ATTR.url] || (ial[ATTR.contentType] === "local" && hasValidClipStatus(ial))) {
            rows.push({
                id: row.id,
                title: row.content || "",
                hpath: row.hpath || "",
                box: row.box || "",
                url: "",
                site: "",
                words: 0,
                minutes: 0,
                contentType: undefined,
                state: "skipped",
                detail: "already-clipped",
                evidence: ["url-attribute"],
                missing: [],
            });
            continue;
        }
        const probed = await probeRow(row, ial);
        if (probed) rows.push(probed);
    }
    return rows;
}

async function probeRow(
    row: DocRow,
    ial: Record<string, string | undefined> = {},
): Promise<MigrateRow | null> {
    const base: MigrateRow = {
        id: row.id,
        title: row.content || "",
        hpath: row.hpath || "",
        box: row.box || "",
        url: "",
        site: "",
        words: 0,
        minutes: 0,
        state: "pending",
    };
    try {
        const exported = await exportMdContent(row.id);
        const markdown = exported?.content ?? "";
        const candidate = inspectCandidate({
            ial,
            markdown,
            title: row.content || "",
            hpath: row.hpath || "",
            tags: row.tag || ial.tags || "",
        });
        // An anchor notebook is only a search boundary. Ordinary documents with no
        // source evidence are omitted so a scan cannot turn a whole notebook into
        // an apparent backlog. A status-only old clip remains visible as manual.
        if (!candidate.eligible && !hasValidClipStatus(ial)) return null;
        if (candidate.internal || candidate.excluded) return null;
        const metadata = inspectClipMarkdown(markdown, { url: candidate.url });
        const documentTime = documentTimeFromId(row.id);
        return {
            ...base,
            // Metadata's broad URL extraction must not turn an incidental inline
            // link into source evidence; candidate policy owns URL eligibility.
            url: candidate.url,
            site: candidate.site,
            words: metadata.words,
            minutes: metadata.minutes,
            contentType: candidate.url ? metadata.contentType : undefined,
            time: documentTime ?? undefined,
            timeSource: documentTime ? "document" : "capture",
            state: candidate.url ? "pending" : "manual",
            evidence: candidate.evidence,
            missing: candidate.missing,
            detail: candidate.evidence.length > 0 ? undefined : "missing-source-url",
        };
    } catch (error) {
        return { ...base, state: "error", detail: String(error).slice(0, 120) };
    }
}

export interface BackfillTick {
    processed: number;
    ok: number;
    skipped: number;
    manual: number;
    errors: number;
    finished: boolean;
}

/**
 * 分批回填：从 progress.cursor 继续，每批 settings.migrateBatchSize 篇；
 * 返回 tick 供 UI 展示进度；cursor 到尾或用户中断时返回。
 * 写入策略（时间戳幂等）：优先用文档 ID 时间，无法识别时取执行时刻；
 * status=inbox；src=migration。来源的可信程度另存 timeSource。
 */
export async function runBackfillBatch(
    plugin: Plugin,
    settings: GleanSettings,
    opts: { signal?: { aborted: boolean } } = {}
): Promise<BackfillTick> {
    const progress = await loadMigrateProgress(plugin);
    if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
    if (progress.finished) {
        return tickOf(progress, progress.rows.length, true);
    }

    const batchSize = Math.min(Math.max(1, settings.migrateBatchSize), 50);
    const end = Math.min(progress.cursor + batchSize, progress.rows.length);
    const pendingIds = progress.rows.slice(progress.cursor, end)
        .filter((row) => row.state === "pending" && !!row.url && row.resolution !== "local" && row.resolution !== "exclude")
        .map((row) => row.id);
    const attrsById = new Map(
        (await batchReadClipAttrs(pendingIds)).map((pair) => [pair.id, pair.attrs])
    );
    const stamped = siyuanTimestamp();

    for (let i = progress.cursor; i < end; i += 1) {
        if (opts.signal?.aborted) break;
        const row = progress.rows[i];
        if (row.state === "pending") {
            if (row.resolution === "exclude" || row.resolution === "local") {
                try {
                    const resolved = await resolvePlannedRow(plugin, row);
                    progress.rows[i] = resolved;
                } catch (error) {
                    row.state = "error";
                    row.detail = String(error).slice(0, 120);
                }
            } else if (!row.url) {
                row.state = "manual";
            } else {
                const ial = attrsById.get(row.id);
                if (!ial) {
                    row.state = "error";
                    row.detail = "无法读取文档属性";
                } else if (ial[ATTR.url]) {
                    try {
                        // 上次属性写成但索引同步失败时，空补丁可恢复派生索引；不改已有属性。
                        await writeClip(plugin, row.id, {});
                        row.state = "skipped";
                        row.detail = "already-clipped";
                    } catch (error) {
                        row.state = "error";
                        row.detail = String(error).slice(0, 120);
                    }
                } else {
                    try {
                        const conflict = await findClipUrlConflict(row.url, row.id);
                        if (conflict && !row.allowDuplicate) {
                            row.state = "manual";
                            row.conflictDocId = conflict.id;
                            row.detail = "duplicate-url";
                        } else {
                            const patch: Parameters<typeof writeClip>[2] = { url: row.url, src: "migration" };
                            if (!ial[ATTR.site] && row.site) patch.site = row.site;
                            if (!ial[ATTR.time]) {
                                patch.time = row.time ?? documentTimeFromId(row.id) ?? stamped;
                                patch.timeSource = row.timeSource ?? (documentTimeFromId(row.id) ? "document" : "capture");
                            }
                            if (!ial[ATTR.words] && row.words > 0) patch.words = row.words;
                            if (!ial[ATTR.minutes] && row.minutes > 0) patch.minutes = row.minutes;
                            if (!ial[ATTR.contentType] && row.contentType) patch.contentType = row.contentType;
                            // 旧文已有状态时只补缺失字段，绝不把它改回 inbox。
                            if (!ial[ATTR.status]) patch.status = "inbox";
                            const result = await writeClip(plugin, row.id, patch);
                            if (result.skippedKeys.includes(ATTR.url)) {
                                row.state = "skipped";
                                row.detail = "already-clipped";
                            } else {
                                row.state = "ok";
                                delete row.detail;
                            }
                        }
                    } catch (error) {
                        row.state = "error";
                        row.detail = String(error).slice(0, 120);
                    }
                }
            }
        }
        progress.cursor = i + 1;
        progress.finished = progress.cursor >= progress.rows.length;
        await saveProgress(plugin, progress);
    }

    if (progress.cursor >= progress.rows.length && !progress.finished) {
        progress.finished = true;
        await saveProgress(plugin, progress);
    }
    return tickOf(progress, progress.cursor, progress.finished);
}

function tickOf(progress: MigrateProgress, processed: number, finished: boolean): BackfillTick {
    let ok = 0;
    let skipped = 0;
    let manual = 0;
    let errors = 0;
    for (const row of progress.rows) {
        if (row.state === "ok") ok += 1;
        else if (row.state === "skipped") skipped += 1;
        else if (row.state === "manual") manual += 1;
        else if (row.state === "error") errors += 1;
    }
    return { processed, ok, skipped, manual, errors, finished };
}

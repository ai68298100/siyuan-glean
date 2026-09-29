/**
 * 存量迁移器（T-1102）：把历史剪藏文章的来源 URL/入库时间等回填为文档属性。
 * 铁律：dry-run 报告优先；分批写入（≤50/批）可中断续跑；幂等（已有 custom-clip-url 的文档跳过）；
 * 用户手填字段永不覆盖（schema 层 USER_GUARDED + 这里跳过已收录文档双保险）。
 */
import type { Plugin } from "siyuan";
import { exportMdContent, type DocRow } from "../api/client";
import { bestUrlCandidate, stripMarkdown } from "../domain/migrate";
import { ATTR, countWords, estimateMinutes, siteFromUrl, siyuanTimestamp } from "../domain/schema";
import { batchReadClipAttrs, listAnchorDocs, writeClip } from "./clip-store";
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

/** 完成一次尝试后仅重排写入失败的行；扫描失败仍需重新扫描。 */
export async function retryMigrateErrors(plugin: Plugin): Promise<MigrateProgress> {
    const progress = await loadMigrateProgress(plugin);
    if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
    const first = progress.rows.findIndex((row) => row.state === "error" && !!row.url);
    if (first < 0) return progress;
    for (const row of progress.rows) {
        if (row.state === "error" && row.url) {
            row.state = "pending";
            delete row.detail;
        }
    }
    progress.cursor = first;
    progress.finished = false;
    await saveProgress(plugin, progress);
    return progress;
}

/**
 * dry-run：扫描锚点笔记本 → 排除已收录 → 逐篇导出 markdown 提取 URL 候选 →
 * 生成报告（不写入任何属性）。
 */
export async function buildDryRunReport(settings: GleanSettings): Promise<MigrateRow[]> {
    const anchorRows = await listAnchorDocs(settings.anchorNotebooks, 5000);
    const attrPairs = await batchReadClipAttrs(anchorRows.map((row) => row.id));
    const hasAttrs = new Set(
        attrPairs
            // 只有已有来源 URL 才是幂等跳过；status-only 旧文仍需补来源与元数据。
            .filter((pair) => pair.attrs[ATTR.url])
            .map((pair) => pair.id)
    );

    const rows: MigrateRow[] = [];
    for (const row of anchorRows) {
        if (hasAttrs.has(row.id)) {
            rows.push({
                id: row.id,
                title: row.content || "",
                hpath: row.hpath || "",
                box: row.box || "",
                url: "",
                site: "",
                words: 0,
                minutes: 0,
                state: "skipped",
                detail: "already-clipped",
            });
            continue;
        }
        rows.push(await probeRow(row));
    }
    return rows;
}

async function probeRow(row: DocRow): Promise<MigrateRow> {
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
        const candidate = bestUrlCandidate(markdown);
        const words = countWords(stripMarkdown(markdown));
        return {
            ...base,
            url: candidate?.url ?? "",
            site: candidate ? siteFromUrl(candidate.url) : "",
            words,
            minutes: estimateMinutes(words),
            state: candidate ? "pending" : "manual",
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
 * 写入策略（时间戳幂等）：time 一律取"现在"一次性补齐；status=inbox；src=migration。
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
        .filter((row) => row.state === "pending" && !!row.url)
        .map((row) => row.id);
    const attrsById = new Map(
        (await batchReadClipAttrs(pendingIds)).map((pair) => [pair.id, pair.attrs])
    );
    const stamped = siyuanTimestamp();

    for (let i = progress.cursor; i < end; i += 1) {
        if (opts.signal?.aborted) break;
        const row = progress.rows[i];
        if (row.state === "pending") {
            if (!row.url) {
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
                        const patch: Parameters<typeof writeClip>[2] = { url: row.url, src: "migration" };
                        if (!ial[ATTR.site] && row.site) patch.site = row.site;
                        if (!ial[ATTR.time]) patch.time = stamped;
                        if (!ial[ATTR.words] && row.words > 0) patch.words = row.words;
                        if (!ial[ATTR.minutes] && row.minutes > 0) patch.minutes = row.minutes;
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

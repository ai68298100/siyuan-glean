/**
 * 存量迁移器（T-1102）：把历史剪藏文章的来源 URL/入库时间等回填为文档属性。
 * 铁律：dry-run 报告优先；分批写入（≤50/批）可中断续跑；幂等（已有 custom-clip-url 的文档跳过）；
 * 用户手填字段永不覆盖（schema 层 USER_GUARDED + 这里跳过已收录文档双保险）。
 */
import type { Plugin } from "siyuan";
import { batchGetBlockAttrs, batchSetBlockAttrs, exportMdContent, type DocRow } from "../api/client";
import { bestUrlCandidate, stripMarkdown } from "../domain/migrate";
import { countWords, estimateMinutes, siteFromUrl, siyuanTimestamp } from "../domain/schema";
import { listAnchorDocs } from "./clip-store";
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

/**
 * dry-run：扫描锚点笔记本 → 排除已收录 → 逐篇导出 markdown 提取 URL 候选 →
 * 生成报告（不写入任何属性）。
 */
export async function buildDryRunReport(settings: GleanSettings): Promise<MigrateRow[]> {
    const anchorRows = await listAnchorDocs(settings.anchorNotebooks, 5000);
    const attrPairs = await batchGetBlockAttrs(anchorRows.map((row) => row.id));
    const hasAttrs = new Set(
        attrPairs
            .filter((pair) => pair.attrs["custom-clip-url"] || pair.attrs["custom-clip-status"])
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
    let progress = await loadMigrateProgress(plugin);
    if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
    if (progress.finished) {
        return tickOf(progress, progress.rows.length, true);
    }

    const batchSize = Math.min(settings.migrateBatchSize, 50);
    const end = Math.min(progress.cursor + batchSize, progress.rows.length);
    const reqs: { id: string; attrs: Record<string, string | null> }[] = [];
    const stamped = siyuanTimestamp();

    for (let i = progress.cursor; i < end; i += 1) {
        const row = progress.rows[i];
        if (row.state !== "pending") continue;
        if (!row.url) {
            row.state = "manual";
            continue;
        }
        reqs.push({
            id: row.id,
            attrs: {
                "custom-clip-url": row.url,
                "custom-clip-site": row.site,
                "custom-clip-time": stamped,
                "custom-clip-status": "inbox",
                "custom-clip-words": String(row.words),
                "custom-clip-minutes": String(row.minutes),
                "custom-clip-src": "migration",
            },
        });
    }

    if (reqs.length > 0) {
        await batchSetBlockAttrs(reqs);
        for (const req of reqs) {
            const row = progress.rows.find((item) => item.id === req.id);
            if (row) row.state = "ok";
        }
    }

    progress.cursor = end;
    progress.finished = end >= progress.rows.length || opts.signal?.aborted === true;
    await saveProgress(plugin, progress);
    return tickOf(progress, end, progress.finished);
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

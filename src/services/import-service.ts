/**
 * 迁移导入服务（T-1501）：外部导出文件 → 思源文档 + 读库属性。
 * 流程：解析 → 与库内 custom-clip-url 去重 → 批量建文档（≤50/批）→ captureClip（写入来源 URL/时间/标签）。
 * 幂等：库内已有同 URL 的条目跳过；文件内重复 URL 在解析层已去重。
 * 标签落位：外部标签写入文档根块 IAL 的 tags（用户标签位，不用 ai-tags）——尊重"标签是用户的"。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd, newNodeId } from "../api/client";
import { ATTR, parseClipAttrs, siyuanTimestamp } from "../domain/schema";
import { siteFromUrl } from "../domain/schema";
import type { ImportFormat, ImportedItem, ParseResult } from "../domain/importers";
import { parseImport } from "../domain/importers";
import { normalizeUrl } from "../domain/url";
import { batchReadClipAttrs, captureClip, ClipRestoreError, findClipUrlConflict, listClipDocs, readClipAttributeSnapshot, writeClip } from "./clip-store";
import { ImportProgressError, isImportFingerprint, isImportId, normalizeImportFolder, recoverImportProgress, type ImportFailureReason, type ImportProgress } from "../domain/import-progress";
import { isInternalDocument } from "../domain/candidate-policy";
import { fingerprintImportSource, readImportProgress, saveImportProgress, withImportLock } from "./import-progress";

export interface ImportPreviewRow {
    title: string;
    url: string;
    site: string;
    time: string;
    /** 导出文件里的可靠已读时间；空串 = 未知，导入后完成时间待用户显式标记（D-0028） */
    doneTime: string;
    tags: string[];
    status: ImportedItem["status"];
    /** 库内已有同 URL，导入时将跳过 */
    duplicate: boolean;
}

export interface ImportPreview {
    fingerprint: string;
    format: ImportFormat | null;
    rows: ImportPreviewRow[];
    duplicateCount: number;
}

export interface ImportStatusSummary {
    status: ImportPreviewRow["status"];
    count: number;
}

/** 解析文件内容并标记库内重复项。 */
export async function previewImport(content: string, format: ImportFormat | "auto", fingerprint?: string): Promise<ImportPreview> {
    const sourceFingerprint = fingerprint ?? await fingerprintImportSource(new TextEncoder().encode(content));
    if (!isImportFingerprint(sourceFingerprint)) throw new ImportProgressError("file");
    const parsed: ParseResult = parseImport(content, format);
    const existingUrls = await collectExistingUrls();
    const rows: ImportPreviewRow[] = parsed.items.map((item) => ({
        title: item.title,
        url: item.url,
        site: item.site,
        time: item.time,
        doneTime: item.doneTime,
        tags: item.tags,
        status: item.status,
        duplicate: existingUrls.has(normalizeUrl(item.url)),
    }));
    return {
        fingerprint: sourceFingerprint,
        format: parsed.format,
        rows,
        duplicateCount: rows.filter((row) => row.duplicate).length,
    };
}

/** 统计去重后实际会写入的目标状态，供预览确认使用。 */
export function summarizeImportStatuses(rows: ImportPreviewRow[]): ImportStatusSummary[] {
    const counts = new Map<ImportPreviewRow["status"], number>();
    for (const row of rows) {
        if (row.duplicate) continue;
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return (["inbox", "done", "archived"] as const)
        .filter((status) => (counts.get(status) ?? 0) > 0)
        .map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

/** 全库已有 clip URL 集合；导入前必须读完次锚点的全部分页。 */
async function collectExistingUrls(exceptDocIds: ReadonlySet<string> = new Set()): Promise<Set<string>> {
    const pageSize = 500;
    const urls = new Set<string>();
    const seenIds = new Set<string>();
    let offset = 0;
    while (true) {
        const docs = await listClipDocs(pageSize, offset);
        if (docs.length === 0) break;
        const freshIds = docs.map((doc) => doc.id).filter((id) => !seenIds.has(id));
        if (docs.length === pageSize && freshIds.length === 0) {
            throw new Error("导入查重分页未前进，无法确认全库 URL");
        }
        for (const id of freshIds) seenIds.add(id);
        const attrPairs = await batchReadClipAttrs(freshIds);
        for (const pair of attrPairs) {
            if (exceptDocIds.has(pair.id)) continue;
            const key = normalizeUrl(pair.attrs[ATTR.url] || "");
            if (key) urls.add(key);
        }
        if (docs.length < pageSize) break;
        offset += docs.length;
    }
    return urls;
}

export interface ImportOptions {
    fingerprint: string;
    resumeTaskId?: string;
    notebookId: string;
    /** 来源格式（决定 custom-clip-src 标记） */
    format: ImportFormat;
    /** 导入文档存放路径（如 /导入）；按此建目录 */
    folder: string;
    /** 进度回调（已完成条数, 总数） */
    onProgress?: (done: number, total: number) => void;
    signal?: { aborted: boolean };
    retryFailures?: readonly ImportFailure[];
}

export interface ImportFailure {
    url: string;
    docId?: string;
}

export interface ImportSummary {
    imported: number;
    skippedDuplicate: number;
    failed: number;
    docIds: string[];
    /** 本轮真正失败的来源 URL，供 UI 只重试失败项。 */
    failedUrls: string[];
    failedItems: ImportFailure[];
    unknown: number;
    stopped: boolean;
    taskId: string;
}

export class ImportExecutionError extends ImportProgressError {
    readonly summary: ImportSummary;
    constructor(reason: ImportProgressError["reason"], summary: ImportSummary) { super(reason); this.summary = summary; }
}

/** 执行导入：建文档 → 收录（写 URL/时间/站点）→ 外部标签写入 tags → 状态映射。 */
export async function runImport(
    plugin: Plugin,
    rows: ImportPreviewRow[],
    options: ImportOptions
): Promise<ImportSummary> {
    return withImportLock(plugin, async () => {
        if (!isImportFingerprint(options.fingerprint)) throw new ImportProgressError("file");
        if (!isImportId(options.notebookId)) throw new ImportProgressError("target");
        const folder = normalizeImportFolder(options.folder);
        const keyedRows = await Promise.all(rows.map(async (row) => {
            const url = normalizeUrl(row.url);
            if (!url) throw new ImportProgressError("file");
            return { row: { ...row, tags: [...row.tags] }, key: await fingerprintImportSource(new TextEncoder().encode(JSON.stringify([url, row.title, row.site, row.time, row.doneTime || "", row.tags, row.status]))) };
        }));
        if (!keyedRows.length || new Set(keyedRows.map((item) => item.key)).size !== keyedRows.length) throw new ImportProgressError("file");
        let saved = await readImportProgress(plugin);
        let progress: ImportProgress;
        if (options.resumeTaskId) {
            if (!saved || saved.taskId !== options.resumeTaskId) throw new ImportProgressError("changed");
            if (saved.fingerprint !== options.fingerprint || saved.format !== options.format || saved.rows.length !== keyedRows.length || saved.rows.some((row, index) => row.key !== keyedRows[index].key)) throw new ImportProgressError("file");
            if (saved.notebookId !== options.notebookId || saved.folder !== folder) throw new ImportProgressError("target");
            progress = recoverImportProgress(saved);
        } else {
            if (options.retryFailures) throw new ImportProgressError("confirmation");
            if (saved && recoverImportProgress(saved).state !== "finished") throw new ImportProgressError("unfinished");
            const now = new Date().toISOString();
            progress = { version: 1, taskId: newNodeId(), fingerprint: options.fingerprint, format: options.format, notebookId: options.notebookId, folder, state: "paused", createdAt: now, updatedAt: now,
                rows: keyedRows.map(({ row, key }) => ({ key, hpath: `${folder === "/" ? "" : folder}/${sanitizeTitle(row.title || row.url)}`, state: "pending", docId: "", reason: "" })) };
        }
        const summary: ImportSummary = { imported: 0, skippedDuplicate: 0, failed: 0, failedUrls: [], failedItems: [], docIds: [], unknown: 0, stopped: false, taskId: progress.taskId };
        const checkpoint = async () => {
            progress.updatedAt = new Date().toISOString();
            try { saved = await saveImportProgress(plugin, progress, saved); }
            catch (error) { summary.stopped = true; throw new ImportExecutionError(error instanceof ImportProgressError ? error.reason : "save", summary); }
        };
        const retryUrls = options.retryFailures ? new Set(options.retryFailures.map((item) => normalizeUrl(item.url))) : null;
        const pending = progress.rows.map((entry, index) => ({ entry, row: keyedRows[index].row })).filter(({ entry, row }) => !["applied", "duplicate"].includes(entry.state) && (!retryUrls || retryUrls.has(normalizeUrl(row.url))));
        const existingUrls = await collectExistingUrls(new Set(progress.rows.map((entry) => entry.docId).filter(Boolean)));
        progress.state = "running";
        await checkpoint();
        let done = 0;
        for (const { entry, row } of pending) {
            if (options.signal?.aborted) { summary.stopped = true; break; }
            if (entry.state === "unknown") { summary.unknown += 1; done += 1; options.onProgress?.(done, pending.length); continue; }
            const urlKey = normalizeUrl(row.url);
            if (!entry.docId && (existingUrls.has(urlKey) || await findClipUrlConflict(row.url, undefined, plugin))) {
                entry.state = "duplicate";
                entry.reason = "";
                summary.skippedDuplicate += 1;
            } else {
                if (!entry.docId) {
                    entry.state = "creating";
                    await checkpoint();
                    let returnedId = "";
                    try { returnedId = await createDocWithMd(options.notebookId, entry.hpath, buildImportMarkdown(row.title || row.url, row.url, row.site, row.time, row.tags, row.doneTime), row.tags.join(",")); }
                    catch { returnedId = ""; }
                    if (!isImportId(returnedId)) {
                        entry.state = "unknown";
                        entry.reason = "unknown";
                        summary.unknown += 1;
                        await checkpoint();
                        done += 1;
                        options.onProgress?.(done, pending.length);
                        continue;
                    }
                    entry.docId = returnedId;
                    entry.state = "created";
                    await checkpoint();
                }
                try {
                    const snapshot = await requireImportDocument(entry.docId, progress, entry.hpath, row.url);
                    const attrs = parseClipAttrs(snapshot.attrs);
                    const expectedLocation = { box: snapshot.meta.box, hpath: snapshot.meta.hpath };
                    const expectedAttrs = Object.fromEntries(Object.values(ATTR).map((key) => [key, snapshot.attrs[key] ?? null]));
                    if (attrs.status) {
                        await writeClip(plugin, entry.docId, {}, { expectedLocation, expectedAttrs });
                    } else {
                        const captured = await captureClip(plugin, entry.docId, { url: row.url, site: row.site || siteFromUrl(row.url), src: formatToSrc(options.format), time: row.time || siyuanTimestamp(), timeSource: row.time ? "source" : "capture", status: row.status, doneTime: row.status === "done" ? row.doneTime : "", contentType: "link", markdown: buildImportMarkdown(row.title || row.url, row.url, row.site, row.time, row.tags, row.doneTime), expectedLocation, expectedAttrs });
                        if (captured.conflict) throw new ImportRowError("conflict");
                        if (!captured.captured) throw new ImportRowError("changed");
                    }
                    await requireImportDocument(entry.docId, progress, entry.hpath, row.url, true);
                    entry.state = "applied";
                    entry.reason = "";
                    existingUrls.add(urlKey);
                    summary.imported += 1;
                    summary.docIds.push(entry.docId);
                } catch (error) {
                    entry.state = "failed";
                    entry.reason = error instanceof ImportRowError ? error.reason : error instanceof ClipRestoreError ? error.reason === "missing" ? "missing" : error.reason === "internal" ? "internal" : "changed" : "capture";
                    summary.failed += 1;
                    summary.failedUrls.push(row.url);
                    summary.failedItems.push({ url: row.url, docId: entry.docId });
                }
            }
            await checkpoint();
            done += 1;
            options.onProgress?.(done, pending.length);
        }
        summary.stopped ||= Boolean(options.signal?.aborted);
        progress.state = progress.rows.every((entry) => entry.state === "applied" || entry.state === "duplicate") ? "finished" : "paused";
        await checkpoint();
        return summary;
    });
}

class ImportRowError extends Error {
    readonly reason: ImportFailureReason;
    constructor(reason: ImportFailureReason) { super(reason); this.reason = reason; }
}

async function requireImportDocument(docId: string, progress: ImportProgress, hpath: string, url: string, requireStatus = false) {
    let snapshot;
    try { snapshot = await readClipAttributeSnapshot(docId); }
    catch (error) { throw new ImportRowError(error instanceof ClipRestoreError && error.reason === "missing" ? "missing" : "read"); }
    if (snapshot.meta.box !== progress.notebookId || snapshot.meta.hpath !== hpath) throw new ImportRowError("changed");
    const attrs = parseClipAttrs(snapshot.attrs);
    if (attrs.internal || (!attrs.status && isInternalDocument(snapshot.meta))) throw new ImportRowError("internal");
    if (attrs.excluded || (snapshot.attrs[ATTR.status] && !attrs.status) || (snapshot.attrs[ATTR.url] && normalizeUrl(snapshot.attrs[ATTR.url]) !== normalizeUrl(url)) || (attrs.status && normalizeUrl(snapshot.attrs[ATTR.url] ?? "") !== normalizeUrl(url)) || (requireStatus && !attrs.status)) throw new ImportRowError("changed");
    return snapshot;
}


function formatToSrc(format: ImportFormat): "import-pocket" | "import-omnivore" | "import-wallabag" {
    if (format === "omnivore-json") return "import-omnivore";
    if (format === "wallabag-json") return "import-wallabag";
    return "import-pocket";
}

function sanitizeTitle(title: string): string {
    // 思源文档名不允许 / \\ 等路径字符
    const cleaned = title.replace(/[/\\:<>|?*"~\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
    return (cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "未命名").slice(0, 80);
}

function buildImportMarkdown(title: string, url: string, site: string, time: string, tags: string[], doneTime = ""): string {
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`- [${url}](${url})`);
    lines.push(`- 来源：${site || siteFromUrl(url)}`);
    if (time) lines.push(`- 收藏于：${formatTime(time)}`);
    if (doneTime) lines.push(`- 已读于：${formatTime(doneTime)}`);
    if (tags.length > 0) lines.push(`- 标签：${tags.map((tag) => `#${tag}`).join(" ")}`);
    lines.push("");
    lines.push(`> 由迁移导入器带入。原文内容请访问来源链接，或使用剪藏扩展重新剪藏全文。`);
    return lines.join("\n");
}

function formatTime(time: string): string {
    if (!/^\d{14}$/.test(time)) return time;
    return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
}

/** 供 UI 判断解析结果是否值得导入。 */
export function hasImportableItems(preview: ImportPreview): boolean {
    return preview.rows.some((row) => !row.duplicate);
}


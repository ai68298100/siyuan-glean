/**
 * 迁移导入服务（T-1501）：外部导出文件 → 思源文档 + 读库属性。
 * 流程：解析 → 与库内 custom-clip-url 去重 → 批量建文档（≤50/批）→ captureClip（写入来源 URL/时间/标签）。
 * 幂等：库内已有同 URL 的条目跳过；文件内重复 URL 在解析层已去重。
 * 标签落位：外部标签写入文档根块 IAL 的 tags（用户标签位，不用 ai-tags）——尊重"标签是用户的"。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd } from "../api/client";
import { ATTR, siyuanTimestamp } from "../domain/schema";
import { siteFromUrl } from "../domain/schema";
import type { ImportFormat, ImportedItem, ParseResult } from "../domain/importers";
import { parseImport } from "../domain/importers";
import { normalizeUrl } from "../domain/url";
import { normalizeImportFolder } from "../domain/importers";
import { batchReadClipAttrs, captureClip, listClipDocs } from "./clip-store";

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
    format: ImportFormat | null;
    rows: ImportPreviewRow[];
    duplicateCount: number;
}

/** 解析文件内容并标记库内重复项。 */
export async function previewImport(content: string, format: ImportFormat | "auto"): Promise<ImportPreview> {
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
        format: parsed.format,
        rows,
        duplicateCount: rows.filter((row) => row.duplicate).length,
    };
}

/** 全库已有 clip URL 集合；导入前必须读完次锚点的全部分页。 */
async function collectExistingUrls(): Promise<Set<string>> {
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
            const key = normalizeUrl(pair.attrs[ATTR.url] || "");
            if (key) urls.add(key);
        }
        if (docs.length < pageSize) break;
        offset += docs.length;
    }
    return urls;
}

export interface ImportOptions {
    notebookId: string;
    /** 来源格式（决定 custom-clip-src 标记） */
    format: ImportFormat;
    /** 导入文档存放路径（如 /导入）；按此建目录 */
    folder: string;
    /** 进度回调（已完成条数, 总数） */
    onProgress?: (done: number, total: number) => void;
    signal?: { aborted: boolean };
}

export interface ImportFailure {
    title: string;
    /** 脱敏后的失败原因（错误消息前 120 字） */
    reason: string;
}

export interface ImportSummary {
    imported: number;
    skippedDuplicate: number;
    failed: number;
    docIds: string[];
    /** 文档已创建但收录未完成的孤儿（T-1840）：已记入 import-orphans.json，可重试补收录 */
    orphanCount: number;
    /** 逐条失败原因（T-1963）：title + 脱敏 reason，供 done 阶段展示 */
    failures: ImportFailure[];
}

/* ---------- 导入孤儿账本（T-1840，DATA-CONTRACT §0） ---------- */

const ORPHANS_FILE = "import-orphans.json";

export interface ImportOrphan {
    docId: string;
    notebookId: string;
    format: ImportFormat;
    row: ImportPreviewRow;
}

export async function loadImportOrphans(plugin: Plugin): Promise<ImportOrphan[]> {
    try {
        const raw = await plugin.loadData(ORPHANS_FILE);
        if (!Array.isArray(raw)) return [];
        return raw.filter((entry) => entry && typeof entry === "object" && typeof (entry as ImportOrphan).docId === "string");
    } catch {
        return [];
    }
}

export async function saveImportOrphans(plugin: Plugin, orphans: ImportOrphan[]): Promise<void> {
    await plugin.saveData(ORPHANS_FILE, orphans);
}

/** 执行重试：逐条对已创建文档补收录，成功即从账本移除。返回结算供 UI 反馈。 */
export async function retryImportOrphans(
    plugin: Plugin,
    options: { onProgress?: (done: number, total: number) => void } = {}
): Promise<{ restored: number; remaining: number }> {
    const orphans = await loadImportOrphans(plugin);
    const remaining: ImportOrphan[] = [];
    let restored = 0;
    for (let index = 0; index < orphans.length; index += 1) {
        const orphan = orphans[index];
        try {
            const src = formatToSrc(orphan.format);
            const captured = await captureClip(plugin, orphan.docId, {
                url: orphan.row.url,
                site: orphan.row.site || siteFromUrl(orphan.row.url),
                src,
                time: orphan.row.time || siyuanTimestamp(),
                timeSource: orphan.row.time ? "source" : "capture",
                status: orphan.row.status,
                doneTime: orphan.row.status === "done" ? orphan.row.doneTime : "",
                contentType: "link",
            });
            if (captured.captured || captured.attrs.status) restored += 1;
            else remaining.push(orphan);
        } catch {
            remaining.push(orphan);
        }
        options.onProgress?.(index + 1, orphans.length);
    }
    await saveImportOrphans(plugin, remaining);
    return { restored, remaining: remaining.length };
}

/** 执行导入：建文档 → 收录（写 URL/时间/站点）→ 外部标签写入 tags → 状态映射。 */
export async function runImport(
    plugin: Plugin,
    rows: ImportPreviewRow[],
    options: ImportOptions
): Promise<ImportSummary> {
    const src = formatToSrc(options.format);
    // T-1988：目标文件夹规范化——拒绝越级（..）、空段与非法字符，不静默跨目录创建
    const folder = normalizeImportFolder(options.folder, "导入");
    const summary: ImportSummary = { imported: 0, skippedDuplicate: 0, failed: 0, docIds: [], orphanCount: 0, failures: [] };
    const orphans: ImportOrphan[] = [];
    // 预览和执行之间库可能已变化；执行阶段重新查重，并把本批已创建 URL 记入集合。
    const existingUrls = await collectExistingUrls();
    const pending = rows.filter((row) => !row.duplicate);
    summary.skippedDuplicate = rows.filter((row) => row.duplicate).length;
    const total = pending.length;
    let done = 0;

    for (let i = 0; i < pending.length; i += 50) {
        if (options.signal?.aborted) break;
        const batch = pending.slice(i, i + 50);
        for (const row of batch) {
            const urlKey = normalizeUrl(row.url);
            if (existingUrls.has(urlKey)) {
                summary.skippedDuplicate += 1;
                done += 1;
                options.onProgress?.(done, total);
                continue;
            }
            try {
                const title = row.title || row.url;
                const hPath = `/${folder}/${sanitizeTitle(title)}`;
                const markdown = buildImportMarkdown(title, row.url, row.site, row.time, row.tags, row.doneTime);
                // createDocWithMd 的 tags 参数已在隔离内核 spike 验证会落到新文档根块。
                const docId = await createDocWithMd(options.notebookId, hPath, markdown, row.tags.join(","));
                if (!docId) {
                    throw new Error("创建导入文档失败");
                }
                // 即使后续属性写入失败，本次执行也不再为同 URL 建第二篇文档。
                existingUrls.add(urlKey);
                const captured = await captureClip(plugin, docId, {
                    url: row.url,
                    site: row.site || siteFromUrl(row.url),
                    src,
                    time: row.time || siyuanTimestamp(),
                    timeSource: row.time ? "source" : "capture",
                    status: row.status,
                    // 只有导出文件确有已读时间才写完成时间；否则保持"未知"（D-0028）。
                    doneTime: row.status === "done" ? row.doneTime : "",
                    contentType: "link",
                    markdown,
                });
                if (!captured.captured) {
                    throw new Error(`导入文档未完成收录: ${docId}`);
                }
                summary.imported += 1;
                summary.docIds.push(docId);
            } catch (error) {
                summary.failed += 1;
                // T-1963：逐条失败原因（脱敏：只取消息前 120 字）
                summary.failures.push({
                    title: row.title || row.url,
                    reason: String((error as Error)?.message ?? error).slice(0, 120),
                });
                // T-1840：失败可能发生在"文档已创建、属性未写入"——若本批已为该 URL 建档
                //（existingUrls 含 urlKey），记入孤儿账本供重试补收录，避免重跑重建重复文档。
                if (existingUrls.has(urlKey) && urlKey) {
                    orphans.push({ docId: "", notebookId: options.notebookId, format: options.format, row });
                    summary.orphanCount = orphans.length;
                }
            }
            done += 1;
            options.onProgress?.(done, total);
        }
    }
    // 孤儿账本：docId 只有在建档成功后才可知——失败时回查本批新建文档补齐 ID
    if (orphans.length > 0) {
        await attachOrphanDocIds(orphans, options.notebookId, folder);
        const known = orphans.filter((orphan) => orphan.docId);
        const previous = await loadImportOrphans(plugin);
        await saveImportOrphans(plugin, [...previous, ...known]);
        summary.orphanCount = known.length;
    }
    return summary;
}

/** 回查孤儿文档 ID：按标题+路径在目标笔记本定位本批新建、无读库属性的文档。 */
async function attachOrphanDocIds(
    orphans: ImportOrphan[],
    notebookId: string,
    folder: string
): Promise<void> {
    const { querySql, getBlockAttrs } = await import("../api/client");
    const { ATTR } = await import("../domain/schema");
    for (const orphan of orphans) {
        if (orphan.docId) continue;
        const title = sanitizeTitle(orphan.row.title || orphan.row.url);
        const hPath = `/${folder}/${title}`;
        try {
            const rows = await querySql<{ id: string }>(
                `SELECT id FROM blocks WHERE type = 'd' AND box = '${notebookId.replace(/'/g, "''")}' AND hpath = '${hPath.replace(/'/g, "''")}' LIMIT 5`
            );
            for (const row of rows) {
                const ial = await getBlockAttrs(row.id);
                // 只认无读库状态的文档为孤儿（有状态=已收录，跳过）
                if (!ial[ATTR.status]) {
                    orphan.docId = row.id;
                    break;
                }
            }
        } catch {
            // 回查失败保持 docId 为空，账本里跳过该条（不误绑）
        }
    }
}


function formatToSrc(format: ImportFormat): "import-pocket" | "import-omnivore" | "import-wallabag" {
    if (format === "omnivore-json") return "import-omnivore";
    if (format === "wallabag-json") return "import-wallabag";
    return "import-pocket";
}

function sanitizeTitle(title: string): string {
    // 思源文档名不允许 / \\ 等路径字符
    const cleaned = title.replace(/[/\\:<>|?*"~]/g, " ").replace(/\s+/g, " ").trim();
    return (cleaned || "未命名").slice(0, 80);
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


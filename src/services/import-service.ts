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

export interface ImportSummary {
    imported: number;
    skippedDuplicate: number;
    failed: number;
    docIds: string[];
}

/** 执行导入：建文档 → 收录（写 URL/时间/站点）→ 外部标签写入 tags → 状态映射。 */
export async function runImport(
    plugin: Plugin,
    rows: ImportPreviewRow[],
    options: ImportOptions
): Promise<ImportSummary> {
    const src = formatToSrc(options.format);
    const summary: ImportSummary = { imported: 0, skippedDuplicate: 0, failed: 0, docIds: [] };
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
                const hPath = `/${options.folder}/${sanitizeTitle(title)}`;
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
            } catch {
                summary.failed += 1;
            }
            done += 1;
            options.onProgress?.(done, total);
        }
    }
    return summary;
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


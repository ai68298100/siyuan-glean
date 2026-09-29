/**
 * 迁移导入服务（T-1501）：外部导出文件 → 思源文档 + 读库属性。
 * 流程：解析 → 与库内 custom-clip-url 去重 → 批量建文档（≤50/批）→ captureClip（写入来源 URL/时间/标签）。
 * 幂等：库内已有同 URL 的条目跳过；文件内重复 URL 在解析层已去重。
 * 标签落位：外部标签写入文档根块 IAL 的 tags（用户标签位，不用 ai-tags）——尊重"标签是用户的"。
 */
import type { Plugin } from "siyuan";
import { batchGetBlockAttrs, batchSetBlockAttrs, createDocWithMd } from "../api/client";
import { ATTR, siyuanTimestamp } from "../domain/schema";
import { siteFromUrl } from "../domain/schema";
import type { ImportFormat, ParseResult } from "../domain/importers";
import { parseImport } from "../domain/importers";
import { captureClip } from "./clip-store";

export interface ImportPreviewRow {
    title: string;
    url: string;
    site: string;
    time: string;
    tags: string[];
    status: string;
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
        tags: item.tags,
        status: item.status,
        duplicate: existingUrls.has(item.url.toLowerCase().replace(/\/$/, "")),
    }));
    return {
        format: parsed.format,
        rows,
        duplicateCount: rows.filter((row) => row.duplicate).length,
    };
}

/** 全库已有 clip URL 集合（次锚点全扫；导入是一次性操作，代价可接受）。 */
async function collectExistingUrls(): Promise<Set<string>> {
    const { listClipDocs } = await import("./clip-store");
    const docs = await listClipDocs(5000);
    const attrPairs = await batchGetBlockAttrs(docs.map((doc) => doc.id));
    const urls = new Set<string>();
    for (const pair of attrPairs) {
        const url = pair.attrs[ATTR.url];
        if (url) urls.add(url.toLowerCase().replace(/\/$/, ""));
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
    const pending = rows.filter((row) => !row.duplicate);
    const total = pending.length;
    let done = 0;

    for (let i = 0; i < pending.length; i += 50) {
        if (options.signal?.aborted) break;
        const batch = pending.slice(i, i + 50);
        for (const row of batch) {
            try {
                const title = row.title || row.url;
                const hPath = `/${options.folder}/${sanitizeTitle(title)}`;
                const markdown = buildImportMarkdown(title, row.url, row.site, row.time, row.tags);
                const docId = await createDocWithMd(options.notebookId, hPath, markdown);
                if (!docId) {
                    summary.failed += 1;
                    continue;
                }
                const captured = await captureClip(plugin, docId, {
                    url: row.url,
                    site: row.site || siteFromUrl(row.url),
                    src,
                });
                if (!captured.captured) {
                    // 极小概率并发撞库：文档建了但属性已在——补时间即可
                }
                // 原收藏时间 + 外部标签（写用户 tags 位，逗号分割）
                const attrs: Record<string, string | null> = {
                    [ATTR.time]: row.time || siyuanTimestamp(),
                };
                if (row.tags.length > 0) attrs.tags = row.tags.join(",");
                if (row.status !== "inbox") {
                    attrs[ATTR.status] = row.status;
                }
                await batchSetBlockAttrs([{ id: docId, attrs }]);
                summary.imported += 1;
                summary.docIds.push(docId);
            } catch {
                summary.failed += 1;
            }
            done += 1;
            options.onProgress?.(done, total);
        }
    }
    summary.skippedDuplicate = rows.filter((row) => row.duplicate).length;
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

function buildImportMarkdown(title: string, url: string, site: string, time: string, tags: string[]): string {
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`- [${url}](${url})`);
    lines.push(`- 来源：${site || siteFromUrl(url)}`);
    if (time) lines.push(`- 收藏于：${formatTime(time)}`);
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


import { normalizeUrl } from "./url.ts";

export interface HighlightRoot {
    id: string;
    title: string;
    box: string;
    hpath: string;
    site: string;
    tags: string[];
    aiTags: string[];
    url: string;
}

export interface HighlightItem extends HighlightRoot {
    rootId: string;
    text: string;
    markdown: string;
    color?: string;
    source: { content: string; markdown: string; type: string; highlight: string };
}

export interface HighlightFilter {
    search?: string;
    site?: string;
    tag?: string;
    aiTag?: string;
    sort?: "id" | "title" | "site";
    direction?: "asc" | "desc";
}

export interface HighlightExportLabels {
    title: string;
    original: string;
    source: string;
}

export function isHighlightId(value: string): boolean {
    return typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value);
}

export function highlightMarker(ial: string): string {
    return /(?:^|[\s{])custom-clip-highlight="([^"]*)"/.exec(ial)?.[1] ?? "";
}

export function highlightColor(ial: string): string {
    return /(?:^|[\s{])custom-clip-hl-color="([^"]*)"/.exec(ial)?.[1]
        ?? /(?:^|[\s{])custom-clip-highlight="([^"]*)"/.exec(ial)?.[1]
        ?? "";
}

export function cleanHighlightText(content: string): string {
    return content.replace(/&nbsp;|\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function filterHighlights(items: readonly HighlightItem[], filter: HighlightFilter = {}): HighlightItem[] {
    const terms = (filter.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result = items.filter((item) => {
        if (filter.site && item.site !== filter.site) return false;
        if (filter.tag && !item.tags.includes(filter.tag)) return false;
        if (filter.aiTag && !item.aiTags.includes(filter.aiTag)) return false;
        const searchable = [item.text, item.title, item.site, item.url, ...item.tags, ...item.aiTags].join("\n").toLowerCase();
        return terms.every((term) => searchable.includes(term));
    });
    const field = filter.sort ?? "id";
    const direction = filter.direction === "desc" ? -1 : 1;
    return result.sort((left, right) => direction * compareText(left[field], right[field]) || compareText(left.id, right.id));
}

export function highlightFacets(items: readonly HighlightItem[]): { sites: string[]; tags: string[]; aiTags: string[] } {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort(compareText);
    return {
        sites: unique(items.map((item) => item.site)),
        tags: unique(items.flatMap((item) => item.tags)),
        aiTags: unique(items.flatMap((item) => item.aiTags)),
    };
}

export function pageHighlights(items: readonly HighlightItem[], page = 1, pageSize = 20): { items: HighlightItem[]; page: number; pages: number; total: number } {
    const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 500) : 20;
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(pages, Number.isSafeInteger(page) && page > 0 ? page : 1);
    return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
}

export function selectHighlights(items: readonly HighlightItem[], selectedIds: readonly string[]): HighlightItem[] {
    const selected = new Set(selectedIds);
    const result = items.filter((item) => selected.has(item.id));
    if (result.length !== selected.size || new Set(result.map((item) => item.id)).size !== result.length) throw new Error("Invalid highlight selection");
    return result;
}

export function retainHighlightSelection(items: readonly HighlightItem[], selectedIds: readonly string[]): string[] {
    const available = new Set(items.map((item) => item.id));
    return [...new Set(selectedIds)].filter((id) => available.has(id));
}

export function escapeHighlightText(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/([`*_{}\[\]()#!+\-.|~$])/g, "\\$1");
}

function inlineHighlightText(value: string): string {
    return escapeHighlightText(value.replace(/[\r\n\u0000-\u001f]+/g, " "));
}

export function highlightBlockLink(id: string): string {
    if (!isHighlightId(id)) throw new Error("Invalid highlight ID");
    return `siyuan://blocks/${id}`;
}

function safeSourceUrl(value: string): string {
    return normalizeUrl(value) && !/[\s<>"'\\\u0000-\u001f]/.test(value) ? value : "";
}

export function renderHighlightsMarkdown(items: readonly HighlightItem[], labels: HighlightExportLabels): string {
    const sections = items.map((item) => {
        const quote = item.text.split(/\r?\n/).map((line) => `> ${escapeHighlightText(line)}`).join("\n");
        const sourceUrl = safeSourceUrl(item.url);
        return [
            quote,
            `[${inlineHighlightText(item.title || item.rootId)}](${highlightBlockLink(item.rootId)}) · [${inlineHighlightText(labels.original)}](${highlightBlockLink(item.id)})`,
            ...(sourceUrl ? [`${inlineHighlightText(labels.source)}: [${inlineHighlightText(new URL(sourceUrl).host)}](<${sourceUrl}>)`] : []),
        ].join("\n\n");
    });
    return [`# ${inlineHighlightText(labels.title)}`, ...sections].join("\n\n");
}

export function safeHighlightCsvCell(value: string): string {
    const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
}

export function renderHighlightsCsv(items: readonly HighlightItem[]): string {
    const headers = ["blockId", "rootId", "title", "text", "site", "userTags", "aiTags", "sourceUrl", "blockLink"];
    const rows = items.map((item) => [item.id, item.rootId, item.title, item.text, item.site, item.tags.join(", "), item.aiTags.join(", "), item.url, highlightBlockLink(item.id)]);
    return [headers, ...rows].map((row) => row.map(safeHighlightCsvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * 格式化单条摘录分享卡（T-1803）：
 * - 引述纯文本前缀 `> `；
 * - 来源行前缀 `> —— `，注明标题与站点；
 * - 思源确切引述块链接 `> siyuan://blocks/${item.id}`。
 */
export function formatHighlightShare(item: HighlightItem): string {
    const title = item.title || "未命名文档";
    const source = item.site ? (title + "（" + item.site + "）") : title;
    const quoteLines = item.text.split(String.fromCharCode(10))
        .map((line) => line.replaceAll(String.fromCharCode(13), "").trim())
        .filter(Boolean)
        .map((line) => "> " + line);
    return [
        ...(quoteLines.length ? quoteLines : ["> " + item.text.trim()]),
        "> —— " + source,
        "> " + highlightBlockLink(item.id),
    ].join(String.fromCharCode(10));
}

/**
 * 从思源块 ID（YYYYMMDDHHmmss-xxxxxxx）解析时间线索（T-1753）。
 * 非法 ID 返回空串。
 */
export function formatHighlightTime(blockId: string): string {
    if (!isHighlightId(blockId)) return "";
    const y = blockId.slice(0, 4);
    const m = blockId.slice(4, 6);
    const d = blockId.slice(6, 8);
    const hh = blockId.slice(8, 10);
    const mm = blockId.slice(10, 12);
    return y + "-" + m + "-" + d + " " + hh + ":" + mm;
}

export interface ArticleHighlightGroup {
    rootId: string;
    title: string;
    site: string;
    url: string;
    tags: string[];
    aiTags: string[];
    items: HighlightItem[];
}

/**
 * 将已筛选的摘录按来源文章（rootId）聚合为分组（T-3415）。
 * 保持首次出现的文章顺序及组内条目顺序。
 */
export function groupHighlightsByArticle(items: readonly HighlightItem[]): ArticleHighlightGroup[] {
    const map = new Map<string, ArticleHighlightGroup>();
    for (const item of items) {
        const existing = map.get(item.rootId);
        if (existing) {
            existing.items.push(item);
        } else {
            map.set(item.rootId, {
                rootId: item.rootId,
                title: item.title,
                site: item.site,
                url: item.url,
                tags: item.tags ? [...item.tags] : [],
                aiTags: item.aiTags ? [...item.aiTags] : [],
                items: [item],
            });
        }
    }
    return Array.from(map.values());
}

/**
 * 将单篇文章的所有摘录渲染为合集 Markdown（T-3415）。
 */
export function renderArticleHighlightsMarkdown(
    group: ArticleHighlightGroup,
    labels: HighlightExportLabels,
): string {
    const title = group.title || group.rootId;
    const headerLines = [
        `# ${inlineHighlightText(title)}`,
        "",
        ...(group.site ? [`*${inlineHighlightText(labels.source)}: ${inlineHighlightText(group.site)}*`, ""] : []),
        ...(isHighlightId(group.rootId) ? [`[${inlineHighlightText(labels.title)}](${highlightBlockLink(group.rootId)})`] : [inlineHighlightText(labels.title)]),
        "",
        "---",
        "",
    ];

    const quotes = group.items.map((item, index) => {
        const quote = item.text.split(/\r?\n/).map((line) => `> ${escapeHighlightText(line)}`).join("\n");
        return [
            quote,
            `[${inlineHighlightText(labels.original)} #${index + 1}](${highlightBlockLink(item.id)})`,
        ].join("\n\n");
    });

    return headerLines.join("\n") + quotes.join("\n\n---\n\n");
}

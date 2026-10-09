/**
 * 全库摘录墙域层（T-1750/T-1752，纯函数）：摘录条目投影、分面筛选与批量导出构造。
 * 引述块本体来自 services/highlights.listLibraryQuotes；root 元数据（标题/站点/标签）
 * 由调用方从派生索引映射——本层只做纯投影，不写任何属性。
 */
import type { NameCount } from "./stats.ts";

export interface QuoteEntry {
    /** 引述块 ID（跳回定位用） */
    id: string;
    /** 所在文档 ID */
    rootId: string;
    /** 引述纯文本 */
    text: string;
    /** 所在文档标题（未收录文档由 root 查询补齐，可能为空） */
    title: string;
    /** 所在文档站点（仅已收录读库文章有） */
    site: string;
    /** 所在文档的用户标签（根块 IAL.tags 投影，只读） */
    tags: string[];
    /** 所在文档的 AI 标签（只读投影） */
    aiTags: string[];
    /** 高亮颜色标记（T-1901 延伸）；空串 = 未标记 */
    color: string;
}

export interface QuoteFilter {
    site?: string;
    tag?: string;
    aiTag?: string;
    /** 高亮颜色筛选（T-1901 延伸）；空/缺省 = 不筛选 */
    color?: string;
    /** 引述文本关键词（大小写不敏感） */
    keyword?: string;
}


/** 分面聚合（与库视图同款计数语义：小写归一、计数降序）。 */
export function quoteFacets(entries: QuoteEntry[]): { sites: NameCount[]; tags: NameCount[]; aiTags: NameCount[]; colors: NameCount[] } {
    if (entries.length === 0) return { sites: [], tags: [], aiTags: [], colors: [] };
    const sites = new Map<string, number>();
    const tags = new Map<string, number>();
    const aiTags = new Map<string, number>();
    const colors = new Map<string, number>();
    for (const entry of entries) {
        const site = entry.site.trim().toLocaleLowerCase();
        if (site) sites.set(site, (sites.get(site) ?? 0) + 1);
        for (const tag of new Set(entry.tags)) {
            if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
        }
        for (const tag of new Set(entry.aiTags)) {
            if (tag) aiTags.set(tag, (aiTags.get(tag) ?? 0) + 1);
        }
        if (entry.color) colors.set(entry.color, (colors.get(entry.color) ?? 0) + 1);
    }
    const toNameCounts = (map: Map<string, number>) =>
        [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return { sites: toNameCounts(sites), tags: toNameCounts(tags), aiTags: toNameCounts(aiTags), colors: toNameCounts(colors) };
}

/** 筛选只返回新数组，不改条目（视图投影纪律）。泛型保留调用方的扩展字段（如摘录墙 color）。 */
export function filterQuotes<T extends QuoteEntry>(entries: T[], filter: QuoteFilter): T[] {
    const keyword = (filter.keyword ?? "").trim().toLowerCase();
    return entries.filter((entry) => {
        if (filter.site && entry.site.trim().toLowerCase() !== filter.site.trim().toLowerCase()) return false;
        if (filter.tag && !entry.tags.some((tag) => tag.toLowerCase() === filter.tag!.toLowerCase())) return false;
        if (filter.aiTag && !entry.aiTags.some((tag) => tag.toLowerCase() === filter.aiTag!.toLowerCase())) return false;
        if (filter.color && entry.color !== filter.color) return false;
        if (keyword && !entry.text.toLowerCase().includes(keyword)) return false;
        return true;
    });
}

/**
 * 批量导出 Markdown（T-1752）：每条引述附原文回链（siyuan://blocks/文档ID），
 * 站点与所在文档标题做来源行。文档级（非逐篇）汇总，由服务层 createDocWithMd 落库。
 * 有颜色标记的条目加 【颜色】 前缀（T-1901 延伸）。
 */
export function quoteExportMarkdown(entries: QuoteEntry[], rangeLabel: string, generatedAt: string): string {
    const lines: string[] = [];
    lines.push(`# 摘录导出 · ${rangeLabel}`);
    lines.push("");
    lines.push(`> 由小驴拾遗导出于 ${generatedAt}，共 ${entries.length} 条摘录。点击原文链接可回到所在文档。`);
    lines.push("");
    for (const entry of entries) {
        const title = entry.title || "未命名文档";
        const source = entry.site ? `${title}（${entry.site}）` : title;
        const colorTag = entry.color ? `【${entry.color}】` : "";
        lines.push(`- ${colorTag}${entry.text.replace(/\s+/g, " ")}`);
        lines.push(`  [↩ ${source}](siyuan://blocks/${entry.rootId})`);
    }
    lines.push("");
    return lines.join("\n");
}

/* ---------- 高亮分享卡（T-1803） ---------- */

/** 格式化引用文本（复制用）：引述 + 来源行（标题/站点）+ 思源回链。 */
export function formatQuoteShare(entry: QuoteEntry): string {
    const title = entry.title || "未命名文档";
    const source = entry.site ? `${title}（${entry.site}）` : title;
    return [`> ${entry.text.replace(/\s+/g, " ")}`, `> —— ${source}`, `> ${`siyuan://blocks/${entry.rootId}`}`].join("\n");
}

/**
 * 高亮聚合（T-1202）：读当前文档的引述块（DATA-CONTRACT §4 形态②）。
 * 只消费不编辑——批注 UI 不在本插件范围（D-0008 延后项）。
 * T-1750/T-1752 地基：全库引述块分页查询（同端点新查询，root 元数据由调用方从索引映射）。
 */
import { listQuoteBlocks, querySql, type BlockRow } from "../api/client";

export interface HighlightItem {
    id: string;
    /** 纯文本引用内容 */
    text: string;
    /** 行内 markdown（含加粗/链接等标记，渲染用） */
    markdown: string;
}

export async function listDocHighlights(rootDocId: string): Promise<HighlightItem[]> {
    const rows: BlockRow[] = await listQuoteBlocks(rootDocId);
    return rows
        .map((row) => ({
            id: row.id,
            text: cleanQuoteText(row.content || ""),
            markdown: row.markdown || "",
        }))
        .filter((item) => item.text.length > 0);
}

/** 引述块的 content 会带引用首行杂音（"&nbsp;" 等），做轻清洗。 */
function cleanQuoteText(raw: string): string {
    return raw
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export interface LibraryQuoteRow {
    /** 引述块 ID */
    id: string;
    /** 所在文档 ID */
    rootId: string;
    text: string;
    markdown: string;
}

/** 全库引述块分页（按块更新时间倒序；条件与 listQuoteBlocks 的实证形状一致：type='b'）。root 元数据由调用方经索引映射。 */
export async function listLibraryQuotes(limit = 500, offset = 0): Promise<LibraryQuoteRow[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 500;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const rows = await querySql<{ id: string; root_id: string; content: string; markdown: string }>(
        `SELECT id, root_id, content, markdown FROM blocks
         WHERE type = 'b'
         ORDER BY updated DESC, id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`
    );
    return rows
        .map((row) => ({
            id: row.id,
            rootId: row.root_id,
            text: cleanQuoteText(row.content || ""),
            markdown: row.markdown || "",
        }))
        .filter((row) => row.text.length > 0);
}

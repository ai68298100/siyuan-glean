/**
 * 高亮聚合（T-1202）：读当前文档的引述块（DATA-CONTRACT §4 形态②）。
 * 只消费不编辑——批注 UI 不在本插件范围（D-0008 延后项）。
 */
import { listQuoteBlocks, type BlockRow } from "../api/client";

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

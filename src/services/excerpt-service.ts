/**
 * 摘录服务（T-1730d，D-0030 落点 T-1725）：选区 → 引述块插入原文档。
 * 块定位即摘录位置；无法取得块定位时 UI 明确降级为"仅复制文本"，不伪造锚点。
 * T-1752：筛选后的摘录批量导出为普通汇总笔记（含原文回链；不写 custom-clip-*，
 * 无 URL/标签/模板证据不会进入候选扫描）。
 */
import { createDocWithMd, insertBlockAfter } from "../api/client";
import { escapeDomText } from "../domain/flashcard";
import { buildQuoteBlockDom, clampExcerpt, EXCERPT_MAX_LENGTH } from "../domain/reader";
import { quoteExportMarkdown, type QuoteEntry } from "../domain/quotes";
import { siyuanTimestamp } from "../domain/schema";

export interface ExcerptSelection {
    text: string;
    /** 所选内容所在块的 ID；取不到为空串（定位失败）。 */
    blockId: string;
}

/** 从 DOM 选区提取摘录：仅当锚点落在宿主元素内；无文本返回 null。 */
export function excerptFromSelection(host: Element | null, selection: Selection | null): ExcerptSelection | null {
    if (!host || !selection || selection.isCollapsed) return null;
    const node = selection.anchorNode;
    if (!node || !host.contains(node)) return null;
    const text = clampExcerpt(selection.toString());
    if (!text) return null;
    const anchor = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const blockEl = anchor?.closest("[data-node-id]");
    const blockId = blockEl && host.contains(blockEl) ? blockEl.getAttribute("data-node-id") ?? "" : "";
    return { text, blockId };
}

/** 摘录为引述块：插在所选块之后；返回引述块 ID。 */
export async function insertQuoteExcerpt(blockId: string, text: string): Promise<string> {
    const dom = buildQuoteBlockDom(clampExcerpt(text).slice(0, EXCERPT_MAX_LENGTH), escapeDomText);
    if (!dom) throw new Error("摘录内容为空");
    return insertBlockAfter(blockId, dom);
}

/**
 * 批量导出摘录为汇总笔记（T-1752）：写入第一个锚点笔记本 /摘录导出/ 下。
 * 返回文档 ID；空集合抛错由调用方提示。
 */
export async function exportQuotesToDoc(entries: QuoteEntry[], notebookId: string): Promise<string> {
    if (entries.length === 0) throw new Error("当前没有可导出的摘录");
    const now = new Date();
    const stamp = siyuanTimestamp(now);
    const rangeLabel = `${stamp.slice(0, 4)}.${stamp.slice(4, 6)}.${stamp.slice(6, 8)}`;
    const markdown = quoteExportMarkdown(entries, rangeLabel, `${rangeLabel} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`);
    const docId = await createDocWithMd(notebookId, `/摘录导出/${stamp.slice(0, 8)}-${stamp.slice(8)}`, markdown);
    if (!docId) throw new Error("创建摘录导出文档失败");
    return docId;
}

/**
 * 摘录服务（T-1730d，D-0030 落点 T-1725）：选区 → 引述块插入原文档。
 * 块定位即摘录位置；无法取得块定位时 UI 明确降级为"仅复制文本"，不伪造锚点。
 */
import { insertBlockAfter } from "../api/client";
import { escapeDomText } from "../domain/flashcard";
import { buildQuoteBlockDom, clampExcerpt, EXCERPT_MAX_LENGTH } from "../domain/reader";

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

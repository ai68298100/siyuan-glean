/**
 * 摘录服务（T-1730d，D-0030 落点 T-1725）：选区 → 引述块插入原文档。
 * 块定位即摘录位置；无法取得块定位时 UI 明确降级为"仅复制文本"，不伪造锚点。
 */
import { insertBlockAfter } from "../api/client";
import { escapeDomText } from "../domain/flashcard";
import { buildQuoteBlockDom, clampExcerpt, EXCERPT_MAX_LENGTH } from "../domain/reader";

const BLOCK_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export interface ExcerptSelection {
    text: string;
    /** 所选内容所在块的 ID；取不到为空串（定位失败）。 */
    blockId: string;
}

/** 从 DOM 选区提取摘录：仅当完整选区落在宿主元素内；无文本返回 null。 */
export function excerptFromSelection(host: Element | null, selection: Selection | null): ExcerptSelection | null {
    if (!host || !selection) return null;
    try {
        if (selection.isCollapsed !== false) return null;
        const rangeCount = selection.rangeCount;
        if (!Number.isInteger(rangeCount) || rangeCount < 1) return null;
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode || !host.contains(anchorNode) || !host.contains(focusNode)) return null;
        for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
            const range = selection.getRangeAt(rangeIndex);
            if (!range) return null;
            const startNode = range.startContainer;
            const endNode = range.endContainer;
            if (!startNode || !endNode || !host.contains(startNode) || !host.contains(endNode)) return null;
        }
        const text = clampExcerpt(selection.toString());
        if (!text) return null;
        const anchor = anchorNode.nodeType === 1 ? (anchorNode as Element) : anchorNode.parentElement;
        const blockEl = anchor?.closest("[data-node-id]");
        const blockId = blockEl && blockEl !== host && host.contains(blockEl) ? blockEl.getAttribute("data-node-id") ?? "" : "";
        return { text, blockId: BLOCK_ID_PATTERN.test(blockId) ? blockId : "" };
    } catch {
        return null;
    }
}

/** 摘录为引述块：插在所选块之后；返回引述块 ID。 */
export async function insertQuoteExcerpt(blockId: string, text: string): Promise<string> {
    if (typeof blockId !== "string" || !BLOCK_ID_PATTERN.test(blockId)) throw new Error("摘录块 ID 无效");
    const dom = buildQuoteBlockDom(clampExcerpt(text).slice(0, EXCERPT_MAX_LENGTH), escapeDomText);
    if (!dom) throw new Error("摘录内容为空");
    return insertBlockAfter(blockId, dom);
}

import { parseReadingPosition, type ReadingPosition } from "../domain/reading-position.ts";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

function rendered(element: HTMLElement): boolean {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && style?.visibility !== "collapse";
}

export function readingViewport(host: HTMLElement | null): HTMLElement | null {
    if (!host?.isConnected) return null;
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(".protyle-content, .protyle-preview, .protyle-preview .b3-typography"))
        .filter((element) => {
            if (element.matches(".b3-typography")) {
                const preview = element.closest<HTMLElement>(".protyle-preview");
                if (!preview || !host.contains(preview)) return false;
            }
            const overflow = element.ownerDocument.defaultView?.getComputedStyle(element).overflowY ?? "";
            return host.contains(element) && rendered(element) && element.clientHeight > 0
                && /^(auto|scroll|overlay)$/.test(overflow);
        });
    const overflowing = candidates.filter((element) => element.scrollHeight > element.clientHeight + 1);
    // A short article still has a real viewport; prefer an overflowing ancestor when one exists.
    const pool = overflowing.length ? overflowing : candidates;
    return pool.find((candidate) => !pool.some((other) => other !== candidate && candidate.contains(other))) ?? null;
}

function readingBlockId(element: HTMLElement): string {
    return element.getAttribute("data-node-id") ?? element.getAttribute("id") ?? "";
}

function readingBlocks(host: HTMLElement, viewport: HTMLElement, docId: string): HTMLElement[] {
    return Array.from(viewport.querySelectorAll<HTMLElement>("[data-node-id], [id]"))
        .filter((element) => {
            if (!viewport.contains(element) || !rendered(element) || element.getAttribute("data-type") === "NodeDocument") return false;
            if (element.getAttribute("data-node-id") === null) {
                // Native preview exports use id for both blocks and the document h1: never infer the root from heading order.
                if (!BLOCK_ID_PATTERN.test(docId)) return false;
                const typography = element.closest<HTMLElement>(".b3-typography");
                const preview = typography?.closest<HTMLElement>(".protyle-preview");
                if (!typography || typography === element || !preview || !host.contains(preview) || !viewport.contains(typography)) return false;
            }
            const id = readingBlockId(element);
            return BLOCK_ID_PATTERN.test(id) && id !== docId;
        });
}

function viewportTop(viewport: HTMLElement): number {
    return viewport.getBoundingClientRect().top + viewport.clientTop;
}

export function captureReadingPosition(host: HTMLElement | null, now = new Date(), docId = ""): ReadingPosition | null {
    const viewport = readingViewport(host);
    if (!viewport) return null;
    const top = viewportTop(viewport);
    const bottom = top + viewport.clientHeight;
    const blocks = readingBlocks(host!, viewport, docId);
    const candidates = blocks.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > top && rect.top < bottom;
    });
    const crossing = candidates.filter((element) => element.getBoundingClientRect().top <= top);
    const pool = crossing.length ? crossing : candidates;
    pool.sort((left, right) => {
        const distance = left.getBoundingClientRect().top - right.getBoundingClientRect().top;
        if (distance) return crossing.length ? -distance : distance;
        if (left.contains(right)) return 1;
        if (right.contains(left)) return -1;
        return 0;
    });
    const block = pool[0];
    if (!block) return null;
    const blockId = readingBlockId(block);
    if (blocks.filter((element) => readingBlockId(element) === blockId).length !== 1) return null;
    const rect = block.getBoundingClientRect();
    const offset = Math.min(10000, Math.max(0, Math.min(Math.round(top - rect.top), Math.max(0, Math.floor(rect.height) - 1))));
    if (!Number.isFinite(now.getTime())) return null;
    return parseReadingPosition({ version: 1, blockId, offset, at: now.toISOString() });
}

export function restoreReadingPosition(host: HTMLElement | null, value: ReadingPosition, docId = ""): boolean {
    const position = parseReadingPosition(value);
    const viewport = readingViewport(host);
    if (!position || !viewport) return false;
    const targets = readingBlocks(host!, viewport, docId).filter((element) => readingBlockId(element) === position.blockId);
    if (targets.length !== 1) return false;
    const target = targets[0];
    const rect = target.getBoundingClientRect();
    const withinBlock = Math.min(position.offset, Math.max(0, Math.floor(rect.height) - 1));
    const requested = viewport.scrollTop + rect.top - viewportTop(viewport) + withinBlock;
    const top = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, requested));
    viewport.scrollTo({ top, behavior: "auto" });
    target.focus({ preventScroll: true });
    return true;
}

/**
 * 在已渲染的编辑器 DOM 中，根据目标块位置查找所属的最近前置大纲小节。
 */
export function findActiveOutlineItemInHost(
    host: HTMLElement | null,
    items: readonly { id: string }[],
    targetBlockId: string | null | undefined,
): string | null {
    if (!targetBlockId || !items.length) return null;
    const direct = items.find((item) => item.id === targetBlockId);
    if (direct) return direct.id;
    if (!host || !host.isConnected) return null;
    const escapedTarget = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(targetBlockId) : targetBlockId;
    const targetEl = host.querySelector<HTMLElement>(`[data-node-id="${escapedTarget}"]`);
    if (!targetEl) return null;

    const FOLLOWING = typeof Node !== "undefined" ? (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY) : 20;
    let activeId: string | null = null;
    for (const item of items) {
        const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(item.id) : item.id;
        const itemEl = host.querySelector<HTMLElement>(`[data-node-id="${escaped}"]`);
        if (!itemEl) continue;
        const pos = itemEl.compareDocumentPosition(targetEl);
        if (itemEl === targetEl || Boolean(pos & FOLLOWING)) {
            activeId = item.id;
        } else {
            break;
        }
    }
    return activeId;
}

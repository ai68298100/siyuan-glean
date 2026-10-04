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
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(".protyle-content, .protyle-preview"))
        .filter((element) => {
            const overflow = element.ownerDocument.defaultView?.getComputedStyle(element).overflowY ?? "";
            return host.contains(element) && rendered(element) && element.clientHeight > 0
                && element.scrollHeight > element.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(overflow);
        });
    return candidates.find((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other))) ?? null;
}

function readingBlocks(viewport: HTMLElement): HTMLElement[] {
    return Array.from(viewport.querySelectorAll<HTMLElement>("[data-node-id]"))
        .filter((element) => BLOCK_ID_PATTERN.test(element.getAttribute("data-node-id") ?? "")
            && element.getAttribute("data-type") !== "NodeDocument" && rendered(element));
}

function viewportTop(viewport: HTMLElement): number {
    return viewport.getBoundingClientRect().top + viewport.clientTop;
}

export function captureReadingPosition(host: HTMLElement | null, now = new Date()): ReadingPosition | null {
    const viewport = readingViewport(host);
    if (!viewport) return null;
    const top = viewportTop(viewport);
    const bottom = top + viewport.clientHeight;
    const candidates = readingBlocks(viewport).filter((element) => {
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
    const blockId = block.getAttribute("data-node-id")!;
    if (readingBlocks(viewport).filter((element) => element.getAttribute("data-node-id") === blockId).length !== 1) return null;
    const rect = block.getBoundingClientRect();
    const offset = Math.min(10000, Math.max(0, Math.min(Math.round(top - rect.top), Math.max(0, Math.floor(rect.height) - 1))));
    if (!Number.isFinite(now.getTime())) return null;
    return parseReadingPosition({ version: 1, blockId, offset, at: now.toISOString() });
}

export function restoreReadingPosition(host: HTMLElement | null, value: ReadingPosition): boolean {
    const position = parseReadingPosition(value);
    const viewport = readingViewport(host);
    if (!position || !viewport) return false;
    const targets = readingBlocks(viewport).filter((element) => element.getAttribute("data-node-id") === position.blockId);
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

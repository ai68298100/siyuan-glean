export interface ReadingPosition {
    version: 1;
    blockId: string;
    offset: number;
    at: string;
}

export function parseReadingPosition(raw: unknown): ReadingPosition | null {
    let value: unknown = raw;
    if (typeof raw === "string") {
        if (raw.length > 1024) return null;
        try { value = JSON.parse(raw); } catch { return null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Partial<ReadingPosition>;
    const keys = Object.keys(entry);
    if (keys.length !== 4 || keys.some((key) => !["version", "blockId", "offset", "at"].includes(key))) return null;
    if (entry.version !== 1 || typeof entry.blockId !== "string" || !/^\d{14}-[a-z0-9]{7}$/.test(entry.blockId)
        || typeof entry.offset !== "number" || !Number.isSafeInteger(entry.offset) || entry.offset < 0 || entry.offset > 10000
        || typeof entry.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.at)
        || !Number.isFinite(Date.parse(entry.at)) || new Date(entry.at).toISOString() !== entry.at) return null;
    return { version: 1, blockId: entry.blockId, offset: entry.offset, at: entry.at };
}

export function serializeReadingPosition(value: unknown): string {
    const parsed = parseReadingPosition(value);
    if (!parsed) throw new RangeError("Invalid reading position");
    return JSON.stringify(parsed);
}

/**
 * 根据正文滚动视口高度轻量估算阅读进度百分比（T-3336 / T-3380）：
 * 1. 只有当正文内容高度大于视口高度（scrollHeight > clientHeight）且 clientHeight > 0 时才计算；
 * 2. 以已读可视底部 (scrollTop + clientHeight) / scrollHeight 派生 0–100 的整数百分比；
 * 3. 无滚动短文、未渲染或参数非法时返回 null，避免伪造虚假进度。
 */
export function estimateReadingRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number | null {
    if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return null;
    if (clientHeight <= 0 || scrollHeight <= clientHeight) return null;
    const offset = Math.max(0, scrollTop);
    const visibleBottom = Math.min(scrollHeight, offset + clientHeight);
    const ratio = visibleBottom / scrollHeight;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

export function estimateReadingPercentage(scrollTop: number, scrollHeight: number, clientHeight: number): number | null {
    if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return null;
    if (clientHeight <= 0 || scrollHeight <= clientHeight) return null;
    const offset = Math.max(0, scrollTop);
    const visibleBottom = Math.min(scrollHeight, offset + clientHeight);
    const ratio = visibleBottom / scrollHeight;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

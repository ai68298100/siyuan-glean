export interface ReaderSearchQuery {
    keyword: string;
    caseSensitive?: boolean;
}

export interface ReaderSearchState {
    open: boolean;
    keyword: string;
    caseSensitive: boolean;
    activeIndex: number;
    totalMatches: number;
}

export interface TextMatchRange {
    start: number;
    end: number;
}

export function initialReaderSearchState(): ReaderSearchState {
    return {
        open: false,
        keyword: "",
        caseSensitive: false,
        activeIndex: -1,
        totalMatches: 0,
    };
}

export function normalizeSearchKeyword(raw: string): string {
    return (raw || "").replace(/[\r\n\t]/g, " ");
}

export function calculateMatchIndex(current: number, total: number, direction: "next" | "prev"): number {
    if (total <= 0) return -1;
    if (direction === "next") {
        if (current < 0 || current >= total - 1) return 0;
        return current + 1;
    }
    // prev
    if (current <= 0 || current >= total) return total - 1;
    return current - 1;
}

export function formatMatchCount(activeIndex: number, totalMatches: number): { currentDisplay: number; totalDisplay: number; text: string } {
    if (totalMatches <= 0 || activeIndex < 0 || activeIndex >= totalMatches) {
        return {
            currentDisplay: 0,
            totalDisplay: Math.max(0, totalMatches),
            text: `0 / ${Math.max(0, totalMatches)}`,
        };
    }
    const current = activeIndex + 1;
    return {
        currentDisplay: current,
        totalDisplay: totalMatches,
        text: `${current} / ${totalMatches}`,
    };
}

export function isFindShortcut(event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
}): boolean {
    if (event.isComposing) return false;
    if (event.altKey) return false;
    const isCtrlOrMeta = Boolean(event.ctrlKey || event.metaKey);
    return isCtrlOrMeta && (event.key === "f" || event.key === "F");
}

export function findTextOffsets(text: string, query: string, caseSensitive = false): TextMatchRange[] {
    const trimmed = query;
    if (!text || !trimmed) return [];

    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const needleLen = needle.length;
    if (needleLen === 0) return [];

    const matches: TextMatchRange[] = [];
    let pos = 0;
    while (pos <= haystack.length - needleLen) {
        const found = haystack.indexOf(needle, pos);
        if (found === -1) break;
        matches.push({ start: found, end: found + needleLen });
        pos = found + Math.max(1, needleLen);
    }
    return matches;
}

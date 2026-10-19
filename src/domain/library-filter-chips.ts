import type { LibraryFilter } from "./library-view.ts";

export const FILTER_CHIP_KEYS = ["site", "author", "tag", "aiTag", "src", "timeSource", "contentType", "keyword"] as const;
export type FilterChipKey = typeof FILTER_CHIP_KEYS[number];

export function libraryFilterChips(filter: LibraryFilter): Array<{ key: FilterChipKey; value: string }> {
    return FILTER_CHIP_KEYS.flatMap((key) => {
        const raw = filter[key];
        const value = typeof raw === "string" ? raw.trim() : "";
        return value ? [{ key, value }] : [];
    });
}

export function removeLibraryFilter(filter: LibraryFilter, key: FilterChipKey): LibraryFilter {
    const next = { ...filter };
    delete next[key];
    return next;
}

export const SECONDARY_FILTER_KEYS = ["author", "aiTag", "src", "timeSource", "contentType", "readingTimeTier"] as const;
export type SecondaryFilterKey = typeof SECONDARY_FILTER_KEYS[number];

/**
 * 统计高级筛选（ActionPopover 内部收纳的次级分面）激活条件的数量（T-1808 / T-3386 / T-3391）：
 * 包括 author, aiTag, src, timeSource, contentType, readingTimeTier。
 */
export function countSecondaryActiveFilters(filter: Partial<Record<string, unknown>>): number {
    let count = 0;
    for (const key of SECONDARY_FILTER_KEYS) {
        const val = filter[key];
        if (typeof val === "string" && val.trim().length > 0 && val !== "all") {
            count += 1;
        }
    }
    return count;
}

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

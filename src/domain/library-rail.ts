import type { LibraryFacet } from "./library-view.ts";

export const RAIL_GROUP_KEYS = ["queues", "sites", "authors", "tags", "aiTags"] as const;
export type RailGroupKey = (typeof RAIL_GROUP_KEYS)[number];
export interface RailGroupPrefs { collapsed: boolean; expanded: boolean }
export type RailGroups = Record<RailGroupKey, RailGroupPrefs>;

export function normalizeRailGroups(raw: unknown): RailGroups {
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return Object.fromEntries(RAIL_GROUP_KEYS.map((name) => {
        const value = source[name];
        const group = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return [name, { collapsed: group.collapsed === true, expanded: group.expanded === true }];
    })) as RailGroups;
}

export function railFacetSelected(value: string, selected: string): boolean {
    return value.trim().toLocaleLowerCase() === selected.trim().toLocaleLowerCase();
}

export function projectRailFacets(items: readonly LibraryFacet[], expanded: boolean, query: string, selected: string): LibraryFacet[] {
    const keyword = query.trim().toLocaleLowerCase();
    const matches = items.filter((item) => !keyword || item.value.toLocaleLowerCase().includes(keyword));
    const visible = expanded || keyword ? matches : matches.slice(0, 8);
    const active = selected ? items.find((item) => railFacetSelected(item.value, selected)) : undefined;
    if (active && !visible.includes(active)) return [...visible, active];
    return [...visible];
}

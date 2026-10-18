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

/**
 * 应用侧栏分组切换（T-1810 / T-3377）：
 * 若启用手风琴模式且当前组被展开（collapsed = false），自动将其余各组设为折叠。
 * 纯函数，返回全新的 RailGroups 副本。
 */
export function applyRailGroupToggle(
    current: RailGroups,
    targetKey: RailGroupKey,
    patch: Partial<RailGroupPrefs>,
    accordion = false
): RailGroups {
    const next = normalizeRailGroups(current);
    const targetCurrent = next[targetKey];
    const nextTarget: RailGroupPrefs = {
        collapsed: patch.collapsed ?? targetCurrent.collapsed,
        expanded: patch.expanded ?? targetCurrent.expanded,
    };
    next[targetKey] = nextTarget;

    if (accordion && !nextTarget.collapsed) {
        for (const key of RAIL_GROUP_KEYS) {
            if (key !== targetKey) {
                next[key] = { ...next[key], collapsed: true };
            }
        }
    }

    return next;
}

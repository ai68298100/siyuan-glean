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
    accordionOrPatch: boolean | Partial<RailGroupPrefs> = false,
    accordion = false
): RailGroups {
    const next = normalizeRailGroups(current);
    const targetCurrent = next[targetKey];
    let nextTarget: RailGroupPrefs;
    let isAccordion = accordion;

    if (typeof accordionOrPatch === "boolean") {
        isAccordion = accordionOrPatch;
        nextTarget = {
            ...targetCurrent,
            collapsed: !targetCurrent.collapsed,
        };
    } else {
        nextTarget = {
            collapsed: accordionOrPatch.collapsed ?? targetCurrent.collapsed,
            expanded: accordionOrPatch.expanded ?? targetCurrent.expanded,
        };
    }
    next[targetKey] = nextTarget;

    if (isAccordion && !nextTarget.collapsed) {
        for (const key of RAIL_GROUP_KEYS) {
            if (key !== targetKey) {
                next[key] = { ...next[key], collapsed: true };
            }
        }
    }

    return next;
}

/**
 * 批量切换所有分组折叠状态（全部折叠 / 全部展开）
 */
export function toggleAllRailGroups(current: RailGroups, collapsed: boolean): RailGroups {
    const next = normalizeRailGroups(current);
    for (const key of RAIL_GROUP_KEYS) {
        next[key] = { ...next[key], collapsed };
    }
    return next;
}

/**
 * 手风琴约束同步：保证至多只有一个分组处于展开状态。
 * 若当前有多个分组展开，保留首个展开的分组（或指定的 preferredKey），其余折叠。
 */
export function syncAccordionRailGroups(current: RailGroups, preferredKey?: RailGroupKey): RailGroups {
    const next = normalizeRailGroups(current);
    const expandedKeys = RAIL_GROUP_KEYS.filter((k) => !next[k].collapsed);
    if (expandedKeys.length <= 1) return next;

    const keepKey = preferredKey && !next[preferredKey].collapsed ? preferredKey : expandedKeys[0];
    for (const key of RAIL_GROUP_KEYS) {
        if (key !== keepKey) {
            next[key] = { ...next[key], collapsed: true };
        }
    }
    return next;
}


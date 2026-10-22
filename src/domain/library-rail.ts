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

/**
 * 判定两个分面列表的内容与计数是否完全相同（保持引用稳定）。
 */
export function areFacetListsEqual(
    a: readonly LibraryFacet[] | undefined,
    b: readonly LibraryFacet[] | undefined
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].value !== b[i].value || a[i].count !== b[i].count) {
            return false;
        }
    }
    return true;
}

/**
 * 判定两个队列计数映射是否完全相同。
 */
export function areQueueCountsEqual(
    a: Record<string, number> | undefined,
    b: Record<string, number> | undefined
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

export interface FacetCountDiff {
    value: string;
    prevCount: number;
    nextCount: number;
    delta: number;
}

export interface FacetListDiff {
    added: LibraryFacet[];
    removed: LibraryFacet[];
    changed: FacetCountDiff[];
    unchanged: LibraryFacet[];
    hasChanges: boolean;
}

/**
 * 计算新旧分面列表之间的具体增量差异（新增、移除、计数变化、未变化）。
 */
export function diffFacetList(
    prev: readonly LibraryFacet[],
    next: readonly LibraryFacet[]
): FacetListDiff {
    const prevMap = new Map<string, number>();
    for (const item of prev) {
        prevMap.set(item.value, item.count);
    }

    const nextMap = new Map<string, number>();
    for (const item of next) {
        nextMap.set(item.value, item.count);
    }

    const added: LibraryFacet[] = [];
    const removed: LibraryFacet[] = [];
    const changed: FacetCountDiff[] = [];
    const unchanged: LibraryFacet[] = [];

    for (const item of next) {
        const prevCount = prevMap.get(item.value);
        if (prevCount === undefined) {
            added.push(item);
        } else if (prevCount === item.count) {
            unchanged.push(item);
        } else {
            changed.push({
                value: item.value,
                prevCount,
                nextCount: item.count,
                delta: item.count - prevCount,
            });
        }
    }

    for (const item of prev) {
        if (!nextMap.has(item.value)) {
            removed.push(item);
        }
    }

    return {
        added,
        removed,
        changed,
        unchanged,
        hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
    };
}

/**
 * 基于增量 Delta 映射局部打补丁更新分面项。
 * 适用于无需全量扫描条目时的轻量级徽章调整。
 */
export function patchFacetCounts(
    base: readonly LibraryFacet[],
    deltas: Record<string, number> | ReadonlyMap<string, number>,
    options?: { keepZero?: boolean }
): LibraryFacet[] {
    const map = new Map<string, LibraryFacet>();
    for (const item of base) {
        map.set(item.value, { ...item });
    }

    const entries = deltas instanceof Map ? deltas.entries() : Object.entries(deltas);
    for (const [key, delta] of entries) {
        const current = map.get(key);
        if (current) {
            current.count += delta;
        } else if (delta > 0) {
            map.set(key, { value: key, count: delta });
        }
    }

    const keepZero = options?.keepZero ?? false;
    const result: LibraryFacet[] = [];
    for (const item of map.values()) {
        if (keepZero || item.count > 0) {
            result.push(item);
        }
    }

    return result.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface RailFacetsSnapshot {
    queues?: Record<string, number>;
    sites: readonly LibraryFacet[];
    authors: readonly LibraryFacet[];
    tags: readonly LibraryFacet[];
    aiTags: readonly LibraryFacet[];
}

/**
 * 局部对账分面快照：若某一分组新旧项完全一致，则直接重用旧引用，防止不必要的响应式子树重绘。
 */
export function reconcileRailFacets(
    prev: RailFacetsSnapshot | undefined,
    next: RailFacetsSnapshot
): { snapshot: RailFacetsSnapshot; changedGroups: RailGroupKey[] } {
    if (!prev) {
        return {
            snapshot: next,
            changedGroups: [...RAIL_GROUP_KEYS],
        };
    }

    const changedGroups: RailGroupKey[] = [];
    const snapshot: RailFacetsSnapshot = {
        queues: next.queues,
        sites: next.sites,
        authors: next.authors,
        tags: next.tags,
        aiTags: next.aiTags,
    };

    if (areQueueCountsEqual(prev.queues, next.queues)) {
        snapshot.queues = prev.queues;
    } else {
        changedGroups.push("queues");
    }

    if (areFacetListsEqual(prev.sites, next.sites)) {
        snapshot.sites = prev.sites;
    } else {
        changedGroups.push("sites");
    }

    if (areFacetListsEqual(prev.authors, next.authors)) {
        snapshot.authors = prev.authors;
    } else {
        changedGroups.push("authors");
    }

    if (areFacetListsEqual(prev.tags, next.tags)) {
        snapshot.tags = prev.tags;
    } else {
        changedGroups.push("tags");
    }

    if (areFacetListsEqual(prev.aiTags, next.aiTags)) {
        snapshot.aiTags = prev.aiTags;
    } else {
        changedGroups.push("aiTags");
    }

    return { snapshot, changedGroups };
}

export interface RailBadgeDebouncerOptions<T> {
    delayMs?: number;
    mode?: "microtask" | "timer";
    onFlush: (latest: T) => void;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    microtask?: (fn: () => void) => void;
}

export interface RailBadgeDebouncer<T> {
    schedule: (payload: T) => void;
    flush: () => void;
    cancel: () => void;
    isPending: () => boolean;
    getPendingPayload: () => T | undefined;
}

/**
 * 分面项徽章计数防抖与微任务聚合控制器（T-3418）
 * 无论在高频导入还是批量操作中，确保平滑合并连续更新并防止计时器泄漏。
 */
export function createRailBadgeDebouncer<T>(options: RailBadgeDebouncerOptions<T>): RailBadgeDebouncer<T> {
    const mode = options.mode ?? (options.delayMs === 0 ? "microtask" : "timer");
    const delayMs = Math.max(0, options.delayMs ?? 16);
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const microtask = options.microtask ?? ((fn) => {
        if (typeof queueMicrotask === "function") {
            queueMicrotask(fn);
        } else {
            setTimeout(fn, 0);
        }
    });

    let pendingPayload: T | undefined;
    let hasPending = false;
    let timerHandle: unknown = null;
    let microtaskActive = false;

    function flush(): void {
        if (timerHandle !== null) {
            clearTimer(timerHandle);
            timerHandle = null;
        }
        microtaskActive = false;
        if (!hasPending) return;

        const payload = pendingPayload as T;
        hasPending = false;
        pendingPayload = undefined;
        options.onFlush(payload);
    }

    function schedule(payload: T): void {
        pendingPayload = payload;
        hasPending = true;

        if (mode === "microtask") {
            if (!microtaskActive) {
                microtaskActive = true;
                microtask(() => {
                    if (microtaskActive && hasPending) {
                        flush();
                    }
                });
            }
            return;
        }

        // timer 模式：防抖重新计时
        if (timerHandle !== null) {
            clearTimer(timerHandle);
        }
        timerHandle = setTimer(() => {
            timerHandle = null;
            if (hasPending) {
                flush();
            }
        }, delayMs);
    }

    function cancel(): void {
        if (timerHandle !== null) {
            clearTimer(timerHandle);
            timerHandle = null;
        }
        microtaskActive = false;
        hasPending = false;
        pendingPayload = undefined;
    }

    return {
        schedule,
        flush,
        cancel,
        isPending: () => hasPending,
        getPendingPayload: () => pendingPayload,
    };
}

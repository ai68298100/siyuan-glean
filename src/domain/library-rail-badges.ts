/**
 * library-rail-badges.ts
 *
 * 侧栏分面徽章高频变更对账与去抖调度（纯函数与状态机）
 *
 * 核心目标：
 * 1. 结构共享比对（reconcileRailFacets）：精准计算 groups 级别的变更，
 *    未发生变化的 group 保持引用相等（reference equality），避免 Svelte 子组件无谓重渲染。
 * 2. 状态平滑与防抖（createRailBadgeDebouncer）：在批量打标、批量导入或快速切换时，
 *    去抖高频徽章闪烁，同时支持 flush() 强制同步。
 */

import type { LibraryFacet, LibraryFacets } from "./library-view.ts";

export interface FacetReconcileResult {
    snapshot: LibraryFacets;
    changedGroups: (keyof LibraryFacets)[];
}

const FACET_GROUPS: readonly (keyof LibraryFacets)[] = [
    "sites",
    "authors",
    "tags",
    "aiTags",
    "sources",
    "timeSources",
    "contentTypes",
];

/**
 * 比较两个 LibraryFacet 数组是否完全一致
 */
function isFacetListEqual(
    a: readonly LibraryFacet[] | undefined,
    b: readonly LibraryFacet[] | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const itemA = a[i];
        const itemB = b[i];
        if (itemA.value !== itemB.value || itemA.count !== itemB.count) {
            return false;
        }
    }
    return true;
}

/**
 * 分面徽章结构对账
 *
 * 对比 prev 与 next 的各个分面分组（sites, authors, tags, aiTags, sources, timeSources, contentTypes）。
 * 如果某个分组内容没有变化，复用 prev 中对应的对象引用；
 * 仅当存在真正变更时返回新对象引用，并列出变更的分组。
 */
export function reconcileRailFacets(
    prev: LibraryFacets | undefined,
    next: LibraryFacets,
): FacetReconcileResult {
    if (!prev) {
        return {
            snapshot: next,
            changedGroups: [...FACET_GROUPS],
        };
    }

    let hasAnyChange = false;
    const changedGroups: (keyof LibraryFacets)[] = [];
    const snapshotResult: Partial<LibraryFacets> = {};

    for (const group of FACET_GROUPS) {
        const prevGroup = prev[group];
        const nextGroup = next[group];
        if (isFacetListEqual(prevGroup, nextGroup)) {
            // 复用旧引用
            snapshotResult[group] = prevGroup;
        } else {
            hasAnyChange = true;
            changedGroups.push(group);
            snapshotResult[group] = nextGroup;
        }
    }

    if (!hasAnyChange) {
        return {
            snapshot: prev,
            changedGroups: [],
        };
    }

    return {
        snapshot: snapshotResult as LibraryFacets,
        changedGroups,
    };
}

export interface RailBadgeDebouncerOptions<T> {
    delayMs?: number;
    onFlush: (latestValue: T) => void;
}

export interface RailBadgeDebouncer<T> {
    schedule: (value: T) => void;
    flush: () => void;
    cancel: () => void;
    isPending: () => boolean;
}

/**
 * 分面徽章去抖调度器
 *
 * - schedule(value): 安排一次徽章刷新
 * - flush(): 立即刷新当前积压的徽章值
 * - cancel(): 取消待刷新的定时器
 * - isPending(): 是否有排队的更新
 */
export function createRailBadgeDebouncer<T>(
    options: RailBadgeDebouncerOptions<T>,
): RailBadgeDebouncer<T> {
    const delay = options.delayMs ?? 32;
    let timer: any = null;
    let pendingValue: T | undefined = undefined;
    let hasPending = false;

    function flush(): void {
        if (!hasPending) return;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        const val = pendingValue as T;
        hasPending = false;
        pendingValue = undefined;
        options.onFlush(val);
    }

    function schedule(value: T): void {
        pendingValue = value;
        hasPending = true;
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            flush();
        }, delay);
    }

    function cancel(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        hasPending = false;
        pendingValue = undefined;
    }

    function isPending(): boolean {
        return hasPending;
    }

    return {
        schedule,
        flush,
        cancel,
        isPending,
    };
}

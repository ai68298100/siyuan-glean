/**
 * 读库时间线的筛选、排序和分面纯函数（S3 / T-1715）。
 *
 * Dock、工作台和看板都把索引映射成这里的轻量条目，再调用同一个函数。
 * 该层不读写属性，也不依赖 Svelte、思源 API 或服务层；筛选只是视图投影，
 * 不会改变文章状态。
 */
import type { ClipContentType, ClipSource, ClipStatus, ClipTimeSource } from "./schema.ts";
import { applySessionOrder } from "./session-order.ts";

export type LibraryItemKind = "clip" | "candidate";
/** "session"（T-1903，D-0034）：按 ui-prefs 的会话顺序展示；direction 不适用（忽略）。 */
export type LibrarySortKey = "time" | "updated" | "words" | "priority" | "rating" | "title" | "session";
export type LibrarySortDirection = "asc" | "desc";

export interface LibraryItem {
    kind: LibraryItemKind;
    id: string;
    title: string;
    hpath: string;
    updated: string;
    status?: ClipStatus;
    url?: string;
    site?: string;
    tags?: string[];
    aiTags?: string[];
    src?: ClipSource | string;
    contentType?: ClipContentType | string;
    timeSource?: ClipTimeSource | string;
    time?: string;
    words?: number;
    minutes?: number;
    priority?: number;
    rating?: number;
    /** 来源作者（T-1811 投影）；候选无此字段 */
    author?: string;
    /** 用户显式收藏标记（T-1755 投影）；候选无此字段 */
    favorite?: boolean;
}

export interface LibraryFilter {
    /** `all` is used by the kanban, whose columns apply status afterwards. */
    status?: ClipStatus | "all";
    site?: string;
    tag?: string;
    /** AI 标签分面（T-1729）：与用户 tag 分开筛选，UI 需带 AI 来源标记。 */
    aiTag?: string;
    src?: string;
    timeSource?: string;
    contentType?: string;
    keyword?: string;
    /** 来源作者筛选（T-1812）；空/缺省 = 不筛选 */
    author?: string;
    /** 仅看收藏（T-1755）；true 时只保留 favorite 条目 */
    favoriteOnly?: boolean;
    sortBy?: LibrarySortKey;
    direction?: LibrarySortDirection;
    /** Candidates are only shown when the inbox view explicitly opts in. */
    includeCandidates?: boolean;
    /** 会话顺序（T-1903）：sortBy="session" 时按此 docId 序展示；domain 不读 prefs，由调用方传入 */
    sessionOrder?: string[];
}

export interface LibraryFacet {
    value: string;
    count: number;
}

export interface LibraryFacets {
    sites: LibraryFacet[];
    tags: LibraryFacet[];
    /** AI 标签分面（T-1729）：独立于用户 tags，UI 显示 AI 来源标记。 */
    aiTags: LibraryFacet[];
    /** 来源作者分面（T-1812）。 */
    authors: LibraryFacet[];
    sources: LibraryFacet[];
    timeSources: LibraryFacet[];
    contentTypes: LibraryFacet[];
}

/** 稳定、跨设备的字典序；不依赖浏览器/系统的中文 locale。 */
function compareText(left: string, right: string): number {
    const a = left.toLocaleLowerCase();
    const b = right.toLocaleLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
}

function clean(value: string | undefined): string {
    return String(value ?? "").trim();
}

function key(value: string | undefined): string {
    return clean(value).toLocaleLowerCase();
}

function numberOrZero(value: number | undefined): number {
    return Number.isFinite(value) ? Number(value) : 0;
}

function matchesExact(actual: string | undefined, expected: string | undefined): boolean {
    if (!expected) return true;
    return key(actual) === key(expected);
}

function hasTag(item: LibraryItem, expected: string): boolean {
    const wanted = key(expected);
    if (!wanted) return true;
    return (item.tags ?? []).some((tag) => key(tag) === wanted);
}

/** AI 标签精确匹配（T-1729）；关键词搜索仍同时匹配 AI 标签（searchableText 不变）。 */
function hasAiTag(item: LibraryItem, expected: string): boolean {
    const wanted = key(expected);
    if (!wanted) return true;
    return (item.aiTags ?? []).some((tag) => key(tag) === wanted);
}

function searchableText(item: LibraryItem): string {
    return [
        item.title,
        item.hpath,
        item.site,
        item.url,
        ...(item.tags ?? []),
        ...(item.aiTags ?? []),
    ]
        .map(clean)
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
}

/** 是否满足当前视图的所有筛选项。 */
export function matchesLibraryFilter(item: LibraryItem, filter: LibraryFilter = {}): boolean {
    if (item.kind === "candidate" && !filter.includeCandidates) return false;
    if (filter.status && filter.status !== "all") {
        // 候选没有五态。Inbox 明确允许候选进入“待确认”混合视图。
        if (item.kind === "candidate") {
            if (filter.status !== "inbox") return false;
        } else if (item.status !== filter.status) {
            return false;
        }
    }
    if (!matchesExact(item.site, filter.site)) return false;
    if (filter.tag && !hasTag(item, filter.tag)) return false;
    if (filter.aiTag && !hasAiTag(item, filter.aiTag)) return false;
    if (!matchesExact(item.src, filter.src)) return false;
    if (!matchesExact(item.timeSource, filter.timeSource)) return false;
    if (!matchesExact(item.contentType, filter.contentType)) return false;
    // T-1812：作者筛选（候选无作者字段，天然不命中）
    if (!matchesExact(item.author, filter.author)) return false;
    // T-1755：仅看收藏（候选不参与收藏）
    if (filter.favoriteOnly && !(item.kind === "clip" && item.favorite === true)) return false;
    const query = key(filter.keyword);
    return !query || searchableText(item).includes(query);
}

function compareValue(item: LibraryItem, sortBy: LibrarySortKey): string | number {
    if (sortBy === "title") return clean(item.title);
    if (sortBy === "words") return numberOrZero(item.words);
    if (sortBy === "priority") return numberOrZero(item.priority) || 3;
    if (sortBy === "rating") return numberOrZero(item.rating);
    if (sortBy === "updated") return clean(item.updated) || clean(item.time);
    return clean(item.time) || clean(item.updated);
}

function compareItems(a: LibraryItem, b: LibraryItem, sortBy: LibrarySortKey, direction: LibrarySortDirection): number {
    const left = compareValue(a, sortBy);
    const right = compareValue(b, sortBy);
    let result: number;
    if (typeof left === "number" && typeof right === "number") {
        result = left - right;
    } else {
        result = compareText(String(left), String(right));
    }
    if (result === 0) result = compareText(a.id, b.id);
    return direction === "asc" ? result : -result;
}

/**
 * 应用统一筛选和排序。返回新数组，不改变传入索引或条目，也不写任何属性。
 * sortBy="session"（T-1903）：先按默认 time desc 建立基底序，再按 sessionOrder 投影
 * （order 内按相对次序在前，未入列追加尾部）；direction 对 session 无效。
 */
export function filterAndSortLibrary(items: readonly LibraryItem[], filter: LibraryFilter = {}): LibraryItem[] {
    const sortBy = filter.sortBy ?? "time";
    const direction = filter.direction ?? (sortBy === "title" ? "asc" : "desc");
    const filtered = items.filter((item) => matchesLibraryFilter(item, filter));
    if (sortBy === "session") {
        return applySessionOrder(filtered.sort((a, b) => compareItems(a, b, "time", "desc")), filter.sessionOrder ?? []);
    }
    return filtered.sort((a, b) => compareItems(a, b, sortBy, direction));
}

function addFacet(map: Map<string, LibraryFacet>, value: string | undefined): void {
    const display = clean(value);
    if (!display) return;
    const normalized = key(display);
    const current = map.get(normalized);
    if (current) current.count += 1;
    else map.set(normalized, { value: display, count: 1 });
}

function facetsFromMap(map: Map<string, LibraryFacet>): LibraryFacet[] {
    return [...map.values()].sort((a, b) => b.count - a.count || compareText(a.value, b.value));
}

/** 从同一条目集合生成筛选控件的真实分面计数。 */
export function libraryFacets(items: readonly LibraryItem[]): LibraryFacets {
    const sites = new Map<string, LibraryFacet>();
    const authors = new Map<string, LibraryFacet>();
    const tags = new Map<string, LibraryFacet>();
    const aiTags = new Map<string, LibraryFacet>();
    const sources = new Map<string, LibraryFacet>();
    const timeSources = new Map<string, LibraryFacet>();
    const contentTypes = new Map<string, LibraryFacet>();
    for (const item of items) {
        if (item.kind !== "clip") continue;
        addFacet(sites, item.site);
        addFacet(authors, item.author);
        for (const tag of item.tags ?? []) addFacet(tags, tag);
        for (const tag of item.aiTags ?? []) addFacet(aiTags, tag);
        addFacet(sources, item.src);
        addFacet(timeSources, item.timeSource);
        addFacet(contentTypes, item.contentType);
    }
    return {
        sites: facetsFromMap(sites),
        authors: facetsFromMap(authors),
        tags: facetsFromMap(tags),
        aiTags: facetsFromMap(aiTags),
        sources: facetsFromMap(sources),
        timeSources: facetsFromMap(timeSources),
        contentTypes: facetsFromMap(contentTypes),
    };
}


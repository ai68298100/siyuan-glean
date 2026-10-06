<script lang="ts">
/** 读库 Dock 面板 v2（T-1104/T-1201/T-1202/T-1300/T-1400c）：库 / 统计 / 高亮 三视图；tab 画布 rail+行表/看板。 */
import { onMount, tick } from "svelte";
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { isActivationKey } from "../domain/keyboard";
import type { ClipStatus } from "../domain/schema";
import { normalizeUrl } from "../domain/url";
import { batchSetStatus, batchSetStatusDetailed, captureDocument, findClipUrlConflict, reconcileIndex, writeClip } from "../services/clip-store";
import { autoEnrich, enrichClip } from "../services/enrich-service";
import { snapshotClip } from "../services/snapshot-service";
import { filterAndSortLibrary, libraryFacets, type LibraryItem, type LibrarySortDirection, type LibrarySortKey } from "../domain/library-view.ts";
import { loadIndex, type ClipIndexEntry, type CandidateEntry, type GleanIndex } from "../services/index-store";
import StatsView from "./StatsView.svelte";
import HighlightView from "./HighlightView.svelte";
import LibraryRailGroup from "./LibraryRailGroup.svelte";
import WorkbenchPreview from "./WorkbenchPreview.svelte";
import LibraryFilters from "./LibraryFilters.svelte";
import ActionPopover from "./ActionPopover.svelte";
import AuthorEditor from "./AuthorEditor.svelte";
import AiBatchPanel from "./AiBatchPanel.svelte";
import { libraryFilterChips, removeLibraryFilter, type FilterChipKey } from "../domain/library-filter-chips.ts";
import { nextPreviewId, normalizePreviewRatio, previewRatioFromPointer } from "../domain/workbench-preview.ts";
import InboxSection from "./InboxSection.svelte";
import ResurfaceView from "./ResurfaceView.svelte";
import { archiveStaleCandidates, setSurfacePinned } from "../services/resurface-service";
import { loadUiPrefs, saveUiPrefs } from "../services/prefs";
import { ageDays, todayStamp } from "../domain/resurface.ts";
import { recordReadingDone } from "../services/checkin-bridge";
import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
import ClipStatusActions from "./ClipStatusActions.svelte";
import ClipRankControls from "./ClipRankControls.svelte";
import { installMobileViewportVars } from "../libs/mobile-viewport";
import { installEscapeHandler, installModalFocus } from "../libs/modal-focus";
import { createRefreshQueue } from "../libs/refresh-queue";
import { applySavedView, createSavedView, deleteSavedView, governanceCueMuted, localDateStamp, setDefaultSavedView, type GovernanceCueKey, type GovernanceMuted, type SavedView } from "../domain/ui-prefs";

interface Props {
    facade: GleanFacade;
    initialPreviewId?: string;
}

let { facade, initialPreviewId = "" }: Props = $props();

const i18n = $derived(facade.i18n);

type PanelView = "resurface" | "library" | "stats" | "highlights";
let view = $state<PanelView>("resurface");
let loading = $state(true);
let loadError = $state(false);
let offline = $state(false);
let index = $state<GleanIndex>({ version: 1, updatedAt: "", clips: {}, candidates: {} });
let activeQueue = $state<ClipStatus>("inbox");
let keyword = $state("");
let sortBy = $state<LibrarySortKey>("time");
let sortDirection = $state<LibrarySortDirection>("desc");
let selectedSite = $state("");
let selectedAuthor = $state("");
let authorTimeline = $state(false);
let selectedTag = $state("");
/** AI 标签分面（T-1729）：独立于用户 tag，UI 带 ✨ 来源标记。 */
let selectedAiTag = $state("");
/** Dock 窄画布搜索默认折叠为图标（UX 审计 #8）；工作台/浮窗保持常驻。 */
let searchOpen = $state(false);
let searchInput = $state<HTMLInputElement | null>(null);
let selectedSource = $state("");
let selectedTimeSource = $state("");
let selectedContentType = $state("");
let mobileFilterOpen = $state(false);

type MobileFilterDraft = {
    site: string;
    author: string;
    tag: string;
    aiTag: string;
    source: string;
    timeSource: string;
    contentType: string;
    sortBy: LibrarySortKey;
    direction: LibrarySortDirection;
};

let mobileFilterDraft = $state<MobileFilterDraft>({
    site: "",
    author: "",
    tag: "",
    aiTag: "",
    source: "",
    timeSource: "",
    contentType: "",
    sortBy: "time",
    direction: "desc",
});
let mobileFilterSheet = $state<HTMLElement | null>(null);
let mobileFilterReturnFocus: HTMLElement | null = null;
let disposeMobileFilterFocus = () => {};
let selection = $state<ReadonlySet<string>>(new Set());
let batchBusy = $state(false);
let aiBatchOpen = $state(false);
let aiBatchIds = $state<string[]>([]);
let rootEl = $state<HTMLElement | null>(null);
let previewId = $state("");
let previewRevision = $state(0);
let previewEnabled = $state(true);
let previewRatio = $state(normalizePreviewRatio(undefined));
let previewPrefsTouched = false;
let previewSplit = $state<HTMLDivElement | null>(null);
let previewDialog = $state<HTMLDivElement | null>(null);
let previewReturnFocus: HTMLElement | null = null;
let draggingPointer: number | null = null;
let dragStartRatio = normalizePreviewRatio(undefined);
onMount(() => {
    const cleanupViewport = installMobileViewportVars(rootEl, facade.isMobile);
    if (initialPreviewId) void focusClipById(initialPreviewId, true);
    if (!facade.isMobile || typeof window === "undefined") return cleanupViewport;
    const syncOnlineState = () => (offline = !navigator.onLine);
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
        disposeMobileFilterFocus();
        cleanupViewport();
        window.removeEventListener("online", syncOnlineState);
        window.removeEventListener("offline", syncOnlineState);
    };
});
let layoutMode = $state<"list" | "kanban">("list");
let isTabCanvas = $state(false);
const previewEntry = $derived<Row | null>(index.clips[previewId]
    ? { kind: "clip", ...index.clips[previewId] }
    : index.candidates[previewId] ? { kind: "candidate", ...index.candidates[previewId] } : null);
let dragOverCol = $state<ClipStatus | null>(null);
let dragId = $state("");
let enrichingId = $state("");
let statusActionId = $state("");
let pendingFocusId = $state("");
let focusRequested = false;
let popupOpen = $state(false);
let mobileMoreOpen = $state(false);
let savedViews = $state<SavedView[]>([]);
let defaultSavedViewId = $state("");
let savedViewId = $state("");
let savedViewName = $state("");
let prefsLoading = $state(true);
let prefsUserTouched = false;
let applyingPrefs = false;
let governanceMuted = $state<GovernanceMuted>({ quota: "", stale: "", candidates: "" });

/** 工作台弹出为独立浮窗（全宽画布，独立于 dock/tab）。 */
function openPopup() {
    if (popupOpen) return;
    popupOpen = true;
    facade.openWorkbenchPopup();
    // 弹窗关闭时机未知，保守复位
    window.setTimeout(() => (popupOpen = false), 1500);
}
let snappingId = $state("");
let archivingStale = $state(false);
let editingCandidateId = $state("");
let candidateUrlInput = $state("");

type QueueKey = ClipStatus;
const queues: QueueKey[] = ["inbox", "later", "reading", "done", "archived"];
const views: { key: PanelView; labelKey: string }[] = [
    { key: "resurface", labelKey: "view.resurface" },
    { key: "library", labelKey: "view.library" },
    { key: "stats", labelKey: "view.stats" },
    { key: "highlights", labelKey: "view.highlights" },
];

type MobileNavKey = "home" | "library" | "highlights" | "settings";
const mobileNavItems: { key: MobileNavKey; labelKey: string }[] = [
    { key: "home", labelKey: "mobile.navHome" },
    { key: "library", labelKey: "mobile.navLibrary" },
    { key: "highlights", labelKey: "mobile.navHighlights" },
    { key: "settings", labelKey: "mobile.navSettings" },
];
const mobileActive = $derived<MobileNavKey>(view === "library" ? "library" : view === "highlights" ? "highlights" : "home");
const mobileTitleKey = $derived(views.find((item) => item.key === view)?.labelKey ?? "view.resurface");

type MobileTaskState = "loading" | "error" | "offline" | "ready";
const mobileTaskState = $derived<MobileTaskState>(loading ? "loading" : offline ? "offline" : loadError ? "error" : "ready");

function mobileBack() {
    if (view === "resurface") return;
    view = "resurface";
    mobileMoreOpen = false;
}

function selectMobileNav(key: MobileNavKey) {
    markPrefsInteraction();
    mobileMoreOpen = false;
    if (key === "settings") {
        facade.openSettings();
        return;
    }
    if (key === "home") {
        view = "resurface";
        return;
    }
    view = key;
}

function markPrefsInteraction(): void {
    if (prefsLoading && !applyingPrefs) prefsUserTouched = true;
}

type Row =
    | ({ kind: "candidate" } & CandidateEntry)
    | ({ kind: "clip" } & ClipIndexEntry);

const LIBRARY_RENDER_PAGE = 80;
let renderLimit = $state(LIBRARY_RENDER_PAGE);

const libraryItems = $derived.by<LibraryItem[]>(() => [
    ...Object.values(index.clips).map((entry) => ({
        kind: "clip" as const,
        id: entry.id,
        title: entry.title,
        hpath: entry.hpath,
        updated: entry.updated,
        status: entry.status || undefined,
        url: entry.url,
        site: entry.site,
        author: entry.author,
        tags: entry.tags,
        aiTags: entry.aiTags,
        src: entry.src,
        contentType: entry.contentType,
        timeSource: entry.timeSource,
        time: entry.time,
        words: entry.words,
        minutes: entry.minutes,
        priority: entry.priority,
        rating: entry.rating,
    })),
    ...Object.values(index.candidates).map((entry) => ({ kind: "candidate" as const, ...entry })),
]);

const facets = $derived.by(() => libraryFacets(libraryItems));

const activeFilter = $derived({
    status: authorTimeline ? "all" as const : activeQueue,
    site: selectedSite,
    author: selectedAuthor,
    tag: selectedTag,
    aiTag: selectedAiTag,
    src: selectedSource,
    timeSource: selectedTimeSource,
    contentType: selectedContentType,
    keyword,
    sortBy,
    direction: sortDirection,
    includeCandidates: !authorTimeline && activeQueue === "inbox",
});

const rows = $derived.by<Row[]>(() => {
    // 筛选/排序只返回轻量投影；渲染时回到索引取完整条目，保留 snapshot 等操作字段。
    const filtered = filterAndSortLibrary(libraryItems, activeFilter);
    return filtered.flatMap((item): Row[] => {
        if (item.kind === "clip") {
            const entry = index.clips[item.id];
            return entry ? [{ kind: "clip", ...entry }] : [];
        }
        const entry = index.candidates[item.id];
        return entry ? [{ kind: "candidate", ...entry }] : [];
    });
});

const activeFilterKey = $derived(JSON.stringify(activeFilter));
const visibleRows = $derived(rows.slice(0, renderLimit));
const hasMoreRows = $derived(visibleRows.length < rows.length);

function loadMoreRows(): void {
    renderLimit = Math.min(rows.length, renderLimit + LIBRARY_RENDER_PAGE);
}

$effect(() => {
    if (activeFilterKey !== "") renderLimit = LIBRARY_RENDER_PAGE;
});

// 窄 Dock 里搜索入口是折叠的；打开后立即聚焦，避免用户再点一次输入框。
$effect(() => {
    if (!searchOpen) return;
    void tick().then(() => searchInput?.focus());
});

const candidateCount = $derived(Object.keys(index.candidates).length);
const totalClips = $derived(Object.keys(index.clips).length);

/**
 * 治理提示和状态 rail 共用同一份索引扫描结果。
 * staleDays 是设置项，改变它时会重新计算超龄池；文章索引变更时则只扫描一次。
 */
const queueStats = $derived.by<{
    counts: Record<QueueKey, number>;
    inboxTotal: number;
    stalePool: ClipIndexEntry[];
}>(() => {
    const counts: Record<QueueKey, number> = {
        inbox: 0,
        later: 0,
        reading: 0,
        done: 0,
        archived: 0,
    };
    const stalePool: ClipIndexEntry[] = [];
    let inboxTotal = 0;
    const limit = facade.settings.staleDays;
    for (const entry of Object.values(index.clips)) {
        if (entry.status && entry.status in counts) counts[entry.status] += 1;
        if (entry.status === "inbox") inboxTotal += 1;
        if ((entry.status === "inbox" || entry.status === "later") && ageDays(entry.time) >= limit) {
            stalePool.push(entry);
        }
    }
    return { counts, inboxTotal, stalePool };
});

// 待确认候选单独展示，不占 inbox 配额；只有已收录条目进入五态计数。
const inboxTotal = $derived(queueStats.inboxTotal);
const overQuota = $derived(inboxTotal > facade.settings.inboxQuota);
const stalePool = $derived(queueStats.stalePool);
const governanceCueCount = $derived(
    Number(overQuota && activeQueue === "inbox" && !authorTimeline && !governanceCueMuted("quota", governanceMuted))
    + Number(stalePool.length > 0 && (activeQueue === "inbox" || activeQueue === "later") && !governanceCueMuted("stale", governanceMuted))
    + Number(candidateCount > 0 && !governanceCueMuted("candidates", governanceMuted)),
);
let governanceExpanded = $state(false);
const governanceDetailsVisible = $derived(governanceCueCount <= 1 || governanceExpanded);

async function muteGovernanceCue(key: GovernanceCueKey): Promise<void> {
    const next = { ...governanceMuted, [key]: localDateStamp() };
    try {
        const saved = await saveUiPrefs(facade.pluginInstance, { governanceMuted: next });
        governanceMuted = saved.governanceMuted;
    } catch {
        showMessage(t(i18n, "settings.saveFailed"), 3000);
    }
}

/** 超龄归档候选清单（T-1710）：先展示勾选，确认后按显式 ID 归档。 */
let stalePreviewOpen = $state(false);
let staleSelected = $state(new Set<string>());

function toggleStalePreview() {
    if (!stalePreviewOpen) staleSelected = new Set(stalePool.map((entry) => entry.id));
    stalePreviewOpen = !stalePreviewOpen;
}

function toggleStalePick(id: string) {
    const next = new Set(staleSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    staleSelected = next;
}

async function doArchiveStale() {
    if (archivingStale || staleSelected.size === 0) return;
    archivingStale = true;
    try {
        const ids = stalePool.filter((entry) => staleSelected.has(entry.id)).map((entry) => entry.id);
        const result = await archiveStaleCandidates(facade.pluginInstance, ids);
        showMessage(t(i18n, "panel.staleArchived", { n: result.ok }), 3000);
        stalePreviewOpen = false;
        await reload();
    } finally {
        archivingStale = false;
    }
}

/** Dock、工作台与看板共用的真实站点/用户标签分面。 */
const railStats = $derived(facets);

function queueCount(key: QueueKey): number {
    return queueStats.counts[key];
}

function queueLabel(key: QueueKey | ""): string {
    return t(i18n, `status.${key || "inbox"}`);
}

function sourceLabel(value: string): string {
    const translated = t(i18n, `clip.source.${value}`);
    return translated === `clip.source.${value}` ? value : translated;
}

function facetLabel(value: string, kind: "timeSource" | "contentType"): string {
    const i18nKind = kind === "contentType" ? "type" : "timeSource";
    const key = `clip.${i18nKind}.${value}`;
    const translated = t(i18n, key);
    return translated === key ? value : translated;
}

function selectQueue(queue: QueueKey): void {
    markPrefsInteraction();
    activeQueue = queue;
    authorTimeline = false;
    selectedAuthor = "";
    selectedSite = "";
    selectedTag = "";
    selectedAiTag = "";
    selectedSource = "";
    selectedTimeSource = "";
    selectedContentType = "";
    keyword = "";
}

function openCandidateQueue(): void {
    markPrefsInteraction();
    view = "library";
    activeQueue = "inbox";
    authorTimeline = false;
    selectedAuthor = "";
    selectedSite = "";
    selectedTag = "";
    selectedAiTag = "";
    selectedSource = "";
    selectedTimeSource = "";
    selectedContentType = "";
    keyword = "";
    if (isTabCanvas) layoutMode = "list";
}

function clearFilters(): void {
    authorTimeline = false;
    selectedAuthor = "";
    selectedSite = "";
    selectedTag = "";
    selectedAiTag = "";
    selectedSource = "";
    selectedTimeSource = "";
    selectedContentType = "";
    keyword = "";
}

const hasFilters = $derived(Boolean(authorTimeline || selectedAuthor || selectedSite || selectedTag || selectedAiTag || selectedSource || selectedTimeSource || selectedContentType || keyword.trim()));
const filterChips = $derived(libraryFilterChips(activeFilter));

function selectAuthor(value: string): void {
    markPrefsInteraction();
    const alreadySelected = authorTimeline && selectedAuthor.toLocaleLowerCase() === value.toLocaleLowerCase();
    clearFilters();
    if (alreadySelected) return;
    selectedAuthor = value;
    authorTimeline = true;
    sortBy = "time";
    sortDirection = "desc";
}

function filterChipText(key: FilterChipKey, value: string): string {
    const labels: Record<FilterChipKey, string> = { author: "library.filterAuthor", site: "library.filterSite", tag: "library.filterTag", aiTag: "library.filterAiTag", src: "library.filterSource", timeSource: "library.filterTimeSource", contentType: "library.filterContentType", keyword: "action.search" };
    const text = key === "tag" ? `#${value}` : key === "aiTag" ? `✨${value}` : key === "src" ? sourceLabel(value) : key === "timeSource" || key === "contentType" ? facetLabel(value, key) : value;
    return `${t(i18n, labels[key])}: ${text}`;
}

function removeFilterChip(key: FilterChipKey): void {
    markPrefsInteraction();
    const next = removeLibraryFilter(activeFilter, key);
    selectedSite = next.site ?? "";
    selectedAuthor = next.author ?? "";
    if (key === "author") authorTimeline = false;
    selectedTag = next.tag ?? "";
    selectedAiTag = next.aiTag ?? "";
    selectedSource = next.src ?? "";
    selectedTimeSource = next.timeSource ?? "";
    selectedContentType = next.contentType ?? "";
    keyword = next.keyword ?? "";
}
const activeFilterCount = $derived([selectedAuthor, selectedSite, selectedTag, selectedAiTag, selectedSource, selectedTimeSource, selectedContentType, keyword.trim()].filter(Boolean).length);
const headerSubtitle = $derived.by(() => {
    const viewLabel = t(i18n, views.find((item) => item.key === view)?.labelKey ?? "view.resurface");
    return view === "library" && activeFilterCount > 0
        ? t(i18n, "panel.headerFiltered", { view: viewLabel, n: totalClips, filters: activeFilterCount })
        : t(i18n, "panel.headerView", { view: viewLabel, n: totalClips });
});

function openMobileFilters(): void {
    mobileFilterDraft = {
        site: selectedSite,
        author: selectedAuthor,
        tag: selectedTag,
        aiTag: selectedAiTag,
        source: selectedSource,
        timeSource: selectedTimeSource,
        contentType: selectedContentType,
        sortBy,
        direction: sortDirection,
    };
    mobileFilterReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileFilterOpen = true;
    void tick().then(() => {
        if (!mobileFilterOpen) return;
        if (!mobileFilterSheet) return;
        disposeMobileFilterFocus = installModalFocus(mobileFilterSheet, {
            onClose: closeMobileFilters,
            returnFocus: mobileFilterReturnFocus,
        });
    });
}

function closeMobileFilters(): void {
    mobileFilterOpen = false;
    const dispose = disposeMobileFilterFocus;
    disposeMobileFilterFocus = () => {};
    dispose();
    mobileFilterReturnFocus = null;
}

function clearMobileFilterDraft(): void {
    mobileFilterDraft = {
        ...mobileFilterDraft,
        site: "",
        author: "",
        tag: "",
        aiTag: "",
        source: "",
        timeSource: "",
        contentType: "",
    };
}

function applyMobileFilters(): void {
    selectedSite = mobileFilterDraft.site;
    selectedAuthor = mobileFilterDraft.author;
    if (!selectedAuthor) authorTimeline = false;
    selectedTag = mobileFilterDraft.tag;
    selectedAiTag = mobileFilterDraft.aiTag;
    selectedSource = mobileFilterDraft.source;
    selectedTimeSource = mobileFilterDraft.timeSource;
    selectedContentType = mobileFilterDraft.contentType;
    sortBy = mobileFilterDraft.sortBy;
    sortDirection = mobileFilterDraft.direction;
    closeMobileFilters();
}

const kanbanCols = $derived.by(() => {
    const clips = filterAndSortLibrary(libraryItems, {
        ...activeFilter,
        status: "all",
        includeCandidates: false,
    }).filter((item) => item.kind === "clip").map((item) => item.id);
    return queues.map((status) => ({
        status,
        label: queueLabel(status),
        items: clips.map((id) => index.clips[id]).filter((entry): entry is ClipIndexEntry => Boolean(entry && entry.status === status)),
    }));
});
const visibleKanbanCols = $derived(kanbanCols.map((column) => ({ ...column, items: column.items.slice(0, renderLimit) })));
const renderedKanbanCount = $derived(visibleKanbanCols.reduce((total, column) => total + column.items.length, 0));
const totalKanbanCount = $derived(kanbanCols.reduce((total, column) => total + column.items.length, 0));
const hasMoreKanban = $derived(renderedKanbanCount < totalKanbanCount);

async function moveTo(entry: ClipIndexEntry, status: ClipStatus) {
    if (entry.status === status) return;
    dragId = "";
    dragOverCol = null;
    await setStatus(entry, status);
}

function draggedEntry(): ClipIndexEntry | null {
    if (!dragId) return null;
    return index.clips[dragId] ?? null;
}

function statusDotClass(status: string): string {
    return `glean-dot glean-dot--${status}`;
}

function staleText(time: string): string | null {
    const days = staleDays(time);
    return days === null ? null : t(i18n, "panel.staleDays", { n: days });
}

function staleDays(time: string): number | null {
    if (!/^\d{14}$/.test(time)) return null;
    const t = new Date(Number(time.slice(0, 4)), Number(time.slice(4, 6)) - 1, Number(time.slice(6, 8))).getTime();
    const days = Math.floor((Date.now() - t) / 86_400_000);
    return days >= 14 ? days : null;
}

const reload = createRefreshQueue(async () => {
    loading = true;
    try {
        const cached = await loadIndex(facade.pluginInstance);
        if (cached.updatedAt) index = cached;
        index = await reconcileIndex(facade.pluginInstance, facade.settings);
        loadError = false;
    } catch (error) {
        console.warn("[glean] 读库对账失败:", error);
        loadError = true;
    } finally {
        loading = false;
    }
});

$effect(() => {
    void reload();
});

$effect(() => {
    if (rootEl?.closest(".glean-tab-root")) {
        isTabCanvas = true;
        const pending = facade.consumeLibraryFocus();
        if (pending && !initialPreviewId) void focusClipById(pending);
    }
});

// 视图偏好持久化：挂载恢复 + 切换保存
$effect(() => {
    void loadUiPrefs(facade.pluginInstance).then((prefs) => {
        const valid = views.some((item) => item.key === prefs.lastView);
        // 返回读库定位优先于异步恢复的上次视图，避免把 library 切回旧视图。
        applyingPrefs = true;
        if (!prefsUserTouched && valid && !focusRequested) view = prefs.lastView as PanelView;
        savedViews = prefs.savedViews;
        defaultSavedViewId = prefs.defaultSavedViewId;
        governanceMuted = prefs.governanceMuted;
        if (!previewPrefsTouched) {
            previewEnabled = prefs.workbenchPreviewEnabled;
            previewRatio = prefs.workbenchPreviewRatio;
        }
        if (!prefsUserTouched && !focusRequested && prefs.defaultSavedViewId) applySavedViewState(prefs.defaultSavedViewId, prefs.savedViews);
        applyingPrefs = false;
        prefsLoading = false;
    });
});

$effect(() => {
    if (prefsLoading) return;
    void saveUiPrefs(facade.pluginInstance, { lastView: view, savedViews, defaultSavedViewId });
});

function currentSavedFilter() {
    return {
        status: authorTimeline ? "all" as const : activeQueue,
        site: selectedSite || undefined,
        author: selectedAuthor || undefined,
        tag: selectedTag || undefined,
        aiTag: selectedAiTag || undefined,
        src: selectedSource || undefined,
        timeSource: selectedTimeSource || undefined,
        contentType: selectedContentType || undefined,
        keyword: keyword.trim() || undefined,
        sortBy,
        direction: sortDirection,
    };
}

function applySavedViewState(id: string, source = savedViews): void {
    const selected = applySavedView(source, id);
    if (!selected) return;
    const filter = selected.filter;
    applyingPrefs = true;
    layoutMode = selected.layout;
    if (filter.status && filter.status !== "all") activeQueue = filter.status;
    selectedSite = filter.site ?? "";
    selectedAuthor = filter.author ?? "";
    authorTimeline = filter.status === "all";
    selectedTag = filter.tag ?? "";
    selectedAiTag = filter.aiTag ?? "";
    selectedSource = filter.src ?? "";
    selectedTimeSource = filter.timeSource ?? "";
    selectedContentType = filter.contentType ?? "";
    keyword = filter.keyword ?? "";
    sortBy = filter.sortBy ?? "time";
    sortDirection = filter.direction ?? (sortBy === "title" ? "asc" : "desc");
    savedViewId = selected.id;
    applyingPrefs = false;
}

function saveCurrentView(): void {
    const name = savedViewName.trim();
    if (!name || savedViews.length >= 20) return;
    const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = createSavedView(name, currentSavedFilter(), layoutMode, savedViews, id);
    if (!created) return;
    savedViews = [...savedViews, created];
    savedViewId = created.id;
    savedViewName = "";
}

function removeSavedView(): void {
    if (!savedViewId) return;
    const result = deleteSavedView(savedViews, savedViewId, defaultSavedViewId);
    savedViews = result.views;
    defaultSavedViewId = result.defaultSavedViewId;
    savedViewId = "";
}

function makeDefaultSavedView(): void {
    defaultSavedViewId = setDefaultSavedView(savedViews, savedViewId);
}

// 插件壳广播的数据变更（迁移完成、右键收录等）触发面板对账
$effect(() => {
    const handler = () => void reload();
    document.addEventListener("glean:data-changed", handler);
    return () => document.removeEventListener("glean:data-changed", handler);
});

async function focusClipById(id: string, openPreview = false): Promise<void> {
    focusRequested = true;
    pendingFocusId = id;
    view = "library";
    clearFilters();
    if (!index.clips[id] && !index.candidates[id]) await reload();
    if (pendingFocusId !== id) return;
    if (!index.clips[id] && !index.candidates[id]) return;
    activeQueue = index.clips[id]?.status || "inbox";
    authorTimeline = false;
    if (openPreview) {
        layoutMode = "list";
        previewPrefsTouched = true;
        previewEnabled = true;
        previewRevision += 1;
        previewId = id;
    }
}

// 工作台可能仍在对账或等待 Svelte 渲染；保留定位请求直到目标行真正出现。
$effect(() => {
    const id = pendingFocusId;
    if (!id || !isTabCanvas || loading || view !== "library" || !rootEl) return;
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex < 0) return;
    if (rowIndex >= renderLimit) {
        renderLimit = rowIndex + 1;
        return;
    }
    void tick().then(() => {
        if (pendingFocusId !== id) return;
        const target = rootEl?.querySelector<HTMLElement>(`[data-glean-clip-id="${CSS.escape(id)}"]`);
        if (!target) return;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.add("glean-focus-flash");
        window.setTimeout(() => target.classList.remove("glean-focus-flash"), 1200);
        pendingFocusId = "";
    });
});

$effect(() => {
    const handler = (event: Event) => {
        if (!isTabCanvas) return;
        const id = (event as CustomEvent<{ id?: string }>).detail?.id;
        if (id) {
            // 已存在的工作台由事件处理；同时清掉新建工作台使用的一次性请求。
            facade.consumeLibraryFocus();
            void focusClipById(id);
        }
    };
    document.addEventListener("glean:focus-clip", handler);
    return () => document.removeEventListener("glean:focus-clip", handler);
});

async function capture(entry: CandidateEntry) {
    if (!normalizeUrl(entry.url)) {
        showMessage(t(i18n, "msg.candidateNeedsUrl"), 3500);
        return;
    }
    try {
        const result = await captureDocument(facade.pluginInstance, entry.id, { url: entry.url || undefined });
        if (result.captured) {
            showMessage(t(i18n, "msg.added"), 2500);
            autoEnrich(facade.pluginInstance, entry.id, facade.settings);
        } else if (result.conflict) {
            showMessage(`${t(i18n, "inbox.duplicate")}: ${result.conflict.title || result.conflict.hpath}`, 4000);
        } else {
            showMessage(t(i18n, "msg.alreadyIn"), 2500);
        }
        await reload();
    } catch (error) {
        console.warn("[glean] 收录失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.captureFailed"), 3500);
    }
}

async function captureAsLocal(entry: CandidateEntry) {
    if (entry.url) return;
    try {
        const result = await captureDocument(facade.pluginInstance, entry.id, { contentType: "local" });
        showMessage(t(i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 本地文档收录失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.captureFailed"), 3500);
    }
}

async function excludeCandidate(entry: CandidateEntry) {
    try {
        await writeClip(facade.pluginInstance, entry.id, { excluded: true });
        showMessage(t(i18n, "msg.candidateExcluded"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 忽略候选失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.captureFailed"), 3500);
    }
}

function startCandidateUrlEdit(entry: CandidateEntry) {
    editingCandidateId = entry.id;
    candidateUrlInput = entry.url;
}

async function saveCandidateUrl(entry: CandidateEntry) {
    const url = candidateUrlInput.trim();
    if (!normalizeUrl(url)) {
        showMessage(t(i18n, "msg.candidateInvalidUrl"), 3500);
        return;
    }
    try {
        const conflict = await findClipUrlConflict(url, entry.id, facade.pluginInstance);
        if (conflict) {
            showMessage(`${t(i18n, "inbox.duplicate")}: ${conflict.title || conflict.hpath}`, 4000);
            return;
        }
        await writeClip(facade.pluginInstance, entry.id, { url }, { force: true });
        editingCandidateId = "";
        await reload();
    } catch (error) {
        console.warn("[glean] 修正来源失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.captureFailed"), 3500);
    }
}

function candidateEvidence(entry: CandidateEntry): string {
    return entry.evidence.map((item) => t(i18n, `candidate.evidence.${item}`)).join(" · ");
}

function candidateMissing(entry: CandidateEntry): string {
    return entry.missing.filter((item) => item !== "status")
        .map((item) => t(i18n, `candidate.missing.${item}`)).join(" · ");
}

function clipType(entry: ClipIndexEntry): string {
    return t(i18n, `clip.type.${resolveCarrier(entry.contentType)}`);
}

function timeSource(entry: ClipIndexEntry): string {
    return t(i18n, `clip.timeSource.${entry.timeSource || "unknown"}`);
}

function lengthLabel(entry: ClipIndexEntry): string {
    if (entry.contentType === "link") return clipType(entry);
    if (entry.words <= 0) return t(i18n, "clip.lengthUnknown");
    return `${t(i18n, "panel.words", { n: entry.words })} · ${t(i18n, "panel.minutes", { n: entry.minutes })}`;
}

/** 手动 AI 富化（卡上 ✨，静默降级） */
async function enrich(entry: ClipIndexEntry) {
    if (enrichingId) return;
    enrichingId = entry.id;
    try {
        const outcome = await enrichClip(facade.pluginInstance, entry.id, facade.settings);
        if (outcome.ok) {
            showMessage(
                outcome.duplicates.length > 0
                    ? t(i18n, "ai.similarFound", { title: outcome.duplicates[0].title })
                    : t(i18n, "ai.enrichDone"),
                3500
            );
        } else if (outcome.skipped === "cap") {
            showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
        } else if (outcome.skipped === "off") {
            showMessage(t(i18n, "ai.disabled"), 3000);
        } else {
            showMessage(t(i18n, "ai.enrichFailed"), 3000);
        }
    } finally {
        enrichingId = "";
        await reload();
    }
}

async function setStatus(entry: ClipIndexEntry, status: ClipStatus) {
    if (statusActionId) return false;
    statusActionId = entry.id;
    try {
        const ok = await batchSetStatus(facade.pluginInstance, [entry.id], status);
        if (ok === 1 && status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
            void recordReadingDone(facade.settings.integration.checkinItemId, entry.id, entry.title);
        }
        showMessage(t(i18n, ok === 1 ? "msg.statusChanged" : "msg.statusFailed"), 3000);
        await reload();
        return ok === 1;
    } catch (error) {
        console.warn("[glean] 状态变更失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.statusFailed"), 3000);
        return false;
    } finally {
        statusActionId = "";
    }
}

async function startReading(entry: ClipIndexEntry) {
    if (entry.status === "reading") {
        openReading(entry);
        return;
    }
    if (await setStatus(entry, "reading")) openReading(entry);
}

function toggleSelect(id: string, event: Event) {
    event.stopPropagation();
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection = next;
}

async function batchApply(status: ClipStatus) {
    if (batchBusy || selection.size === 0) return;
    batchBusy = true;
    try {
        await applySelectedStatus(status);
    } finally {
        batchBusy = false;
    }
}

async function applySelectedStatus(status: ClipStatus) {
    if (selection.size === 0) return;
    const total = selection.size;
    let result: { ok: number; succeeded: string[] };
    try {
        result = await batchSetStatusDetailed(facade.pluginInstance, [...selection], status);
        await reload();
    } catch (error) {
        console.warn("[glean] 批量状态变更失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.statusFailed"), 3500);
        return;
    }
    if (status === "done" && result.ok > 0 && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
        const completed = result.succeeded
            .map((id) => index.clips[id])
            .filter((entry): entry is ClipIndexEntry => Boolean(entry && entry.status === "done"));
        await Promise.allSettled(completed.map((entry) => recordReadingDone(
            facade.settings.integration.checkinItemId,
            entry.id,
            entry.title,
        )));
    }
    showMessage(t(i18n, "msg.statusBatchResult", { ok: result.ok, total }), 3500);
    const succeeded = new Set(result.succeeded);
    selection = new Set([...selection].filter((id) => !succeeded.has(id)));
}

function openDoc(docId: string) {
    facade.openReadingDocument(docId);
}

function selectPreview(id: string): void {
    if (!previewEnabled || (!isTabCanvas && !facade.isMobile)) { openDoc(id); return; }
    previewReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previewRevision += 1;
    previewId = id;
}

function closePreview(): void {
    previewRevision += 1;
    previewId = "";
    const target = previewReturnFocus;
    previewReturnFocus = null;
    void tick().then(() => {
        const fallback = rootEl?.querySelector<HTMLElement>('[data-glean-clip-id], .glean-q, button');
        (target?.isConnected ? target : fallback)?.focus({ preventScroll: true });
    });
}

function processedCallback(id: string, revision: number): () => Promise<void> {
    const before = rows.map((row) => row.id);
    const filter = JSON.stringify(activeFilter);
    return async () => {
        await reload();
        if (previewId !== id || previewRevision !== revision || view !== "library" || filter !== JSON.stringify(activeFilter)) return;
        if (loadError) return;
        const next = nextPreviewId(before, rows.map((row) => row.id), id);
        previewRevision += 1;
        if (next) previewId = next;
        else closePreview();
    };
}

async function savePreviewPrefs(patch: { workbenchPreviewEnabled?: boolean; workbenchPreviewRatio?: number }): Promise<void> {
    previewPrefsTouched = true;
    try { await saveUiPrefs(facade.pluginInstance, patch); }
    catch { showMessage(t(i18n, "settings.saveFailed"), 3000); }
}

function togglePreview(): void {
    previewEnabled = !previewEnabled;
    if (!previewEnabled) closePreview();
    void savePreviewPrefs({ workbenchPreviewEnabled: previewEnabled });
}

function resizePreview(event: PointerEvent): void {
    if (draggingPointer !== event.pointerId || !previewSplit) return;
    const rect = previewSplit.getBoundingClientRect();
    const railWidth = previewSplit.querySelector(".glean-rail")?.getBoundingClientRect().width ?? 0;
    const ratio = previewRatioFromPointer(event.clientX, rect.right, rect.width - railWidth);
    if (ratio !== null) previewRatio = ratio;
}

function startPreviewResize(event: PointerEvent): void {
    if (event.button !== 0 || draggingPointer !== null) return;
    event.preventDefault();
    const separator = event.currentTarget as HTMLElement;
    separator.focus({ preventScroll: true });
    separator.setPointerCapture(event.pointerId);
    draggingPointer = event.pointerId;
    dragStartRatio = previewRatio;
    previewPrefsTouched = true;
}

function finishPreviewResize(event: PointerEvent, cancel = false): void {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    if (cancel) previewRatio = dragStartRatio;
    else void savePreviewPrefs({ workbenchPreviewRatio: previewRatio });
    const separator = event.currentTarget as HTMLElement;
    if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
}

function previewResizeKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    previewRatio = normalizePreviewRatio(event.key === "Home" ? 0.25 : event.key === "End" ? 0.65 : previewRatio + (event.key === "ArrowLeft" ? 0.02 : -0.02));
    void savePreviewPrefs({ workbenchPreviewRatio: previewRatio });
}

$effect(() => {
    if (view !== "library" || (!facade.isMobile && layoutMode !== "list")) {
        if (previewId) closePreview();
    }
});

$effect(() => {
    if (!facade.isMobile || !previewId || !previewDialog) return;
    return installModalFocus(previewDialog, { onClose: closePreview, returnFocus: previewReturnFocus });
});

$effect(() => {
    const root = previewSplit;
    if (!root || !previewId || facade.isMobile) return;
    const onKey = (event: KeyboardEvent): boolean => {
        if (event.ctrlKey || event.altKey || event.metaKey) return false;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"]')) return false;
        const nestedDialog = target?.closest('[role="dialog"]');
        if (nestedDialog && root.contains(nestedDialog)) return false;
        const overlay = document.querySelectorAll<HTMLElement>('.b3-menu, .b3-dialog, [aria-modal="true"]');
        if (Array.from(overlay).some((element) => element.getClientRects().length && !element.contains(root))) return false;
        closePreview();
        return true;
    };
    return installEscapeHandler(root, onKey);
});

/** 全文/仅链接的有效来源是次级动作；打开来源不会改变文章状态。 */
function openSource(entry: ClipIndexEntry) {
    const url = sourceUrlForCarrier(entry.contentType, entry.url);
    if (!url) {
        showMessage(t(i18n, "clip.sourceMissing"), 3000);
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
}

/** “开始阅读”按载体选择正文或原文；导航本身不再写状态。 */
function openReading(entry: ClipIndexEntry) {
    if (openTargetForCarrier(entry.contentType, entry.url) === "source") openSource(entry);
    else {
        if (resolveCarrier(entry.contentType) === "link") showMessage(t(i18n, "clip.sourceMissing"), 3000);
        openDoc(entry.id);
    }
}

function isPinnedToday(entry: ClipIndexEntry): boolean {
    return entry.pinned === todayStamp();
}

function surfacePinLabel(entry: ClipIndexEntry): string {
    return t(i18n, isPinnedToday(entry) ? "resurface.unpinToday" : "resurface.pinToday");
}

async function toggleSurfacePin(entry: ClipIndexEntry) {
    if (statusActionId) return;
    const nextPinned = !isPinnedToday(entry);
    statusActionId = entry.id;
    try {
        await setSurfacePinned(facade.pluginInstance, entry.id, nextPinned);
        showMessage(t(i18n, nextPinned ? "resurface.pinToday" : "resurface.unpinToday"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 今日置顶写入失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.statusFailed"), 3000);
    } finally {
        statusActionId = "";
    }
}

async function setPriority(entry: ClipIndexEntry, value: number) {
    if (statusActionId) return;
    statusActionId = entry.id;
    try {
        await writeClip(facade.pluginInstance, entry.id, { priority: value }, { force: true });
        showMessage(t(i18n, "msg.rankSaved"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 优先级写入失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.statusFailed"), 3000);
    } finally {
        statusActionId = "";
    }
}

async function setRating(entry: ClipIndexEntry, value: number) {
    if (statusActionId) return;
    statusActionId = entry.id;
    try {
        await writeClip(facade.pluginInstance, entry.id, { rating: value }, { force: true });
        showMessage(t(i18n, "msg.rankSaved"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 评分写入失败:", error);
        showMessage(t(i18n, offline ? "msg.offlineRetry" : "msg.statusFailed"), 3000);
    } finally {
        statusActionId = "";
    }
}

function carrierClass(entry: ClipIndexEntry): string {
    return `glean-carrier-badge glean-carrier-badge--${resolveCarrier(entry.contentType)}`;
}

/** 全文已收录但正文长度未记录或记录为 0：提示"待核"，不在这里断言缺失（T-1727）。 */
function bodyPending(entry: ClipIndexEntry): boolean {
    return resolveCarrier(entry.contentType) === "fulltext" && entry.words <= 0;
}

function carrierLabel(entry: ClipIndexEntry): string {
    return clipType(entry);
}

function openAsset(path: string) {
    void openTab({ app: facade.pluginInstance.app, asset: { path } });
}

function snapshotLabel(entry: ClipIndexEntry): string {
    return entry.snapshot ? t(i18n, "snapshot.open") : t(i18n, "snapshot.take");
}

async function takeSnapshot(entry: ClipIndexEntry) {
    if (snappingId) return;
    if (entry.snapshot) {
        openAsset(entry.snapshot);
        return;
    }
    snappingId = entry.id;
    try {
        const { path } = await snapshotClip(facade.pluginInstance, entry.id);
        showMessage(t(i18n, "snapshot.done"), 3000);
        entry.snapshot = path;
        await reload();
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        snappingId = "";
    }
}

function metaLine(entry: Row): string {
    const parts: string[] = [];
    if (entry.kind === "clip") {
        parts.push(clipType(entry));
        if (entry.minutes > 0) parts.push(t(i18n, "panel.minutes", { n: entry.minutes }));
        parts.push(timeSource(entry));
    }
    return parts.join(" · ");
}
</script>

<div class="glean-panel" class:glean-panel--mobile={facade.isMobile} bind:this={rootEl} onchange={markPrefsInteraction}>
    <header class="glean-panel__head">
        {#if facade.isMobile}
            <div class="glean-mobile-topbar">
                <button
                    type="button"
                    class="glean-mobile-topbar__back"
                    class:glean-mobile-topbar__back--home={view === "resurface"}
                    disabled={view === "resurface"}
                    title={t(i18n, "mobile.back")}
                    aria-label={t(i18n, "mobile.back")}
                    onclick={() => mobileBack()}
                >
                    {#if view === "resurface"}
                        <span class="glean-mobile-topbar__mark" aria-hidden="true"><svg><use href="#iconGleanWheat" /></svg></span>
                    {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 5.3-6.7 6.7 6.7 6.7 1.4-1.4-5.3-5.3 5.3-5.3-1.4-1.4Z" /></svg>
                    {/if}
                </button>
                <div class="glean-mobile-topbar__copy">
                    <h1 class="glean-mobile-topbar__title">{t(i18n, mobileTitleKey)}</h1>
                    <span class="glean-mobile-topbar__sub">{t(i18n, "panel.libraryCount", { n: totalClips })}</span>
                </div>
                <span
                    class={`glean-mobile-task glean-mobile-task--${mobileTaskState}`}
                    role="status"
                    aria-live="polite"
                    aria-busy={loading}
                >
                    <span class="glean-mobile-task__dot" aria-hidden="true"></span>
                    {#if mobileTaskState === "loading"}
                        {t(i18n, "mobile.taskLoading")}
                    {:else if mobileTaskState === "error"}
                        {t(i18n, "mobile.taskError")}
                    {:else if mobileTaskState === "offline"}
                        {t(i18n, "mobile.taskOffline")}
                    {:else}
                        {t(i18n, "mobile.taskReady")}
                    {/if}
                </span>
                <div class="glean-mobile-topbar__more">
                    <button
                        type="button"
                        class="glean-mobile-topbar__more-btn"
                        title={t(i18n, "mobile.more")}
                        aria-label={t(i18n, "mobile.more")}
                        aria-haspopup="menu"
                        aria-expanded={mobileMoreOpen}
                        onclick={() => (mobileMoreOpen = !mobileMoreOpen)}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>
                    </button>
                    {#if mobileMoreOpen}
                        <div class="glean-mobile-more" role="menu" aria-label={t(i18n, "mobile.moreLabel")}>
                            <button type="button" class="glean-mobile-more__item" role="menuitem" onclick={() => { mobileMoreOpen = false; void reload(); }}>
                                {t(i18n, "action.refresh")}
                            </button>
                            <button type="button" class="glean-mobile-more__item" role="menuitem" onclick={() => { mobileMoreOpen = false; openPopup(); }}>
                                {t(i18n, "panel.popup")}
                            </button>
                            <button type="button" class="glean-mobile-more__item" role="menuitem" onclick={() => { mobileMoreOpen = false; facade.openMigrate(); }}>
                                {t(i18n, "panel.migrate")}
                            </button>
                            <button type="button" class="glean-mobile-more__item" role="menuitem" onclick={() => { mobileMoreOpen = false; facade.openImport(); }}>
                                {t(i18n, "import.title")}
                            </button>
                            <button type="button" class="glean-mobile-more__item" role="menuitem" onclick={() => { mobileMoreOpen = false; facade.openSettings(); }}>
                                {t(i18n, "panel.settings")}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="glean-brand">
                <div class="glean-brand__mark"><svg><use href="#iconGleanWheat" /></svg></div>
                <div>
                    <div class="glean-brand__name">{t(i18n, "pluginName")}</div>
                    <div class="glean-brand__sub">{headerSubtitle}</div>
                </div>
                <div class="glean-head-actions">
                    <button type="button" class="glean-icon-btn glean-head-action" title={t(i18n, "panel.popup")} aria-label={t(i18n, "panel.popup")} onclick={() => openPopup()}>
                        <svg aria-hidden="true"><use href="#iconGleanPopup" /></svg>
                        <span class="glean-head-action__label">{t(i18n, "panel.popupShort")}</span>
                    </button>
                    <button type="button" class="glean-icon-btn glean-head-action" title={t(i18n, "panel.migrate")} aria-label={t(i18n, "panel.migrate")} onclick={() => facade.openMigrate()}>
                        <svg aria-hidden="true"><use href="#iconGleanRefresh" /></svg>
                        <span class="glean-head-action__label">{t(i18n, "panel.migrateShort")}</span>
                    </button>
                    <button type="button" class="glean-icon-btn glean-head-action" title={t(i18n, "panel.settings")} aria-label={t(i18n, "panel.settings")} onclick={() => facade.openSettings()}>
                        <svg aria-hidden="true"><use href="#iconGleanGear" /></svg>
                        <span class="glean-head-action__label">{t(i18n, "panel.settings")}</span>
                    </button>
                </div>
            </div>
        {/if}

        {#if !facade.isMobile}
            <div class="glean-views">
                {#each views as item (item.key)}
                    <button
                        class="glean-views__btn"
                        class:glean-views__btn--on={view === item.key}
                        onclick={() => { markPrefsInteraction(); view = item.key; }}
                    >{t(i18n, item.labelKey)}</button>
                {/each}
            </div>
        {/if}

        {#if view === "library"}
            {#if isTabCanvas || searchOpen}
                <div class="glean-search">
                    <svg class="glean-search__icon" viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2a1 1 0 0 1-1.4 1.4l-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
                    <input
                        bind:this={searchInput}
                        type="text"
                        placeholder={t(i18n, "panel.searchPlaceholder")}
                        bind:value={keyword}
                    />
                    {#if keyword}
                        <button
                            type="button"
                            class="glean-search__clear"
                            title={t(i18n, "panel.searchClear")}
                            aria-label={t(i18n, "panel.searchClear")}
                            onclick={() => { keyword = ""; searchInput?.focus(); }}
                        >×</button>
                    {/if}
                </div>
            {:else}
                <button
                    class="glean-icon-btn"
                    title={t(i18n, "panel.searchPlaceholder")}
                    aria-label={t(i18n, "panel.searchPlaceholder")}
                    onclick={() => (searchOpen = true)}
                >
                    <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2a1 1 0 0 1-1.4 1.4l-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
                </button>
            {/if}
        {/if}
    </header>

    {#if loadError}
        <div class="glean-load-error" role="alert">
            <span>{t(i18n, "panel.reloadFailed")}</span>
            <button class="glean-btn" disabled={loading} onclick={() => void reload()}>{t(i18n, "action.retry")}</button>
        </div>
    {/if}

    {#if facade.isMobile && offline}
        <div class="glean-offline-notice" role="status" aria-live="polite">
            <span>{t(i18n, "mobile.offlineHint")}</span>
            <button class="glean-btn" disabled={loading} onclick={() => void reload()}>{t(i18n, "action.retry")}</button>
        </div>
    {/if}

    {#if view === "library"}
        <InboxSection {facade} onMutated={() => void reload()} />
        <AiBatchPanel {facade} bind:open={aiBatchOpen} docIds={aiBatchIds} />
    {/if}

    {#if view === "library"}
        <nav class="glean-queues">
            {#each queues as queue (queue)}
                <button
                    class="glean-q"
                    class:glean-q--on={!authorTimeline && activeQueue === queue}
                    onclick={() => selectQueue(queue)}
                >
                    {queueLabel(queue)}
                    <span class="glean-q__n">{queueCount(queue)}</span>
                </button>
            {/each}
        </nav>

        {#if facade.isMobile}
            <div class="glean-mobile-filter-summary">
                <button
                    type="button"
                    class="glean-mobile-filter-trigger"
                    class:glean-mobile-filter-trigger--active={activeFilterCount > 0}
                    aria-label={t(i18n, "library.filters")}
                    onclick={openMobileFilters}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13a1.5 1.5 0 0 1 1.2 2.4l-5.2 6.9v5.2a1.5 1.5 0 0 1-.8 1.3l-2.5 1.2a1.5 1.5 0 0 1-2.2-1.3v-6.4L3.3 6.4A1.5 1.5 0 0 1 4 5.5Zm1.5.5 5 6.7v5l1-.5v-4.5l5-6.7h-11Z" /></svg>
                    <span>{t(i18n, "library.filters")}</span>
                    {#if activeFilterCount > 0}<span class="glean-mobile-filter-badge">{activeFilterCount}</span>{/if}
                </button>
                <span class="glean-mobile-filter-results" role="status" aria-live="polite">{t(i18n, "library.resultCount", { n: rows.length })}</span>
            </div>
        {:else if !isTabCanvas}
            <LibraryFilters {i18n} {facets} bind:site={selectedSite} bind:author={selectedAuthor} bind:tag={selectedTag} bind:aiTag={selectedAiTag} bind:source={selectedSource} bind:timeSource={selectedTimeSource} bind:contentType={selectedContentType} bind:sortBy bind:direction={sortDirection} {hasFilters} onClear={clearFilters} {sourceLabel} {facetLabel} />
        {/if}

        {#if isTabCanvas}
            <div class="glean-libbar">
                <div class="glean-seg">
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={layoutMode === "list"}
                        onclick={() => { markPrefsInteraction(); layoutMode = "list"; }}
                    >☰ {t(i18n, "view.modeList")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={layoutMode === "kanban"}
                        onclick={() => { markPrefsInteraction(); layoutMode = "kanban"; }}
                    >⇆ {t(i18n, "view.modeKanban")}</button>
                </div>
                <div class="glean-libbar__spacer"></div>
                <button class="glean-btn glean-btn--ghost" aria-pressed={previewEnabled} onclick={togglePreview}>{t(i18n, "preview.enabled")}</button>
                <LibraryFilters {i18n} {facets} bind:site={selectedSite} bind:author={selectedAuthor} bind:tag={selectedTag} bind:aiTag={selectedAiTag} bind:source={selectedSource} bind:timeSource={selectedTimeSource} bind:contentType={selectedContentType} bind:sortBy bind:direction={sortDirection} {hasFilters} onClear={clearFilters} {sourceLabel} {facetLabel} />
            </div>
        {/if}

        {#if view === "library" && !facade.isMobile}
            <div class="glean-saved-views" aria-label={t(i18n, "library.savedViews")}>
                <select class="b3-select" aria-label={t(i18n, "library.savedViews")} value={savedViewId} onchange={(event) => applySavedViewState((event.currentTarget as HTMLSelectElement).value)}>
                    <option value="">{t(i18n, "library.savedViews")}</option>
                    {#each savedViews as saved (saved.id)}<option value={saved.id}>{saved.name}</option>{/each}
                </select>
                <input class="b3-text-field" maxlength="40" value={savedViewName} placeholder={t(i18n, "library.savedViewName")} oninput={(event) => (savedViewName = (event.currentTarget as HTMLInputElement).value)} />
                <button class="glean-btn" disabled={!savedViewName.trim() || savedViews.length >= 20} onclick={saveCurrentView}>{t(i18n, "library.savedViewSave")}</button>
                <button class="glean-btn glean-btn--ghost" disabled={!savedViewId} onclick={makeDefaultSavedView}>{t(i18n, "library.savedViewDefault")}</button>
                <button class="glean-btn glean-btn--ghost" disabled={!savedViewId} onclick={removeSavedView}>{t(i18n, "library.savedViewDelete")}</button>
            </div>
        {/if}

        {#if filterChips.length > 0}
            <div class="glean-filter-chips" aria-label={t(i18n, "library.filters")}>
                {#each filterChips as chip (chip.key)}
                    <button class="glean-filter-chip" title={filterChipText(chip.key, chip.value)} aria-label={t(i18n, "library.removeFilter", { name: filterChipText(chip.key, chip.value) })} onclick={() => removeFilterChip(chip.key)}>{filterChipText(chip.key, chip.value)} <span aria-hidden="true">×</span></button>
                {/each}
            </div>
        {/if}
        {#if facade.isMobile && mobileFilterOpen}
            <div class="glean-mobile-filter-layer">
                <button
                    type="button"
                    class="glean-mobile-filter-backdrop"
                    aria-label={t(i18n, "library.filterClose")}
                    onclick={closeMobileFilters}
                ></button>
                <div
                    class="glean-mobile-filter-sheet"
                    bind:this={mobileFilterSheet}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="glean-mobile-filter-title"
                >
                    <header class="glean-mobile-filter-sheet__head">
                        <div>
                            <h2 id="glean-mobile-filter-title">{t(i18n, "library.filters")}</h2>
                            <span>{t(i18n, "library.resultCount", { n: rows.length })}</span>
                        </div>
                        <button type="button" class="glean-mobile-filter-sheet__close" aria-label={t(i18n, "library.filterClose")} onclick={closeMobileFilters}>×</button>
                    </header>
                    <div class="glean-mobile-filter-sheet__body">
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterAuthor")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.author}>
                                <option value="">{t(i18n, "library.filterAuthor")}</option>
                                {#each facets.authors as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
                                {#if mobileFilterDraft.author && !facets.authors.some((facet) => facet.value === mobileFilterDraft.author)}<option value={mobileFilterDraft.author}>{mobileFilterDraft.author}</option>{/if}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterSite")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.site}>
                                <option value="">{t(i18n, "library.filterSite")}</option>
                                {#each facets.sites as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterTag")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.tag}>
                                <option value="">{t(i18n, "library.filterTag")}</option>
                                {#each facets.tags as facet (facet.value)}<option value={facet.value}>#{facet.value} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterAiTag")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.aiTag}>
                                <option value="">{t(i18n, "library.filterAiTag")}</option>
                                {#each facets.aiTags as facet (facet.value)}<option value={facet.value}>✨{facet.value} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterSource")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.source}>
                                <option value="">{t(i18n, "library.filterSource")}</option>
                                {#each facets.sources as facet (facet.value)}<option value={facet.value}>{sourceLabel(facet.value)} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterTimeSource")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.timeSource}>
                                <option value="">{t(i18n, "library.filterTimeSource")}</option>
                                {#each facets.timeSources as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "timeSource")} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <label class="glean-mobile-filter-field">
                            <span>{t(i18n, "library.filterContentType")}</span>
                            <select class="b3-select" bind:value={mobileFilterDraft.contentType}>
                                <option value="">{t(i18n, "library.filterContentType")}</option>
                                {#each facets.contentTypes as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "contentType")} · {facet.count}</option>{/each}
                            </select>
                        </label>
                        <div class="glean-mobile-filter-sort">
                            <label class="glean-mobile-filter-field">
                                <span>{t(i18n, "library.sort")}</span>
                                <select class="b3-select" bind:value={mobileFilterDraft.sortBy}>
                                    <option value="time">{t(i18n, "action.sortTime")}</option>
                                    <option value="updated">{t(i18n, "library.sortUpdated")}</option>
                                    <option value="words">{t(i18n, "action.sortWords")}</option>
                                    <option value="priority">{t(i18n, "action.sortPriority")}</option>
                                    <option value="rating">{t(i18n, "library.sortRating")}</option>
                                    <option value="title">{t(i18n, "library.sortTitle")}</option>
                                </select>
                            </label>
                            <button
                                type="button"
                                class="glean-mobile-filter-direction"
                                aria-label={t(i18n, "library.toggleDirection")}
                                onclick={() => (mobileFilterDraft.direction = mobileFilterDraft.direction === "desc" ? "asc" : "desc")}
                            >
                                {mobileFilterDraft.direction === "desc" ? "↓" : "↑"}
                            </button>
                        </div>
                    </div>
                    <footer class="glean-mobile-filter-sheet__foot">
                        <button type="button" class="glean-btn glean-btn--ghost" onclick={clearMobileFilterDraft}>{t(i18n, "library.filterClear")}</button>
                        <button type="button" class="glean-btn glean-btn--pri" onclick={applyMobileFilters}>{t(i18n, "library.filterApply")}</button>
                    </footer>
                </div>
            </div>
        {/if}

        {#if authorTimeline && selectedAuthor}<p class="glean-author-timeline" role="status">{t(i18n, "author.timeline", { author: selectedAuthor })}</p>{/if}
        {#if governanceCueCount > 1 && !governanceExpanded}
            <div class="glean-governance-summary" role="status">
                <span aria-hidden="true">💡</span>
                <span style="flex:1">{t(i18n, "panel.governanceSummary", { n: governanceCueCount })}</span>
                <button type="button" class="glean-cap-btn" aria-expanded={governanceExpanded} onclick={() => (governanceExpanded = true)}>
                    {t(i18n, "panel.governanceExpand")}
                </button>
            </div>
        {/if}
        {#if governanceDetailsVisible}
            {#if governanceCueCount > 1}
                <div class="glean-governance-collapse">
                    <button type="button" class="glean-linkish" aria-expanded={governanceExpanded} onclick={() => (governanceExpanded = false)}>
                        {t(i18n, "panel.governanceCollapse")}
                    </button>
                </div>
            {/if}
            {#if overQuota && activeQueue === "inbox" && !authorTimeline && !governanceCueMuted("quota", governanceMuted)}
                <div class="glean-quota">
                    <span>⚖️</span>
                    <span style="flex:1">{t(i18n, "panel.quotaOver", { total: inboxTotal, quota: facade.settings.inboxQuota })}</span>
                    <button class="glean-linkish" onclick={() => void muteGovernanceCue("quota")}>{t(i18n, "panel.governanceMuteToday")}</button>
                </div>
            {/if}
            {#if stalePool.length > 0 && (activeQueue === "inbox" || activeQueue === "later") && !governanceCueMuted("stale", governanceMuted)}
            <div class="glean-quota">
                <svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanArchive" /></svg>
                <span style="flex:1">{t(i18n, "panel.staleCandidates", { n: stalePool.length })}</span>
                <button class="glean-cap-btn" onclick={() => toggleStalePreview()}>
                    {stalePreviewOpen ? t(i18n, "panel.staleHide") : t(i18n, "panel.archiveStale")}
                </button>
                <button class="glean-linkish" onclick={() => void muteGovernanceCue("stale")}>{t(i18n, "panel.governanceMuteToday")}</button>
            </div>
            {#if stalePreviewOpen}
                <div class="glean-stale-preview">
                    <div class="glean-stale-preview__hint">{t(i18n, "panel.staleHint", { n: facade.settings.staleDays })}</div>
                    {#each stalePool as entry (entry.id)}
                        <label class="glean-stale-preview__row">
                            <input
                                type="checkbox"
                                checked={staleSelected.has(entry.id)}
                                onchange={() => toggleStalePick(entry.id)}
                            />
                            <span class="glean-stale-preview__title" title={entry.title}>{entry.title || t(i18n, "panel.untitled")}</span>
                            <span class="glean-stale-preview__meta">{entry.site || t(i18n, "panel.unknownSite")} · {t(i18n, "panel.staleDays", { n: ageDays(entry.time) })}</span>
                        </label>
                    {/each}
                    <div class="glean-stale-preview__ops">
                        <button class="glean-cap-btn" onclick={() => { staleSelected = new Set(stalePool.map((entry) => entry.id)); }}>
                            {t(i18n, "panel.staleSelectAll")}
                        </button>
                        <button
                            class="glean-cap-btn glean-cap-btn--pri"
                            disabled={archivingStale || staleSelected.size === 0}
                            onclick={() => void doArchiveStale()}
                        >{t(i18n, "panel.staleConfirm", { n: staleSelected.size })}</button>
                    </div>
                </div>
            {/if}
            {/if}
            {#if candidateCount > 0 && !governanceCueMuted("candidates", governanceMuted)}
            <div class="glean-candidates">
                <svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanInbox" /></svg>
                <span style="flex:1">{t(i18n, "panel.candidatesDetected", { n: candidateCount })}</span>
                <button class="glean-cap-btn" onclick={openCandidateQueue}>{t(i18n, "panel.viewCandidates")}</button>
                <button class="glean-linkish" onclick={() => void muteGovernanceCue("candidates")}>{t(i18n, "panel.governanceMuteToday")}</button>
            </div>
            {/if}
        {/if}

        {#if loading && !index.updatedAt}
            <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
        {:else if isTabCanvas && layoutMode === "kanban"}
            <div class="glean-kanban">
                {#each visibleKanbanCols as col (col.status)}
                    <div
                        class="glean-kcol"
                        class:glean-kcol--over={dragOverCol === col.status}
                        role="region"
                        aria-label={col.label}
                        ondragover={(e) => { e.preventDefault(); dragOverCol = col.status; }}
                        ondragleave={() => { if (dragOverCol === col.status) dragOverCol = null; }}
                        ondrop={(e) => {
                            e.preventDefault();
                            const source = draggedEntry();
                            if (source) void moveTo(source, col.status);
                        }}
                    >
                        <div class="glean-kcol__head">
                            <span class={statusDotClass(col.status)}></span>
                            {col.label}
                            <span class="glean-kcol__n">{col.items.length}</span>
                        </div>
                        {#each col.items as entry (entry.id)}
                            <div
                                class="glean-kcard"
                                data-glean-clip-id={entry.id}
                                draggable="true"
                                ondragstart={(e) => { dragId = entry.id; e.dataTransfer?.setData("text/plain", entry.id); }}
                                ondragend={() => { dragId = ""; dragOverCol = null; }}
                                onclick={() => openDoc(entry.id)}
                                onkeydown={(event) => {
                                    if (event.target === event.currentTarget && isActivationKey(event.key)) {
                                        event.preventDefault();
                                        openDoc(entry.id);
                                    }
                                }}
                                role="button"
                                tabindex="0"
                            >
                                <div class="glean-kcard__t">{entry.title || t(i18n, "panel.untitled")}</div>
                                <div class="glean-kcard__m">
                                    <span class={carrierClass(entry)}>{carrierLabel(entry)}</span>
                                    {#if bodyPending(entry)}
                                        <span class="glean-body-pending" title={t(i18n, "clip.bodyPendingHint")}>{t(i18n, "clip.bodyPending")}</span>
                                    {/if}
                                    {#if entry.site}<span class="glean-meta-icon"><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanNews" /></svg>{entry.site}</span>{/if}
                                    {#if entry.author}<button class="glean-source-author" onclick={(event) => { event.stopPropagation(); selectAuthor(entry.author!); }}>· {entry.author}</button>{/if}
                                    {#if entry.minutes > 0}<span>· {t(i18n, "panel.minutes", { n: entry.minutes })}</span>{/if}
                                    {#if (entry.status === "inbox" || entry.status === "later") && staleText(entry.time) !== null}
                                        <span class="glean-stale">{staleText(entry.time)}</span>
                                    {/if}
                                    {#if hasSourceAction(entry.contentType, entry.url)}
                                        <button class="glean-op-btn" title={t(i18n, "clip.openSource")} aria-label={t(i18n, "clip.openSource")} onclick={(e) => { e.stopPropagation(); openSource(entry); }}>↗</button>
                                    {:else if entry.contentType === "link"}
                                        <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                                    {/if}
                                </div>
                                <ClipStatusActions
                                    {i18n}
                                    status={entry.status || "inbox"}
                                    disabled={statusActionId === entry.id}
                                    onStartReading={() => void startReading(entry)}
                                    onSetStatus={(status) => void setStatus(entry, status)}
                                />
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>
            {#if hasMoreKanban}
                <div class="glean-list-more" role="status">
                    <span>{t(i18n, "library.renderedCount", { shown: renderedKanbanCount, total: totalKanbanCount })}</span>
                    <button class="glean-btn glean-btn--ghost" onclick={loadMoreRows}>{t(i18n, "library.loadMore")}</button>
                </div>
            {/if}
        {:else if isTabCanvas && layoutMode === "list"}
            <div class="glean-lib" class:glean-lib--preview={Boolean(previewEntry)} bind:this={previewSplit}>
                <aside class="glean-rail">
                    <LibraryRailGroup plugin={facade.pluginInstance} {i18n} group="queues" label={t(i18n, "rail.queues")} items={queues.map((queue) => ({ value: queue, count: queueCount(queue) }))} selected={authorTimeline ? "" : activeQueue} itemLabel={(value) => queueLabel(value as ClipStatus)} dotClass={(value) => statusDotClass(value as ClipStatus)} onSelect={(value) => selectQueue(value as ClipStatus)} />
                    {#if railStats.authors.length > 0 || selectedAuthor}
                        <LibraryRailGroup plugin={facade.pluginInstance} {i18n} group="authors" label={t(i18n, "rail.authors")} items={railStats.authors} selected={selectedAuthor} onSelect={selectAuthor} />
                    {/if}
                    {#if railStats.sites.length > 0 || selectedSite}
                        <LibraryRailGroup plugin={facade.pluginInstance} {i18n} group="sites" label={t(i18n, "rail.sites")} items={railStats.sites} selected={selectedSite} onSelect={(value) => selectedSite = selectedSite.toLocaleLowerCase() === value.toLocaleLowerCase() ? "" : value} />
                    {/if}
                    {#if railStats.tags.length > 0 || selectedTag}
                        <LibraryRailGroup plugin={facade.pluginInstance} {i18n} group="tags" label={t(i18n, "rail.tags")} prefix="#" items={railStats.tags} selected={selectedTag} onSelect={(value) => selectedTag = selectedTag.toLocaleLowerCase() === value.toLocaleLowerCase() ? "" : value} />
                    {/if}
                    {#if railStats.aiTags.length > 0 || selectedAiTag}
                        <LibraryRailGroup plugin={facade.pluginInstance} {i18n} group="aiTags" label={`✨ ${t(i18n, "rail.aiTags")}`} hint={t(i18n, "library.filterAiTagHint")} prefix="✨" items={railStats.aiTags} selected={selectedAiTag} onSelect={(value) => selectedAiTag = selectedAiTag.toLocaleLowerCase() === value.toLocaleLowerCase() ? "" : value} />
                    {/if}
                </aside>
                <div class="glean-lib__main">
                    {#if rows.length === 0}
                        <div class="glean-empty">
                            <div class="glean-empty__art"><svg><use href="#iconGleanWheat" /></svg></div>
                            <div class="glean-empty__title">{t(i18n, "panel.empty")}</div>
                            <div class="glean-empty__hint">
                                {facade.settings.anchorNotebooks.length === 0
                                    ? t(i18n, "panel.noAnchorHint")
                                    : t(i18n, "panel.emptyHint")}
                            </div>
                            {#if facade.settings.anchorNotebooks.length === 0}
                                <button class="glean-btn" style="margin-top:10px" onclick={() => facade.openSettings()}>
                                    {t(i18n, "panel.setupAnchor")}
                                </button>
                            {/if}
                        </div>
                    {:else}
                        <div class="glean-dtable">
                            {#each visibleRows as entry (entry.id)}
                                {#if entry.kind === "clip"}
                                    <div
                                        class="glean-drow"
                                        data-glean-clip-id={entry.id}
                                        class:glean-drow--selected={selection.has(entry.id)}
                                        class:glean-drow--preview={previewId === entry.id}
                                        onclick={() => selectPreview(entry.id)}
                                        onkeydown={(event) => {
                                            if (event.target === event.currentTarget && isActivationKey(event.key)) {
                                                event.preventDefault();
                                                selectPreview(entry.id);
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                    >
                                        <span class={statusDotClass(entry.status)}></span>
                                        <span class="glean-drow__ti">{entry.title || t(i18n, "panel.untitled")}</span>
                                        <span class="glean-drow__site">{entry.site || t(i18n, "panel.unknownSite")}{#if entry.author}<button class="glean-source-author" onclick={(event) => { event.stopPropagation(); selectAuthor(entry.author!); }}>· {entry.author}</button>{/if}</span>
                                         <span class={carrierClass(entry)} title={entry.contentType === "link" && !hasSourceAction(entry.contentType, entry.url) ? t(i18n, "clip.sourceMissing") : carrierLabel(entry)}>{carrierLabel(entry)}</span>
                                        {#if entry.contentType === "link" && !hasSourceAction(entry.contentType, entry.url)}
                                            <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                                        {/if}
                                        {#if bodyPending(entry)}
                                            <span class="glean-body-pending" title={t(i18n, "clip.bodyPendingHint")}>{t(i18n, "clip.bodyPending")}</span>
                                        {/if}
                                        <span class="glean-drow__len" title={timeSource(entry)}>{lengthLabel(entry)}</span>
                                        <span class="glean-drow__st">
                                            <span class="glean-st-badge glean-st-badge--{entry.status}">{queueLabel(entry.status)}</span>
                                        </span>
                                        <div class="glean-drow__ops">
                                            {#if entry.status === "archived"}
                                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId)} onclick={(event) => { event.stopPropagation(); void setStatus(entry, "later"); }}>{t(i18n, "action.restore")}</button>
                                            {:else}
                                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId)} onclick={(event) => { event.stopPropagation(); void startReading(entry); }}>{t(i18n, entry.status === "reading" ? "action.continueReading" : entry.status === "done" ? "action.readAgain" : "action.startReading")}</button>
                                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId) || entry.status === "done"} onclick={(event) => { event.stopPropagation(); void setStatus(entry, "done"); }}>{t(i18n, "action.markDone")}</button>
                                            {/if}
                                            <ActionPopover label={t(i18n, "library.moreActions")} compact>
                                                <AuthorEditor {facade} docId={entry.id} onSaved={reload} />
                                                {#if entry.status !== "archived"}
                                                    <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId) || entry.status === "later"} onclick={() => void setStatus(entry, "later")}>{t(i18n, "action.moveToLater")}</button>
                                                    <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId)} onclick={() => void setStatus(entry, "archived")}>{t(i18n, "action.archive")}</button>
                                                {/if}
                                                <button class="glean-btn glean-btn--ghost" disabled={snappingId === entry.id} onclick={() => void takeSnapshot(entry)}>{snapshotLabel(entry)}</button>
                                                <button class="glean-btn glean-btn--ghost" disabled={enrichingId === entry.id} onclick={() => void enrich(entry)}>{t(i18n, "ai.actionEnrich")}</button>
                                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(statusActionId)} aria-pressed={isPinnedToday(entry)} onclick={() => void toggleSurfacePin(entry)}>{surfacePinLabel(entry)}</button>
                                                {#if hasSourceAction(entry.contentType, entry.url)}
                                                    <button class="glean-btn glean-btn--ghost" onclick={() => openSource(entry)}>{t(i18n, "clip.openSource")}</button>
                                                {/if}
                                                <label class="glean-row-select">
                                                    <input type="checkbox" checked={selection.has(entry.id)} onchange={(event) => toggleSelect(entry.id, event)} />
                                                    {t(i18n, "library.selectArticle")}
                                                </label>
                                            </ActionPopover>
                                        </div>
                                    </div>
                                {:else}
                                    <div
                                        class="glean-drow"
                                        data-glean-clip-id={entry.id}
                                        class:glean-drow--preview={previewId === entry.id}
                                        onclick={() => selectPreview(entry.id)}
                                        onkeydown={(event) => {
                                            if (event.target === event.currentTarget && isActivationKey(event.key)) {
                                                event.preventDefault();
                                                selectPreview(entry.id);
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                    >
                                        <span class="glean-dot glean-dot--inbox"></span>
                                        <span class="glean-drow__ti">{entry.title || t(i18n, "panel.untitled")}</span>
                                        <span class="glean-drow__site" title={entry.url || entry.hpath}>{entry.site || candidateEvidence(entry)}</span>
                                        <span class="glean-drow__len">{candidateMissing(entry) || t(i18n, "candidate.pending")}</span>
                                        <span class="glean-drow__st">
                                            {#if entry.url}<button class="glean-card__capture" onclick={(e) => { e.stopPropagation(); void capture(entry); }}>{t(i18n, "action.addToInbox")}</button>{/if}
                                        </span>
                                        <div class="glean-drow__ops">
                                            <button class="glean-op-btn" title={t(i18n, "candidate.fixUrl")} aria-label={t(i18n, "candidate.fixUrl")} onclick={(e) => { e.stopPropagation(); startCandidateUrlEdit(entry); }}>✎</button>
                                            {#if !entry.url}<button class="glean-op-btn" title={t(i18n, "candidate.captureLocal")} aria-label={t(i18n, "candidate.captureLocal")} onclick={(e) => { e.stopPropagation(); void captureAsLocal(entry); }}>▤</button>{/if}
                                            <button class="glean-op-btn" title={t(i18n, "candidate.exclude")} aria-label={t(i18n, "candidate.exclude")} onclick={(e) => { e.stopPropagation(); void excludeCandidate(entry); }}>×</button>
                                        </div>
                                    </div>
                                    {#if editingCandidateId === entry.id}
                                        <div class="glean-candidate-edit">
                                            <input class="b3-text-field" type="url" bind:value={candidateUrlInput} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} />
                                            <button class="glean-btn" onclick={() => void saveCandidateUrl(entry)}>{t(i18n, "action.save")}</button>
                                            <button class="glean-btn glean-btn--ghost" onclick={() => (editingCandidateId = "")}>{t(i18n, "action.cancel")}</button>
                                        </div>
                                    {/if}
                                {/if}
                            {/each}
                        </div>
                        {#if hasMoreRows}
                            <div class="glean-list-more" role="status">
                                <span>{t(i18n, "library.renderedCount", { shown: visibleRows.length, total: rows.length })}</span>
                                <button class="glean-btn glean-btn--ghost" onclick={loadMoreRows}>{t(i18n, "library.loadMore")}</button>
                            </div>
                        {/if}
                    {/if}
                </div>
                {#if previewEntry && !facade.isMobile}
                    <input type="range" class="glean-preview-separator" min="25" max="65" step="1" value={Math.round(previewRatio * 100)} aria-label={t(i18n, "preview.resize")} oninput={(event) => { previewRatio = normalizePreviewRatio(Number(event.currentTarget.value) / 100); void savePreviewPrefs({ workbenchPreviewRatio: previewRatio }); }} onpointerdown={startPreviewResize} onpointermove={resizePreview} onpointerup={(event) => finishPreviewResize(event)} onpointercancel={(event) => finishPreviewResize(event, true)} onlostpointercapture={(event) => finishPreviewResize(event)} onkeydown={previewResizeKey} />
                    <div class="glean-preview-pane" style:--glean-preview-ratio={previewRatio}>
                        {#key previewId}
                            <WorkbenchPreview {facade} entry={previewEntry} onClose={closePreview} onProcessed={processedCallback(previewId, previewRevision)} onRefresh={reload} />
                        {/key}
                    </div>
                {/if}
            </div>
        {:else}
            <div class="glean-list">
                {#if rows.length === 0 && !(candidateCount > 0 && activeQueue === "inbox" && !authorTimeline)}
                    <div class="glean-empty">
                        <div class="glean-empty__art"><svg><use href="#iconGleanWheat" /></svg></div>
                        <div class="glean-empty__title">{t(i18n, "panel.empty")}</div>
                        <div class="glean-empty__hint">
                            {facade.settings.anchorNotebooks.length === 0
                                ? t(i18n, "panel.noAnchorHint")
                                : t(i18n, "panel.emptyHint")}
                        </div>
                        {#if facade.settings.anchorNotebooks.length === 0}
                            <button class="glean-btn" style="margin-top:10px" onclick={() => facade.openSettings()}>
                                {t(i18n, "panel.setupAnchor")}
                            </button>
                        {/if}
                    </div>
                {:else}
                    {#each visibleRows as entry (entry.id)}
                        <article
                            class="glean-card"
                            data-glean-clip-id={entry.kind === "clip" ? entry.id : undefined}
                            class:glean-card--candidate={entry.kind === "candidate"}
                            class:glean-card--selected={selection.has(entry.id)}
                        >
                            <div
                                class="glean-card__body"
                                onclick={() => selectPreview(entry.id)}
                                onkeydown={(event) => {
                                    if (event.target === event.currentTarget && isActivationKey(event.key)) {
                                        event.preventDefault();
                                        selectPreview(entry.id);
                                    }
                                }}
                                role="button"
                                tabindex="0"
                            >
                                <div class="glean-card__title">{entry.title || t(i18n, "panel.untitled")}</div>
                                <div class="glean-card__meta">
                                    {#if entry.kind === "clip"}
                                        <span class={statusDotClass(entry.status)}></span>
                                    {/if}
                                    {#if entry.kind === "clip" && entry.site}
                                        <span class="glean-card__site">{entry.site}</span>
                                    {:else if entry.kind === "candidate"}
                                        <span title={entry.url || entry.hpath}>{entry.site || candidateEvidence(entry)}</span>
                                    {/if}
                                    {#if entry.kind === "clip" && entry.author}<button class="glean-source-author" onclick={(event) => { event.stopPropagation(); selectAuthor(entry.author!); }}>· {entry.author}</button>{/if}
                                     {#if entry.kind === "clip"}
                                         <span class={carrierClass(entry)}>{carrierLabel(entry)}</span>
                                         {#if entry.contentType === "link" && !hasSourceAction(entry.contentType, entry.url)}
                                             <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                                         {/if}
                                         {#if bodyPending(entry)}
                                             <span class="glean-body-pending" title={t(i18n, "clip.bodyPendingHint")}>{t(i18n, "clip.bodyPending")}</span>
                                         {/if}
                                     {/if}
                                    {#if metaLine(entry)}
                                        <span>· {metaLine(entry)}</span>
                                    {/if}
                                    {#if entry.kind === "clip"}
                                        {@const days = staleDays(entry.time)}
                                        {#if days !== null && (entry.status === "inbox" || entry.status === "later")}
                                            <span class="glean-stale">{t(i18n, "panel.staleDays", { n: days })}</span>
                                        {/if}
                                    {/if}
                                </div>
                            </div>
                            {#if entry.kind === "candidate"}
                                <div class="glean-card__ops">
                                    {#if entry.url}<button class="glean-card__capture" onclick={() => void capture(entry)}>{t(i18n, "action.addToInbox")}</button>{/if}
                                    <button class="glean-op-btn" title={t(i18n, "candidate.fixUrl")} aria-label={t(i18n, "candidate.fixUrl")} onclick={() => startCandidateUrlEdit(entry)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                    {#if !entry.url}<button class="glean-op-btn" title={t(i18n, "candidate.captureLocal")} aria-label={t(i18n, "candidate.captureLocal")} onclick={() => void captureAsLocal(entry)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>{/if}
                                    <button class="glean-op-btn" title={t(i18n, "candidate.exclude")} aria-label={t(i18n, "candidate.exclude")} onclick={() => void excludeCandidate(entry)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                </div>
                                <div class="glean-candidate-detail">
                                    <span>{t(i18n, "candidate.evidenceLabel")}: {candidateEvidence(entry)}</span>
                                    {#if candidateMissing(entry)}<span>{candidateMissing(entry)}</span>{/if}
                                    {#if entry.url}<span title={entry.url}>{entry.url}</span>{/if}
                                </div>
                                {#if editingCandidateId === entry.id}
                                    <div class="glean-candidate-edit">
                                        <input class="b3-text-field" type="url" bind:value={candidateUrlInput} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} />
                                        <button class="glean-btn" onclick={() => void saveCandidateUrl(entry)}>{t(i18n, "action.save")}</button>
                                        <button class="glean-btn glean-btn--ghost" onclick={() => (editingCandidateId = "")}>{t(i18n, "action.cancel")}</button>
                                    </div>
                                {/if}
                            {:else}
                                <div class="glean-card__ops">
                                    <ActionPopover label={t(i18n, "author.edit")} compact><AuthorEditor {facade} docId={entry.id} onSaved={reload} /></ActionPopover>
                                    <button
                                        class="glean-op-btn"
                                        title={snapshotLabel(entry)}
                                        aria-label={snapshotLabel(entry)}
                                        disabled={snappingId === entry.id}
                                        onclick={(e) => { e.stopPropagation(); void takeSnapshot(entry); }}
                                    ><svg class="glean-icon" aria-hidden="true"><use href={entry.snapshot ? "#iconGleanArchive" : "#iconGleanCamera"} /></svg></button>
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "ai.actionEnrich")}
                                        aria-label={t(i18n, "ai.actionEnrich")}
                                        disabled={enrichingId === entry.id}
                                        onclick={(e) => { e.stopPropagation(); void enrich(entry); }}
                                    ><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanSpark" /></svg></button>
                                    <button
                                        class="glean-op-btn"
                                        title={surfacePinLabel(entry)}
                                        aria-label={surfacePinLabel(entry)}
                                        aria-pressed={isPinnedToday(entry)}
                                        disabled={statusActionId === entry.id}
                                        onclick={(e) => { e.stopPropagation(); void toggleSurfacePin(entry); }}
                                    ><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPin" /></svg></button>
                                     {#if hasSourceAction(entry.contentType, entry.url)}
                                         <button
                                             class="glean-op-btn"
                                             title={t(i18n, "clip.openSource")}
                                             aria-label={t(i18n, "clip.openSource")}
                                             onclick={(e) => { e.stopPropagation(); openSource(entry); }}
                                         >↗</button>
                                     {:else if entry.contentType === "link"}
                                         <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                                     {/if}
                                </div>
                                <ClipRankControls
                                    {i18n}
                                    priority={entry.priority}
                                    rating={entry.rating}
                                    disabled={statusActionId === entry.id}
                                    onPriority={(value) => void setPriority(entry, value)}
                                    onRating={(value) => void setRating(entry, value)}
                                />
                                <ClipStatusActions
                                    {i18n}
                                    status={entry.status || "inbox"}
                                    disabled={statusActionId === entry.id}
                                    onStartReading={() => void startReading(entry)}
                                    onSetStatus={(status) => void setStatus(entry, status)}
                                />
                            {/if}
                            {#if entry.kind === "clip"}
                                <label class="glean-card__check">
                                    <input
                                        type="checkbox"
                                        checked={selection.has(entry.id)}
                                        onclick={(event) => event.stopPropagation()}
                                        onchange={(e) => toggleSelect(entry.id, e)}
                                    />
                                </label>
                            {/if}
                        </article>
                    {/each}
                {/if}
            </div>

            {#if hasMoreRows}
                <div class="glean-list-more" role="status">
                    <span>{t(i18n, "library.renderedCount", { shown: visibleRows.length, total: rows.length })}</span>
                    <button class="glean-btn glean-btn--ghost" onclick={loadMoreRows}>{t(i18n, "library.loadMore")}</button>
                </div>
            {/if}

            {#if selection.size > 0}
                <footer class="glean-batchbar">
                    <b>{t(i18n, "action.selected")} {selection.size}</b>
                    <div class="glean-batchbar__ops">
                        <button class="glean-bb" disabled={batchBusy} onclick={() => void batchApply("reading")}>{t(i18n, "status.reading")}</button>
                        <button class="glean-bb" disabled={batchBusy} onclick={() => void batchApply("done")}>{t(i18n, "status.done")}</button>
                        <button class="glean-bb glean-bb--pri" disabled={batchBusy} onclick={() => void batchApply("archived")}>{t(i18n, "action.batchArchive")}</button>
                        <button class="glean-bb" disabled={batchBusy} onclick={() => { aiBatchIds = [...selection]; aiBatchOpen = true; }}>{t(i18n, "aiBatch.title")}</button>
                        <button class="glean-bb" aria-label={t(i18n, "action.cancel")} onclick={() => (selection = new Set())}>✕</button>
                    </div>
                </footer>
            {/if}
        {/if}
    {:else if view === "resurface"}
        <ResurfaceView {facade} {index} onMutated={() => void reload()} />
    {:else if view === "stats"}
        <StatsView {facade} {index} onCaptured={() => void reload()} />
    {:else}
        <HighlightView {facade} />
    {/if}

    {#if facade.isMobile && previewEntry && view === "library"}
        <div class="glean-preview-sheet" bind:this={previewDialog} role="dialog" aria-modal="true" aria-label={t(i18n, "preview.title")} tabindex="-1">
            {#key previewId}
                <WorkbenchPreview {facade} entry={previewEntry} onClose={closePreview} onProcessed={processedCallback(previewId, previewRevision)} onRefresh={reload} />
            {/key}
        </div>
    {/if}
    {#if facade.isMobile}
        <nav class="glean-mobile-nav" aria-label={t(i18n, "mobile.navLabel")}>
            {#each mobileNavItems as item (item.key)}
                <button
                    type="button"
                    class="glean-mobile-nav__item"
                    class:glean-mobile-nav__item--on={mobileActive === item.key}
                    aria-current={mobileActive === item.key ? "page" : undefined}
                    aria-label={t(i18n, item.labelKey)}
                    onclick={() => selectMobileNav(item.key)}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        {#if item.key === "home"}
                            <path d="M3 10.7 12 3l9 7.7v8.1a1.2 1.2 0 0 1-1.2 1.2h-5.1v-6.2H9.3V20H4.2A1.2 1.2 0 0 1 3 18.8v-8.1Z" />
                        {:else if item.key === "library"}
                            <path d="M5 4.2A2.2 2.2 0 0 1 7.2 2h10.6A2.2 2.2 0 0 1 20 4.2v15.6a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 19.8V4.2Zm2.4 0v15.6c0 .3.2.5.5.5h10.4V3.7H7.9c-.3 0-.5.2-.5.5Zm2.3 2.1h6.8v1.6H9.7V6.3Zm0 3.4h6.8v1.6H9.7V9.7Z" />
                        {:else if item.key === "highlights"}
                            <path d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v8A2.5 2.5 0 0 1 19 16.5h-7.1L7.2 20v-3.5H5A2.5 2.5 0 0 1 2.5 14V6A2.5 2.5 0 0 1 5 3.5Zm1.6 4.1v2.2h2.2V7.6H6.6Zm4.3 0v2.2h2.2V7.6h-2.2Zm4.3 0v2.2h2.2V7.6h-2.2Z" />
                        {:else}
                            <path d="M12 2.8a2 2 0 0 1 2 2v.5a7.6 7.6 0 0 1 2.2.9l.4-.4a2 2 0 1 1 2.8 2.8l-.4.4c.4.7.7 1.4.9 2.2h.5a2 2 0 1 1 0 4h-.5a7.6 7.6 0 0 1-.9 2.2l.4.4a2 2 0 1 1-2.8 2.8l-.4-.4a7.6 7.6 0 0 1-2.2.9v.5a2 2 0 1 1-4 0v-.5a7.6 7.6 0 0 1-2.2-.9l-.4.4a2 2 0 1 1-2.8-2.8l.4-.4a7.6 7.6 0 0 1-.9-2.2h-.5a2 2 0 1 1 0-4h.5c.2-.8.5-1.5.9-2.2l-.4-.4a2 2 0 1 1 2.8-2.8l.4.4A7.6 7.6 0 0 1 10 5.3v-.5a2 2 0 0 1 2-2Zm0 6.1a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z" />
                    {/if}
                    </svg>
                    <span>{t(i18n, item.labelKey)}</span>
                </button>
            {/each}
        </nav>
    {/if}
</div>

<style>
    /* 样式集中在 src/index.scss（设计系统），组件内不再重复 */
</style>

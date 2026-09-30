<script lang="ts">
/** 读库 Dock 面板 v2（T-1104/T-1201/T-1202/T-1300/T-1400c）：库 / 统计 / 高亮 三视图；tab 画布 rail+行表/看板。 */
import { tick } from "svelte";
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { ClipStatus } from "../domain/schema";
import { normalizeUrl } from "../domain/url";
import { batchSetStatus, batchSetStatusDetailed, captureDocument, findClipUrlConflict, reconcileIndex, writeClip } from "../services/clip-store";
import { autoEnrich, enrichClip } from "../services/enrich-service";
import { snapshotClip } from "../services/snapshot-service";
import { filterAndSortLibrary, libraryFacets, type LibraryItem, type LibrarySortDirection, type LibrarySortKey } from "../domain/library-view.ts";
import { loadIndex, type ClipIndexEntry, type CandidateEntry, type GleanIndex } from "../services/index-store";
import StatsView from "./StatsView.svelte";
import HighlightView from "./HighlightView.svelte";
import QuotesView from "./QuotesView.svelte";
import InboxSection from "./InboxSection.svelte";
import ResurfaceView from "./ResurfaceView.svelte";
import { archiveStaleCandidates } from "../services/resurface-service";
import { loadUiPrefs, saveUiPrefs } from "../services/prefs";
import { ageDays } from "../domain/resurface.ts";
import { recordReadingDone } from "../services/checkin-bridge";
import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
import ClipStatusActions from "./ClipStatusActions.svelte";
import ClipRankControls from "./ClipRankControls.svelte";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

type PanelView = "resurface" | "library" | "stats" | "highlights" | "quotes";
let view = $state<PanelView>("resurface");
let loading = $state(true);
let loadError = $state(false);
let index = $state<GleanIndex>({ version: 1, updatedAt: "", clips: {}, candidates: {} });
let activeQueue = $state<ClipStatus>("inbox");
let keyword = $state("");
let sortBy = $state<LibrarySortKey>("time");
let sortDirection = $state<LibrarySortDirection>("desc");
let selectedSite = $state("");
let selectedTag = $state("");
/** AI 标签分面（T-1729）：独立于用户 tag，UI 带 ✨ 来源标记。 */
let selectedAiTag = $state("");
/** Dock 窄画布搜索默认折叠为图标（UX 审计 #8）；工作台/浮窗保持常驻。 */
let searchOpen = $state(false);
let selectedSource = $state("");
let selectedTimeSource = $state("");
let selectedContentType = $state("");
let selection = $state<ReadonlySet<string>>(new Set());
let rootEl = $state<HTMLElement | null>(null);
let layoutMode = $state<"list" | "kanban">("list");
let isTabCanvas = $state(false);
let dragOverCol = $state<ClipStatus | null>(null);
let dragId = $state("");
let enrichingId = $state("");
let statusActionId = $state("");
let pendingFocusId = $state("");
let focusRequested = false;

/** 工作台弹出为独立浮窗；单实例由壳层守卫（T-1956：真实关闭回执，非定时器猜测）。 */
function openPopup() {
    facade.openWorkbenchPopup();
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
    { key: "quotes", labelKey: "view.quotes" },
];

type Row =
    | ({ kind: "candidate" } & CandidateEntry)
    | ({ kind: "clip" } & ClipIndexEntry);

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
    status: activeQueue,
    site: selectedSite,
    tag: selectedTag,
    aiTag: selectedAiTag,
    src: selectedSource,
    timeSource: selectedTimeSource,
    contentType: selectedContentType,
    keyword,
    sortBy,
    direction: sortDirection,
    includeCandidates: activeQueue === "inbox",
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

const candidateCount = $derived(Object.keys(index.candidates).length);
const totalClips = $derived(Object.keys(index.clips).length);

// 待确认候选单独展示，不占 inbox 配额；只有已收录条目进入五态计数。
const inboxTotal = $derived(Object.values(index.clips).filter((entry) => entry.status === "inbox").length);
const overQuota = $derived(inboxTotal > facade.settings.inboxQuota);
const stalePool = $derived.by(() => {
    const limit = facade.settings.staleDays;
    return Object.values(index.clips).filter((entry) =>
        (entry.status === "inbox" || entry.status === "later") && ageDays(entry.time) >= limit
    );
});

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
    if (key === "inbox") return Object.values(index.clips).filter((entry) => entry.status === "inbox").length;
    return Object.values(index.clips).filter((entry) => entry.status === key).length;
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
    activeQueue = queue;
    selectedSite = "";
    selectedTag = "";
    selectedAiTag = "";
    selectedSource = "";
    selectedTimeSource = "";
    selectedContentType = "";
    keyword = "";
}

function clearFilters(): void {
    selectedSite = "";
    selectedTag = "";
    selectedAiTag = "";
    selectedSource = "";
    selectedTimeSource = "";
    selectedContentType = "";
    keyword = "";
}

const hasFilters = $derived(Boolean(selectedSite || selectedTag || selectedAiTag || selectedSource || selectedTimeSource || selectedContentType || keyword.trim()));

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

/** T-1790：可点击卡片的键盘等价（Enter/Space 激活），与 role="button" 配对。 */
function activateOnKey(handler: () => void) {
    return (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handler();
        }
    };
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

let reloadSeq = 0;

async function reload() {
    // 请求代次守卫（T-1882）：快速连续刷新时丢弃晚到的旧结果，销毁后不再写状态
    const seq = ++reloadSeq;
    loading = true;
    try {
        const next = await reconcileIndex(facade.pluginInstance, facade.settings);
        if (seq !== reloadSeq) return;
        index = next;
        loadError = false;
    } catch (error) {
        console.warn("[glean] 读库对账失败:", error);
        if (seq !== reloadSeq) return;
        if (!index.updatedAt) index = await loadIndex(facade.pluginInstance);
        loadError = true;
    } finally {
        if (seq === reloadSeq) loading = false;
    }
}

$effect(() => {
    void reload();
});

$effect(() => {
    if (rootEl?.closest(".glean-tab-root")) {
        isTabCanvas = true;
        const pending = facade.consumeLibraryFocus();
        if (pending) void focusClipById(pending);
    }
});

// 视图偏好持久化：挂载恢复 + 切换保存
// T-1955：加载完成前不得保存——否则初始默认视图会把磁盘上的真实偏好覆盖掉
let prefsLoaded = $state(false);

$effect(() => {
    void loadUiPrefs(facade.pluginInstance).then((prefs) => {
        const valid = views.some((item) => item.key === prefs.lastView);
        // 返回读库定位优先于异步恢复的上次视图，避免把 library 切回旧视图。
        if (valid && !focusRequested) view = prefs.lastView as PanelView;
        prefsLoaded = true;
    });
});

$effect(() => {
    if (!prefsLoaded) return;
    void saveUiPrefs(facade.pluginInstance, { lastView: view });
});

// 插件壳广播的数据变更（迁移完成、右键收录等）触发面板对账
$effect(() => {
    const handler = () => void reload();
    document.addEventListener("glean:data-changed", handler);
    return () => document.removeEventListener("glean:data-changed", handler);
});

async function focusClipById(id: string): Promise<void> {
    focusRequested = true;
    pendingFocusId = id;
    view = "library";
    clearFilters();
    const known = index.clips[id];
    if (known) {
        activeQueue = known.status || "inbox";
        return;
    }
    await reload();
    if (pendingFocusId !== id) return;
    const refreshed = index.clips[id];
    if (!refreshed) return;
    activeQueue = refreshed.status || "inbox";
}

// 工作台可能仍在对账或等待 Svelte 渲染；保留定位请求直到目标行真正出现。
$effect(() => {
    const id = pendingFocusId;
    if (!id || !isTabCanvas || loading || view !== "library" || !rootEl || !rows.some((row) => row.id === id)) return;
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
        showMessage(t(i18n, "msg.captureFailed"), 3500);
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
        showMessage(t(i18n, "msg.captureFailed"), 3500);
    }
}

async function excludeCandidate(entry: CandidateEntry) {
    try {
        await writeClip(facade.pluginInstance, entry.id, { excluded: true });
        showMessage(t(i18n, "msg.candidateExcluded"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 忽略候选失败:", error);
        showMessage(t(i18n, "msg.captureFailed"), 3500);
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
        const conflict = await findClipUrlConflict(url, entry.id);
        if (conflict) {
            showMessage(`${t(i18n, "inbox.duplicate")}: ${conflict.title || conflict.hpath}`, 4000);
            return;
        }
        await writeClip(facade.pluginInstance, entry.id, { url }, { force: true });
        editingCandidateId = "";
        await reload();
    } catch (error) {
        console.warn("[glean] 修正来源失败:", error);
        showMessage(t(i18n, "msg.captureFailed"), 3500);
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
    if (statusActionId === entry.id) return false;
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
        showMessage(t(i18n, "msg.statusFailed"), 3000);
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
    if (selection.size === 0) return;
    const total = selection.size;
    let result: { ok: number; succeeded: string[] };
    try {
        result = await batchSetStatusDetailed(facade.pluginInstance, [...selection], status);
        await reload();
    } catch (error) {
        console.warn("[glean] 批量状态变更失败:", error);
        showMessage(t(i18n, "msg.statusFailed"), 3500);
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
    if (result.ok === total) selection = new Set();
}

function openDoc(docId: string) {
    facade.openReadingDocument(docId);
}

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

async function setPriority(entry: ClipIndexEntry, value: number) {
    if (statusActionId) return;
    statusActionId = entry.id;
    try {
        await writeClip(facade.pluginInstance, entry.id, { priority: value }, { force: true });
        showMessage(t(i18n, "msg.rankSaved"), 2500);
        await reload();
    } catch (error) {
        console.warn("[glean] 优先级写入失败:", error);
        showMessage(t(i18n, "msg.statusFailed"), 3000);
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
        showMessage(t(i18n, "msg.statusFailed"), 3000);
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

<div class="glean-panel" bind:this={rootEl}>
    <header class="glean-panel__head">
        <div class="glean-brand">
            <div class="glean-brand__mark"><svg><use href="#iconGleanWheat" /></svg></div>
            <div>
                <div class="glean-brand__name">{t(i18n, "pluginName")}</div>
                <div class="glean-brand__sub">{t(i18n, "panel.libraryCount", { n: totalClips })}</div>
            </div>
            <div class="glean-head-actions">
                <!-- T-1794（作者反馈）：宽画布（tab/浮窗）图标+文字提升可读性，Dock 窄栏保留图标+title -->
                <button
                    class="glean-icon-btn"
                    class:glean-icon-btn--labeled={isTabCanvas}
                    title={t(i18n, "panel.popup")}
                    onclick={() => openPopup()}
                >
                    <svg><use href="#iconGleanPopup" /></svg>{#if isTabCanvas}<span>{t(i18n, "panel.popup")}</span>{/if}
                </button>
                <button
                    class="glean-icon-btn"
                    class:glean-icon-btn--labeled={isTabCanvas}
                    title={t(i18n, "panel.migrate")}
                    onclick={() => facade.openMigrate()}
                >🧹{#if isTabCanvas}<span>{t(i18n, "panel.migrate")}</span>{/if}</button>
                <button
                    class="glean-icon-btn"
                    class:glean-icon-btn--labeled={isTabCanvas}
                    title={t(i18n, "panel.settings")}
                    onclick={() => facade.openSettings()}
                >
                    <svg><use href="#iconGleanGear" /></svg>{#if isTabCanvas}<span>{t(i18n, "panel.settings")}</span>{/if}
                </button>
            </div>
        </div>

        <div class="glean-views">
            {#each views as item (item.key)}
                <button
                    class="glean-views__btn"
                    class:glean-views__btn--on={view === item.key}
                    onclick={() => (view = item.key)}
                >{t(i18n, item.labelKey)}</button>
            {/each}
        </div>

        {#if view === "library"}
            {#if isTabCanvas || searchOpen}
                <div class="glean-search">
                    <svg class="glean-search__icon" viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2a1 1 0 0 1-1.4 1.4l-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
                    <input
                        type="text"
                        placeholder={t(i18n, "panel.searchPlaceholder")}
                        bind:value={keyword}
                    />
                </div>
            {:else}
                <button
                    class="glean-icon-btn"
                    title={t(i18n, "panel.searchPlaceholder")}
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
            <button class="glean-btn" onclick={() => void reload()}>{t(i18n, "action.retry")}</button>
        </div>
    {/if}

    {#if view === "library" && !loading}
        <InboxSection {facade} onMutated={() => void reload()} />
    {/if}

    {#if view === "library"}
        <nav class="glean-queues">
            {#each queues as queue (queue)}
                <button
                    class="glean-q"
                    class:glean-q--on={activeQueue === queue}
                    onclick={() => selectQueue(queue)}
                >
                    {queueLabel(queue)}
                    <span class="glean-q__n">{queueCount(queue)}</span>
                </button>
            {/each}
        </nav>

        {#if !isTabCanvas}
            <div class="glean-filters glean-filters--dock" aria-label={t(i18n, "library.filters")}>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterSite")} bind:value={selectedSite}>
                    <option value="">{t(i18n, "library.filterSite")}</option>
                    {#each facets.sites as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterTag")} bind:value={selectedTag}>
                    <option value="">{t(i18n, "library.filterTag")}</option>
                    {#each facets.tags as facet (facet.value)}<option value={facet.value}>#{facet.value} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterAiTag")} bind:value={selectedAiTag}>
                    <option value="">{t(i18n, "library.filterAiTag")}</option>
                    {#each facets.aiTags as facet (facet.value)}<option value={facet.value}>✨{facet.value} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterSource")} bind:value={selectedSource}>
                    <option value="">{t(i18n, "library.filterSource")}</option>
                    {#each facets.sources as facet (facet.value)}<option value={facet.value}>{sourceLabel(facet.value)} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterTimeSource")} bind:value={selectedTimeSource}>
                    <option value="">{t(i18n, "library.filterTimeSource")}</option>
                    {#each facets.timeSources as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "timeSource")} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterContentType")} bind:value={selectedContentType}>
                    <option value="">{t(i18n, "library.filterContentType")}</option>
                    {#each facets.contentTypes as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "contentType")} · {facet.count}</option>{/each}
                </select>
                <select class="b3-select glean-filter" aria-label={t(i18n, "library.sort")} bind:value={sortBy}>
                    <option value="time">{t(i18n, "action.sortTime")}</option>
                    <option value="updated">{t(i18n, "library.sortUpdated")}</option>
                    <option value="words">{t(i18n, "action.sortWords")}</option>
                    <option value="priority">{t(i18n, "action.sortPriority")}</option>
                    <option value="rating">{t(i18n, "library.sortRating")}</option>
                    <option value="title">{t(i18n, "library.sortTitle")}</option>
                </select>
                <button class="glean-filter-dir" aria-label={t(i18n, "library.toggleDirection")} title={t(i18n, "library.toggleDirection")} onclick={() => (sortDirection = sortDirection === "desc" ? "asc" : "desc")}>{sortDirection === "desc" ? "↓" : "↑"}</button>
                {#if hasFilters}<button class="glean-filter-clear" onclick={clearFilters}>{t(i18n, "library.clearFilters")}</button>{/if}
            </div>
        {/if}

        {#if isTabCanvas}
            <div class="glean-libbar">
                <div class="glean-seg">
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={layoutMode === "list"}
                        onclick={() => (layoutMode = "list")}
                    >☰ {t(i18n, "view.modeList")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={layoutMode === "kanban"}
                        onclick={() => (layoutMode = "kanban")}
                    >⇆ {t(i18n, "view.modeKanban")}</button>
                </div>
                <div class="glean-libbar__spacer"></div>
                <div class="glean-filters" aria-label={t(i18n, "library.filters")}>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterSite")} bind:value={selectedSite}>
                        <option value="">{t(i18n, "library.filterSite")}</option>
                        {#each facets.sites as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterTag")} bind:value={selectedTag}>
                        <option value="">{t(i18n, "library.filterTag")}</option>
                        {#each facets.tags as facet (facet.value)}<option value={facet.value}>#{facet.value} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterAiTag")} bind:value={selectedAiTag}>
                        <option value="">{t(i18n, "library.filterAiTag")}</option>
                        {#each facets.aiTags as facet (facet.value)}<option value={facet.value}>✨{facet.value} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterSource")} bind:value={selectedSource}>
                        <option value="">{t(i18n, "library.filterSource")}</option>
                        {#each facets.sources as facet (facet.value)}<option value={facet.value}>{sourceLabel(facet.value)} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterTimeSource")} bind:value={selectedTimeSource}>
                        <option value="">{t(i18n, "library.filterTimeSource")}</option>
                        {#each facets.timeSources as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "timeSource")} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.filterContentType")} bind:value={selectedContentType}>
                        <option value="">{t(i18n, "library.filterContentType")}</option>
                        {#each facets.contentTypes as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "contentType")} · {facet.count}</option>{/each}
                    </select>
                    <select class="b3-select glean-filter" aria-label={t(i18n, "library.sort")} bind:value={sortBy}>
                        <option value="time">{t(i18n, "action.sortTime")}</option>
                        <option value="updated">{t(i18n, "library.sortUpdated")}</option>
                        <option value="words">{t(i18n, "action.sortWords")}</option>
                        <option value="priority">{t(i18n, "action.sortPriority")}</option>
                        <option value="rating">{t(i18n, "library.sortRating")}</option>
                        <option value="title">{t(i18n, "library.sortTitle")}</option>
                    </select>
                    <button class="glean-filter-dir" aria-label={t(i18n, "library.toggleDirection")} title={t(i18n, "library.toggleDirection")} onclick={() => (sortDirection = sortDirection === "desc" ? "asc" : "desc")}>{sortDirection === "desc" ? "↓" : "↑"}</button>
                    {#if hasFilters}<button class="glean-filter-clear" onclick={clearFilters}>{t(i18n, "library.clearFilters")}</button>{/if}
                </div>
            </div>
        {/if}

        {#if loading}
            <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
        {:else if isTabCanvas && layoutMode === "kanban"}
            <div class="glean-kanban">
                {#each kanbanCols as col (col.status)}
                    <div
                        class="glean-kcol"
                        class:glean-kcol--over={dragOverCol === col.status}
                        role="group"
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
                                onkeydown={activateOnKey(() => openDoc(entry.id))}
                                role="button"
                                tabindex="0"
                            >
                                <div class="glean-kcard__t">{entry.title || t(i18n, "panel.untitled")}</div>
                                <div class="glean-kcard__m">
                                    <span class={carrierClass(entry)}>{carrierLabel(entry)}</span>
                                    {#if bodyPending(entry)}
                                        <span class="glean-body-pending" title={t(i18n, "clip.bodyPendingHint")}>{t(i18n, "clip.bodyPending")}</span>
                                    {/if}
                                    {#if entry.site}<span>📰 {entry.site}</span>{/if}
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
        {:else if isTabCanvas && layoutMode === "list"}
            <div class="glean-lib">
                <aside class="glean-rail">
                    <div class="glean-rail__title">{t(i18n, "rail.queues")}</div>
                    {#each queues as queue (queue)}
                        <button
                            class="glean-rail__item"
                            class:glean-rail__item--on={activeQueue === queue}
                            onclick={() => selectQueue(queue)}
                        >
                            <span class={statusDotClass(queue)}></span>{queueLabel(queue)}
                            <span class="glean-rail__n">{queueCount(queue)}</span>
                        </button>
                    {/each}
                    {#if railStats.sites.length > 0}
                        <div class="glean-rail__title">{t(i18n, "rail.sites")}</div>
                        {#each railStats.sites as site (site.value)}
                            <button class="glean-rail__item" class:glean-rail__item--on={selectedSite === site.value} onclick={() => (selectedSite = selectedSite === site.value ? "" : site.value)}>
                                {site.value}<span class="glean-rail__n">{site.count}</span>
                            </button>
                        {/each}
                    {/if}
                    {#if railStats.tags.length > 0}
                        <div class="glean-rail__title">{t(i18n, "rail.tags")}</div>
                        {#each railStats.tags.slice(0, 8) as tag (tag.value)}
                            <button class="glean-rail__item" class:glean-rail__item--on={selectedTag === tag.value} onclick={() => (selectedTag = selectedTag === tag.value ? "" : tag.value)}>
                                #{tag.value}<span class="glean-rail__n">{tag.count}</span>
                            </button>
                        {/each}
                    {/if}
                    {#if railStats.aiTags.length > 0}
                        <div class="glean-rail__title" title={t(i18n, "library.filterAiTagHint")}>✨ {t(i18n, "rail.aiTags")}</div>
                        {#each railStats.aiTags.slice(0, 8) as tag (tag.value)}
                            <button class="glean-rail__item" class:glean-rail__item--on={selectedAiTag === tag.value} onclick={() => (selectedAiTag = selectedAiTag === tag.value ? "" : tag.value)}>
                                ✨{tag.value}<span class="glean-rail__n">{tag.count}</span>
                            </button>
                        {/each}
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
                            {#each rows as entry (entry.id)}
                                {#if entry.kind === "clip"}
                                    <div
                                        class="glean-drow"
                                        data-glean-clip-id={entry.id}
                                        class:glean-drow--selected={selection.has(entry.id)}
                                        onclick={() => openDoc(entry.id)}
                                        onkeydown={activateOnKey(() => openDoc(entry.id))}
                                        role="button"
                                        tabindex="0"
                                    >
                                        <span class={statusDotClass(entry.status)}></span>
                                        <span class="glean-drow__ti">{entry.title || t(i18n, "panel.untitled")}</span>
                                        <span class="glean-drow__site">{entry.site || t(i18n, "panel.unknownSite")}</span>
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
                                            <button
                                                class="glean-op-btn"
                                                title={snapshotLabel(entry)}
                                                disabled={snappingId === entry.id}
                                                onclick={(e) => { e.stopPropagation(); void takeSnapshot(entry); }}
                                            >{entry.snapshot ? "⟐" : "📷"}</button>
                                            <button
                                                class="glean-op-btn"
                                                title={t(i18n, "ai.actionEnrich")}
                                                disabled={enrichingId === entry.id}
                                                onclick={(e) => { e.stopPropagation(); void enrich(entry); }}
                                            >✨</button>
                                             {#if hasSourceAction(entry.contentType, entry.url)}
                                                 <button
                                                     class="glean-op-btn"
                                                     title={t(i18n, "clip.openSource")}
                                                     aria-label={t(i18n, "clip.openSource")}
                                                     onclick={(e) => { e.stopPropagation(); openSource(entry); }}
                                                 >↗</button>
                                             {/if}
                                             <ClipStatusActions
                                                 {i18n}
                                                 status={entry.status || "inbox"}
                                                 disabled={statusActionId === entry.id}
                                                 onStartReading={() => void startReading(entry)}
                                                 onSetStatus={(status) => void setStatus(entry, status)}
                                             />
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={selection.has(entry.id)}
                                                    onclick={(e) => e.stopPropagation()}
                                                    onchange={(e) => toggleSelect(entry.id, e)}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                {:else}
                                    <div class="glean-drow" onclick={() => openDoc(entry.id)} onkeydown={activateOnKey(() => openDoc(entry.id))} role="button" tabindex="0">
                                        <span class="glean-dot glean-dot--inbox"></span>
                                        <span class="glean-drow__ti">{entry.title || t(i18n, "panel.untitled")}</span>
                                        <span class="glean-drow__site" title={entry.url || entry.hpath}>{entry.site || candidateEvidence(entry)}</span>
                                        <span class="glean-drow__len">{candidateMissing(entry) || t(i18n, "candidate.pending")}</span>
                                        <span class="glean-drow__st">
                                            {#if entry.url}<button class="glean-card__capture" onclick={(e) => { e.stopPropagation(); void capture(entry); }}>{t(i18n, "action.addToInbox")}</button>{/if}
                                        </span>
                                        <div class="glean-drow__ops">
                                            <button class="glean-op-btn" title={t(i18n, "candidate.fixUrl")} onclick={(e) => { e.stopPropagation(); startCandidateUrlEdit(entry); }}>✎</button>
                                            {#if !entry.url}<button class="glean-op-btn" title={t(i18n, "candidate.captureLocal")} onclick={(e) => { e.stopPropagation(); void captureAsLocal(entry); }}>▤</button>{/if}
                                            <button class="glean-op-btn" title={t(i18n, "candidate.exclude")} onclick={(e) => { e.stopPropagation(); void excludeCandidate(entry); }}>×</button>
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
                    {/if}
                </div>
            </div>
        {:else}
            <div class="glean-list">
                {#if overQuota && activeQueue === "inbox"}
                    <div class="glean-quota">
                        <span>⚖️</span>
                        <span style="flex:1">{t(i18n, "panel.quotaOver", { total: inboxTotal, quota: facade.settings.inboxQuota })}</span>
                    </div>
                {/if}
                {#if stalePool.length > 0 && (activeQueue === "inbox" || activeQueue === "later")}
                    <div class="glean-quota">
                        <span>🧹</span>
                        <span style="flex:1">{t(i18n, "panel.staleCandidates", { n: stalePool.length })}</span>
                        <button class="glean-cap-btn" onclick={() => toggleStalePreview()}>
                            {stalePreviewOpen ? t(i18n, "panel.staleHide") : t(i18n, "panel.archiveStale")}
                        </button>
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
                {#if candidateCount > 0}
                    <div class="glean-candidates">
                        <span>📥</span>
                        <span style="flex:1">{t(i18n, "panel.candidatesDetected", { n: candidateCount })}</span>
                    </div>
                {/if}
                {#if rows.length === 0 && !(candidateCount > 0 && activeQueue === "inbox")}
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
                    {#each rows as entry (entry.id)}
                        <article
                            class="glean-card"
                            data-glean-clip-id={entry.kind === "clip" ? entry.id : undefined}
                            class:glean-card--candidate={entry.kind === "candidate"}
                            class:glean-card--selected={selection.has(entry.id)}
                        >
                            <div class="glean-card__body" onclick={() => openDoc(entry.id)} onkeydown={activateOnKey(() => openDoc(entry.id))} role="button" tabindex="0">
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
                                    <button class="glean-op-btn" title={t(i18n, "candidate.fixUrl")} onclick={() => startCandidateUrlEdit(entry)}>✎</button>
                                    {#if !entry.url}<button class="glean-op-btn" title={t(i18n, "candidate.captureLocal")} onclick={() => void captureAsLocal(entry)}>▤</button>{/if}
                                    <button class="glean-op-btn" title={t(i18n, "candidate.exclude")} onclick={() => void excludeCandidate(entry)}>×</button>
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
                                    <button
                                        class="glean-op-btn"
                                        title={snapshotLabel(entry)}
                                        disabled={snappingId === entry.id}
                                        onclick={(e) => { e.stopPropagation(); void takeSnapshot(entry); }}
                                    >{entry.snapshot ? "⟐" : "📷"}</button>
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "ai.actionEnrich")}
                                        disabled={enrichingId === entry.id}
                                        onclick={(e) => { e.stopPropagation(); void enrich(entry); }}
                                    >✨</button>
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
                                        onclick={(e) => e.stopPropagation()}
                                        onchange={(e) => toggleSelect(entry.id, e)}
                                    />
                                </label>
                            {/if}
                        </article>
                    {/each}
                {/if}
            </div>

            {#if selection.size > 0}
                <footer class="glean-batchbar">
                    <b>{t(i18n, "action.selected")} {selection.size}</b>
                    <div class="glean-batchbar__ops">
                        <button class="glean-bb" onclick={() => void batchApply("reading")}>{t(i18n, "status.reading")}</button>
                        <button class="glean-bb" onclick={() => void batchApply("done")}>{t(i18n, "status.done")}</button>
                        <button class="glean-bb glean-bb--pri" onclick={() => void batchApply("archived")}>{t(i18n, "action.batchArchive")}</button>
                        <button class="glean-bb" onclick={() => (selection = new Set())}>✕</button>
                    </div>
                </footer>
            {/if}
        {/if}
    {:else if view === "resurface"}
        <ResurfaceView {facade} {index} onMutated={() => void reload()} />
    {:else if view === "stats"}
        <StatsView {facade} {index} onCaptured={() => void reload()} />
    {:else if view === "quotes"}
        <QuotesView {facade} {index} />
    {:else}
        <HighlightView {facade} />
    {/if}
</div>

<style>
    /* 样式集中在 src/index.scss（设计系统），组件内不再重复 */
</style>

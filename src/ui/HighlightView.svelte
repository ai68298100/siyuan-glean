<script lang="ts">
// 触控契约：摘录操作的 min-height: 44px 由 src/index.scss 统一提供。
// 宽屏布局契约集中在 src/index.scss：@container glean-workbench (min-width: 760px)
// 下 .glean-highlights__items { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); }，
// .glean-highlights__empty { width: min(100%, 720px); align-self: center; }。
import { tick, untrack } from "svelte";
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { filterHighlights, formatHighlightShare, formatHighlightTime, groupHighlightsByArticle, highlightFacets, pageHighlights, renderArticleHighlightsMarkdown, retainHighlightSelection, type ArticleHighlightGroup, type HighlightFilter } from "../domain/highlights";
import {
    copyHighlights, createArticleHighlightsDoc, exportHighlightsCsv, HighlightExportError, highlightDocumentTitle, listDocHighlights, listLibraryHighlights,
    prepareHighlightExport, saveHighlightDraft, type HighlightExportSession, type HighlightItem, type HighlightSaveReason,
} from "../services/highlights";
import { findRelatedOutcome, type RelatedReason } from "../services/enrich-service";
import { makeQuoteCardPreview } from "./flashcard-dialog";
import type { GleanSettings } from "../services/settings";
import { loadUiPrefs } from "../services/prefs";
import { displayTagAlias, type TagAlias } from "../domain/ui-prefs";
import { moveLibraryCursor, resolveLibraryShortcut } from "../domain/library-keyboard";

interface Props { facade: GleanFacade }
let { facade }: Props = $props();
const instanceId = $props.id();
const titleId = `glean-highlights-title-${instanceId}`;
const previewTitleId = `glean-highlights-preview-title-${instanceId}`;
const relatedTitleId = `glean-highlights-related-title-${instanceId}`;
const i18n = $derived(facade.i18n);
const currentDocId = $derived(facade.currentDocId());
let scope = $state<"current" | "library">("current");
let viewMode = $state<"timeline" | "article">("timeline");
let items = $state<HighlightItem[]>([]);
let loading = $state(true);
let loadError = $state("");
let related = $state<Array<{ id: string; title: string }>>([]);
let relatedLoading = $state(false);
let relatedReason = $state<RelatedReason | null>("disabled");
let docTitle = $state("");
let cardingKey = $state("");
let search = $state("");
let site = $state("");
let tag = $state("");
let aiTag = $state("");
let sort = $state<NonNullable<HighlightFilter["sort"]>>("id");
let direction = $state<"asc" | "desc">("asc");
let page = $state(1);
let selected = $state<string[]>([]);
let session = $state<HighlightExportSession | null>(null);
let exportBusy = $state(false);
let exportError = $state("");
let exportStatus = $state("");
let retryAction = $state<"copy" | "csv" | "markdown" | "preview" | "save">("preview");
let tagAliases = $state<TagAlias[]>([]);
/** 摘录墙键盘光标（T-3399）：只描述当前页可见条目，不写入任何文章事实。 */
let cursorId = $state("");
let expandedTags = $state<Record<string, boolean>>({});
let expandedAiTags = $state<Record<string, boolean>>({});
let rootEl = $state<HTMLElement | null>(null);
let generation = 0;
let relatedGeneration = 0;
let loadedContext = "";
let tagAliasGeneration = 0;
let allGroupsOpen = $state(true);

const facets = $derived(highlightFacets(items));
const filtered = $derived(filterHighlights(items, { search, site, tag, aiTag, sort, direction }));
const articleGroups = $derived(groupHighlightsByArticle(filtered));
const highlightPageSize = 20;
const visible = $derived(pageHighlights(filtered, page, highlightPageSize));
const visibleIds = $derived(visible.items.map((item) => item.id));

// 翻页、筛选或作用域变化后，光标只在仍可见时保留。
$effect(() => {
    if (cursorId && !visibleIds.includes(cursorId)) cursorId = "";
});
const labels = $derived({ title: t(i18n, "highlight.exportTitle"), original: t(i18n, "highlight.original"), source: t(i18n, "highlight.source") });

$effect(() => {
    let active = true;
    const syncTagAliases = (): void => {
        const request = ++tagAliasGeneration;
        void loadUiPrefs(facade.pluginInstance).then((prefs) => {
            if (active && request === tagAliasGeneration) tagAliases = prefs.tagAliases;
        }).catch(() => undefined);
    };
    syncTagAliases();
    document.addEventListener("glean:tag-aliases-changed", syncTagAliases);
    return () => {
        active = false;
        tagAliasGeneration += 1;
        document.removeEventListener("glean:tag-aliases-changed", syncTagAliases);
    };
});

$effect(() => {
    const targetScope = scope;
    const docId = targetScope === "current" ? currentDocId : "";
    const settings = facade.settings;
    untrack(() => void loadHighlights(targetScope, docId, settings));
    return () => { generation += 1; };
});

async function loadHighlights(targetScope: "current" | "library", docId: string, settings: GleanSettings) {
    const request = ++generation;
    relatedGeneration += 1;
    relatedLoading = false;
    related = [];
    relatedReason = "disabled";
    const context = `${targetScope}:${docId}`;
    if (context !== loadedContext) {
        items = [];
        selected = [];
        session = null;
        exportError = "";
        exportStatus = "";
        related = [];
        docTitle = "";
        page = 1;
        search = "";
        site = "";
        tag = "";
        aiTag = "";
        loadedContext = context;
    }
    loadError = "";
    loading = true;
    if (targetScope === "current" && !docId) {
        loading = false;
        return;
    }
    try {
        const next = targetScope === "library" ? await listLibraryHighlights(facade.pluginInstance, settings) : await listDocHighlights(docId);
        // 标题查询失败不应把"暂无摘录"污染成"加载失败"：降级为空串即可
        let title = "";
        if (targetScope === "current") {
            title = next[0]?.title || "";
            if (!title) {
                try {
                    title = await highlightDocumentTitle(docId);
                } catch (titleError) {
                    console.warn("[glean] 摘录标题查询失败:", titleError);
                }
            }
        }
        if (request !== generation) return;
        items = next;
        selected = retainHighlightSelection(next, selected);
        docTitle = title;
        if (targetScope === "current") {
            void loadRelated(docId, next[0]?.text || docId, settings, request);
        }
    } catch (error) {
        if (request === generation) {
            console.warn("[glean] 摘录加载失败:", error);
            loadError = t(i18n, "highlight.loadFailed");
        }
    } finally {
        if (request === generation) loading = false;
    }
}

async function loadRelated(docId: string, query: string, settings: GleanSettings, listRequest: number): Promise<void> {
    const request = ++relatedGeneration;
    related = [];
    relatedReason = null;
    relatedLoading = true;
    try {
        const outcome = await findRelatedOutcome(docId, query, [], { plugin: facade.pluginInstance, settings });
        if (request !== relatedGeneration || listRequest !== generation) return;
        related = outcome.items;
        relatedReason = outcome.reason;
    } catch {
        if (request === relatedGeneration && listRequest === generation) {
            related = [];
            relatedReason = "error";
        }
    } finally {
        if (request === relatedGeneration && listRequest === generation) relatedLoading = false;
    }
}

function retryRelated(): void {
    const docId = currentDocId;
    if (scope !== "current" || !docId || loading || loadError || relatedLoading) return;
    void loadRelated(docId, items[0]?.text || docId, facade.settings, generation);
}

function refresh() {
    session = null;
    exportError = "";
    exportStatus = "";
    void loadHighlights(scope, scope === "current" ? currentDocId : "", facade.settings);
}

function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}

function selectPage() {
    selected = [...new Set([...selected, ...visible.items.map((item) => item.id)])];
}

function clearFilters() {
    search = "";
    site = "";
    tag = "";
    aiTag = "";
    page = 1;
}

const hasFilters = $derived(Boolean(search.trim() || site || tag || aiTag));

function reasonText(reason: HighlightSaveReason): string {
    const keys: Record<HighlightSaveReason, string> = {
        changed: "highlight.changed", readFailed: "highlight.readFailed", empty: "highlight.emptySelection",
        invalid: "highlight.invalidSelection", busy: "highlight.busy", createUnknown: "highlight.createUnknown", markFailed: "highlight.markFailed",
    };
    return t(i18n, keys[reason]);
}

async function runExport(action: "copy" | "csv" | "markdown" | "preview") {
    if (exportBusy || loading) return;
    exportBusy = true;
    exportError = "";
    exportStatus = "";
    retryAction = action;
    try {
        if (action === "copy") {
            await copyHighlights(items, selected, labels, (text) => navigator.clipboard.writeText(text));
            exportStatus = t(i18n, "highlight.copied");
        } else if (action === "csv") {
            const csv = await exportHighlightsCsv(items, selected);
            const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${labels.title}.csv`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            exportStatus = t(i18n, "highlight.exported");
        } else if (action === "markdown") {
            const prep = await prepareHighlightExport(items, selected, labels);
            const blob = new Blob([prep.markdown], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${labels.title}.md`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            exportStatus = t(i18n, "highlight.exported");
        } else if (!session) {
            session = await prepareHighlightExport(items, selected, labels);
        }
    } catch (error) {
        console.warn("[glean] 摘录导出失败:", error);
        exportError = error instanceof HighlightExportError ? reasonText(error.reason) : t(i18n, "msg.actionFailed");
    } finally {
        exportBusy = false;
    }
}

async function save() {
    if (!session || exportBusy) return;
    exportBusy = true;
    exportError = "";
    exportStatus = "";
    retryAction = "save";
    try {
        const result = await saveHighlightDraft(facade.pluginInstance, session);
        if (result.ok) {
            exportStatus = t(i18n, "highlight.saved");
            facade.notifyDataChanged();
        } else {
            exportError = reasonText(result.reason ?? "readFailed");
        }
    } catch (error) {
        console.warn("[glean] 制卡保存失败:", error);
        exportError = t(i18n, "msg.actionFailed");
    } finally {
        exportBusy = false;
    }
}

function retryExport() {
    if (retryAction === "save") void save();
    else void runExport(retryAction);
}

async function card(item: HighlightItem) {
    if (cardingKey) return;
    cardingKey = item.id;
    try {
        makeQuoteCardPreview(facade, { title: item.title || docTitle, quote: item.text, docId: item.rootId, blockId: item.id });
    } catch (error) {
        console.warn("[glean] 分享卡生成失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 3000);
    } finally {
        cardingKey = "";
    }
}

let copyingId = $state("");

async function copyQuote(item: HighlightItem): Promise<void> {
    if (copyingId) return;
    copyingId = item.id;
    try {
        const text = formatHighlightShare(item);
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            showMessage(t(i18n, "highlight.shareCopied"), 2500);
        } else {
            showMessage(t(i18n, "highlight.clipboardUnavailable"), 3000);
        }
    } catch {
        showMessage(t(i18n, "highlight.clipboardUnavailable"), 3000);
    } finally {
        copyingId = "";
    }
}

function openDoc(id: string, focusBlockId?: string) {
    facade.openReadingDocument(id, focusBlockId);
}

async function copyArticleQuotes(group: ArticleHighlightGroup): Promise<void> {
    if (exportBusy || loading) return;
    exportBusy = true;
    exportError = "";
    try {
        const md = renderArticleHighlightsMarkdown(group, labels);
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(md);
            showMessage(t(i18n, "highlight.copied"), 2500);
        } else {
            showMessage(t(i18n, "highlight.clipboardUnavailable"), 3000);
        }
    } catch (error) {
        console.warn("[glean] 文章摘录复制失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 3000);
    } finally {
        exportBusy = false;
    }
}

function exportArticleQuotes(group: ArticleHighlightGroup): void {
    if (exportBusy || loading) return;
    try {
        const md = renderArticleHighlightsMarkdown(group, labels);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        const safeTitle = (group.title || group.rootId).replace(/[\/\\?%*:|"<>]/g, "_").slice(0, 50);
        anchor.download = `${safeTitle}-highlights.md`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showMessage(t(i18n, "highlight.exported"), 2500);
    } catch (error) {
        console.warn("[glean] 文章摘录导出失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 3000);
    } finally {
        exportBusy = false;
    }
}

async function createDocFromArticleQuotes(group: ArticleHighlightGroup): Promise<void> {
    if (exportBusy || loading) return;
    exportBusy = true;
    try {
        const result = await createArticleHighlightsDoc(facade.pluginInstance, group, labels);
        if (result.ok && result.docId) {
            showMessage(t(i18n, "highlight.articleDocCreated"), 3000);
            facade.notifyDataChanged();
            openDoc(result.docId);
        } else {
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        }
    } catch (error) {
        console.warn("[glean] 创建读书笔记失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 3000);
    } finally {
        exportBusy = false;
    }
}

function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (event.key === "Escape") {
        if (session && !exportBusy) {
            event.preventDefault();
            event.stopPropagation();
            session = null;
            exportError = "";
            exportStatus = "";
            return;
        }
        if (cursorId) {
            event.preventDefault();
            event.stopPropagation();
            const previous = cursorId;
            cursorId = "";
            focusHighlightRow(previous);
        }
        return;
    }
    handleHighlightShortcut(event);
}

/**
 * 摘录墙行级键盘导航（T-3399）：与读库共用同一个键位仲裁层，
 * J/K 移动，X 勾选，Enter 打开原文；Escape 由上面的窗口处理器收口。
 */
function handleHighlightShortcut(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const textEntry = Boolean(target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
    const nativeAction = Boolean(target?.closest("button, a[href], summary, [role='button']"));
    const action = resolveLibraryShortcut(event, {
        textEntry,
        nativeAction,
        overlay: Boolean(document.querySelector("dialog[open], .b3-menu")),
        cursorActive: Boolean(cursorId),
    });
    // 只接管 J/K/X/Enter；方向键仍交给列表原生滚动。
    if (!action || action.type === "clearCursor") return;
    if (!["move", "toggleSelect", "activate"].includes(action.type)) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "move") {
        setCursor(moveLibraryCursor(visibleIds, cursorId, action.delta));
        return;
    }
    const item = visible.items.find((entry) => entry.id === cursorId);
    if (!item) return;
    if (action.type === "toggleSelect") toggle(item.id);
    if (action.type === "activate") openDoc(item.id);
}

function setCursor(id: string): void {
    cursorId = id;
    if (id) focusHighlightRow(id);
}

function focusHighlightRow(id: string): void {
    void tick().then(() => {
        if (!id) return;
        rootEl?.querySelector<HTMLElement>(`[data-glean-highlight-id="${CSS.escape(id)}"] .glean-highlights__quote input`)?.focus({ preventScroll: true });
    });
}
</script>

<svelte:window onkeydown={onWindowKeyDown} />

<div class="glean-panel glean-highlights" bind:this={rootEl} aria-busy={loading || exportBusy} aria-labelledby={titleId}>
    <div class="glean-highlights__head">
        <div>
            <h2 id={titleId} class="glean-highlights__title">{t(i18n, "highlight.title")}</h2>
            <p class="glean-highlights__subtitle">{scope === "current" ? t(i18n, "highlight.current") : t(i18n, "highlight.allLibrary")}</p>
        </div>
        <div class="glean-highlights__tools glean-highlights__tools--scope" role="group" aria-label={t(i18n, "highlight.title")}>
            <button aria-pressed={scope === "current"} disabled={exportBusy} onclick={() => scope = "current"}>{t(i18n, "highlight.current")}</button>
            <button aria-pressed={scope === "library"} disabled={exportBusy} onclick={() => scope = "library"}>{t(i18n, "highlight.allLibrary")}</button>
            <button aria-pressed={viewMode === "timeline"} disabled={exportBusy} onclick={() => viewMode = "timeline"}>{t(i18n, "highlight.viewTimeline")}</button>
            <button aria-pressed={viewMode === "article"} disabled={exportBusy} onclick={() => viewMode = "article"}>{t(i18n, "highlight.viewArticle")}</button>
            {#if viewMode === "article" && articleGroups.length > 0}
                <button
                    type="button"
                    class="glean-highlights__fold-toggle"
                    disabled={exportBusy}
                    onclick={() => allGroupsOpen = !allGroupsOpen}
                    title={t(i18n, allGroupsOpen ? "highlight.collapseAll" : "highlight.expandAll")}
                    aria-label={t(i18n, allGroupsOpen ? "highlight.collapseAll" : "highlight.expandAll")}
                >
                    <svg class="glean-icon glean-icon--xs" aria-hidden="true">
                        <use href={allGroupsOpen ? "#iconGleanCollapseAll" : "#iconGleanExpandAll"} />
                    </svg>
                </button>
            {/if}
            <button class="glean-highlights__refresh" disabled={loading || exportBusy} onclick={refresh}>{t(i18n, "action.refresh")}</button>
        </div>
    </div>
    <div class="glean-highlights__filters" role="search" aria-label={t(i18n, "action.search")}>
        <input type="search" bind:value={search} oninput={() => page = 1} onkeydown={(event) => { if (event.key === "Escape" && search) { event.stopPropagation(); search = ""; page = 1; } }} placeholder={t(i18n, "highlight.searchPlaceholder")} aria-label={t(i18n, "action.search")} />
        <label>{t(i18n, "library.filterSite")}<select bind:value={site} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.sites as value}<option value={value}>{value}</option>{/each}</select></label>
        <label>{t(i18n, "library.filterTag")}<select bind:value={tag} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.tags as value}<option value={value}>{displayTagAlias(tagAliases, value)}</option>{/each}</select></label>
        <label>{t(i18n, "library.filterAiTag")}<select bind:value={aiTag} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.aiTags as value}<option value={value}>{value}</option>{/each}</select></label>
        <label>{t(i18n, "library.sort")}<select bind:value={sort} onchange={() => page = 1}><option value="id">{t(i18n, "action.sortTime")}</option><option value="title">{t(i18n, "library.sortTitle")}</option><option value="site">{t(i18n, "library.filterSite")}</option></select></label>
        <button class="glean-filter-dir" aria-pressed={direction === "asc"} aria-label={`${t(i18n, "library.toggleDirection")}: ${t(i18n, direction === "asc" ? "library.directionAscending" : "library.directionDescending")}`} title={`${t(i18n, "library.toggleDirection")}: ${t(i18n, direction === "asc" ? "library.directionAscending" : "library.directionDescending")}`} onclick={() => { direction = direction === "asc" ? "desc" : "asc"; page = 1; }}><span class="glean-filter-dir__icon" aria-hidden="true"><svg class="glean-icon glean-icon--xs"><use href={direction === "asc" ? "#iconGleanArrowUp" : "#iconGleanArrowDown"} /></svg></span><span class="glean-filter-dir__label">{t(i18n, "library.toggleDirection")}</span></button>
        <button onclick={clearFilters}>{t(i18n, "library.clearFilters")}</button>
    </div>
    {#if loading && items.length === 0}
        <div class="glean-highlights__loading" role="status" aria-live="polite" aria-label={t(i18n, "panel.loading")}>
            {#each [0, 1, 2] as placeholder (placeholder)}
                <div class="glean-highlights__loading-card" aria-hidden="true">
                    <span></span><span></span><span></span>
                </div>
            {/each}
        </div>
    {/if}
    {#if loadError}
        <div class="glean-highlights__error" role="alert"><p>{loadError}</p><button disabled={loading} onclick={refresh}>{t(i18n, "action.retry")}</button></div>
    {/if}
    <div class="glean-highlights__tools glean-highlights__tools--selection">
        <div class="glean-highlights__selection-actions" role="group" aria-label={t(i18n, "action.selected")}>
            <span class="glean-highlights__selection-count" aria-live="polite" aria-atomic="true">{t(i18n, "action.selected")} {selected.length}</span>
            <button disabled={loading || exportBusy || !visible.items.length} onclick={selectPage}>{t(i18n, "highlight.selectPage")}</button>
            <button disabled={exportBusy || !selected.length} onclick={() => selected = []}>{t(i18n, "highlight.clearSelection")}</button>
        </div>
        <div class="glean-highlights__export-actions" role="group" aria-label={t(i18n, "highlight.exportTitle")}>
            <button disabled={loading || exportBusy || !selected.length} onclick={() => void runExport("copy")}>{t(i18n, "highlight.copy")}</button>
            <button disabled={loading || exportBusy || !selected.length} onclick={() => void runExport("csv")}>{t(i18n, "highlight.csv")}</button>
            <button disabled={loading || exportBusy || !selected.length} onclick={() => void runExport("markdown")}>{t(i18n, "highlight.markdown")}</button>
            <button class="glean-highlights__preview-action" disabled={loading || exportBusy || !selected.length || !!session} onclick={() => void runExport("preview")}>{t(i18n, "highlight.preview")}</button>
        </div>
    </div>
    {#if exportError}
        <div class="glean-highlights__error" role="alert">
            <p>{exportError}</p>
            {#if !(retryAction === "save" && session?.state === "unknown")}<button disabled={exportBusy || loading} onclick={retryExport}>{t(i18n, "action.retry")}</button>{/if}
        </div>
    {/if}
    {#if exportStatus}<p class="glean-highlights__status" role="status">{exportStatus}</p>{/if}
    {#if session}
        <section class="glean-highlights__preview" aria-labelledby={previewTitleId}>
            <h3 id={previewTitleId}>{t(i18n, "highlight.preview")}</h3>
            <p>{t(i18n, "highlight.exportHint")}</p>
            <p>{session.hpath}</p>
            <pre>{session.markdown}</pre>
            <div class="glean-highlights__tools">
                {#if session.state === "ready" || session.state === "created"}<button disabled={exportBusy} onclick={() => void save()}>{t(i18n, session.state === "created" ? "highlight.retryMark" : "highlight.confirm")}</button>{/if}
                {#if session.createdDocId}<button onclick={() => openDoc(session!.createdDocId)}>{t(i18n, "action.openDoc")}</button>{/if}
                <button disabled={exportBusy} onclick={() => { session = null; exportError = ""; exportStatus = ""; }}>{t(i18n, "action.close")}</button>
            </div>
        </section>
    {/if}
    {#if !loading && !loadError && scope === "current" && !currentDocId}
        <div class="glean-empty glean-highlights__empty"><div class="glean-empty__art"><svg aria-hidden="true"><use href="#iconGleanWheat" /></svg></div><div class="glean-empty__title">{t(i18n, "highlight.noDoc")}</div><div class="glean-empty__hint">{t(i18n, "highlight.noDocHint")}</div></div>
    {:else if !loading && !loadError && !visible.items.length}
        {#if hasFilters}
            <div class="glean-empty glean-highlights__empty" role="status"><div class="glean-empty__hint">{t(i18n, "library.noMatch")}</div><button class="glean-btn glean-btn--ghost" onclick={clearFilters}>{t(i18n, "library.clearFilters")}</button></div>
        {:else}
            <div class="glean-empty glean-highlights__empty"><div class="glean-empty__art"><svg aria-hidden="true"><use href="#iconGleanWheat" /></svg></div><div class="glean-empty__title">{t(i18n, "highlight.empty")}</div><div class="glean-empty__hint">{t(i18n, "highlight.emptyHint")}</div></div>
        {/if}
    {/if}
    {#if !loadError}
        {#if viewMode === "timeline"}
            <div class="glean-highlights__items">
                {#each visible.items as item (item.id)}
                    <article class="glean-highlights__item" data-glean-highlight-id={item.id} class:glean-highlights__item--cursor={cursorId === item.id} aria-current={cursorId === item.id ? "true" : undefined} aria-busy={cardingKey === item.id}>
                        <div class="glean-highlights__item-head">
                            <span class="glean-reader__highlight-dot glean-reader__highlight-dot--{item.color || 'yellow'}" aria-hidden="true"></span>
                            <span class="glean-highlights__item-label">{t(i18n, "highlight.quoteTag")}</span>
                            <span class="glean-highlights__item-index">{(visible.page - 1) * highlightPageSize + visible.items.indexOf(item) + 1}</span>
                        </div>
                        <label class="glean-highlights__quote"><input type="checkbox" checked={selected.includes(item.id)} disabled={exportBusy} onchange={() => toggle(item.id)} aria-label={`${t(i18n, "highlight.quoteTag")} ${(visible.page - 1) * highlightPageSize + visible.items.indexOf(item) + 1}: ${item.text.slice(0, 120)}`} /><span>{item.text}</span></label>
                        <p class="glean-highlights__meta" title={item.title || t(i18n, "panel.untitled")}>
                            {item.title || t(i18n, "panel.untitled")} {item.site ? ` · ${item.site}` : ""}
                            {#if formatHighlightTime(item.id)}<span class="glean-highlights__time"> · {formatHighlightTime(item.id)}</span>{/if}
                        </p>
                        {#if item.tags.length}<p class="glean-highlights__meta glean-highlights__tags"><span>{t(i18n, "library.filterTag")}</span>{#each (expandedTags[item.id] ? item.tags : item.tags.slice(0, 3)) as value}<span class="glean-highlights__tag">{value}</span>{/each}{#if item.tags.length > 3 && !expandedTags[item.id]}<button type="button" class="glean-highlights__tag glean-highlights__tag--more" onclick={() => expandedTags[item.id] = true}>+{item.tags.length - 3}</button>{/if}</p>{/if}
                        {#if item.aiTags.length}<p class="glean-highlights__meta glean-highlights__tags glean-highlights__tags--ai"><span>{t(i18n, "library.filterAiTag")}</span>{#each (expandedAiTags[item.id] ? item.aiTags : item.aiTags.slice(0, 3)) as value}<span class="glean-highlights__tag">{value}</span>{/each}{#if item.aiTags.length > 3 && !expandedAiTags[item.id]}<button type="button" class="glean-highlights__tag glean-highlights__tag--more" onclick={() => expandedAiTags[item.id] = true}>+{item.aiTags.length - 3}</button>{/if}</p>{/if}
                        <div class="glean-highlights__tools glean-highlights__tools--card">
                            <button type="button" onclick={() => openDoc(item.rootId, item.id)}>{t(i18n, "highlight.original")}</button>
                            <button type="button" onclick={() => openDoc(item.rootId)}>{t(i18n, "action.openDoc")}</button>
                            <button type="button" aria-busy={copyingId === item.id} disabled={Boolean(copyingId)} onclick={() => void copyQuote(item)} title={t(i18n, "highlight.copyShare")}>
                                <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanCopy" /></svg>
                                {t(i18n, "highlight.copyShare")}
                            </button>
                            <button type="button" aria-busy={cardingKey === item.id} disabled={Boolean(cardingKey)} onclick={() => void card(item)} title={t(i18n, "flashcard.make")} aria-label={t(i18n, "flashcard.make")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanCard" /></svg>{t(i18n, "flashcard.make")}</button>
                        </div>
                    </article>
                {/each}
            </div>
            {#if !loading && visible.pages > 1}
                <nav class="glean-highlights__tools glean-highlights__pagination" aria-label={t(i18n, "highlight.pageInfo", { page: visible.page, pages: visible.pages, n: visible.total })}>
                    <button disabled={visible.page <= 1} onclick={() => page = visible.page - 1}>{t(i18n, "highlight.previousPage")}</button>
                    <span>{t(i18n, "highlight.pageInfo", { page: visible.page, pages: visible.pages, n: visible.total })}</span>
                    <button disabled={visible.page >= visible.pages} onclick={() => page = visible.page + 1}>{t(i18n, "highlight.nextPage")}</button>
                </nav>
            {/if}
        {:else}
            <div class="glean-highlights__article-groups">
                {#each articleGroups as group (group.rootId)}
                    <details class="glean-highlights__article-group" open={allGroupsOpen}>
                        <summary class="glean-highlights__article-header">
                            <span class="glean-highlights__article-title" title={group.title || t(i18n, "panel.untitled")}>
                                {group.title || t(i18n, "panel.untitled")}
                            </span>
                            {#if group.site}<span class="glean-highlights__article-site"> · {group.site}</span>{/if}
                            <span class="glean-chip">{t(i18n, "highlight.groupCount", { n: group.items.length })}</span>
                            <div class="glean-highlights__article-actions" role="group" aria-label={t(i18n, "library.moreActions")}>
                                <button type="button" class="glean-btn glean-btn--ghost" onclick={(e) => { e.stopPropagation(); openDoc(group.rootId); }}>{t(i18n, "action.openDoc")}</button>
                                <button type="button" class="glean-btn glean-btn--ghost" disabled={exportBusy} onclick={(e) => { e.stopPropagation(); void copyArticleQuotes(group); }} title={t(i18n, "highlight.copyArticleQuotes")}>
                                    <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanCopy" /></svg>
                                    {t(i18n, "highlight.copyArticleQuotes")}
                                </button>
                                <button type="button" class="glean-btn glean-btn--ghost" disabled={exportBusy} onclick={(e) => { e.stopPropagation(); exportArticleQuotes(group); }} title={t(i18n, "highlight.exportArticleQuotes")}>
                                    <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanDownload" /></svg>
                                    {t(i18n, "highlight.exportArticleQuotes")}
                                </button>
                                <button type="button" class="glean-btn glean-btn--ghost" disabled={exportBusy} onclick={(e) => { e.stopPropagation(); void createDocFromArticleQuotes(group); }} title={t(i18n, "highlight.createArticleDoc")}>
                                    <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanNews" /></svg>
                                    {t(i18n, "highlight.createArticleDoc")}
                                </button>
                            </div>
                        </summary>
                        <div class="glean-highlights__items glean-highlights__items--grouped">
                            {#each group.items as item, itemIndex (item.id)}
                                <article class="glean-highlights__item" data-glean-highlight-id={item.id} class:glean-highlights__item--cursor={cursorId === item.id} aria-current={cursorId === item.id ? "true" : undefined} aria-busy={cardingKey === item.id}>
                                    <div class="glean-highlights__item-head">
                                        <span class="glean-reader__highlight-dot glean-reader__highlight-dot--{item.color || 'yellow'}" aria-hidden="true"></span>
                                        <span class="glean-highlights__item-label">{t(i18n, "highlight.quoteTag")}</span>
                                        <span class="glean-highlights__item-index">{itemIndex + 1}</span>
                                    </div>
                                    <label class="glean-highlights__quote"><input type="checkbox" checked={selected.includes(item.id)} disabled={exportBusy} onchange={() => toggle(item.id)} aria-label={`${t(i18n, "highlight.quoteTag")} ${itemIndex + 1}: ${item.text.slice(0, 120)}`} /><span>{item.text}</span></label>
                                    {#if formatHighlightTime(item.id)}<p class="glean-highlights__meta"><span class="glean-highlights__time">{formatHighlightTime(item.id)}</span></p>{/if}
                                    <div class="glean-highlights__tools glean-highlights__tools--card">
                                        <button type="button" onclick={() => openDoc(group.rootId, item.id)}>{t(i18n, "highlight.original")}</button>
                                        <button type="button" onclick={() => openDoc(item.rootId)}>{t(i18n, "action.openDoc")}</button>
                                        <button type="button" aria-busy={copyingId === item.id} disabled={Boolean(copyingId)} onclick={() => void copyQuote(item)} title={t(i18n, "highlight.copyShare")}>
                                            <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanCopy" /></svg>
                                            {t(i18n, "highlight.copyShare")}
                                        </button>
                                        <button type="button" aria-busy={cardingKey === item.id} disabled={Boolean(cardingKey)} onclick={() => void card(item)} title={t(i18n, "flashcard.make")} aria-label={t(i18n, "flashcard.make")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanCard" /></svg>{t(i18n, "flashcard.make")}</button>
                                    </div>
                                </article>
                            {/each}
                        </div>
                    </details>
                {/each}
            </div>
        {/if}
    {/if}
    {#if scope === "current" && currentDocId && !loading && !loadError}
        <section class="glean-highlights__related" aria-labelledby={relatedTitleId} aria-busy={relatedLoading}>
            <div class="glean-sect" id={relatedTitleId}>✨ {t(i18n, "ai.relatedTitle")}</div>
            {#if relatedLoading}
                <p class="glean-highlights__related-state" role="status" aria-live="polite">{t(i18n, "reader.relatedLoading")}</p>
            {:else if relatedReason === "ok" && related.length}
                {#each related as item (item.id)}<button class="glean-rel" onclick={() => openDoc(item.id)}><span class="glean-rel__t">{item.title}</span><svg class="glean-rel__go glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowRight" /></svg></button>{/each}
                <div class="glean-highlights__meta">AI · {t(i18n, "ai.actionsPreview")}</div>
            {:else if relatedReason === "error"}
                <div class="glean-highlights__related-error" role="alert">
                    <p>{t(i18n, "reader.relatedFailed")}</p>
                    <button class="glean-btn glean-btn--ghost" disabled={relatedLoading} onclick={retryRelated}>{t(i18n, "reader.relatedRetry")}</button>
                </div>
            {:else if relatedReason === "embedding-disabled"}
                <p class="glean-highlights__related-state" role="status">{t(i18n, "reader.relatedEmbeddingDisabled")}</p>
            {:else if relatedReason === "disabled"}
                <p class="glean-highlights__related-state" role="status">{t(i18n, "reader.relatedDisabled")}</p>
            {:else}
                <div class="glean-highlights__related-empty" role="status">
                    <span class="glean-empty__art" aria-hidden="true"><svg><use href="#iconGleanWheat" /></svg></span>
                    <span>{t(i18n, "reader.relatedNoHits")}</span>
                </div>
            {/if}
        </section>
    {/if}
</div>

<style>
    .glean-highlights {
        flex: 1 1 auto;
        box-sizing: border-box;
        min-height: 0;
        padding: 24px;
        gap: 20px;
        overflow-y: auto;
        font-size: 14px;
        line-height: 1.6;
    }
    .glean-highlights__related { display: grid; gap: var(--glean-space-2); min-width: 0; }
    .glean-highlights__related-state { margin: 0; color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); overflow-wrap: anywhere; }
    .glean-highlights__related-empty { display: flex; align-items: center; gap: var(--glean-space-2); color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); }
    .glean-highlights__related-empty .glean-empty__art { flex: 0 0 32px; width: 32px; height: 32px; }
    .glean-highlights__related-error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--glean-space-2); padding: var(--glean-space-2); border: 1px solid var(--b3-theme-error); border-radius: var(--glean-radius-md); }
    .glean-highlights__related-error p { flex: 1 1 220px; margin: 0; color: var(--b3-theme-error); font-size: var(--glean-text-sm); overflow-wrap: anywhere; }

    .glean-highlights__head {
        gap: 16px;
        padding: 0;
        flex-wrap: wrap;
    }

    .glean-highlights__title {
        font-size: 26px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: 0;
    }

    .glean-highlights__subtitle {
        margin-top: 8px;
        font-size: 13px;
        line-height: 1.7;
    }

    .glean-highlights__tools--scope {
        box-sizing: border-box;
        min-width: 0;
        max-width: 100%;
        gap: 4px;
        padding: 4px;
        border: 0;
        border-radius: 12px;
        background: var(--glean-inset-surface);
        box-shadow: none;
    }

    .glean-highlights__tools--scope button {
        min-height: 34px;
        padding: 6px 12px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        font-size: 12px;
    }

    .glean-highlights__tools--scope button[aria-pressed="true"] {
        background: var(--b3-theme-surface);
        color: var(--glean-accent-b);
        box-shadow: none;
    }

    .glean-highlights__filters {
        gap: 12px;
        padding: 16px;
        border-radius: 16px;
        background: var(--b3-theme-surface);
        box-shadow: none;
        align-items: end;
    }

    .glean-highlights__filters label {
        min-width: 0;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
    }

    .glean-highlights input[type="search"],
    .glean-highlights select,
    .glean-highlights button {
        min-height: 36px;
        border-radius: 10px;
        font-size: 13px;
        box-shadow: none;
    }

    .glean-highlights__filters input[type="search"] {
        flex-basis: 240px;
        min-width: 0;
        background: var(--glean-inset-surface);
    }

    .glean-highlights__filters select {
        min-width: 0;
        width: 100%;
        background: var(--glean-inset-surface);
    }

    .glean-highlights__tools--selection {
        padding: 12px 16px;
        border-radius: 12px;
        background: var(--glean-primary-soft);
        box-shadow: none;
    }

    .glean-highlights__selection-count {
        background: transparent;
        font-size: 13px;
    }

    .glean-highlights__items {
        gap: 16px;
    }

    .glean-highlights__item,
    .glean-highlights__preview,
    .glean-highlights__loading-card {
        padding: 20px;
        border: 1px solid var(--glean-border-soft);
        border-radius: 16px;
        background: var(--b3-theme-surface);
        box-shadow: none;
    }

    .glean-highlights__item {
        display: flex;
        flex-direction: column;
        transition: border-color 160ms var(--glean-ease-out), background-color 160ms var(--glean-ease-out);
    }

    .glean-highlights .glean-highlights__item:hover {
        border-color: color-mix(in srgb, var(--glean-accent-b) 32%, var(--glean-border-soft));
        box-shadow: none;
        transform: none;
    }

    .glean-highlights__item::before,
    .glean-highlights__preview::before {
        display: none;
    }

    .glean-highlights__item:has(input:checked) {
        background: var(--glean-selection-surface);
    }

    .glean-highlights__item-head {
        margin-bottom: 12px;
        padding-left: 30px;
        font-size: 12px;
    }

    .glean-highlights__quote span {
        padding: 0;
        font-size: 14px;
        font-weight: 450;
        line-height: 1.8;
    }

    .glean-highlights__quote input {
        margin: 3px 0;
    }

    .glean-highlights__meta {
        margin: 12px 0 0 30px;
        font-size: 12px;
        line-height: 1.65;
    }

    .glean-highlights__tools--card {
        margin-top: auto;
        padding-top: 16px;
        gap: 8px;
    }

    .glean-highlights__item > .glean-highlights__tools--card {
        margin-top: 16px;
    }

    .glean-highlights__preview h3 {
        font-size: 16px;
        line-height: 1.5;
    }

    .glean-highlights__empty {
        min-height: 280px;
        gap: 12px;
    }

    .glean-highlights__empty .glean-empty__title {
        font-size: 19px;
        line-height: 1.5;
    }

    .glean-highlights__empty .glean-empty__hint {
        max-width: 42ch;
        font-size: 13px;
        line-height: 1.8;
    }

    .glean-highlights__status,
    .glean-highlights__error {
        padding: 12px 16px;
        font-size: 13px;
        box-shadow: none;
    }

    @container glean-workbench (min-width: 760px) {
        .glean-highlights__items {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
            align-items: start;
        }

        .glean-highlights__empty {
            width: min(100%, 720px);
            align-self: center;
        }
    }

    @container glean-workbench (max-width: 560px) {
        .glean-highlights {
            padding: 16px;
            gap: 16px;
        }

        .glean-highlights__title {
            font-size: 24px;
        }

        .glean-highlights__tools--scope {
            width: 100%;
        }

        .glean-highlights__tools--scope button {
            flex: 1 1 auto;
        }

        .glean-highlights__filters {
            padding: 16px;
            gap: 12px;
        }

        .glean-highlights__filters input[type="search"] {
            flex: 1 1 100%;
            width: 100%;
        }

        .glean-highlights__item,
        .glean-highlights__preview {
            padding: 16px;
        }

        .glean-highlights input[type="search"],
        .glean-highlights select,
        .glean-highlights button {
            min-height: 44px;
        }

        .glean-highlights__tools--card {
            justify-content: flex-start;
            flex-wrap: wrap;
        }

        .glean-highlights__error {
            flex-wrap: wrap;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .glean-highlights__item {
            transition: none;
        }
    }

    .glean-highlights__article-groups {
        display: grid;
        gap: var(--glean-space-3);
        min-width: 0;
    }

    .glean-highlights__article-group {
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-lg);
        background: var(--b3-theme-surface);
        padding: var(--glean-space-3) var(--glean-space-4);
        box-shadow: var(--glean-shadow-card);
    }

    .glean-highlights__article-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--glean-space-2);
        cursor: pointer;
        font-weight: 600;
        font-size: var(--glean-text-md);
        padding-bottom: var(--glean-space-2);
    }

    .glean-highlights__article-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .glean-highlights__article-site {
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        font-weight: 400;
    }

    .glean-highlights__article-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--glean-space-1-5);
    }

    .glean-highlights__items--grouped {
        margin-top: var(--glean-space-3);
        padding-top: var(--glean-space-3);
        border-top: 1px dashed var(--glean-border-soft);
    }
</style>

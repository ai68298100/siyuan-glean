<script lang="ts">
import { untrack } from "svelte";
import { openMobileFileById, openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { filterHighlights, highlightFacets, pageHighlights, retainHighlightSelection, type HighlightFilter } from "../domain/highlights";
import {
    copyHighlights, exportHighlightsCsv, HighlightExportError, highlightDocumentTitle, listDocHighlights, listLibraryHighlights,
    prepareHighlightExport, saveHighlightDraft, type HighlightExportSession, type HighlightItem, type HighlightSaveReason,
} from "../services/highlights";
import { findRelated } from "../services/enrich-service";
import { makeQuoteCardPreview } from "./flashcard-dialog";
import type { GleanSettings } from "../services/settings";

interface Props { facade: GleanFacade }
let { facade }: Props = $props();
const i18n = $derived(facade.i18n);
const currentDocId = $derived(facade.currentDocId());
let scope = $state<"current" | "library">("current");
let items = $state<HighlightItem[]>([]);
let loading = $state(true);
let loadError = $state("");
let related = $state<Array<{ id: string; title: string }>>([]);
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
let retryAction = $state<"copy" | "csv" | "preview" | "save">("preview");
let generation = 0;
let loadedContext = "";

const facets = $derived(highlightFacets(items));
const filtered = $derived(filterHighlights(items, { search, site, tag, aiTag, sort, direction }));
const visible = $derived(pageHighlights(filtered, page));
const labels = $derived({ title: t(i18n, "highlight.exportTitle"), original: t(i18n, "highlight.original"), source: t(i18n, "highlight.source") });

$effect(() => {
    const targetScope = scope;
    const docId = targetScope === "current" ? currentDocId : "";
    const settings = facade.settings;
    untrack(() => void loadHighlights(targetScope, docId, settings));
    return () => { generation += 1; };
});

async function loadHighlights(targetScope: "current" | "library", docId: string, settings: GleanSettings) {
    const request = ++generation;
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
        const title = targetScope === "current" ? next[0]?.title || await highlightDocumentTitle(docId) : "";
        if (request !== generation) return;
        items = next;
        selected = retainHighlightSelection(next, selected);
        docTitle = title;
        related = [];
        if (targetScope === "current") {
            try {
                const matches = await findRelated(docId, next[0]?.text || docId, [], { plugin: facade.pluginInstance, settings });
                if (request === generation) related = matches;
            } catch {
                if (request === generation) related = [];
            }
        }
    } catch (error) {
        if (request === generation) loadError = `${t(i18n, "highlight.loadFailed")} ${String(error)}`;
    } finally {
        if (request === generation) loading = false;
    }
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

function reasonText(reason: HighlightSaveReason): string {
    const keys: Record<HighlightSaveReason, string> = {
        changed: "highlight.changed", readFailed: "highlight.readFailed", empty: "highlight.emptySelection",
        invalid: "highlight.invalidSelection", busy: "panel.loading", createUnknown: "highlight.createUnknown", markFailed: "highlight.markFailed",
    };
    return t(i18n, keys[reason]);
}

async function runExport(action: "copy" | "csv" | "preview") {
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
        } else if (!session) {
            session = await prepareHighlightExport(items, selected, labels);
        }
    } catch (error) {
        exportError = error instanceof HighlightExportError ? reasonText(error.reason) : String(error);
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
        exportError = String(error);
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
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        cardingKey = "";
    }
}

function openDoc(id: string) {
    if (facade.isMobile) openMobileFileById(facade.pluginInstance.app, id);
    else void openTab({ app: facade.pluginInstance.app, doc: { id }, keepCursor: false });
}
</script>

<div class="glean-panel glean-highlights" aria-busy={loading || exportBusy}>
    <div class="glean-highlights__tools">
        <button aria-pressed={scope === "current"} disabled={exportBusy} onclick={() => scope = "current"}>{t(i18n, "highlight.current")}</button>
        <button aria-pressed={scope === "library"} disabled={exportBusy} onclick={() => scope = "library"}>{t(i18n, "highlight.allLibrary")}</button>
        <button disabled={loading || exportBusy} onclick={refresh}>{t(i18n, "action.refresh")}</button>
    </div>
    <div class="glean-highlights__filters">
        <input type="search" bind:value={search} oninput={() => page = 1} placeholder={t(i18n, "highlight.searchPlaceholder")} aria-label={t(i18n, "action.search")} />
        <label>{t(i18n, "library.filterSite")}<select bind:value={site} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.sites as value}<option value={value}>{value}</option>{/each}</select></label>
        <label>{t(i18n, "library.filterTag")}<select bind:value={tag} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.tags as value}<option value={value}>{value}</option>{/each}</select></label>
        <label>{t(i18n, "library.filterAiTag")}<select bind:value={aiTag} onchange={() => page = 1}><option value="">{t(i18n, "action.filterAll")}</option>{#each facets.aiTags as value}<option value={value}>{value}</option>{/each}</select></label>
        <label>{t(i18n, "library.sort")}<select bind:value={sort} onchange={() => page = 1}><option value="id">{t(i18n, "action.sortTime")}</option><option value="title">{t(i18n, "library.sortTitle")}</option><option value="site">{t(i18n, "library.filterSite")}</option></select></label>
        <button class="glean-filter-dir" aria-label={t(i18n, "library.toggleDirection")} title={t(i18n, "library.toggleDirection")} onclick={() => { direction = direction === "asc" ? "desc" : "asc"; page = 1; }}><span class="glean-filter-dir__icon" aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span><span class="glean-filter-dir__label">{t(i18n, "library.toggleDirection")}</span></button>
        <button onclick={clearFilters}>{t(i18n, "library.clearFilters")}</button>
    </div>
    {#if loading}<p role="status">{t(i18n, "panel.loading")}</p>{/if}
    {#if loadError}
        <div class="glean-highlights__error" role="alert"><p>{loadError}</p><button disabled={loading} onclick={refresh}>{t(i18n, "action.retry")}</button></div>
    {/if}
    <div class="glean-highlights__tools">
        <span>{t(i18n, "action.selected")} {selected.length}</span>
        <button disabled={loading || exportBusy || !visible.items.length} onclick={selectPage}>{t(i18n, "highlight.selectPage")}</button>
        <button disabled={exportBusy || !selected.length} onclick={() => selected = []}>{t(i18n, "highlight.clearSelection")}</button>
        <button disabled={loading || exportBusy || !selected.length} onclick={() => void runExport("copy")}>{t(i18n, "highlight.copy")}</button>
        <button disabled={loading || exportBusy || !selected.length} onclick={() => void runExport("csv")}>{t(i18n, "highlight.csv")}</button>
        <button disabled={loading || exportBusy || !selected.length || !!session} onclick={() => void runExport("preview")}>{t(i18n, "highlight.preview")}</button>
    </div>
    {#if exportError}
        <div class="glean-highlights__error" role="alert">
            <p>{exportError}</p>
            {#if !(retryAction === "save" && session?.state === "unknown")}<button disabled={exportBusy || loading} onclick={retryExport}>{t(i18n, "action.retry")}</button>{/if}
        </div>
    {/if}
    {#if exportStatus}<p role="status">{exportStatus}</p>{/if}
    {#if session}
        <section class="glean-highlights__preview" aria-label={t(i18n, "highlight.preview")}>
            <h3>{t(i18n, "highlight.preview")}</h3>
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
        <div class="glean-empty glean-highlights__empty"><div class="glean-empty__title">{t(i18n, "highlight.noDoc")}</div><div class="glean-empty__hint">{t(i18n, "highlight.noDocHint")}</div></div>
    {:else if !loading && !loadError && !visible.items.length}
        <div class="glean-empty glean-highlights__empty"><div class="glean-empty__title">{t(i18n, "highlight.empty")}</div><div class="glean-empty__hint">{t(i18n, "highlight.emptyHint")}</div></div>
    {/if}
    <div class="glean-highlights__items">
        {#each visible.items as item (item.id)}
            <article class="glean-highlights__item">
                <label class="glean-highlights__quote"><input type="checkbox" checked={selected.includes(item.id)} disabled={exportBusy} onchange={() => toggle(item.id)} aria-label={item.text} /><span>{item.text}</span></label>
                <p class="glean-highlights__meta">{item.title || t(i18n, "panel.untitled")} {item.site ? ` · ${item.site}` : ""}</p>
                {#if item.tags.length}<p class="glean-highlights__meta">{t(i18n, "library.filterTag")}: {item.tags.join(", ")}</p>{/if}
                {#if item.aiTags.length}<p class="glean-highlights__meta">{t(i18n, "library.filterAiTag")}: {item.aiTags.join(", ")}</p>{/if}
                <div class="glean-highlights__tools">
                    <span>{t(i18n, "highlight.quoteTag")}</span>
                    <button onclick={() => openDoc(item.id)}>{t(i18n, "highlight.original")}</button>
                    <button onclick={() => openDoc(item.rootId)}>{t(i18n, "action.openDoc")}</button>
                    {#if scope === "current"}<button disabled={!!cardingKey} onclick={() => void card(item)}>🎴 {t(i18n, "flashcard.make")}</button>{/if}
                </div>
            </article>
        {/each}
    </div>
    <nav class="glean-highlights__tools" aria-label={t(i18n, "highlight.pageInfo", { page: visible.page, pages: visible.pages, n: visible.total })}>
        <button disabled={visible.page <= 1} onclick={() => page = visible.page - 1}>{t(i18n, "highlight.previousPage")}</button>
        <span>{t(i18n, "highlight.pageInfo", { page: visible.page, pages: visible.pages, n: visible.total })}</span>
        <button disabled={visible.page >= visible.pages} onclick={() => page = visible.page + 1}>{t(i18n, "highlight.nextPage")}</button>
    </nav>
    {#if scope === "current" && related.length}
        <div class="glean-sect">✨ {t(i18n, "ai.relatedTitle")}</div>
        {#each related as item (item.id)}<button class="glean-rel" onclick={() => openDoc(item.id)}><span class="glean-rel__t">{item.title}</span><span class="glean-rel__go">→</span></button>{/each}
        <div class="glean-highlights__meta">AI · {t(i18n, "ai.actionsPreview")}</div>
    {/if}
</div>

<style>
.glean-highlights { display: flex; flex-direction: column; gap: 12px; color: var(--b3-theme-on-background); }
.glean-highlights__items { display: flex; flex-direction: column; gap: 12px; }
.glean-highlights__tools, .glean-highlights__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.glean-highlights__filters label { display: flex; flex-direction: column; gap: 4px; max-width: 100%; flex: 1 1 110px; }
.glean-highlights button, .glean-highlights select, .glean-highlights input[type="search"] { min-height: 44px; box-sizing: border-box; border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); padding: 8px 10px; font: inherit; max-width: 100%; }
.glean-highlights button { min-width: 44px; cursor: pointer; white-space: normal; overflow-wrap: anywhere; }
.glean-highlights button[aria-pressed="true"] { background: var(--b3-theme-primary); color: var(--b3-theme-on-primary); }
.glean-highlights button:disabled { opacity: .55; cursor: default; }
.glean-highlights input[type="search"] { flex: 1 1 100%; width: 100%; }
.glean-highlights button:focus-visible, .glean-highlights input:focus-visible, .glean-highlights select:focus-visible, .glean-highlights pre:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
.glean-highlights__item, .glean-highlights__preview { border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 12px; background: var(--b3-theme-surface); }
.glean-highlights__quote { display: flex; gap: 10px; align-items: flex-start; min-height: 44px; cursor: pointer; }
.glean-highlights__quote input { flex: 0 0 auto; width: 20px; height: 20px; margin: 12px 0; accent-color: var(--b3-theme-primary); }
.glean-highlights__quote span { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; padding: 8px 0; }
.glean-highlights__meta { color: var(--b3-theme-on-surface-light); overflow-wrap: anywhere; font-size: 12px; margin: 6px 0; }
.glean-highlights__error { border: 1px solid var(--b3-theme-error); border-radius: 6px; padding: 8px; overflow-wrap: anywhere; }
.glean-highlights__preview p { overflow-wrap: anywhere; }
.glean-highlights__preview pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto; background: var(--b3-theme-background); padding: 12px; font: inherit; }
@media (max-width: 480px) { .glean-highlights__tools button { flex: 1 1 120px; } .glean-highlights__filters label { flex-basis: 45%; min-width: 0; } }
@media (prefers-contrast: more) { .glean-highlights__item, .glean-highlights__preview, .glean-highlights button { border-width: 2px; } }
@container glean-workbench (min-width: 760px) {
    .glean-highlights__items { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); align-items: start; }
    .glean-highlights__empty { width: min(100%, 720px); align-self: center; }
}
</style>

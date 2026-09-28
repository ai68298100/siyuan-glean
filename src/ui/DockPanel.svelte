<script lang="ts">
/** 读库 Dock 面板 v2（T-1104/T-1201/T-1202）：库 / 统计 / 高亮 三视图，玻璃质感胶囊导航。 */
import { openTab } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { ClipStatus } from "../domain/schema";
import { batchSetStatus, captureClip, reconcileIndex } from "../services/clip-store";
import type { ClipIndexEntry, CandidateEntry, GleanIndex } from "../services/index-store";
import StatsView from "./StatsView.svelte";
import HighlightView from "./HighlightView.svelte";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

type PanelView = "library" | "stats" | "highlights";
let view = $state<PanelView>("library");
let loading = $state(true);
let index = $state<GleanIndex>({ version: 1, updatedAt: "", clips: {}, candidates: {} });
let activeQueue = $state<ClipStatus>("inbox");
let keyword = $state("");
let sortBy = $state<"time" | "words" | "priority">("time");
let selection = $state<ReadonlySet<string>>(new Set());
let rootEl = $state<HTMLElement | null>(null);

type QueueKey = ClipStatus;
const queues: QueueKey[] = ["inbox", "later", "reading", "done", "archived"];
const views: { key: PanelView; labelKey: string }[] = [
    { key: "library", labelKey: "view.library" },
    { key: "stats", labelKey: "view.stats" },
    { key: "highlights", labelKey: "view.highlights" },
];

type Row =
    | ({ kind: "candidate" } & CandidateEntry)
    | ({ kind: "clip" } & ClipIndexEntry);

const rows = $derived.by<Row[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const source: Row[] =
        activeQueue === "inbox"
            ? [
                  ...Object.values(index.candidates).map((item) => ({ kind: "candidate" as const, ...item })),
                  ...Object.values(index.clips)
                      .filter((entry) => entry.status === "inbox")
                      .map((entry) => ({ kind: "clip" as const, ...entry })),
              ]
            : Object.values(index.clips)
                  .filter((entry) => entry.status === activeQueue)
                  .map((entry) => ({ kind: "clip" as const, ...entry }));

    const filtered = kw
        ? source.filter((item) =>
              [item.title, item.hpath, "site" in item ? item.site : "", "url" in item ? item.url : ""]
                  .join(" ")
                  .toLowerCase()
                  .includes(kw)
          )
        : source;

    return filtered.sort((a, b) => {
        if (sortBy === "words") return (("words" in b && b.words) || 0) - (("words" in a && a.words) || 0);
        if (sortBy === "priority")
            return (("priority" in b && b.priority) || 3) - (("priority" in a && a.priority) || 3);
        return (b.updated || "") < (a.updated || "") ? 1 : -1;
    });
});

const candidateCount = $derived(Object.keys(index.candidates).length);
const totalClips = $derived(Object.keys(index.clips).length);

function queueCount(key: QueueKey): number {
    if (key === "inbox") return candidateCount + Object.values(index.clips).filter((entry) => entry.status === "inbox").length;
    return Object.values(index.clips).filter((entry) => entry.status === key).length;
}

function queueLabel(key: QueueKey): string {
    return t(i18n, `status.${key}`);
}

function statusDotClass(status: string): string {
    return `glean-dot glean-dot--${status}`;
}

function staleDays(time: string): number | null {
    if (!/^\d{14}$/.test(time)) return null;
    const t = new Date(Number(time.slice(0, 4)), Number(time.slice(4, 6)) - 1, Number(time.slice(6, 8))).getTime();
    const days = Math.floor((Date.now() - t) / 86_400_000);
    return days >= 14 ? days : null;
}

async function reload() {
    loading = true;
    try {
        index = await reconcileIndex(facade.pluginInstance, facade.settings);
    } catch {
        index = { version: 1, updatedAt: "", clips: {}, candidates: {} };
    } finally {
        loading = false;
    }
}

$effect(() => {
    void reload();
});

// 插件壳广播的数据变更（迁移完成、右键收录等）触发面板对账
$effect(() => {
    const el = rootEl;
    if (!el) return;
    const handler = () => void reload();
    el.addEventListener("glean:data-changed", handler);
    return () => el.removeEventListener("glean:data-changed", handler);
});

async function capture(entry: CandidateEntry) {
    await captureClip(facade.pluginInstance, entry.id, {});
    await reload();
}

async function captureAll() {
    for (const entry of Object.values(index.candidates)) {
        try {
            await captureClip(facade.pluginInstance, entry.id, {});
        } catch {
            /* 单篇失败继续 */
        }
    }
    await reload();
}

async function setStatus(entry: ClipIndexEntry, status: ClipStatus) {
    await batchSetStatus(facade.pluginInstance, [entry.id], status);
    await reload();
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
    await batchSetStatus(facade.pluginInstance, [...selection], status);
    selection = new Set();
    await reload();
}

function openDoc(docId: string) {
    void openTab({ app: facade.pluginInstance.app, doc: { id: docId }, keepCursor: false });
}

function metaLine(entry: Row): string {
    const parts: string[] = [];
    if ("minutes" in entry && entry.minutes > 0) parts.push(t(i18n, "panel.minutes", { n: entry.minutes }));
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
                <button class="glean-icon-btn" title={t(i18n, "panel.migrate")} onclick={() => facade.openMigrate()}>
                    <svg><use href="#iconGleanWheat" /></svg>
                </button>
                <button class="glean-icon-btn" title={t(i18n, "panel.settings")} onclick={() => facade.openSettings()}>
                    <svg><use href="#iconGleanGear" /></svg>
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
            <div class="glean-search">
                <svg class="glean-search__icon" viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2a1 1 0 0 1-1.4 1.4l-4.2-4.2A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
                <input
                    type="text"
                    placeholder={t(i18n, "panel.searchPlaceholder")}
                    bind:value={keyword}
                />
            </div>
        {/if}
    </header>

    {#if view === "library"}
        <nav class="glean-queues">
            {#each queues as queue (queue)}
                <button
                    class="glean-q"
                    class:glean-q--on={activeQueue === queue}
                    onclick={() => (activeQueue = queue)}
                >
                    {queueLabel(queue)}
                    <span class="glean-q__n">{queueCount(queue)}</span>
                </button>
            {/each}
        </nav>

        {#if loading}
            <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
        {:else}
            <div class="glean-list">
                {#if candidateCount > 0 && activeQueue === "inbox"}
                    <div class="glean-candidates">
                        <span>📥</span>
                        <span style="flex:1">{t(i18n, "panel.candidatesDetected", { n: candidateCount })}</span>
                        <button class="glean-cap-btn" onclick={() => void captureAll()}>
                            {t(i18n, "action.captureAll")}
                        </button>
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
                    </div>
                {:else}
                    {#each rows as entry (entry.id)}
                        <article
                            class="glean-card"
                            class:glean-card--candidate={entry.kind === "candidate"}
                            class:glean-card--selected={selection.has(entry.id)}
                        >
                            <div class="glean-card__body" onclick={() => openDoc(entry.id)} role="button" tabindex="0">
                                <div class="glean-card__title">{entry.title || t(i18n, "panel.untitled")}</div>
                                <div class="glean-card__meta">
                                    {#if entry.kind === "clip"}
                                        <span class={statusDotClass(entry.status)}></span>
                                    {/if}
                                    {#if entry.kind === "clip" && entry.site}
                                        <span class="glean-card__site">{entry.site}</span>
                                    {:else if entry.kind === "candidate"}
                                        <span>{entry.hpath}</span>
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
                                <button class="glean-card__capture" onclick={(e) => void capture(entry).finally(() => e.stopPropagation())}>
                                    {t(i18n, "action.addToInbox")}
                                </button>
                            {:else}
                                <div class="glean-card__ops">
                                    {#if entry.status === "inbox" || entry.status === "later"}
                                        <button
                                            class="glean-op-btn"
                                            title={t(i18n, "action.startReading")}
                                            onclick={(e) => { e.stopPropagation(); void setStatus(entry, "reading"); }}
                                        >▶</button>
                                    {:else if entry.status === "reading"}
                                        <button
                                            class="glean-op-btn"
                                            title={t(i18n, "action.markDone")}
                                            onclick={(e) => { e.stopPropagation(); void setStatus(entry, "done"); }}
                                        >✓</button>
                                    {/if}
                                    {#if entry.status !== "archived"}
                                        <button
                                            class="glean-op-btn"
                                            title={t(i18n, "action.archive")}
                                            onclick={(e) => { e.stopPropagation(); void setStatus(entry, "archived"); }}
                                        >⤓</button>
                                    {:else}
                                        <button
                                            class="glean-op-btn"
                                            title={t(i18n, "action.restore")}
                                            onclick={(e) => { e.stopPropagation(); void setStatus(entry, "later"); }}
                                        >↩</button>
                                    {/if}
                                </div>
                            {/if}
                            <label class="glean-card__check" onclick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={selection.has(entry.id)}
                                    onchange={(e) => toggleSelect(entry.id, e)}
                                />
                            </label>
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
    {:else if view === "stats"}
        <StatsView {facade} {index} onCaptured={() => void reload()} />
    {:else}
        <HighlightView {facade} />
    {/if}
</div>

<style>
    /* 样式集中在 src/index.scss（设计系统），组件内不再重复 */
</style>

<script lang="ts">
/** 读库 Dock 面板 v1（T-1104）：五队列 + 待收录区 + 筛选排序 + 搜索 + 批量操作。 */
import { openTab } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { ClipStatus } from "../domain/schema";
import { batchSetStatus, captureClip, reconcileIndex } from "../services/clip-store";
import type { ClipIndexEntry, CandidateEntry, GleanIndex } from "../services/index-store";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

let loading = $state(true);
let index = $state<GleanIndex>({ version: 1, updatedAt: "", clips: {}, candidates: {} });
let activeQueue = $state<ClipStatus | "inbox">("inbox");
let keyword = $state("");
let sortBy = $state<"time" | "words" | "priority">("time");
let selection = $state<ReadonlySet<string>>(new Set());
let rootEl = $state<HTMLElement | null>(null);

type QueueKey = ClipStatus | "inbox";
const queues: QueueKey[] = ["inbox", "later", "reading", "done", "archived"];

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

function queueCount(key: QueueKey): number {
    if (key === "inbox") {
        return (
            Object.keys(index.candidates).length +
            Object.values(index.clips).filter((entry) => entry.status === "inbox").length
        );
    }
    return Object.values(index.clips).filter((entry) => entry.status === key).length;
}

function queueLabel(key: QueueKey): string {
    if (key === "inbox") return t(i18n, "queue.inbox");
    return t(i18n, `status.${key}`);
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

function toggleSelect(id: string) {
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
    if ("site" in entry && entry.site) parts.push(entry.site);
    else if ("hpath" in entry && entry.kind === "candidate") parts.push(entry.hpath);
    if ("minutes" in entry && entry.minutes > 0) parts.push(t(i18n, "panel.minutes", { n: entry.minutes }));
    return parts.join(" · ");
}
</script>

<div class="glean-panel" bind:this={rootEl}>
    <header class="glean-panel__header">
        <div class="glean-panel__brand">{t(i18n, "pluginName")}</div>
        <div class="glean-panel__actions">
            <button class="glean-icon-btn" title={t(i18n, "panel.migrate")} onclick={() => facade.openMigrate()}>
                <svg><use href="#iconGleanWheat" /></svg>
            </button>
            <button class="glean-icon-btn" title={t(i18n, "panel.settings")} onclick={() => facade.openSettings()}>
                <svg><use href="#iconGleanGear" /></svg>
            </button>
            <button class="glean-icon-btn" title={t(i18n, "action.refresh")} onclick={() => void reload()}>
                <svg><use href="#iconGleanRefresh" /></svg>
            </button>
        </div>
    </header>

    <div class="glean-panel__search">
        <input
            class="b3-text-field glean-search"
            type="text"
            placeholder={t(i18n, "panel.searchPlaceholder")}
            bind:value={keyword}
        />
    </div>

    <nav class="glean-queues">
        {#each queues as queue (queue)}
            <button
                class="glean-queues__item"
                class:glean-queues__item--active={activeQueue === queue}
                onclick={() => (activeQueue = queue)}
            >
                {queueLabel(queue)}
                <span class="glean-queues__count">{queueCount(queue)}</span>
            </button>
        {/each}
    </nav>

    {#if loading}
        <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
    {:else}
        <div class="glean-list">
            {#if activeQueue === "inbox" && Object.keys(index.candidates).length > 0}
                <div class="glean-section-label">
                    <span>{t(i18n, "migrate.candidatesLabel")} · {Object.keys(index.candidates).length}</span>
                    <button class="b3-button b3-button--small" onclick={() => void captureAll()}>
                        {t(i18n, "action.captureAll")}
                    </button>
                </div>
            {/if}
            {#if rows.length === 0}
                <div class="glean-empty">
                    <div class="glean-empty__title">{t(i18n, "panel.empty")}</div>
                    <div class="glean-empty__hint">
                        {facade.settings.anchorNotebooks.length === 0
                            ? t(i18n, "panel.noAnchorHint")
                            : t(i18n, "panel.emptyHint")}
                    </div>
                </div>
            {:else}
                {#each rows as entry (entry.id)}
                    <article class="glean-card" class:glean-card--candidate={entry.kind === "candidate"} class:glean-card--selected={selection.has(entry.id)}>
                        <label class="glean-card__check">
                            <input
                                type="checkbox"
                                checked={selection.has(entry.id)}
                                onchange={() => toggleSelect(entry.id)}
                            />
                        </label>
                        <div class="glean-card__body" onclick={() => openDoc(entry.id)} role="button" tabindex="0">
                            <div class="glean-card__title">{entry.title || t(i18n, "panel.untitled")}</div>
                            <div class="glean-card__meta">{metaLine(entry)}</div>
                        </div>
                        <div class="glean-card__ops">
                            {#if entry.kind === "candidate"}
                                <button class="b3-button b3-button--small" onclick={() => void capture(entry)}>
                                    {t(i18n, "action.addToInbox")}
                                </button>
                            {:else}
                                {#if entry.status === "inbox" || entry.status === "later"}
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "action.startReading")}
                                        onclick={() => void setStatus(entry, "reading")}
                                    >▶</button>
                                {:else if entry.status === "reading"}
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "action.markDone")}
                                        onclick={() => void setStatus(entry, "done")}
                                    >✓</button>
                                {/if}
                                {#if entry.status !== "archived"}
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "action.archive")}
                                        onclick={() => void setStatus(entry, "archived")}
                                    >⤓</button>
                                {:else}
                                    <button
                                        class="glean-op-btn"
                                        title={t(i18n, "action.restore")}
                                        onclick={() => void setStatus(entry, "later")}
                                    >↩</button>
                                {/if}
                            {/if}
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    {/if}

    {#if selection.size > 0}
        <footer class="glean-batchbar">
            <span class="glean-batchbar__count">{t(i18n, "action.selected")} {selection.size}</span>
            <div class="glean-batchbar__ops">
                <button class="b3-button b3-button--small" onclick={() => void batchApply("reading")}>{t(i18n, "status.reading")}</button>
                <button class="b3-button b3-button--small" onclick={() => void batchApply("done")}>{t(i18n, "status.done")}</button>
                <button class="b3-button b3-button--small" onclick={() => void batchApply("archived")}>{t(i18n, "action.batchArchive")}</button>
                <button class="b3-button b3-button--small" onclick={() => (selection = new Set())}>✕</button>
            </div>
        </footer>
    {/if}
</div>

<style>
    /* 面板样式在 src/index.scss 全局维护（glean- 前缀），此处仅占位 */
</style>

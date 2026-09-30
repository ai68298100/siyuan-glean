<script lang="ts">
/** 全库摘录墙（T-1750）：引述块聚合视图 + 站点/标签/AI 标签/关键词筛选 + 跳回 + 批量导出（T-1752）。
 * 只读投影：引述块来自 highlights.listLibraryQuotes，root 元数据从派生索引与 root 标题查询映射，
 * 筛选不写任何属性（domain/quotes 纯函数）。 */
import { onMount } from "svelte";
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { GleanIndex } from "../services/index-store";
import { listLibraryQuotes, listQuoteRoots } from "../services/highlights";
import { exportQuotesToDoc } from "../services/excerpt-service";
import { filterQuotes, quoteFacets, type QuoteEntry, type QuoteFilter } from "../domain/quotes";

interface Props {
    facade: GleanFacade;
    index: GleanIndex;
}

let { facade, index }: Props = $props();

const i18n = $derived(facade.i18n);

let entries = $state<QuoteEntry[]>([]);
let loading = $state(true);
let loadFailed = $state(false);
let exporting = $state(false);
/** 单页上限；超出时提示仅展示最近 N 条（地基分页已备好，翻页随视图走查再开）。 */
const PAGE_SIZE = 500;
let truncated = $state(false);

let filter = $state<QuoteFilter>({});

const facets = $derived(quoteFacets(entries));
const filtered = $derived(filterQuotes(entries, filter));

onMount(() => {
    void loadQuotes();
});

async function loadQuotes() {
    loading = true;
    loadFailed = false;
    try {
        const rows = await listLibraryQuotes(PAGE_SIZE + 1, 0);
        truncated = rows.length > PAGE_SIZE;
        const page = rows.slice(0, PAGE_SIZE);
        const rootTitles = await listQuoteRoots(page.map((row) => row.rootId));
        entries = page.map((row) => {
            const clip = index.clips[row.rootId];
            return {
                id: row.id,
                rootId: row.rootId,
                text: row.text,
                title: clip?.title || rootTitles.get(row.rootId) || "",
                site: clip?.site || "",
                tags: clip?.tags ?? [],
                aiTags: clip?.aiTags ?? [],
            };
        });
    } catch (error) {
        console.warn("[glean] 摘录墙加载失败:", error);
        loadFailed = true;
    } finally {
        loading = false;
    }
}

function toggleFacet(key: "site" | "tag" | "aiTag", value: string): void {
    filter = { ...filter, [key]: filter[key] === value ? undefined : value };
}

function activeChips(): Array<{ key: "site" | "tag" | "aiTag" | "keyword"; label: string }> {
    const chips: Array<{ key: "site" | "tag" | "aiTag" | "keyword"; label: string }> = [];
    if (filter.site) chips.push({ key: "site", label: filter.site });
    if (filter.tag) chips.push({ key: "tag", label: `#${filter.tag}` });
    if (filter.aiTag) chips.push({ key: "aiTag", label: `✨${filter.aiTag}` });
    if (filter.keyword) chips.push({ key: "keyword", label: `“${filter.keyword}”` });
    return chips;
}

function clearFilter(): void {
    filter = {};
}

function openRoot(quoteId: string): void {
    void openTab({ app: facade.pluginInstance.app, doc: { id: quoteId }, keepCursor: false });
}

async function doExport(): Promise<void> {
    if (filtered.length === 0) return;
    const notebookId = facade.settings.anchorNotebooks[0];
    if (!notebookId) {
        showMessage(t(i18n, "panel.noAnchorHint"), 4000);
        return;
    }
    exporting = true;
    try {
        await exportQuotesToDoc(filtered, notebookId);
        showMessage(t(i18n, "quotes.exportDone", { n: filtered.length }), 3500);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        exporting = false;
    }
}
</script>

<div class="glean-panel">
    {#if loading}
        <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
    {:else if loadFailed}
        <div class="glean-empty">
            <div class="glean-empty__title">{t(i18n, "quotes.loadFailed")}</div>
            <button class="glean-btn glean-btn--ghost" onclick={() => void loadQuotes()}>{t(i18n, "action.retry")}</button>
        </div>
    {:else if entries.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art">❝</div>
            <div class="glean-empty__title">{t(i18n, "quotes.empty")}</div>
            <div class="glean-empty__hint">{t(i18n, "quotes.emptyHint")}</div>
        </div>
    {:else}
        <input
            class="glean-mini-input glean-quotes__search"
            type="text"
            placeholder={t(i18n, "quotes.search")}
            aria-label={t(i18n, "quotes.search")}
            bind:value={filter.keyword}
        />
        {#if facets.sites.length > 0 || facets.tags.length > 0 || facets.aiTags.length > 0}
            <div class="glean-quotes__facets">
                {#each facets.sites.slice(0, 8) as site (site.name)}
                    <button
                        class="glean-tag glean-quotes__facet"
                        class:glean-quotes__facet--on={filter.site === site.name}
                        onclick={() => toggleFacet("site", site.name)}
                    >{site.name} ×{site.count}</button>
                {/each}
                {#each facets.tags.slice(0, 8) as tag (tag.name)}
                    <button
                        class="glean-tag glean-quotes__facet"
                        class:glean-quotes__facet--on={filter.tag === tag.name}
                        onclick={() => toggleFacet("tag", tag.name)}
                    >#{tag.name} ×{tag.count}</button>
                {/each}
                {#each facets.aiTags.slice(0, 6) as tag (tag.name)}
                    <button
                        class="glean-tag glean-quotes__facet"
                        class:glean-quotes__facet--on={filter.aiTag === tag.name}
                        onclick={() => toggleFacet("aiTag", tag.name)}
                    >✨{tag.name} ×{tag.count}</button>
                {/each}
            </div>
        {/if}
        {#if activeChips().length > 0}
            <div class="glean-quotes__chips">
                {#each activeChips() as chip (chip.key + chip.label)}
                    <button class="glean-quotes__chip" title={t(i18n, "quotes.clearFilter")} onclick={() => clearFilter()}>
                        {chip.label} ×
                    </button>
                {/each}
                <span class="glean-quotes__count">{t(i18n, "quotes.count", { n: filtered.length, total: entries.length })}</span>
            </div>
        {:else}
            <div class="glean-quotes__chips">
                <span class="glean-quotes__count">{t(i18n, "quotes.count", { n: filtered.length, total: entries.length })}</span>
            </div>
        {/if}
        {#if truncated}
            <div class="glean-quotes__truncated">{t(i18n, "quotes.truncated", { n: PAGE_SIZE })}</div>
        {/if}
        <div class="glean-quotes">
            {#each filtered as quote (quote.id)}
                <div class="glean-quote">
                    <div class="glean-quote__text">{quote.text.slice(0, 160)}{quote.text.length > 160 ? "…" : ""}</div>
                    <div class="glean-quote__meta">
                        <button class="glean-quote__src" title={quote.title || quote.rootId} onclick={() => openRoot(quote.id)}>
                            ↩ {quote.title || t(i18n, "panel.untitled")}{quote.site ? ` · ${quote.site}` : ""}
                        </button>
                    </div>
                </div>
            {:else}
                <div class="glean-empty" style="padding:12px">
                    <div class="glean-empty__hint">{t(i18n, "quotes.filterEmpty")}</div>
                    <button class="glean-btn glean-btn--ghost" onclick={clearFilter}>{t(i18n, "quotes.clearFilter")}</button>
                </div>
            {/each}
        </div>
        <button class="glean-primary-btn" disabled={exporting || filtered.length === 0} onclick={() => void doExport()}>
            📤 {exporting ? t(i18n, "panel.loading") : t(i18n, "quotes.export", { n: filtered.length })}
        </button>
    {/if}
</div>

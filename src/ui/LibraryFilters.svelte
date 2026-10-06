<script lang="ts">
    import { t, type I18nBundle } from "../libs/i18n";
    import type { LibraryFacets, LibrarySortKey, LibrarySortDirection } from "../domain/library-view";
    import ActionPopover from "./ActionPopover.svelte";

    interface Props {
        i18n: I18nBundle;
        facets: LibraryFacets;
        site?: string;
        author?: string;
        tag?: string;
        aiTag?: string;
        source?: string;
        timeSource?: string;
        contentType?: string;
        sortBy?: LibrarySortKey;
        direction?: LibrarySortDirection;
        hasFilters: boolean;
        onClear: () => void;
        sourceLabel: (value: string) => string;
        facetLabel: (value: string, kind: "timeSource" | "contentType") => string;
    }
    let { i18n, facets, site = $bindable(""), author = $bindable(""), tag = $bindable(""), aiTag = $bindable(""), source = $bindable(""), timeSource = $bindable(""), contentType = $bindable(""), sortBy = $bindable("time"), direction = $bindable("desc"), hasFilters, onClear, sourceLabel, facetLabel }: Props = $props();
</script>

<div class="glean-filters glean-filters--compact" aria-label={t(i18n, "library.filters")}>
    <select class="b3-select glean-filter" class:glean-filter--active={Boolean(site)} aria-label={t(i18n, "library.filterSite")} bind:value={site}>
        <option value="">{t(i18n, "library.filterSite")}</option>
        {#each facets.sites as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
        {#if site && !facets.sites.some((facet) => facet.value === site)}<option value={site}>{site}</option>{/if}
    </select>
    <select class="b3-select glean-filter" class:glean-filter--active={Boolean(tag)} aria-label={t(i18n, "library.filterTag")} bind:value={tag}>
        <option value="">{t(i18n, "library.filterTag")}</option>
        {#each facets.tags as facet (facet.value)}<option value={facet.value}>#{facet.value} · {facet.count}</option>{/each}
        {#if tag && !facets.tags.some((facet) => facet.value === tag)}<option value={tag}>#{tag}</option>{/if}
    </select>
    <select class="b3-select glean-filter" aria-label={t(i18n, "library.sort")} bind:value={sortBy}>
        <option value="time">{t(i18n, "action.sortTime")}</option>
        <option value="updated">{t(i18n, "library.sortUpdated")}</option>
        <option value="words">{t(i18n, "action.sortWords")}</option>
        <option value="priority">{t(i18n, "action.sortPriority")}</option>
        <option value="rating">{t(i18n, "library.sortRating")}</option>
        <option value="title">{t(i18n, "library.sortTitle")}</option>
    </select>
    <button type="button" class="glean-filter-dir" class:glean-filter-dir--active={direction === "asc"} aria-label={t(i18n, "library.toggleDirection")} aria-pressed={direction === "asc"} title={t(i18n, "library.toggleDirection")} onclick={() => direction = direction === "desc" ? "asc" : "desc"}><span class="glean-filter-dir__icon" aria-hidden="true"><svg class="glean-icon glean-icon--xs"><use href={direction === "desc" ? "#iconGleanArrowDown" : "#iconGleanArrowUp"} /></svg></span><span class="glean-filter-dir__label">{t(i18n, "library.toggleDirection")}</span></button>
    <ActionPopover label={t(i18n, "library.moreFilters")}>
        <label class="glean-action-popover__field">{t(i18n, "library.filterAuthor")}
            <select class="b3-select glean-filter" bind:value={author}>
                <option value="">{t(i18n, "action.filterAll")}</option>
                {#each facets.authors as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
                {#if author && !facets.authors.some((facet) => facet.value === author)}<option value={author}>{author}</option>{/if}
            </select>
        </label>
        <label class="glean-action-popover__field">{t(i18n, "library.filterAiTag")}
            <select class="b3-select glean-filter" bind:value={aiTag}>
                <option value="">{t(i18n, "action.filterAll")}</option>
                {#each facets.aiTags as facet (facet.value)}<option value={facet.value}>✨{facet.value} · {facet.count}</option>{/each}
                {#if aiTag && !facets.aiTags.some((facet) => facet.value === aiTag)}<option value={aiTag}>✨{aiTag}</option>{/if}
            </select>
        </label>
        <label class="glean-action-popover__field">{t(i18n, "library.filterSource")}
            <select class="b3-select glean-filter" bind:value={source}>
                <option value="">{t(i18n, "action.filterAll")}</option>
                {#each facets.sources as facet (facet.value)}<option value={facet.value}>{sourceLabel(facet.value)} · {facet.count}</option>{/each}
                {#if source && !facets.sources.some((facet) => facet.value === source)}<option value={source}>{sourceLabel(source)}</option>{/if}
            </select>
        </label>
        <label class="glean-action-popover__field">{t(i18n, "library.filterTimeSource")}
            <select class="b3-select glean-filter" bind:value={timeSource}>
                <option value="">{t(i18n, "action.filterAll")}</option>
                {#each facets.timeSources as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "timeSource")} · {facet.count}</option>{/each}
                {#if timeSource && !facets.timeSources.some((facet) => facet.value === timeSource)}<option value={timeSource}>{facetLabel(timeSource, "timeSource")}</option>{/if}
            </select>
        </label>
        <label class="glean-action-popover__field">{t(i18n, "library.filterContentType")}
            <select class="b3-select glean-filter" bind:value={contentType}>
                <option value="">{t(i18n, "action.filterAll")}</option>
                {#each facets.contentTypes as facet (facet.value)}<option value={facet.value}>{facetLabel(facet.value, "contentType")} · {facet.count}</option>{/each}
                {#if contentType && !facets.contentTypes.some((facet) => facet.value === contentType)}<option value={contentType}>{facetLabel(contentType, "contentType")}</option>{/if}
            </select>
        </label>
    </ActionPopover>
    {#if hasFilters}<button type="button" class="glean-filter-clear" onclick={onClear}>{t(i18n, "library.clearFilters")}</button>{/if}
</div>

<script lang="ts">
    import { t, type I18nBundle } from "../libs/i18n";
    import type { LibraryFacets, LibrarySortKey, LibrarySortDirection, ReadingTimeTier } from "../domain/library-view";
    import ActionPopover from "./ActionPopover.svelte";
    import { displayTagAlias, type TagAlias } from "../domain/ui-prefs";
    import { countSecondaryActiveFilters } from "../domain/library-filter-chips";

    interface Props {
        i18n: I18nBundle;
        facets: LibraryFacets;
        site?: string;
        author?: string;
        tag?: string;
        tagAliases?: TagAlias[];
        onManageTagAliases?: () => void;
        aiTag?: string;
        source?: string;
        timeSource?: string;
        contentType?: string;
        readingTimeTier?: ReadingTimeTier;
        sortBy?: LibrarySortKey;
        direction?: LibrarySortDirection;
        hasFilters: boolean;
        onClear: () => void;
        sourceLabel: (value: string) => string;
        facetLabel: (value: string, kind: "timeSource" | "contentType") => string;
    }
    let { i18n, facets, site = $bindable(""), author = $bindable(""), tag = $bindable(""), tagAliases = [], onManageTagAliases, aiTag = $bindable(""), source = $bindable(""), timeSource = $bindable(""), contentType = $bindable(""), readingTimeTier = $bindable("all"), sortBy = $bindable("time"), direction = $bindable("desc"), hasFilters, onClear, sourceLabel, facetLabel }: Props = $props();
    const secondaryActiveCount = $derived(countSecondaryActiveFilters({ author, aiTag, src: source, timeSource, contentType, readingTimeTier }));
    const popoverLabel = $derived(secondaryActiveCount > 0 ? `${t(i18n, "library.moreFilters")} (${secondaryActiveCount})` : t(i18n, "library.moreFilters"));

    function clearSecondaryFilters(): void {
        author = "";
        aiTag = "";
        source = "";
        timeSource = "";
        contentType = "";
        readingTimeTier = "all";
    }
</script>

<div class="glean-filters glean-filters--compact" role="group" aria-label={t(i18n, "library.filters")}>
    <select class="b3-select glean-filter" class:glean-filter--active={Boolean(site)} aria-label={t(i18n, "library.filterSite")} bind:value={site}>
        <option value="">{t(i18n, "library.filterSite")}</option>
        {#each facets.sites as facet (facet.value)}<option value={facet.value}>{facet.value} · {facet.count}</option>{/each}
        {#if site && !facets.sites.some((facet) => facet.value === site)}<option value={site}>{site}</option>{/if}
    </select>
    <select class="b3-select glean-filter" class:glean-filter--active={Boolean(tag)} aria-label={t(i18n, "library.filterTag")} bind:value={tag}>
        <option value="">{t(i18n, "library.filterTag")}</option>
        {#each facets.tags as facet (facet.value)}<option value={facet.value}>#{displayTagAlias(tagAliases, facet.value)} · {facet.count}</option>{/each}
        {#if tag && !facets.tags.some((facet) => facet.value === tag)}<option value={tag}>#{displayTagAlias(tagAliases, tag)}</option>{/if}
    </select>
    <select class="b3-select glean-filter" aria-label={t(i18n, "library.sort")} bind:value={sortBy}>
        <option value="time">{t(i18n, "action.sortTime")}</option>
        <option value="updated">{t(i18n, "library.sortUpdated")}</option>
        <option value="words">{t(i18n, "action.sortWords")}</option>
        <option value="priority">{t(i18n, "action.sortPriority")}</option>
        <option value="rating">{t(i18n, "library.sortRating")}</option>
        <option value="title">{t(i18n, "library.sortTitle")}</option>
    </select>
    <button type="button" class="glean-filter-dir" class:glean-filter-dir--active={direction === "asc"} aria-label={`${t(i18n, "library.toggleDirection")}: ${t(i18n, direction === "asc" ? "library.directionAscending" : "library.directionDescending")}`} aria-pressed={direction === "asc"} title={`${t(i18n, "library.toggleDirection")}: ${t(i18n, direction === "asc" ? "library.directionAscending" : "library.directionDescending")}`} onclick={() => direction = direction === "desc" ? "asc" : "desc"}><span class="glean-filter-dir__icon" aria-hidden="true"><svg class="glean-icon glean-icon--xs"><use href={direction === "desc" ? "#iconGleanArrowDown" : "#iconGleanArrowUp"} /></svg></span><span class="glean-filter-dir__label">{t(i18n, "library.toggleDirection")}</span></button>
    <ActionPopover label={popoverLabel}>
        {#if onManageTagAliases}
            <button type="button" class="glean-btn glean-btn--ghost" onclick={onManageTagAliases}>{t(i18n, "library.tagAliasManage")}</button>
        {/if}
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
        <label class="glean-action-popover__field">{t(i18n, "library.filterReadingTime")}
            <select class="b3-select glean-filter" bind:value={readingTimeTier}>
                <option value="all">{t(i18n, "action.filterAll")}</option>
                <option value="short">{t(i18n, "library.readingTimeShort")}</option>
                <option value="medium">{t(i18n, "library.readingTimeMedium")}</option>
                <option value="long">{t(i18n, "library.readingTimeLong")}</option>
            </select>
        </label>
        {#if secondaryActiveCount > 0}
            <button type="button" class="glean-btn glean-btn--ghost" onclick={clearSecondaryFilters}>
                {t(i18n, "library.clearMoreFilters")}
            </button>
        {/if}
    </ActionPopover>
    {#if hasFilters}<button type="button" class="glean-filter-clear" onclick={onClear}>{t(i18n, "library.clearFilters")}</button>{/if}
</div>

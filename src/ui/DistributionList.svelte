<script lang="ts">
    import type { Snippet } from "svelte";
    import { t, type I18nBundle } from "../libs/i18n";
    import type { NameCount } from "../domain/stats";
    import { summarizeDistribution } from "../domain/distribution";

    interface Props { counts: readonly NameCount[]; i18n: I18nBundle; detailsFor?: Snippet<[NameCount]> }
    let { counts, i18n, detailsFor }: Props = $props();
    const grouped = $derived(summarizeDistribution(counts));
</script>

{#snippet row(group: NameCount)}
    <li class="glean-distribution__item">
        <div class="glean-distribution__count"><span>{group.name}</span><strong>{group.count}</strong></div>
        {#if detailsFor}{@render detailsFor(group)}{/if}
    </li>
{/snippet}

<div class="glean-distribution">
    <ul class="glean-distribution__items">
        {#each grouped.top as group (group.name)}{@render row(group)}{:else}<li>{t(i18n, "distribution.empty")}</li>{/each}
    </ul>
    {#if grouped.others.length > 0}
        <details class="glean-distribution__other">
            <summary>{t(i18n, "distribution.other", { groups: grouped.others.length, n: grouped.otherCount })}</summary>
            <ul class="glean-distribution__items">{#each grouped.others as group (group.name)}{@render row(group)}{/each}</ul>
        </details>
    {/if}
</div>

<style>
    .glean-distribution { min-width: 0; }
    .glean-distribution__items { display: flex; flex-wrap: wrap; align-items: start; gap: 8px; padding: 0; list-style: none; }
    .glean-distribution__item { min-width: 0; max-width: 100%; padding: 6px 8px; border: 1px solid var(--b3-border-color); border-radius: 4px; overflow-wrap: anywhere; }
    .glean-distribution__count { display: flex; justify-content: space-between; gap: 8px; }
    .glean-distribution__other summary { cursor: pointer; padding: 6px 0; }
    .glean-distribution__other summary:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
</style>

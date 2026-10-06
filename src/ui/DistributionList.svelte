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
    .glean-distribution__item { min-width: 0; max-width: 100%; min-height: 32px; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-inset-surface); overflow-wrap: anywhere; transition: transform 160ms var(--glean-ease-out), border-color 160ms var(--glean-ease-out), background-color 160ms ease; }
    .glean-distribution__item:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--b3-theme-primary) 26%, var(--glean-border-soft)); background: var(--glean-primary-soft); }
    .glean-distribution__count { display: flex; justify-content: space-between; gap: 8px; }
    .glean-distribution__count strong { font-variant-numeric: tabular-nums; color: var(--b3-theme-on-background); }
    .glean-distribution__other summary { cursor: pointer; padding: 6px 0; color: var(--b3-theme-on-surface); }
    .glean-distribution__other summary:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
</style>

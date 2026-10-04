<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage, type Plugin } from "siyuan";
    import { t, type I18nBundle } from "../libs/i18n";
    import { projectRailFacets, railFacetSelected, type RailGroupKey, type RailGroupPrefs } from "../domain/library-rail";
    import type { LibraryFacet } from "../domain/library-view";
    import { loadUiPrefs, saveUiPrefs } from "../services/prefs";

    interface Props {
        plugin: Plugin;
        i18n: I18nBundle;
        group: RailGroupKey;
        label: string;
        hint?: string;
        prefix?: string;
        items: LibraryFacet[];
        selected: string;
        onSelect: (value: string) => void;
        itemLabel?: (value: string) => string;
        dotClass?: (value: string) => string;
    }
    let { plugin, i18n, group, label, hint = "", prefix = "", items, selected, onSelect, itemLabel = (value) => value, dotClass }: Props = $props();
    let prefs = $state<RailGroupPrefs>({ collapsed: false, expanded: false });
    let query = $state("");
    let busy = $state(false);
    let touched = false;
    const effectiveQuery = $derived(items.length > 15 ? query : "");
    const visible = $derived(projectRailFacets(items, group === "queues" || prefs.expanded, effectiveQuery, selected));
    const selectedMissing = $derived(Boolean(selected && !items.some((item) => railFacetSelected(item.value, selected))));

    onMount(() => {
        let mounted = true;
        void loadUiPrefs(plugin).then((value) => {
            if (mounted && !touched) prefs = value.libraryRailGroups[group];
        });
        return () => { mounted = false; };
    });

    async function toggle(key: keyof RailGroupPrefs): Promise<void> {
        if (busy) return;
        touched = true;
        const next = { ...prefs, [key]: !prefs[key] };
        prefs = next;
        busy = true;
        try {
            await saveUiPrefs(plugin, { libraryRailGroups: { [group]: next } });
        } catch {
            showMessage(t(i18n, "settings.saveFailed"), 3000);
        } finally {
            busy = false;
        }
    }
</script>

<div class="glean-rail__group">
    <button class="glean-rail__title glean-rail__toggle" title={hint} disabled={busy} aria-expanded={!prefs.collapsed} onclick={() => void toggle("collapsed")}>
        <span aria-hidden="true">{prefs.collapsed ? "▸" : "▾"}</span>
        <span>{label}</span><span class="glean-rail__group-count">{t(i18n, "rail.itemCount", { n: items.length })}</span>
    </button>
    {#if selected && group !== "queues" && (prefs.collapsed || selectedMissing)}
        <button class="glean-rail__item glean-rail__item--on" title={t(i18n, "rail.clearSelected", { value: selected })} onclick={() => onSelect(selected)}>
            <span class="glean-rail__value">{prefix}{itemLabel(selected)}</span><span aria-hidden="true">×</span>
        </button>
    {/if}
    {#if !prefs.collapsed}
        {#if items.length > 15}
            <input class="b3-text-field glean-rail__search" type="search" bind:value={query} aria-label={t(i18n, "rail.searchGroup", { name: label })} placeholder={t(i18n, "rail.searchGroup", { name: label })} />
        {/if}
        {#each visible as item (item.value)}
            <button class="glean-rail__item" class:glean-rail__item--on={railFacetSelected(item.value, selected)} aria-pressed={railFacetSelected(item.value, selected)} title={`${itemLabel(item.value)} (${item.count})`} onclick={() => onSelect(item.value)}>
                {#if dotClass}<span class={dotClass(item.value)}></span>{/if}
                <span class="glean-rail__value">{prefix}{itemLabel(item.value)}</span><span class="glean-rail__n">{item.count}</span>
            </button>
        {/each}
        {#if effectiveQuery.trim() && !items.some((item) => item.value.toLocaleLowerCase().includes(effectiveQuery.trim().toLocaleLowerCase()))}
            <div class="glean-rail__empty">{t(i18n, "rail.noMatch")}</div>
        {/if}
        {#if group !== "queues" && items.length > 8 && !effectiveQuery.trim()}
            <button class="glean-rail__more" disabled={busy} aria-expanded={prefs.expanded} onclick={() => void toggle("expanded")}>
                {t(i18n, prefs.expanded ? "rail.showLess" : "rail.showAll", { n: items.length })}
            </button>
        {/if}
    {/if}
</div>

<script lang="ts">
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { ageDays } from "../domain/resurface";
    import { openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
    import { CONTEXT_BUDGETS, selectReadingContext, type ContextBudget, type ContextReason, type ContextSelectionCandidate } from "../domain/context-selection";
    import type { GleanIndex } from "../services/index-store";

    interface Props {
        facade: GleanFacade;
        index: GleanIndex;
        currentTime: Date;
    }

    let { facade, index, currentTime }: Props = $props();
    const instanceId = $props.id();
    const titleId = `glean-context-selection-title-${instanceId}`;
    const resultId = `glean-context-selection-results-${instanceId}`;
    const i18n = $derived(facade.i18n);

    let budget = $state<ContextBudget>(15);
    let selectedTag = $state("");
    let includeDone = $state(false);
    let includeUnknownMinutes = $state(false);

    const items = $derived.by(() => Object.values(index.clips).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        contentType: item.contentType,
        minutes: item.minutes,
        priority: item.priority,
        waitingDays: ageDays(item.time, currentTime),
        tags: item.tags,
        aiTags: item.aiTags,
        url: item.url,
        internal: item.internal,
    })));

    const userTags = $derived.by(() => {
        const values = new Set<string>();
        for (const item of Object.values(index.clips)) {
            for (const tag of item.tags ?? []) {
                const trimmed = tag.trim();
                if (trimmed) values.add(trimmed);
            }
        }
        return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    });

    const selection = $derived(selectReadingContext(items, {
        budget,
        tag: selectedTag,
        includeDone,
        includeUnknownMinutes,
        limit: 3,
    }));

    const emptyDiagnostics = $derived.by(() => {
        const diagnostics = selection.diagnostics;
        const lines: string[] = [];
        if (diagnostics.total === 0) lines.push(t(i18n, "context.empty.noItems"));
        if (diagnostics.statusMiss > 0) lines.push(t(i18n, "context.empty.status", { n: diagnostics.statusMiss }));
        if (diagnostics.tagMiss > 0) lines.push(t(i18n, "context.empty.tag", { n: diagnostics.tagMiss }));
        if (diagnostics.overBudget > 0) lines.push(t(i18n, "context.empty.overBudget", { n: diagnostics.overBudget }));
        if (diagnostics.unknownMinutes > 0 && !includeUnknownMinutes) lines.push(t(i18n, "context.empty.unknownMinutes", { n: diagnostics.unknownMinutes }));
        if (diagnostics.excluded > 0) lines.push(t(i18n, "context.empty.excluded", { n: diagnostics.excluded }));
        if (lines.length === 0) lines.push(t(i18n, "context.empty.noMatch"));
        return lines;
    });

    function setBudget(event: Event): void {
        const value = Number((event.currentTarget as HTMLSelectElement).value) as ContextBudget;
        if (CONTEXT_BUDGETS.includes(value)) budget = value;
    }

    function setTag(event: Event): void {
        selectedTag = (event.currentTarget as HTMLSelectElement).value;
    }

    function setIncludeDone(event: Event): void {
        includeDone = (event.currentTarget as HTMLInputElement).checked;
    }

    function setIncludeUnknownMinutes(event: Event): void {
        includeUnknownMinutes = (event.currentTarget as HTMLInputElement).checked;
    }

    function candidateTitleId(itemId: string): string {
        return `glean-context-selection-item-title-${instanceId}-${itemId}`;
    }

    function reasonText(reason: ContextReason): string {
        switch (reason.kind) {
            case "budget": return reason.value === "unknown"
                ? t(i18n, "context.reason.unknownMinutes")
                : t(i18n, "context.reason.budget", { n: reason.value ?? 0 });
            case "tag": return t(i18n, "context.reason.tag", { tag: reason.value ?? "" });
            case "priority": return t(i18n, "context.reason.priority", { n: reason.value ?? 3 });
            case "waiting": return t(i18n, "context.reason.waiting", { n: reason.value ?? 0 });
            case "unknownMinutes": return t(i18n, "context.reason.unknownMinutes");
            case "linkOnly": return t(i18n, "context.reason.linkOnly");
        }
    }

    function openArticle(candidate: ContextSelectionCandidate): void {
        if (resolveCarrier(candidate.item.contentType) === "link") {
            if (openTargetForCarrier(candidate.item.contentType, candidate.item.url) === "source") {
                const url = sourceUrlForCarrier(candidate.item.contentType, candidate.item.url);
                if (url) {
                    window.open(url, "_blank", "noopener,noreferrer");
                    return;
                }
            }
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
        }
        facade.openReadingDocument(candidate.item.id);
    }
</script>

<section class="glean-context-selection" aria-labelledby={titleId} aria-describedby={resultId}>
    <header class="glean-context-selection__head">
        <div>
            <h2 id={titleId} class="glean-context-selection__title">{t(i18n, "context.title")}</h2>
            <p class="glean-context-selection__subtitle">{t(i18n, "context.subtitle")}</p>
        </div>
        <span class="glean-context-selection__count" aria-live="polite">{t(i18n, "context.resultCount", { n: selection.candidates.length })}</span>
    </header>

    <div class="glean-context-selection__controls" role="group" aria-label={t(i18n, "context.filters")}>
        <label class="glean-context-selection__field">
            <span>{t(i18n, "context.budget")}</span>
            <select aria-label={t(i18n, "context.budget")} value={budget} onchange={setBudget}>
                {#each CONTEXT_BUDGETS as option}
                    <option value={option}>{t(i18n, "context.budgetOption", { n: option })}</option>
                {/each}
            </select>
        </label>
        <label class="glean-context-selection__field">
            <span>{t(i18n, "context.tag")}</span>
            <select aria-label={t(i18n, "context.tag")} value={selectedTag} onchange={setTag}>
                <option value="">{t(i18n, "context.allTags")}</option>
                {#each userTags as tag}
                    <option value={tag}>{tag}</option>
                {/each}
                {#if selectedTag && !userTags.includes(selectedTag)}
                    <option value={selectedTag}>{selectedTag}</option>
                {/if}
            </select>
        </label>
        <label class="glean-context-selection__check">
            <input type="checkbox" checked={includeDone} onchange={setIncludeDone} />
            <span>{t(i18n, "context.includeDone")}</span>
        </label>
        <label class="glean-context-selection__check">
            <input type="checkbox" checked={includeUnknownMinutes} onchange={setIncludeUnknownMinutes} />
            <span>{t(i18n, "context.includeUnknownMinutes")}</span>
        </label>
    </div>

    {#if selection.candidates.length > 0}
        <div id={resultId} class="glean-context-selection__results" role="list" aria-label={t(i18n, "context.results")}>
            {#each selection.candidates as candidate (candidate.item.id)}
                <article class="glean-context-selection__item" role="listitem">
                    <div class="glean-context-selection__item-main">
                        <h3 id={candidateTitleId(candidate.item.id)} class="glean-context-selection__item-title">{candidate.item.title || t(i18n, "panel.untitled")}</h3>
                        <div class="glean-context-selection__meta">
                            {#if Number.isSafeInteger(candidate.item.minutes) && (candidate.item.minutes ?? 0) > 0}
                                <span>{t(i18n, "context.minutes", { n: candidate.item.minutes ?? 0 })}</span>
                            {:else}
                                <span>{t(i18n, "context.reason.unknownMinutes")}</span>
                            {/if}
                            {#if candidate.item.waitingDays && candidate.item.waitingDays > 0}<span>{t(i18n, "context.waiting", { n: candidate.item.waitingDays })}</span>{/if}
                            {#if !candidate.offlineReadable}<span>{t(i18n, "context.linkOnly")}</span>{/if}
                        </div>
                        <div class="glean-context-selection__reasons" aria-label={t(i18n, "context.reasons")}>
                            {#each candidate.reasons.filter((reason) => reason.kind !== "budget" || reason.value !== "unknown") as reason (reason.kind + String(reason.value ?? ""))}
                                <span class="glean-chip">{reasonText(reason)}</span>
                            {/each}
                        </div>
                    </div>
                    <button type="button" class="glean-btn glean-btn--ghost glean-context-selection__open" aria-describedby={candidateTitleId(candidate.item.id)} onclick={() => openArticle(candidate)}>
                        {t(i18n, "context.open")}
                    </button>
                </article>
            {/each}
        </div>
    {:else}
        <div id={resultId} class="glean-context-selection__empty" role="status" aria-live="polite">
            <strong>{t(i18n, "context.empty.title")}</strong>
            <ul>
                {#each emptyDiagnostics as line}
                    <li>{line}</li>
                {/each}
            </ul>
        </div>
    {/if}
</section>

<style>
    .glean-context-selection {
        display: grid;
        flex: 0 0 auto;
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        gap: var(--glean-space-3);
        margin: var(--glean-space-3) 0;
        padding: var(--glean-space-4);
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-lg);
        background: var(--glean-inset-surface);
    }

    .glean-context-selection__head,
    .glean-context-selection__item {
        display: flex;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--glean-space-3);
    }

    .glean-context-selection__head { flex-wrap: wrap; }
    .glean-context-selection__head > div { flex: 1 1 160px; min-width: 0; }

    .glean-context-selection__title,
    .glean-context-selection__item-title {
        margin: 0;
        color: var(--b3-theme-on-background);
        overflow-wrap: anywhere;
    }

    .glean-context-selection__title { font-size: 1.05rem; }
    .glean-context-selection__item-title { font-size: .96rem; }
    .glean-context-selection__subtitle { margin: var(--glean-space-1) 0 0; color: var(--b3-theme-on-surface); font-size: .82rem; overflow-wrap: anywhere; }
    .glean-context-selection__count { max-width: 100%; color: var(--b3-theme-primary); font-size: .82rem; overflow-wrap: anywhere; }

    .glean-context-selection__controls {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--glean-space-2);
    }

    .glean-context-selection__field { display: grid; flex: 0 1 180px; min-width: 0; max-width: 100%; gap: var(--glean-space-1); color: var(--b3-theme-on-surface); font-size: .78rem; overflow-wrap: anywhere; }
    .glean-context-selection__field select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; min-height: 36px; padding: 0 var(--glean-space-2); border: 1px solid var(--b3-border-color); border-radius: var(--glean-radius-md); background: var(--b3-theme-surface); color: var(--b3-theme-on-background); }
    .glean-context-selection__check { display: inline-flex; min-width: 0; max-width: 100%; align-items: center; gap: var(--glean-space-1); min-height: 36px; color: var(--b3-theme-on-surface); font-size: .78rem; }
    .glean-context-selection__check input { flex: 0 0 16px; width: 16px; height: 16px; accent-color: var(--b3-theme-primary); }
    .glean-context-selection__check span { min-width: 0; white-space: normal; overflow-wrap: anywhere; }

    .glean-context-selection__results { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: var(--glean-space-2); }
    .glean-context-selection__item { align-items: center; padding: var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--b3-theme-surface); }
    .glean-context-selection__item-main { flex: 1 1 0; min-width: 0; max-width: 100%; }
    .glean-context-selection__meta,
    .glean-context-selection__reasons { display: flex; flex-wrap: wrap; gap: var(--glean-space-1); margin-top: var(--glean-space-1); color: var(--b3-theme-on-surface); font-size: .76rem; }
    .glean-context-selection__meta > span,
    .glean-context-selection__reasons .glean-chip { min-width: 0; max-width: 100%; box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; }
    .glean-context-selection__reasons .glean-chip { padding: 2px 6px; }
    .glean-context-selection__open { flex: 0 0 auto; min-height: 36px; max-width: 100%; box-sizing: border-box; white-space: normal; overflow-wrap: anywhere; }
    .glean-context-selection__empty { min-width: 0; color: var(--b3-theme-on-surface); font-size: .84rem; overflow-wrap: anywhere; }
    .glean-context-selection__empty strong { color: var(--b3-theme-on-background); }
    .glean-context-selection__empty ul { margin: var(--glean-space-1) 0 0; padding-inline-start: 1.25rem; }

    @container glean-content (max-width: 560px) {
        .glean-context-selection { padding: var(--glean-space-3); }
        .glean-context-selection__item { align-items: stretch; flex-direction: column; }
        .glean-context-selection__field select,
        .glean-context-selection__check,
        .glean-context-selection__open { min-height: 44px; }
        .glean-context-selection__open { width: 100%; }
        .glean-context-selection__field { flex: 1 1 130px; }
    }
</style>

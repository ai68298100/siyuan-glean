<script lang="ts">
    import { onMount } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { aiBatchCounts, aiBatchHasUnresolved, type AiBatchRow } from "../domain/ai-batch.ts";
    import { AiBatchError, discardAiBatch, loadAiBatch, previewAiBatchResume, previewNewAiBatch, runAiBatch, stopAiBatchAfterCurrent, subscribeAiBatch, type AiBatchPreview, type AiBatchState } from "../services/ai-batch-service";

    interface Props { facade: GleanFacade; open?: boolean; docIds?: string[] }
    let { facade, open = $bindable(false), docIds = [] }: Props = $props();
    const i18n = $derived(facade.i18n);
    let task = $state.raw<AiBatchState>({ journal: null, busy: "", stopRequested: false, error: null, journalSignature: null });
    let preview = $state.raw<AiBatchPreview | null>(null);
    let selected = $state<ReadonlySet<string>>(new Set());
    let reviewed = $state<ReadonlySet<string>>(new Set());
    let authorized = $state<ReadonlySet<string>>(new Set());
    let confirmed = $state(false);
    let discardConfirmed = $state(false);
    let errorKey = $state("");
    let localBusy = $state(false);
    let page = $state(0);
    let previewPage = $state(0);
    let mounted = false;
    let revision = 0;
    let journalSignature = "";
    let inputIdsSignature = "";
    let controller: AbortController | null = null;
    const busy = $derived(localBusy || Boolean(task.busy));
    const counts = $derived(aiBatchCounts(task.journal));
    const unresolved = $derived(aiBatchHasUnresolved(task.journal));
    const pageCount = $derived(Math.max(1, Math.ceil((task.journal?.rows.length ?? 0) / 25)));
    const pageRows = $derived(task.journal?.rows.slice(page * 25, page * 25 + 25) ?? []);
    const previewPageCount = $derived(Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 25)));
    const previewRows = $derived(preview?.rows.slice(previewPage * 25, previewPage * 25 + 25) ?? []);

    $effect(() => {
        const signature = JSON.stringify(docIds);
        if (signature !== inputIdsSignature) {
            inputIdsSignature = signature;
            preview = null;
            confirmed = false;
        }
    });

    function resetChoices(): void {
        selected = new Set();
        reviewed = new Set();
        authorized = new Set();
        confirmed = false;
        discardConfirmed = false;
        preview = null;
    }

    function failure(error: unknown): void {
        errorKey = `aiBatch.error.${error instanceof AiBatchError ? error.reason : "previewRead"}`;
    }

    async function reload(): Promise<void> {
        if (busy) return;
        const request = ++revision;
        localBusy = true;
        errorKey = "";
        resetChoices();
        try { await loadAiBatch(facade.pluginInstance); } catch (error) { if (mounted && request === revision) failure(error); }
        finally { if (mounted) localBusy = false; }
    }

    onMount(() => {
        mounted = true;
        const unsubscribe = subscribeAiBatch(facade.pluginInstance, (next) => {
            const signature = JSON.stringify([next.journalSignature, next.journal]);
            if (signature !== journalSignature && !localBusy) resetChoices();
            journalSignature = signature;
            task = next;
            page = Math.min(page, Math.max(0, Math.ceil((next.journal?.rows.length ?? 0) / 25) - 1));
        });
        if (!task.busy) void reload();
        return () => { mounted = false; revision += 1; controller?.abort(); unsubscribe(); };
    });

    function close(): void {
        revision += 1;
        controller?.abort();
        if (task.busy === "run") stopAiBatchAfterCurrent(facade.pluginInstance);
        resetChoices();
        open = false;
    }

    function toggle(docId: string, checked: boolean, unknown = false): void {
        const next = new Set(selected);
        if (checked) next.add(docId); else next.delete(docId);
        selected = next;
        if (unknown) {
            const allowed = new Set(authorized);
            if (checked) allowed.add(docId); else allowed.delete(docId);
            authorized = allowed;
        }
        preview = null;
        confirmed = false;
    }

    function review(row: AiBatchRow): void {
        try {
            facade.openReadingDocument(row.docId);
            if (row.stage === "unknown") reviewed = new Set([...reviewed, row.docId]);
        } catch (error) { failure(error); }
    }

    function selectPending(): void {
        selected = new Set(task.journal?.rows.filter((row) => row.stage === "pending" || row.stage === "failed").map((row) => row.docId) ?? []);
        authorized = new Set();
        preview = null;
        confirmed = false;
    }

    async function prepare(mode: "new" | "resume"): Promise<void> {
        if (busy) return;
        const request = ++revision;
        localBusy = true;
        errorKey = "";
        confirmed = false;
        preview = null;
        try {
            const result = mode === "new"
                ? await previewNewAiBatch(facade.pluginInstance, [...docIds], facade.settings)
                : await previewAiBatchResume(facade.pluginInstance, [...selected], facade.settings, { reviewedUnknownIds: [...reviewed], authorizedUnknownIds: [...authorized] });
            if (mounted && request === revision) { preview = result; previewPage = 0; }
        } catch (error) { if (mounted && request === revision) failure(error); }
        finally { if (mounted) localBusy = false; }
    }

    async function start(): Promise<void> {
        if (busy || !preview || !confirmed) return;
        const running = preview;
        const request = ++revision;
        controller = new AbortController();
        localBusy = true;
        errorKey = "";
        try { await runAiBatch(facade.pluginInstance, running, facade.settings, { confirmed: true, signal: controller.signal }); }
        catch (error) { if (mounted && request === revision) failure(error); }
        finally {
            facade.notifyDataChanged();
            controller = null;
            if (mounted) { localBusy = false; resetChoices(); }
        }
    }

    async function discard(): Promise<void> {
        if (busy || !discardConfirmed || !task.journalSignature) return;
        localBusy = true;
        errorKey = "";
        try { await discardAiBatch(facade.pluginInstance, { confirmed: true, expectedSignature: task.journalSignature }); if (mounted) resetChoices(); }
        catch (error) { if (mounted) failure(error); }
        finally { if (mounted) localBusy = false; }
    }
</script>

{#if open}
    <section class="glean-ai-batch" class:glean-ai-batch--busy={busy} aria-labelledby="glean-ai-batch-title" aria-busy={busy}>
        <header class="glean-ai-batch__head">
            <div class="glean-ai-batch__heading">
                <span class="glean-ai-batch__eyebrow"><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanSpark" /></svg> AI</span>
                <h3 id="glean-ai-batch-title">{t(i18n, "aiBatch.title")}</h3>
            </div>
            <button class="glean-btn glean-btn--ghost" onclick={close}>{t(i18n, "action.close")}</button>
        </header>
        <div class="glean-ai-batch__intro">
            <p>{t(i18n, "aiBatch.hint")}</p>
            <p class="glean-ai-batch__stop-hint">{t(i18n, "aiBatch.stopHint")}</p>
        </div>
        <div class="glean-ai-batch__actions glean-ai-batch__primary-actions">
            <button class="glean-btn" disabled={busy || docIds.length === 0 || unresolved || task.error === "journalRead" || task.error === "journalInvalid"} onclick={() => void prepare("new")}>{t(i18n, "aiBatch.previewNew")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => void reload()}>{t(i18n, "action.retry")}</button>
            {#if task.busy === "run"}<button class="glean-btn" disabled={task.stopRequested} onclick={() => stopAiBatchAfterCurrent(facade.pluginInstance)}>{t(i18n, "aiBatch.pause")}</button>{/if}
        </div>
        {#if task.journal}
            <p class="glean-ai-batch__counts" role="status" aria-live="polite">{#each Object.entries(counts) as [stage, count]}<span class="glean-ai-batch__count glean-ai-batch__count--{stage}"><i aria-hidden="true"></i>{t(i18n, `aiBatch.stage.${stage}`)}: {count}</span>{/each}</p>
            <p>{t(i18n, "aiBatch.resumeHint")}</p>
            {#if counts.unknown > 0}<p>{t(i18n, "aiBatch.unknownHint")}</p>{/if}
            <div class="glean-ai-batch__actions glean-ai-batch__resume-actions">
                <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={selectPending}>{t(i18n, "aiBatch.selectPending")}</button>
                <button class="glean-btn" disabled={busy || selected.size === 0} onclick={() => void prepare("resume")}>{t(i18n, "aiBatch.previewResume")}</button>
            </div>
            {#each pageRows as row (row.docId)}
                <div class="glean-ai-batch__row glean-ai-batch__row--{row.stage}">
                    <div class="glean-ai-batch__actions">
                        {#if row.stage === "pending" || row.stage === "failed"}
                            <label><input type="checkbox" checked={selected.has(row.docId)} disabled={busy} onchange={(event) => toggle(row.docId, event.currentTarget.checked)} />{row.docId}</label>
                        {:else}<span>{row.docId}</span>{/if}
                        <span class="glean-ai-batch__stage"><i aria-hidden="true"></i>{t(i18n, `aiBatch.stage.${row.stage}`)}</span>
                        <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => review(row)}>{t(i18n, "action.openDoc")}</button>
                    </div>
                    {#if row.reason}<p>{t(i18n, `aiBatch.reason.${row.reason}`)}</p>{/if}
                    {#if row.stage === "unknown"}
                        <label><input type="checkbox" checked={authorized.has(row.docId)} disabled={busy || !reviewed.has(row.docId)} onchange={(event) => toggle(row.docId, event.currentTarget.checked, true)} />{t(i18n, "aiBatch.authorizeUnknown")}</label>
                    {/if}
                </div>
            {/each}
            <div class="glean-ai-batch__actions glean-ai-batch__pager">
                <button class="glean-btn glean-btn--ghost" disabled={page === 0} onclick={() => page -= 1}>{t(i18n, "backup.previous")}</button>
                <span>{t(i18n, "aiBatch.page", { page: page + 1, total: pageCount })}</span>
                <button class="glean-btn glean-btn--ghost" disabled={page + 1 >= pageCount} onclick={() => page += 1}>{t(i18n, "backup.next")}</button>
            </div>
        {/if}
        {#if preview}
            <section class="glean-ai-batch__preview" aria-labelledby="glean-ai-batch-preview-summary">
                <div class="glean-ai-batch__preview-meta">
                    <p id="glean-ai-batch-preview-summary">{t(i18n, "aiBatch.replacements", { n: preview.rows.filter((row) => row.document?.eligible).length, summaries: preview.replacements.summaries, tags: preview.replacements.aiTags, skipped: preview.rows.filter((row) => !row.document?.eligible).length })}</p>
                    <p>{preview.quota.remaining === null ? t(i18n, "aiBatch.unlimited", { used: preview.quota.used }) : t(i18n, "aiBatch.quota", { used: preview.quota.used, cap: preview.quota.cap, remaining: preview.quota.remaining })}</p>
                    <p>{t(i18n, `aiBatch.channel.${preview.channel.kind}`, { model: preview.channel.model })}</p>
                    {#if !preview.enabled}<p class="glean-ai-batch__preview-disabled">{t(i18n, "ai.disabled")}</p>{/if}
                </div>
                <div class="glean-ai-batch__preview-list">
                    {#each previewRows as row (row.docId)}
                        <div class="glean-ai-batch__row glean-ai-batch__row--{row.stage}">
                            <span class="glean-ai-batch__preview-title">{row.document?.title || row.docId}</span>
                            {#if row.document}
                                <p>{row.docId} · {row.document.expectedLocation.hpath}</p>
                                <p>{t(i18n, "aiBatch.aiTags", { n: row.document.aiTagCount })}</p>
                                <details><summary>{t(i18n, "aiBatch.summary")}</summary><pre>{row.document.summary.slice(0, 2000) || t(i18n, "aiBatch.noSummary")}</pre>{#if row.document.summary.length > 2000}<p>{t(i18n, "aiBatch.summaryTruncated")}</p>{/if}</details>
                            {/if}
                            {#if row.reason}<p>{t(i18n, `aiBatch.reason.${row.reason}`)}</p>{/if}
                        </div>
                    {/each}
                </div>
                <div class="glean-ai-batch__actions glean-ai-batch__pager">
                    <button class="glean-btn glean-btn--ghost" disabled={previewPage === 0} onclick={() => previewPage -= 1}>{t(i18n, "backup.previous")}</button>
                    <span>{t(i18n, "aiBatch.page", { page: previewPage + 1, total: previewPageCount })}</span>
                    <button class="glean-btn glean-btn--ghost" disabled={previewPage + 1 >= previewPageCount} onclick={() => previewPage += 1}>{t(i18n, "backup.next")}</button>
                </div>
                <div class="glean-ai-batch__confirm">
                    <label><input type="checkbox" bind:checked={confirmed} disabled={busy} />{t(i18n, "aiBatch.confirm")}</label>
                    <button class="glean-btn glean-btn--pri" disabled={busy || !confirmed || !preview.enabled || preview.quota.remaining === 0} onclick={() => void start()}>{t(i18n, "aiBatch.start")}</button>
                </div>
            </section>
        {/if}
        {#if task.journal || task.error === "journalInvalid"}
            <div class="glean-ai-batch__discard">
                <label><input type="checkbox" bind:checked={discardConfirmed} disabled={busy} />{t(i18n, "aiBatch.discardConfirm")}</label>
                <button class="glean-btn glean-btn--ghost" disabled={busy || !discardConfirmed || !task.journalSignature} onclick={() => void discard()}>{t(i18n, "aiBatch.discard")}</button>
            </div>
        {/if}
        {#if busy}<p class="glean-ai-batch__busy" role="status" aria-live="polite">{task.busy === "run" ? t(i18n, "ai.enriching") : t(i18n, "panel.loading")}</p>{/if}
        {#if errorKey || task.error}<p class="glean-ai-batch__error" role="alert" aria-live="assertive">{t(i18n, errorKey || `aiBatch.error.${task.error}`)}</p>{/if}
    </section>
{:else if task.journal || task.error}
    <button class="glean-btn glean-btn--ghost" onclick={() => open = true}>{t(i18n, "aiBatch.title")}</button>
{/if}

<style>
    .glean-ai-batch {
        flex: 0 0 auto;
        max-height: 65vh;
        overflow: auto;
        display: grid;
        gap: var(--glean-space-3, 12px);
        padding: var(--glean-space-4, 16px);
        border: 1px solid var(--glean-border-soft, var(--b3-border-color));
        border-radius: var(--glean-radius-lg, 16px);
        background: var(--glean-section-surface, var(--b3-theme-surface));
        box-shadow: var(--glean-shadow-card, none);
        color: var(--b3-theme-on-background);
        scrollbar-gutter: stable;
    }
    .glean-ai-batch h3,
    .glean-ai-batch p { margin: 0; overflow-wrap: anywhere; }
    .glean-ai-batch h3 { font-size: var(--glean-text-lg, 15px); line-height: 1.35; }
    .glean-ai-batch p { font-size: var(--glean-text-sm, 12px); line-height: 1.6; color: var(--b3-theme-on-surface); }
    .glean-ai-batch__intro { display: grid; gap: 4px; }
    .glean-ai-batch__stop-hint { color: var(--b3-theme-on-background); font-size: var(--glean-text-xs, 11px) !important; }
    .glean-ai-batch__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--glean-space-3, 12px); padding-bottom: var(--glean-space-2, 8px); border-bottom: 1px solid var(--glean-border-soft, var(--b3-border-color)); }
    .glean-ai-batch__heading { min-width: 0; display: grid; gap: 3px; }
    .glean-ai-batch__eyebrow { display: inline-flex; align-items: center; gap: 5px; color: var(--b3-theme-primary); font-size: var(--glean-text-xs, 11px); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .glean-ai-batch__head > .glean-btn { flex: 0 0 auto; min-height: 32px; }
    .glean-ai-batch__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--glean-space-2, 8px); }
    .glean-ai-batch__counts { display: flex; flex-wrap: wrap; gap: var(--glean-space-1, 4px); }
    .glean-ai-batch__row {
        display: grid;
        gap: var(--glean-space-2, 8px);
        padding: var(--glean-space-3, 12px);
        border: 1px solid var(--glean-border-soft, var(--b3-border-color));
        border-radius: var(--glean-radius-md, 12px);
        background: var(--glean-inset-surface, var(--b3-theme-background));
        transition: border-color 160ms var(--glean-ease-out, ease), box-shadow 160ms var(--glean-ease-out, ease), transform 160ms var(--glean-ease-out, ease);
    }
    .glean-ai-batch__row:hover { border-color: color-mix(in srgb, var(--b3-theme-primary) 24%, var(--glean-border-soft, transparent)); box-shadow: var(--glean-shadow-card, none); }
    .glean-ai-batch__stage { display: inline-flex; align-items: center; gap: 5px; color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs, 11px); }
    .glean-ai-batch__stage i,
    .glean-ai-batch__count i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 999px; background: currentColor; opacity: .78; }
    .glean-ai-batch__count {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        margin-inline-end: var(--glean-space-2, 8px);
        padding: 2px 8px;
        border: 1px solid var(--glean-border-soft, var(--b3-border-color));
        border-radius: 999px;
        background: var(--glean-primary-soft, transparent);
        color: var(--b3-theme-on-background);
        font-size: var(--glean-text-xs, 11px);
    }
    .glean-ai-batch__count--pending,
    .glean-ai-batch__row--pending .glean-ai-batch__stage { color: var(--glean-st-inbox, var(--b3-theme-primary)); }
    .glean-ai-batch__count--failed,
    .glean-ai-batch__row--failed .glean-ai-batch__stage { color: var(--b3-theme-error); }
    .glean-ai-batch__count--done,
    .glean-ai-batch__row--done .glean-ai-batch__stage { color: var(--glean-st-done, var(--b3-theme-primary)); }
    .glean-ai-batch__count--unknown,
    .glean-ai-batch__row--unknown .glean-ai-batch__stage { color: var(--b3-theme-on-surface); }
    .glean-ai-batch__counts { margin-block: 2px; padding: 6px 8px; border: 1px solid var(--glean-border-soft, var(--b3-border-color)); border-radius: var(--glean-radius-sm, 8px); background: var(--glean-status-surface, var(--b3-theme-surface)); }
    .glean-ai-batch__primary-actions { padding-top: 2px; }
    .glean-ai-batch__resume-actions { padding-block: 2px; }
    .glean-ai-batch--busy { box-shadow: var(--glean-shadow-card, none), 0 0 0 1px color-mix(in srgb, var(--b3-theme-primary) 8%, transparent); }
    .glean-ai-batch label { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; min-height: 44px; }
    .glean-ai-batch input[type="checkbox"] { flex: 0 0 auto; }
    .glean-ai-batch pre {
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        margin: 4px 0;
        padding: var(--glean-space-2, 8px);
        border-radius: var(--glean-radius-sm, 8px);
        background: var(--glean-status-surface, var(--b3-theme-surface));
        scrollbar-gutter: stable;
    }
    .glean-ai-batch details summary { cursor: pointer; color: var(--b3-theme-primary); }
    .glean-ai-batch__preview { display: grid; gap: var(--glean-space-3, 12px); padding: var(--glean-space-3, 12px); border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 24%, var(--glean-border-soft, var(--b3-border-color))); border-radius: var(--glean-radius-md, 12px); background: var(--glean-grad-soft, var(--glean-section-surface, var(--b3-theme-surface))); box-shadow: var(--glean-shadow-card, none); }
    .glean-ai-batch__preview-meta { display: grid; gap: 4px; padding-bottom: var(--glean-space-2, 8px); border-bottom: 1px solid color-mix(in srgb, var(--glean-border-soft, var(--b3-border-color)) 72%, transparent); }
    .glean-ai-batch__preview-meta p:first-child { color: var(--b3-theme-on-background); font-weight: 650; }
    .glean-ai-batch__preview-disabled { color: var(--b3-theme-error) !important; font-weight: 650; }
    .glean-ai-batch__preview-list { display: grid; gap: var(--glean-space-2, 8px); max-height: 38vh; overflow: auto; padding-inline-end: 2px; scrollbar-gutter: stable; }
    .glean-ai-batch__preview-title { font-weight: 650; color: var(--b3-theme-on-background); }
    .glean-ai-batch__confirm { display: grid; gap: var(--glean-space-2, 8px); padding-top: var(--glean-space-2, 8px); border-top: 1px solid color-mix(in srgb, var(--glean-border-soft, var(--b3-border-color)) 72%, transparent); }
    .glean-ai-batch__confirm .glean-btn { justify-self: end; min-width: 132px; }
    .glean-ai-batch__pager { justify-content: center; padding-top: 2px; }
    .glean-ai-batch__pager > span { min-width: 90px; color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs, 11px); text-align: center; font-variant-numeric: tabular-nums; }
    .glean-ai-batch__discard { display: grid; gap: var(--glean-space-2, 8px); padding-top: var(--glean-space-2, 8px); border-top: 1px dashed var(--glean-border-soft, var(--b3-border-color)); }
    .glean-ai-batch__discard .glean-btn { justify-self: start; }
    .glean-ai-batch__busy { display: inline-flex; align-items: center; gap: 7px; color: var(--b3-theme-primary) !important; }
    .glean-ai-batch__busy::before { width: 8px; height: 8px; border: 2px solid color-mix(in srgb, var(--b3-theme-primary) 28%, transparent); border-top-color: var(--b3-theme-primary); border-radius: 50%; animation: glean-ai-batch-spin 700ms linear infinite; content: ""; }
    .glean-ai-batch__error { margin-top: 2px !important; }
    .glean-ai-batch [role="alert"] {
        padding: var(--glean-space-2, 8px) var(--glean-space-3, 12px);
        border: 1px solid color-mix(in srgb, var(--b3-theme-error) 30%, var(--glean-border-soft, transparent));
        border-radius: var(--glean-radius-sm, 8px);
        background: var(--glean-error-surface, transparent);
        color: var(--b3-theme-error);
    }
    @keyframes glean-ai-batch-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .glean-ai-batch__busy::before { animation: none; } }
    @media (max-width: 600px) {
        .glean-ai-batch { max-height: none; padding: var(--glean-space-3, 12px); border-radius: var(--glean-radius-md, 12px); }
        .glean-ai-batch__head > .glean-btn { min-height: 44px; }
        .glean-ai-batch button { min-height: 44px; }
        .glean-ai-batch__actions > .glean-btn { flex: 1 1 132px; }
        .glean-ai-batch__preview { padding: var(--glean-space-2, 8px); }
        .glean-ai-batch__preview-list { max-height: none; }
        .glean-ai-batch__pager { display: grid; grid-template-columns: 1fr auto 1fr; width: 100%; }
        .glean-ai-batch__pager .glean-btn:last-child { justify-self: end; }
        .glean-ai-batch__confirm .glean-btn,
        .glean-ai-batch__discard .glean-btn { width: 100%; justify-self: stretch; }
    }
</style>

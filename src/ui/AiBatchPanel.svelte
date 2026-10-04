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
    <section class="glean-ai-batch" aria-label={t(i18n, "aiBatch.title")} aria-busy={busy}>
        <div class="glean-ai-batch__actions">
            <h3>{t(i18n, "aiBatch.title")}</h3>
            <button class="glean-btn glean-btn--ghost" onclick={close}>{t(i18n, "action.close")}</button>
        </div>
        <p>{t(i18n, "aiBatch.hint")}</p>
        <p>{t(i18n, "aiBatch.stopHint")}</p>
        <div class="glean-ai-batch__actions">
            <button class="glean-btn" disabled={busy || docIds.length === 0 || unresolved || task.error === "journalRead" || task.error === "journalInvalid"} onclick={() => void prepare("new")}>{t(i18n, "aiBatch.previewNew")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => void reload()}>{t(i18n, "action.retry")}</button>
            {#if task.busy === "run"}<button class="glean-btn" disabled={task.stopRequested} onclick={() => stopAiBatchAfterCurrent(facade.pluginInstance)}>{t(i18n, "aiBatch.pause")}</button>{/if}
        </div>
        {#if task.journal}
            <p role="status" aria-live="polite">{#each Object.entries(counts) as [stage, count]}<span class="glean-ai-batch__count">{t(i18n, `aiBatch.stage.${stage}`)}: {count}</span>{/each}</p>
            <p>{t(i18n, "aiBatch.resumeHint")}</p>
            {#if counts.unknown > 0}<p>{t(i18n, "aiBatch.unknownHint")}</p>{/if}
            <div class="glean-ai-batch__actions">
                <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={selectPending}>{t(i18n, "aiBatch.selectPending")}</button>
                <button class="glean-btn" disabled={busy || selected.size === 0} onclick={() => void prepare("resume")}>{t(i18n, "aiBatch.previewResume")}</button>
            </div>
            {#each pageRows as row (row.docId)}
                <div class="glean-ai-batch__row">
                    <div class="glean-ai-batch__actions">
                        {#if row.stage === "pending" || row.stage === "failed"}
                            <label><input type="checkbox" checked={selected.has(row.docId)} disabled={busy} onchange={(event) => toggle(row.docId, event.currentTarget.checked)} />{row.docId}</label>
                        {:else}<span>{row.docId}</span>{/if}
                        <span>{t(i18n, `aiBatch.stage.${row.stage}`)}</span>
                        <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => review(row)}>{t(i18n, "action.openDoc")}</button>
                    </div>
                    {#if row.reason}<p>{t(i18n, `aiBatch.reason.${row.reason}`)}</p>{/if}
                    {#if row.stage === "unknown"}
                        <label><input type="checkbox" checked={authorized.has(row.docId)} disabled={busy || !reviewed.has(row.docId)} onchange={(event) => toggle(row.docId, event.currentTarget.checked, true)} />{t(i18n, "aiBatch.authorizeUnknown")}</label>
                    {/if}
                </div>
            {/each}
            <div class="glean-ai-batch__actions">
                <button class="glean-btn glean-btn--ghost" disabled={page === 0} onclick={() => page -= 1}>{t(i18n, "backup.previous")}</button>
                <span>{t(i18n, "aiBatch.page", { page: page + 1, total: pageCount })}</span>
                <button class="glean-btn glean-btn--ghost" disabled={page + 1 >= pageCount} onclick={() => page += 1}>{t(i18n, "backup.next")}</button>
            </div>
        {/if}
        {#if preview}
            <p>{t(i18n, "aiBatch.replacements", { n: preview.rows.filter((row) => row.document?.eligible).length, summaries: preview.replacements.summaries, tags: preview.replacements.aiTags, skipped: preview.rows.filter((row) => !row.document?.eligible).length })}</p>
            <p>{preview.quota.remaining === null ? t(i18n, "aiBatch.unlimited", { used: preview.quota.used }) : t(i18n, "aiBatch.quota", { used: preview.quota.used, cap: preview.quota.cap, remaining: preview.quota.remaining })}</p>
            <p>{t(i18n, `aiBatch.channel.${preview.channel.kind}`, { model: preview.channel.model })}</p>
            {#if !preview.enabled}<p>{t(i18n, "ai.disabled")}</p>{/if}
            {#each previewRows as row (row.docId)}
                <div class="glean-ai-batch__row">
                    <span>{row.document?.title || row.docId}</span>
                    {#if row.document}
                        <p>{row.docId} · {row.document.expectedLocation.hpath}</p>
                        <p>{t(i18n, "aiBatch.aiTags", { n: row.document.aiTagCount })}</p>
                        <details><summary>{t(i18n, "aiBatch.summary")}</summary><pre>{row.document.summary.slice(0, 2000) || t(i18n, "aiBatch.noSummary")}</pre>{#if row.document.summary.length > 2000}<p>{t(i18n, "aiBatch.summaryTruncated")}</p>{/if}</details>
                    {/if}
                    {#if row.reason}<p>{t(i18n, `aiBatch.reason.${row.reason}`)}</p>{/if}
                </div>
            {/each}
            <div class="glean-ai-batch__actions">
                <button class="glean-btn glean-btn--ghost" disabled={previewPage === 0} onclick={() => previewPage -= 1}>{t(i18n, "backup.previous")}</button>
                <span>{t(i18n, "aiBatch.page", { page: previewPage + 1, total: previewPageCount })}</span>
                <button class="glean-btn glean-btn--ghost" disabled={previewPage + 1 >= previewPageCount} onclick={() => previewPage += 1}>{t(i18n, "backup.next")}</button>
            </div>
            <label><input type="checkbox" bind:checked={confirmed} disabled={busy} />{t(i18n, "aiBatch.confirm")}</label>
            <button class="glean-btn glean-btn--pri" disabled={busy || !confirmed || !preview.enabled || preview.quota.remaining === 0} onclick={() => void start()}>{t(i18n, "aiBatch.start")}</button>
        {/if}
        {#if task.journal || task.error === "journalInvalid"}
            <label><input type="checkbox" bind:checked={discardConfirmed} disabled={busy} />{t(i18n, "aiBatch.discardConfirm")}</label>
            <button class="glean-btn glean-btn--ghost" disabled={busy || !discardConfirmed || !task.journalSignature} onclick={() => void discard()}>{t(i18n, "aiBatch.discard")}</button>
        {/if}
        {#if busy}<p role="status">{task.busy === "run" ? t(i18n, "ai.enriching") : t(i18n, "panel.loading")}</p>{/if}
        {#if errorKey || task.error}<p role="alert">{t(i18n, errorKey || `aiBatch.error.${task.error}`)}</p>{/if}
    </section>
{:else if task.journal || task.error}
    <button class="glean-btn glean-btn--ghost" onclick={() => open = true}>{t(i18n, "aiBatch.title")}</button>
{/if}

<style>
    .glean-ai-batch { flex: 0 0 auto; max-height: 65vh; overflow: auto; display: grid; gap: 8px; padding: 12px; border: 1px solid var(--b3-border-color); color: var(--b3-theme-on-background); }
    .glean-ai-batch h3, .glean-ai-batch p { margin: 0; overflow-wrap: anywhere; }
    .glean-ai-batch p { font-size: 12px; line-height: 1.6; color: var(--b3-theme-on-surface); }
    .glean-ai-batch__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .glean-ai-batch__row { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--b3-border-color); }
    .glean-ai-batch__count { display: inline-block; margin-inline-end: 10px; }
    .glean-ai-batch label { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; min-height: 44px; }
    .glean-ai-batch input[type="checkbox"] { flex: 0 0 auto; }
    .glean-ai-batch pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0; }
    @media (max-width: 600px) { .glean-ai-batch button { min-height: 44px; } }
</style>

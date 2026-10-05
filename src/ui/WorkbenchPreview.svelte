<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import type { ClipAttrs, ClipStatus } from "../domain/schema";
    import { normalizeUrl } from "../domain/url";
    import type { ClipIndexEntry, CandidateEntry } from "../services/index-store";
    import { readClip } from "../services/clip-store";
    import { autoEnrich } from "../services/enrich-service";
    import { recordReadingDone } from "../services/checkin-bridge";
    import { excerptFromSelection, selectionBelongsToHost, type ExcerptSelection } from "../services/excerpt-service";
    import { confirmPreviewCandidate, excludePreviewCandidate, PreviewActionError, quotePreviewExcerpt, savePreviewCandidateUrl, setPreviewStatus } from "../services/workbench-preview";
    import ProtyleHost from "./ProtyleHost.svelte";
    import AuthorEditor from "./AuthorEditor.svelte";

    type PreviewItem = ({ kind: "clip" } & ClipIndexEntry) | ({ kind: "candidate" } & CandidateEntry);
    interface Props {
        facade: GleanFacade;
        entry: PreviewItem;
        onClose: () => void;
        onProcessed: () => Promise<void>;
        onRefresh: () => Promise<void>;
    }
    let { facade, entry, onClose, onProcessed, onRefresh }: Props = $props();
    const i18n = $derived(facade.i18n);
    let host = $state<HTMLDivElement | null>(null);
    let attrs = $state<ClipAttrs | null>(null);
    let loadFailed = $state(false);
    let busy = $state(false);
    let editingUrl = $state(false);
    let urlDraft = $state("");
    let expectedUrl = "";
    let excerpt = $state<ExcerptSelection | null>(null);
    let mounted = false;
    const requests = createLatestRequestGate();
    const candidate = $derived(entry.kind === "candidate" && attrs && !attrs.status && !attrs.internal && !attrs.excluded);
    const confirmed = $derived(entry.kind === "clip" && attrs?.status && !attrs.internal);
    const sourceUrl = $derived(attrs?.url || entry.url);
    const statuses: ClipStatus[] = ["inbox", "later", "done", "archived"];

    async function load(): Promise<void> {
        const id = entry.id;
        const isCurrent = requests.begin();
        try {
            const next = await readClip(id);
            if (!mounted || !isCurrent() || entry.id !== id) return;
            attrs = next;
            loadFailed = false;
        } catch {
            if (mounted && isCurrent() && entry.id === id) { attrs = null; loadFailed = true; }
        }
    }

    onMount(() => {
        mounted = true;
        void load();
        const onSelect = () => {
            const selection = window.getSelection();
            excerpt = selectionBelongsToHost(host, selection) ? excerptFromSelection(host, selection) : null;
        };
        const onData = () => { void load(); };
        document.addEventListener("selectionchange", onSelect);
        document.addEventListener("glean:data-changed", onData);
        return () => {
            mounted = false;
            requests.invalidate();
            document.removeEventListener("selectionchange", onSelect);
            document.removeEventListener("glean:data-changed", onData);
        };
    });

    function fail(error: unknown): void {
        const key = error instanceof PreviewActionError
            ? ({ changed: "preview.changed", invalidUrl: "msg.candidateInvalidUrl", conflict: "inbox.duplicate", failed: "reader.actionFailed" } as const)[error.reason]
            : "reader.actionFailed";
        const detail = error instanceof PreviewActionError ? error.detail : "";
        showMessage(`${t(i18n, key)}${detail ? `: ${detail}` : ""}`, 3500);
    }

    async function process(action: () => Promise<void>, successKey: string, advance = true): Promise<void> {
        if (busy) return;
        const processed = untrack(() => onProcessed);
        const refresh = untrack(() => onRefresh);
        busy = true;
        try {
            await action();
            showMessage(t(i18n, successKey), 2500);
            if (advance) await processed();
            else {
                await refresh();
                if (mounted) { editingUrl = false; await load(); }
            }
            facade.notifyDataChanged();
        } catch (error) {
            fail(error);
            if (mounted) void load();
        } finally {
            if (mounted) busy = false;
        }
    }

    function statusAction(status: ClipStatus): void {
        const id = entry.id;
        const title = entry.title;
        void process(async () => {
            await setPreviewStatus(facade.pluginInstance, id, status);
            if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, id, title);
            }
        }, "msg.statusChanged");
    }

    function confirm(asLocal = false): void {
        const id = entry.id;
        const url = sourceUrl;
        void process(async () => {
            await confirmPreviewCandidate(facade.pluginInstance, id, url, asLocal);
            autoEnrich(facade.pluginInstance, id, facade.settings);
        }, "msg.added");
    }

    function editUrl(): void {
        expectedUrl = attrs?.url ?? "";
        urlDraft = sourceUrl;
        editingUrl = true;
    }

    function saveUrl(): void {
        const id = entry.id;
        const expected = expectedUrl;
        const draft = urlDraft;
        void process(() => savePreviewCandidateUrl(facade.pluginInstance, id, expected, draft), "msg.rankSaved", false);
    }

    function quote(): void {
        const selected = excerpt;
        const id = entry.id;
        if (!selected?.blockId) return;
        void process(() => quotePreviewExcerpt(id, selected.blockId, selected.text), "reader.excerptDone", false);
    }

    async function copyExcerpt(): Promise<void> {
        const text = excerpt?.text;
        if (!text) return;
        try { await navigator.clipboard.writeText(text); showMessage(t(i18n, "reader.copied"), 2000); }
        catch (error) { fail(error); }
    }
</script>

<section class="glean-preview" aria-label={t(i18n, "preview.title")}>
    <div class="glean-preview__header">
        <strong title={entry.title}>{entry.title || t(i18n, "panel.untitled")}</strong>
        <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(entry.id)}>{t(i18n, "preview.openDocument")}</button>
        <button class="glean-btn glean-btn--ghost" onclick={onClose}>{t(i18n, "preview.close")}</button>
    </div>
    <div class="glean-preview__meta">
        <span>{t(i18n, "preview.readonly")}</span>
        {#if normalizeUrl(sourceUrl)}<a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceUrl}</a>
        {:else if sourceUrl}<span>{sourceUrl}</span>{/if}
        {#if entry.kind === "candidate"}
            <span>{t(i18n, "candidate.evidenceLabel")}: {entry.evidence.map((value) => t(i18n, `candidate.evidence.${value}`)).join(" · ")}</span>
            <span>{entry.missing.filter((value) => value !== "status").map((value) => t(i18n, `candidate.missing.${value}`)).join(" · ")}</span>
        {/if}
    </div>
    <div class="glean-preview__actions" aria-busy={busy}>
        {#if loadFailed}
            <span>{t(i18n, "preview.changed")}</span>
            <button class="glean-btn" onclick={() => void load()}>{t(i18n, "action.retry")}</button>
        {:else if !attrs}
            <span role="status">{t(i18n, "panel.loading")}</span>
        {:else if candidate}
            <button class="glean-btn" disabled={busy || !normalizeUrl(sourceUrl)} onclick={() => confirm()}>{t(i18n, "action.addToInbox")}</button>
            {#if !sourceUrl}<button class="glean-btn" disabled={busy} onclick={() => confirm(true)}>{t(i18n, "candidate.captureLocal")}</button>{/if}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={editUrl}>{t(i18n, "candidate.fixUrl")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => { const id = entry.id; void process(() => excludePreviewCandidate(facade.pluginInstance, id), "msg.candidateExcluded"); }}>{t(i18n, "candidate.exclude")}</button>
        {:else if confirmed}
            {#each statuses as status}
                <button class="glean-btn glean-btn--ghost" disabled={busy || attrs.status === status} onclick={() => statusAction(status)}>{t(i18n, `queue.${status}`)}</button>
            {/each}
        {:else}
            <span role="status">{t(i18n, "preview.changed")}</span>
        {/if}
    </div>
    {#if editingUrl && candidate}
        <div class="glean-preview__url">
            <input class="b3-text-field" type="url" bind:value={urlDraft} disabled={busy} aria-label={t(i18n, "candidate.urlPlaceholder")} />
            <button class="glean-btn" disabled={busy} onclick={saveUrl}>{t(i18n, "action.save")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => editingUrl = false}>{t(i18n, "action.cancel")}</button>
        </div>
    {/if}
    {#if confirmed}
        {#if attrs?.author}<span class="glean-preview__author">{attrs.site ? `${attrs.site} · ` : ""}{attrs.author}</span>{/if}
        <AuthorEditor {facade} docId={entry.id} onSaved={onRefresh} />
    {/if}
    <ProtyleHost app={facade.pluginInstance.app} docId={entry.id} mode="preview" {i18n} bind:host onOpenDocument={() => facade.openReadingDocument(entry.id)} />
    {#if excerpt}
        <div class="glean-preview__excerpt">
            <span title={excerpt.text}>{excerpt.text.slice(0, 100)}</span>
            <button class="glean-btn" disabled={busy || !confirmed || !excerpt.blockId} title={excerpt.blockId ? "" : t(i18n, "reader.excerptNoBlock")} onclick={quote}>{t(i18n, "reader.excerptQuote")}</button>
            <button class="glean-btn glean-btn--ghost" onclick={() => void copyExcerpt()}>{t(i18n, "reader.copy")}</button>
        </div>
    {/if}
</section>

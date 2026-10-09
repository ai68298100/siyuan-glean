<script lang="ts">
    import { untrack } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import { captureReadingPosition, restoreReadingPosition } from "../libs/reading-position";
    import {
        ClipRestoreError, readReadingPosition, saveReadingPosition, verifyReadingBlock, type ReadingPositionSnapshot,
    } from "../services/clip-store";

    interface Props { facade: GleanFacade; docId: string; host: HTMLElement | null; instanceId?: string }
    let { facade, docId, host, instanceId = "glean-reading-position" }: Props = $props();
    const i18n = $derived(facade.i18n);
    const titleId = $derived(`glean-reading-position-${instanceId}-title`);
    const requests = createLatestRequestGate();
    let snapshot = $state.raw<ReadingPositionSnapshot | null>(null);
    let busy = $state(false);
    let messageKey = $state("");
    let blockFallback = $state<{ docId: string; blockId: string } | null>(null);
    let active = false;

    $effect(() => {
        const id = docId;
        const element = host;
        active = true;
        requests.invalidate();
        snapshot = null;
        blockFallback = null;
        messageKey = "";
        busy = false;
        untrack(() => void reload(id, element));
        return () => { active = false; requests.invalidate(); };
    });

    function begin(id: string, element: HTMLElement | null): () => boolean {
        const latest = requests.begin();
        return () => active && latest() && docId === id && host === element;
    }

    function snapshotMessage(value: ReadingPositionSnapshot): string {
        return value.position ? "reading.position.ready" : value.raw !== null ? "reading.position.invalid" : "reading.position.none";
    }

    function errorMessage(error: unknown, saving = false): string {
        if (error instanceof ClipRestoreError) return error.reason === "missing" ? "reading.position.blockMissing" : "reading.position.changed";
        return saving ? "reading.position.saveFailed" : "reading.position.readFailed";
    }

    async function reload(id = docId, element = host): Promise<void> {
        const current = begin(id, element);
        busy = true;
        blockFallback = null;
        messageKey = "";
        try {
            const next = await readReadingPosition(id);
            if (!current()) return;
            if (next.meta.id !== id) throw new Error("Mismatched document");
            snapshot = next;
            messageKey = snapshotMessage(next);
        } catch (error) {
            if (!current()) return;
            snapshot = null;
            messageKey = errorMessage(error);
        } finally {
            if (current()) busy = false;
        }
    }

    async function remember(): Promise<void> {
        if (busy || !snapshot || snapshot.meta.id !== docId) return;
        const id = docId;
        const element = host;
        const expected = snapshot;
        const position = captureReadingPosition(element);
        if (!position) { messageKey = "reading.position.notRendered"; return; }
        const current = begin(id, element);
        busy = true;
        blockFallback = null;
        try {
            const next = await saveReadingPosition(facade.pluginInstance, id, expected, position);
            if (!current()) return;
            snapshot = next;
            messageKey = "reading.position.saved";
            facade.notifyDataChanged();
        } catch (error) {
            if (!current()) return;
            snapshot = null;
            messageKey = errorMessage(error, true);
        } finally {
            if (current()) busy = false;
        }
    }

    async function restore(): Promise<void> {
        if (busy) return;
        const id = docId;
        const element = host;
        const current = begin(id, element);
        busy = true;
        blockFallback = null;
        try {
            const next = await readReadingPosition(id);
            if (!current()) return;
            if (next.meta.id !== id) throw new Error("Mismatched document");
            snapshot = next;
            if (!next.position) { messageKey = snapshotMessage(next); return; }
            await verifyReadingBlock(id, next.position.blockId);
            if (!current()) return;
            if (restoreReadingPosition(element, next.position)) messageKey = "reading.position.restored";
            else {
                blockFallback = { docId: id, blockId: next.position.blockId };
                messageKey = "reading.position.notRendered";
            }
        } catch (error) {
            if (!current()) return;
            messageKey = errorMessage(error);
        } finally {
            if (current()) busy = false;
        }
    }

    async function openSavedBlock(): Promise<void> {
        if (busy || !blockFallback || blockFallback.docId !== docId) return;
        const target = blockFallback;
        const element = host;
        const current = begin(target.docId, element);
        busy = true;
        try {
            const latest = await readReadingPosition(target.docId);
            if (!current()) return;
            if (latest.meta.id !== target.docId || latest.position?.blockId !== target.blockId) {
                snapshot = latest;
                blockFallback = null;
                messageKey = "reading.position.changed";
                return;
            }
            await verifyReadingBlock(target.docId, target.blockId);
            if (current()) facade.openReadingDocument(target.blockId);
        } catch (error) {
            if (!current()) return;
            blockFallback = null;
            messageKey = errorMessage(error);
        } finally {
            if (current()) busy = false;
        }
    }
</script>

<section class="glean-reading-position" aria-labelledby={titleId} aria-busy={busy}>
    <div id={titleId} class="glean-reading-position__title" role="heading" aria-level="3">{t(i18n, "reading.position.title")}</div>
    <p class="glean-reading-position__hint">{t(i18n, "reading.position.hint")}</p>
    <div class="glean-reading-position__actions" role="group" aria-label={t(i18n, "reading.position.title")}>
        <button class="glean-btn glean-btn--ghost" disabled={busy || !snapshot} onclick={() => void remember()}>{t(i18n, "reading.position.remember")}</button>
        <button class="glean-btn glean-btn--ghost" disabled={busy || !snapshot?.position} onclick={() => void restore()}>{t(i18n, "reading.position.restore")}</button>
        <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => void reload()}>{t(i18n, "reading.position.reload")}</button>
        {#if blockFallback?.docId === docId}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => void openSavedBlock()}>{t(i18n, "reading.position.openBlock")}</button>
        {/if}
        {#if messageKey === "reading.position.notRendered" || messageKey === "reading.position.blockMissing" || messageKey === "reading.position.readFailed" || messageKey === "reading.position.changed"}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => facade.openReadingDocument(docId)}>{t(i18n, "reading.position.openDocument")}</button>
        {/if}
    </div>
    <div class="glean-reading-position__status" class:glean-reading-position__status--visible={busy || Boolean(messageKey)} class:glean-reading-position__status--error={/(Failed|Missing)$/.test(messageKey) || messageKey.endsWith("Missing") || messageKey.endsWith("changed")} class:glean-reading-position__status--success={messageKey === "reading.position.saved" || messageKey === "reading.position.restored"} role="status" aria-live="polite">{busy ? t(i18n, "panel.loading") : messageKey ? t(i18n, messageKey) : ""}</div>
</section>

<style>
    .glean-reading-position { margin-top: var(--glean-space-3); padding: var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); color: var(--b3-theme-on-background); background: var(--glean-inset-surface); }
    .glean-reading-position__title { font-size: var(--glean-text-sm); font-weight: 700; }
    .glean-reading-position__hint { margin: var(--glean-space-1) 0 var(--glean-space-2); color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); line-height: 1.6; overflow-wrap: anywhere; }
    .glean-reading-position__actions { display: flex; flex-wrap: wrap; gap: var(--glean-space-2); }
    .glean-reading-position__actions :global(button) { min-width: 0; transition: background-color 160ms var(--glean-ease-out), border-color 160ms var(--glean-ease-out), transform 120ms var(--glean-ease-out); }
    .glean-reading-position__actions :global(button:active:not(:disabled)) { transform: translateY(1px); }
    .glean-reading-position[aria-busy="true"] .glean-reading-position__actions { opacity: .78; }
    .glean-reading-position[aria-busy="true"] .glean-reading-position__status { border-color: color-mix(in srgb, var(--b3-theme-primary) 24%, var(--glean-border-soft)); }
    .glean-reading-position__status { display: none; min-height: 24px; margin-top: var(--glean-space-2); padding: 4px var(--glean-space-2); border-radius: var(--glean-radius-sm); background: var(--glean-status-surface); color: var(--b3-theme-on-surface); overflow-wrap: anywhere; font-size: var(--glean-text-xs); }
    .glean-reading-position__status--visible { display: block; }
    .glean-reading-position__status--success { color: var(--glean-st-done-text); background: color-mix(in srgb, var(--glean-st-done) 8%, var(--glean-status-surface)); }
    .glean-reading-position__status--error { color: var(--b3-theme-error); background: var(--glean-error-surface); }
    .glean-reading-position button:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @media (max-width: 600px) { .glean-reading-position__actions :global(button) { min-height: 44px; flex: 1 1 auto; } }
</style>

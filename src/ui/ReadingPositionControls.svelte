<script lang="ts">
    import { untrack } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import { captureReadingPosition, restoreReadingPosition } from "../libs/reading-position";
    import {
        ClipRestoreError, readReadingPosition, saveReadingPosition, verifyReadingBlock, type ReadingPositionSnapshot,
    } from "../services/clip-store";

    interface Props { facade: GleanFacade; docId: string; host: HTMLElement | null }
    let { facade, docId, host }: Props = $props();
    const i18n = $derived(facade.i18n);
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

<section class="glean-reading-position" aria-label={t(i18n, "reading.position.title")} aria-busy={busy}>
    <div class="glean-reading-position__title">{t(i18n, "reading.position.title")}</div>
    <p class="glean-reading-position__hint">{t(i18n, "reading.position.hint")}</p>
    <div class="glean-reading-position__actions">
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
    <div class="glean-reading-position__status" role="status" aria-live="polite">{busy ? t(i18n, "panel.loading") : messageKey ? t(i18n, messageKey) : ""}</div>
</section>

<style>
    .glean-reading-position { border-top: 1px solid var(--b3-border-color); padding-top: 12px; margin-top: 12px; color: var(--b3-theme-on-background); }
    .glean-reading-position__title { font-weight: 600; }
    .glean-reading-position__hint { color: var(--b3-theme-on-surface); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
    .glean-reading-position__actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .glean-reading-position__status { min-height: 24px; margin-top: 8px; overflow-wrap: anywhere; font-size: 12px; }
    .glean-reading-position button:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @media (max-width: 600px) { .glean-reading-position__actions :global(button) { min-height: 44px; } }
</style>

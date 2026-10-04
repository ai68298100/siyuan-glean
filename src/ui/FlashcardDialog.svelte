<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { showMessage } from "siyuan";
    import { t } from "../libs/i18n";
    import {
        FLASHCARD_AI_QUOTE_LIMIT, FLASHCARD_BACK_LIMIT, FLASHCARD_FRONT_LIMIT, validateFlashcard,
        type FlashcardSource,
    } from "../domain/flashcard";
    import {
        cancelFlashcardSession, confirmFlashcard, createFlashcardSession, draftQuestionCard, questionCardEnabled,
    } from "../services/flashcard-service";
    import type { GleanFacade } from "../types";

    interface Props { facade: GleanFacade; source: FlashcardSource; onClose?: () => void }
    let { facade, source, onClose }: Props = $props();
    const session = createFlashcardSession(untrack(() => source));
    const i18n = $derived(facade.i18n);
    let front = $state(session.draft.front);
    let back = $state(session.draft.back);
    let settings = $state.raw(untrack(() => facade.settings));
    let busy = $state(false);
    let confirming = $state(false);
    let saveState = $state(session.state);
    let message = $state("");
    let cardId = $state("");
    let hostId = $state("");
    let disposed = false;
    const locked = $derived(saveState !== "ready");
    const aiOn = $derived(questionCardEnabled(settings));
    const validation = $derived(validateFlashcard({ front, back }));
    const validationLimit = $derived(validation === "frontTooLong" ? FLASHCARD_FRONT_LIMIT : FLASHCARD_BACK_LIMIT);
    const channel = $derived(settings.ai.channel === "custom" ? settings.ai.customModel || t(i18n, "settings.channelCustom") : t(i18n, "settings.channelSiyuan"));

    onMount(() => {
        const refreshSettings = () => { settings = facade.settings; };
        document.addEventListener("glean:data-changed", refreshSettings);
        return () => {
            disposed = true;
            cancelFlashcardSession(session);
            document.removeEventListener("glean:data-changed", refreshSettings);
        };
    });

    async function questionDraft(): Promise<void> {
        if (busy || locked) return;
        busy = true;
        message = "";
        try {
            const outcome = await draftQuestionCard(facade.pluginInstance, session, facade.settings);
            if (disposed) return;
            if (outcome.ok) {
                front = session.draft.front;
                back = session.draft.back;
                message = t(i18n, "flashcard.aiReady");
            } else {
                const reason = outcome.reason ?? "error";
                message = t(i18n, reason === "sourceChanged" || reason === "readFailed" || reason === "cancelled" || reason === "busy" ? `flashcard.save.${reason}` : `flashcard.ai.${reason}`);
            }
        } finally {
            if (!disposed) busy = false;
        }
    }

    async function confirm(): Promise<void> {
        if (busy || saveState === "saved" || saveState === "unknown" || (saveState === "ready" && validation)) return;
        busy = true;
        confirming = true;
        message = "";
        try {
            const outcome = await confirmFlashcard(facade.pluginInstance, session, facade.settings, { front, back });
            const result = outcome.ok
                ? t(i18n, "flashcard.done")
                : t(i18n, `flashcard.save.${outcome.reason ?? "setupFailed"}`, { id: outcome.cardBlockId ?? outcome.hostDocId ?? "" });
            if (outcome.ok) facade.notifyDataChanged();
            if (disposed) {
                showMessage(outcome.ok ? t(i18n, "flashcard.backgroundSaved", { id: outcome.cardBlockId ?? "" }) : result, 10000);
                return;
            }
            saveState = session.state;
            cardId = outcome.cardBlockId ?? session.cardBlockId;
            hostId = outcome.hostDocId ?? session.hostDocId;
            message = result;
        } finally {
            if (!disposed) {
                busy = false;
                confirming = false;
            }
        }
    }
</script>

<div class="glean-flashcard" aria-busy={busy}>
    <p class="glean-flashcard__hint">{t(i18n, "flashcard.previewHint")}</p>
    <div class="glean-flashcard__source">
        <span>{t(i18n, "flashcard.source")}: {source.title || source.docId || t(i18n, "flashcard.sourceUnknown")}</span>
        {#if source.docId}
            <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(source.docId!)}>{t(i18n, "flashcard.source")}</button>
        {/if}
    </div>
    <details class="glean-flashcard__quote">
        <summary>{t(i18n, "flashcard.quote")}</summary>
        <pre>{source.quote}</pre>
    </details>
    <div class="glean-flashcard__sides">
        <label>
            <span>{t(i18n, "flashcard.front")} ({[...front].length}/{FLASHCARD_FRONT_LIMIT})</span>
            <textarea class="b3-text-field" bind:value={front} disabled={busy || locked} rows="7"></textarea>
        </label>
        <label>
            <span>{t(i18n, "flashcard.back")} ({[...back].length}/{FLASHCARD_BACK_LIMIT})</span>
            <textarea class="b3-text-field" bind:value={back} disabled={busy || locked} rows="10"></textarea>
        </label>
    </div>
    {#if validation && !locked}
        <p class="glean-flashcard__error" role="alert">{t(i18n, `flashcard.validation.${validation}`, { n: validationLimit })}</p>
    {/if}
    <p class="glean-flashcard__hint">
        {aiOn ? t(i18n, "flashcard.aiPrivacy", { n: FLASHCARD_AI_QUOTE_LIMIT, channel }) : t(i18n, "flashcard.aiOff")}
    </p>
    <div class="glean-flashcard__status" role="status" aria-live="polite">{confirming ? t(i18n, "flashcard.saving") : busy ? t(i18n, "panel.loading") : message}</div>
    <div class="glean-flashcard__actions">
        {#if aiOn}
            <button class="glean-btn glean-btn--ghost" disabled={busy || locked} onclick={() => void questionDraft()}>{t(i18n, "flashcard.aiDraft")}</button>
        {:else if !locked}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => facade.openSettings()}>{t(i18n, "panel.settings")}</button>
        {/if}
        {#if saveState === "ready" || saveState === "inserted"}
            <button class="glean-btn glean-btn--pri" disabled={busy || (saveState === "ready" && !!validation)} onclick={() => void confirm()}>{t(i18n, saveState === "inserted" ? "flashcard.retryRegister" : "flashcard.confirm")}</button>
        {/if}
        {#if cardId || hostId}
            <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(cardId || hostId)}>{t(i18n, "flashcard.openCard")}</button>
        {/if}
        <button class="glean-btn glean-btn--ghost" onclick={() => onClose?.()}>{t(i18n, saveState === "ready" && !confirming ? "action.cancel" : "action.close")}</button>
    </div>
</div>

<style>
    .glean-flashcard { width: 100%; min-width: 0; padding: 16px; box-sizing: border-box; overflow: auto; color: var(--b3-theme-on-background); }
    .glean-flashcard__hint { color: var(--b3-theme-on-surface); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
    .glean-flashcard__source, .glean-flashcard__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .glean-flashcard__quote { margin: 12px 0; }
    .glean-flashcard__quote summary { min-height: 32px; cursor: pointer; }
    .glean-flashcard__quote pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; font: inherit; }
    .glean-flashcard__sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .glean-flashcard__sides label { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .glean-flashcard__sides textarea { width: 100%; min-height: 180px; box-sizing: border-box; resize: vertical; }
    .glean-flashcard__error { border: 1px solid var(--b3-theme-error); color: var(--b3-theme-error); border-radius: 6px; padding: 8px; overflow-wrap: anywhere; }
    .glean-flashcard__status { min-height: 32px; overflow-wrap: anywhere; }
    .glean-flashcard button:focus-visible, .glean-flashcard textarea:focus-visible, .glean-flashcard summary:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @media (max-width: 600px) {
        .glean-flashcard__sides { grid-template-columns: minmax(0, 1fr); }
        .glean-flashcard__actions :global(button), .glean-flashcard__quote summary { min-height: 44px; }
        .glean-flashcard { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    }
</style>

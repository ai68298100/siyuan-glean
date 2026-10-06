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

<div class="glean-flashcard" aria-labelledby="glean-flashcard-title" aria-describedby="glean-flashcard-desc" aria-busy={busy}>
    <header class="glean-flashcard__head">
        <div>
            <h3 id="glean-flashcard-title">{t(i18n, "flashcard.confirm")}</h3>
            <p id="glean-flashcard-desc" class="glean-flashcard__hint">{t(i18n, "flashcard.previewHint")}</p>
        </div>
        <span class="glean-flashcard__mode">CARD</span>
    </header>
    <div class="glean-flashcard__source glean-flashcard__surface">
        <span>{t(i18n, "flashcard.source")}: {source.title || source.docId || t(i18n, "flashcard.sourceUnknown")}</span>
        {#if source.docId}
            <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(source.docId!)}>{t(i18n, "flashcard.source")}</button>
        {/if}
    </div>
    <details class="glean-flashcard__quote glean-flashcard__surface">
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
    <div class="glean-flashcard__status {confirming || busy ? "glean-flashcard__status--busy" : message ? "glean-flashcard__status--message" : ""}" role="status" aria-live="polite">{confirming ? t(i18n, "flashcard.saving") : busy ? t(i18n, "panel.loading") : message}</div>
    <div class="glean-flashcard__actions glean-flashcard__actions--footer">
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
    .glean-flashcard {
        display: flex;
        flex-direction: column;
        gap: var(--glean-space-3);
        width: 100%;
        min-width: 0;
        padding: var(--glean-space-5);
        box-sizing: border-box;
        overflow: auto;
        color: var(--b3-theme-on-background);
    }
    .glean-flashcard__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--glean-space-3); padding: var(--glean-space-3) var(--glean-space-4); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-grad-soft); box-shadow: var(--glean-shadow-card); }
    .glean-flashcard__head h3 { margin: 0; font-size: var(--glean-text-xl); line-height: 1.35; }
    .glean-flashcard__head .glean-flashcard__hint { margin-top: var(--glean-space-1); }
    .glean-flashcard__mode { flex: 0 0 auto; padding: 4px 8px; border: 1px solid color-mix(in srgb, var(--glean-accent-b) 24%, var(--glean-border-soft)); border-radius: 999px; color: var(--glean-accent-b); background: var(--glean-primary-soft); font: 600 var(--glean-text-xs)/1.2 var(--b3-font-family); letter-spacing: .05em; }
    .glean-flashcard__hint { margin: 0; color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); line-height: 1.6; overflow-wrap: anywhere; }
    .glean-flashcard__source, .glean-flashcard__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--glean-space-2); overflow-wrap: anywhere; }
    .glean-flashcard__source {
        justify-content: space-between;
        min-height: 36px;
        padding: var(--glean-space-2) var(--glean-space-3);
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-md);
        background: var(--glean-section-surface);
        font-size: var(--glean-text-sm);
    }
    .glean-flashcard__source > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .glean-flashcard__quote { margin: 0; padding: var(--glean-space-2) var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-inset-surface); }
    .glean-flashcard__quote summary { min-height: 32px; display: flex; align-items: center; cursor: pointer; color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); font-weight: 650; }
    .glean-flashcard__quote pre { margin: var(--glean-space-2) 0 0; padding-top: var(--glean-space-2); border-top: 1px solid var(--glean-border-soft); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; font: inherit; font-size: var(--glean-text-sm); line-height: 1.65; }
    .glean-flashcard__sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--glean-space-3); }
    .glean-flashcard__sides label { display: flex; flex-direction: column; gap: var(--glean-space-2); min-width: 0; color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); font-weight: 650; }
    .glean-flashcard__sides textarea { width: 100%; min-height: 180px; box-sizing: border-box; resize: vertical; border-color: var(--glean-border-soft); background: var(--glean-inset-surface); line-height: 1.65; }
    .glean-flashcard__sides textarea:focus { border-color: color-mix(in srgb, var(--b3-theme-primary) 55%, var(--glean-border-soft)); box-shadow: 0 0 0 3px var(--glean-primary-soft); }
    .glean-flashcard__error { margin: 0; border: 1px solid color-mix(in srgb, var(--b3-theme-error) 35%, var(--glean-border-soft)); color: var(--b3-theme-error); border-radius: var(--glean-radius-sm); background: var(--glean-error-surface); padding: var(--glean-space-2) var(--glean-space-3); overflow-wrap: anywhere; font-size: var(--glean-text-sm); }
    .glean-flashcard__status { min-height: 28px; display: flex; align-items: center; padding: 4px var(--glean-space-2); border-radius: var(--glean-radius-sm); color: var(--b3-theme-on-surface); background: var(--glean-status-surface); overflow-wrap: anywhere; font-size: var(--glean-text-xs); }
    .glean-flashcard__status--busy { color: var(--b3-theme-primary); background: var(--glean-primary-soft); }
    .glean-flashcard__status--message { border: 1px solid var(--glean-border-soft); }
    .glean-flashcard__actions { padding-top: var(--glean-space-2); border-top: 1px solid var(--glean-border-soft); }
    .glean-flashcard button:focus-visible, .glean-flashcard textarea:focus-visible, .glean-flashcard summary:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @media (max-width: 600px) {
        .glean-flashcard__sides { grid-template-columns: minmax(0, 1fr); }
        .glean-flashcard__actions :global(button), .glean-flashcard__quote summary { min-height: 44px; }
        .glean-flashcard { padding: var(--glean-space-4) var(--glean-space-3) calc(var(--glean-space-5) + env(safe-area-inset-bottom, 0px)); }
        .glean-flashcard__source { align-items: flex-start; flex-direction: column; }
        .glean-flashcard__source > span { white-space: normal; }
    }
</style>

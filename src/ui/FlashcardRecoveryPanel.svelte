<script lang="ts">
    import { onMount } from "svelte";
    import { t } from "../libs/i18n";
    import {
        clearFlashcardRecovery, loadFlashcardRecovery, resumeFlashcardRecovery,
        type FlashcardRecoveryResult,
    } from "../services/flashcard-service";
    import type { FlashcardRecovery } from "../domain/flashcard-recovery";
    import type { GleanFacade } from "../types";

    interface Props { facade: GleanFacade }
    let { facade }: Props = $props();
    const i18n = $derived(facade.i18n);
    let recovery = $state<FlashcardRecovery | null>(null);
    let panelState = $state<"loading" | "empty" | "ready" | "busy" | "missing" | "error">("loading");
    let message = $state("");

    async function refresh(): Promise<void> {
        panelState = "loading";
        message = "";
        try {
            recovery = await loadFlashcardRecovery(facade.pluginInstance);
            panelState = recovery ? "ready" : "empty";
        } catch {
            recovery = null;
            panelState = "error";
            message = t(i18n, "flashcard.recovery.readFailed");
        }
    }

    async function resume(): Promise<void> {
        if (panelState === "busy") return;
        panelState = "busy";
        message = "";
        try {
            const result: FlashcardRecoveryResult = await resumeFlashcardRecovery(facade.pluginInstance);
            if (result.ok) {
                recovery = null;
                panelState = "empty";
                message = t(i18n, "flashcard.recovery.done");
            } else {
                recovery = result.recovery ?? recovery;
                panelState = result.reason === "missing" ? "missing" : "ready";
                message = t(i18n, `flashcard.recovery.${result.reason ?? "registerFailed"}`);
            }
        } catch {
            panelState = "ready";
            message = t(i18n, "flashcard.recovery.readFailed");
        }
    }

    async function clearMissing(): Promise<void> {
        if (panelState === "busy") return;
        panelState = "busy";
        try {
            await clearFlashcardRecovery(facade.pluginInstance, true);
            recovery = null;
            panelState = "empty";
            message = t(i18n, "flashcard.recovery.cleared");
        } catch {
            panelState = "missing";
            message = t(i18n, "flashcard.recovery.clearFailed");
        }
    }

    onMount(() => { void refresh(); });
</script>

<div class="glean-flashcard-recovery" role="region" aria-label={t(i18n, "flashcard.recovery.title")} aria-busy={panelState === "loading" || panelState === "busy"}>
    <div class="glean-set-row">
        <div class="glean-set-row__lb">
            {t(i18n, "flashcard.recovery.title")}
            <div class="glean-set-row__desc">{t(i18n, "flashcard.recovery.hint")}</div>
        </div>
        {#if panelState === "loading" || panelState === "busy"}
            <span class="glean-flashcard-recovery__message glean-flashcard-recovery__message--busy" role="status" aria-live="polite"><span class="glean-flashcard-recovery__dot" aria-hidden="true"></span>{t(i18n, "panel.loading")}</span>
        {:else if panelState === "empty"}
            <span class="glean-flashcard-recovery__message">{message || t(i18n, "flashcard.recovery.empty")}</span>
        {:else if recovery}
            <div class="glean-flashcard-recovery__body">
                <span class="glean-flashcard-recovery__status glean-flashcard-recovery__status--{panelState}" role="status" aria-live="polite">
                    {#if panelState === "missing"}
                        {t(i18n, "flashcard.recovery.missing")}
                    {:else if recovery.phase === "registered"}
                        {t(i18n, "flashcard.recovery.registered")}
                    {:else}
                        {t(i18n, "flashcard.recovery.ready")}
                    {/if}
                </span>
                <code class="glean-flashcard-recovery__id">{recovery.cardBlockId}</code>
                <div class="glean-flashcard-recovery__actions">
                    <button class="glean-btn glean-btn--pri" disabled={panelState === "missing"} onclick={() => void resume()}>
                        {t(i18n, recovery.phase === "registered" ? "flashcard.recovery.clean" : "flashcard.recovery.retry")}
                    </button>
                    <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(recovery!.hostDocId)}>{t(i18n, "flashcard.recovery.openHost")}</button>
                    {#if panelState === "missing"}
                        <button class="glean-btn glean-btn--ghost" onclick={() => void clearMissing()}>{t(i18n, "flashcard.recovery.clear")}</button>
                    {/if}
                </div>
                {#if message}<span class="glean-flashcard-recovery__message glean-flashcard-recovery__message--error" role="alert">{message}</span>{/if}
            </div>
        {:else}
            <span class="glean-flashcard-recovery__message glean-flashcard-recovery__message--error" role="alert">{message}</span>
        {/if}
    </div>
</div>

<style>
    .glean-flashcard-recovery { min-width: 0; }
    .glean-flashcard-recovery .glean-set-row { border-color: var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-section-surface); }
    .glean-flashcard-recovery__body, .glean-flashcard-recovery__actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--glean-space-2); }
    .glean-flashcard-recovery__body { justify-content: flex-end; min-width: 0; }
    .glean-flashcard-recovery__status { display: inline-flex; align-items: center; padding: 4px 8px; border: 1px solid var(--glean-border-soft); border-radius: 999px; color: var(--b3-theme-on-surface); background: var(--glean-inset-surface); font-size: var(--glean-text-xs); font-weight: 600; overflow-wrap: anywhere; }
    .glean-flashcard-recovery__status--ready, .glean-flashcard-recovery__status--registered { color: var(--glean-st-done-text); border-color: color-mix(in srgb, var(--glean-st-done) 28%, var(--glean-border-soft)); background: color-mix(in srgb, var(--glean-st-done) 8%, transparent); }
    .glean-flashcard-recovery__status--missing { color: var(--glean-st-inbox-text); background: color-mix(in srgb, var(--glean-st-inbox) 9%, transparent); }
    .glean-flashcard-recovery__id { max-width: min(100%, 240px); padding: 4px 7px; border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-sm); color: var(--b3-theme-on-surface); background: var(--glean-inset-surface); font-size: var(--glean-text-xs); overflow-wrap: anywhere; }
    .glean-flashcard-recovery__message { color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); line-height: 1.5; overflow-wrap: anywhere; }
    .glean-flashcard-recovery__message--busy { display: inline-flex; align-items: center; gap: var(--glean-space-2); color: var(--b3-theme-primary); }
    .glean-flashcard-recovery__message--error { color: var(--b3-theme-error); }
    .glean-flashcard-recovery__dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); animation: glean-recovery-pulse 1.4s ease-in-out infinite; }
    .glean-flashcard-recovery :global(button):focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @keyframes glean-recovery-pulse { 50% { opacity: .45; transform: scale(.82); } }
    @media (max-width: 600px) { .glean-flashcard-recovery__body { justify-content: flex-start; } .glean-flashcard-recovery__actions { width: 100%; } .glean-flashcard-recovery__actions :global(button) { min-height: 44px; flex: 1 1 auto; } }
</style>

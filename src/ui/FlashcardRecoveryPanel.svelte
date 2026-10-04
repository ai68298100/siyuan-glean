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

<div class="glean-flashcard-recovery" aria-busy={panelState === "loading" || panelState === "busy"}>
    <div class="glean-set-row">
        <div class="glean-set-row__lb">
            {t(i18n, "flashcard.recovery.title")}
            <div class="glean-set-row__desc">{t(i18n, "flashcard.recovery.hint")}</div>
        </div>
        {#if panelState === "loading" || panelState === "busy"}
            <span class="glean-settings__usage">{t(i18n, "panel.loading")}</span>
        {:else if panelState === "empty"}
            <span class="glean-settings__usage">{message || t(i18n, "flashcard.recovery.empty")}</span>
        {:else if recovery}
            <div class="glean-flashcard-recovery__body">
                <span class="glean-flashcard-recovery__status">
                    {#if panelState === "missing"}
                        {t(i18n, "flashcard.recovery.missing")}
                    {:else if recovery.phase === "registered"}
                        {t(i18n, "flashcard.recovery.registered")}
                    {:else}
                        {t(i18n, "flashcard.recovery.ready")}
                    {/if}
                </span>
                <code>{recovery.cardBlockId}</code>
                <div class="glean-flashcard-recovery__actions">
                    <button class="glean-btn glean-btn--pri" disabled={panelState === "missing"} onclick={() => void resume()}>
                        {t(i18n, recovery.phase === "registered" ? "flashcard.recovery.clean" : "flashcard.recovery.retry")}
                    </button>
                    <button class="glean-btn glean-btn--ghost" onclick={() => facade.openReadingDocument(recovery!.hostDocId)}>{t(i18n, "flashcard.recovery.openHost")}</button>
                    {#if panelState === "missing"}
                        <button class="glean-btn glean-btn--ghost" onclick={() => void clearMissing()}>{t(i18n, "flashcard.recovery.clear")}</button>
                    {/if}
                </div>
                {#if message}<span class="glean-settings__error" role="alert">{message}</span>{/if}
            </div>
        {:else}
            <span class="glean-settings__error" role="alert">{message}</span>
        {/if}
    </div>
</div>

<style>
    .glean-flashcard-recovery__body, .glean-flashcard-recovery__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .glean-flashcard-recovery__body { justify-content: flex-end; min-width: 0; }
    .glean-flashcard-recovery__status, .glean-flashcard-recovery code { overflow-wrap: anywhere; }
    .glean-flashcard-recovery code { color: var(--b3-theme-on-surface); font-size: 11px; }
    .glean-settings__error { color: var(--b3-theme-error); overflow-wrap: anywhere; }
    @media (max-width: 600px) { .glean-flashcard-recovery__body { justify-content: flex-start; } .glean-flashcard-recovery__actions :global(button) { min-height: 44px; } }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { t } from "../libs/i18n";
    import { formattingCandidates, renderFormatting, type FormattingPlan } from "../domain/formatting";
    import { formattingAiEnabled, loadFormattingSession, planAiFormatting, saveFormattingDraft, type FormattingSession } from "../services/formatting-service";
    import type { GleanFacade } from "../types";
    import { DEFAULT_SETTINGS, type GleanSettings } from "../services/settings";

    interface Props {
        facade: GleanFacade;
        docId: string;
        onClose?: () => void;
    }

    let { facade, docId, onClose }: Props = $props();
    const i18n = $derived(facade.i18n);
    let session = $state.raw<FormattingSession | null>(null);
    let plan = $state<FormattingPlan>({ headings: [], cleanup: [] });
    let selected = $state<string[]>([]);
    let busy = $state(false);
    let loading = $state(true);
    let message = $state("");
    let draftId = $state("");
    let saveState = $state<FormattingSession["state"]>("ready");
    let disposed = false;
    let settings = $state.raw<GleanSettings>(DEFAULT_SETTINGS);
    const aiOn = $derived(formattingAiEnabled(settings));
    const candidates = $derived(session ? formattingCandidates(session.analysis, plan) : []);
    const preview = $derived(session ? renderFormatting(session.analysis, plan, selected) : "");
    const locked = $derived(saveState !== "ready");

    onMount(() => {
        settings = facade.settings;
        const refreshSettings = () => { settings = facade.settings; };
        document.addEventListener("glean:data-changed", refreshSettings);
        void reload();
        return () => {
            disposed = true;
            document.removeEventListener("glean:data-changed", refreshSettings);
        };
    });

    async function reload(): Promise<void> {
        if (busy || locked) return;
        busy = true;
        loading = true;
        message = "";
        try {
            const next = await loadFormattingSession(docId);
            if (disposed) return;
            session = next;
            plan = { headings: [], cleanup: [] };
            selected = [];
            saveState = "ready";
        } catch {
            if (!disposed) message = t(i18n, "formatting.loadFailed");
        } finally {
            if (!disposed) {
                busy = false;
                loading = false;
            }
        }
    }

    function basic(): void {
        if (!session || busy || locked) return;
        session.plan = { headings: [], cleanup: [] };
        plan = session.plan;
        selected = selected.filter((id) => session!.analysis.candidates.some((candidate) => candidate.id === id));
        message = "";
    }

    async function formatAi(): Promise<void> {
        if (!session || busy || locked) return;
        busy = true;
        message = "";
        try {
            const outcome = await planAiFormatting(facade.pluginInstance, session, facade.settings);
            if (disposed) return;
            if (outcome.ok) {
                plan = session.plan;
                const nextCandidates = formattingCandidates(session.analysis, session.plan);
                selected = selected.filter((id) => nextCandidates.some((candidate) => candidate.id === id));
                message = t(i18n, "formatting.aiReady");
            } else {
                message = t(i18n, `formatting.ai.${outcome.reason ?? "error"}`);
            }
        } finally {
            if (!disposed) busy = false;
        }
    }

    async function save(): Promise<void> {
        if (!session || busy || saveState === "unknown" || saveState === "saved") return;
        busy = true;
        message = "";
        try {
            const outcome = await saveFormattingDraft(facade.pluginInstance, session, selected, {
                suffix: t(i18n, "formatting.suffix"),
                original: t(i18n, "formatting.original"),
                source: t(i18n, "formatting.source"),
            });
            if (outcome.ok) facade.notifyDataChanged();
            if (disposed) {
                showMessage(outcome.ok ? t(i18n, "formatting.backgroundSaved", { id: outcome.docId ?? "" }) : t(i18n, `formatting.save.${outcome.reason ?? "readFailed"}`, { id: outcome.docId ?? "" }), 10000);
                return;
            }
            draftId = outcome.docId ?? session.createdDocId;
            saveState = session.state;
            message = outcome.ok ? t(i18n, "formatting.saved") : t(i18n, `formatting.save.${outcome.reason ?? "readFailed"}`, { id: draftId });
        } finally {
            if (!disposed) busy = false;
        }
    }

    function toggle(id: string): void {
        if (busy || locked) return;
        selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    }
</script>

<div class="glean-formatting" aria-busy={busy}>
    <p class="glean-formatting__hint">{t(i18n, "formatting.hint")}</p>
    <div class="glean-formatting__toolbar">
        <button class="glean-btn glean-btn--ghost" disabled={busy || locked || !session} onclick={basic}>{t(i18n, "formatting.basic")}</button>
        <button class="glean-btn glean-btn--ghost" disabled={busy || locked} onclick={() => void reload()}>{t(i18n, "formatting.reload")}</button>
        {#if aiOn}
            <button class="glean-btn glean-btn--pri" disabled={busy || locked || !session} onclick={() => void formatAi()}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanSpark" /></svg>{t(i18n, "formatting.ai")}</button>
        {:else}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => facade.openSettings()}>{t(i18n, "formatting.enable")}</button>
        {/if}
    </div>
    <p class="glean-formatting__hint">
        {aiOn ? t(i18n, "formatting.aiPrivacy", { channel: settings.ai.channel === "custom" ? settings.ai.customModel || t(i18n, "settings.channelCustom") : t(i18n, "settings.channelSiyuan") }) : t(i18n, "formatting.aiOff")}
    </p>
    <div class="glean-formatting__status" role="status" aria-live="polite">{loading || busy ? t(i18n, "panel.loading") : message}</div>
    {#if session}
        {#if session.analysis.encodingWarnings}
            <p class="glean-formatting__warning">{t(i18n, "formatting.encoding", { n: session.analysis.encodingWarnings })}</p>
        {/if}
        <fieldset class="glean-formatting__candidates" disabled={busy || locked}>
            <legend>{t(i18n, "formatting.candidates", { n: candidates.length })}</legend>
            <p class="glean-formatting__hint">{t(i18n, "formatting.candidateHint")}</p>
            {#each candidates as candidate (candidate.id)}
                <label class="glean-formatting__candidate">
                    <input type="checkbox" checked={selected.includes(candidate.id)} onchange={() => toggle(candidate.id)} />
                    <span>
                        <span class="glean-formatting__reason">{candidate.reasons.map((reason) => t(i18n, `formatting.reason.${reason}`)).join(" · ")}</span>
                        <span class="glean-formatting__excerpt">{session.analysis.blocks.find((block) => block.id === candidate.id)?.raw}</span>
                    </span>
                </label>
            {:else}
                <p class="glean-formatting__hint">{t(i18n, "formatting.noCandidates")}</p>
            {/each}
        </fieldset>
        <div class="glean-formatting__comparison">
            <label class="glean-formatting__column">
                <span>{t(i18n, "formatting.original")}</span>
                <textarea class="b3-text-field glean-formatting__text" readonly value={session.source.markdown} spellcheck="false"></textarea>
            </label>
            <label class="glean-formatting__column">
                <span>{t(i18n, "formatting.preview")}</span>
                <textarea class="b3-text-field glean-formatting__text" readonly value={preview} spellcheck="false"></textarea>
            </label>
        </div>
        <p class="glean-formatting__hint">{t(i18n, "formatting.selected", { n: selected.length })}</p>
    {/if}
    <div class="glean-formatting__toolbar">
        {#if session && saveState !== "saved" && saveState !== "unknown"}
            <button class="glean-btn glean-btn--pri" disabled={busy || !preview.trim()} onclick={() => void save()}>{t(i18n, saveState === "created" ? "formatting.retryMark" : "formatting.save")}</button>
        {/if}
        {#if draftId}
            <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => facade.openReadingDocument(draftId)}>{t(i18n, "formatting.openDraft")}</button>
        {/if}
        <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => onClose?.()}>{t(i18n, "action.close")}</button>
    </div>
</div>

<style>
    .glean-formatting { width: 100%; min-width: 0; padding: 16px; box-sizing: border-box; overflow: auto; color: var(--b3-theme-on-background); }
    .glean-formatting__hint { color: var(--b3-theme-on-surface); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
    .glean-formatting__toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
    .glean-formatting__status { min-height: 24px; margin-top: 8px; overflow-wrap: anywhere; }
    .glean-formatting__warning { padding: 8px; border: 1px solid var(--b3-theme-error); border-radius: 6px; }
    .glean-formatting__candidates { margin: 12px 0; padding: 10px; border: 1px solid var(--b3-border-color); border-radius: 6px; max-height: 240px; overflow: auto; }
    .glean-formatting__candidate { display: flex; align-items: flex-start; gap: 8px; min-height: 44px; padding: 6px 0; cursor: pointer; }
    .glean-formatting__candidate input { flex-shrink: 0; width: 20px; height: 20px; margin: 3px 0; }
    .glean-formatting__candidate > span { min-width: 0; }
    .glean-formatting__reason { display: block; color: var(--b3-theme-primary); font-size: 12px; }
    .glean-formatting__excerpt { display: block; max-height: 72px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
    .glean-formatting__comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .glean-formatting__column { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .glean-formatting__text { width: 100%; min-height: 240px; height: 30vh; box-sizing: border-box; resize: vertical; font-family: var(--b3-font-family-code); font-size: 12px; }
    @media (max-width: 600px) {
        .glean-formatting__comparison { grid-template-columns: minmax(0, 1fr); }
        .glean-formatting__toolbar :global(button) { min-height: 44px; min-width: 44px; }
        .glean-formatting { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    }
</style>

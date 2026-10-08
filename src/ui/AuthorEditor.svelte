<script lang="ts">
    import { onMount, untrack, tick } from "svelte";
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import { AuthorEditError, readClipAuthor, saveClipAuthor, type AuthorEditSnapshot } from "../services/clip-store";
    import type { AuthorSuggestion } from "../domain/author";
    import { authorSuggestionEnabled, suggestClipAuthor } from "../services/author-service";
    import { activeAiSettings } from "../services/enrich-service";
    import { DEFAULT_SETTINGS, type GleanSettings } from "../services/settings";

    interface Props { facade: GleanFacade; docId: string; onSaved?: () => void | Promise<void> }
    let { facade, docId, onSaved }: Props = $props();
    const i18n = $derived(facade.i18n);
    let editing = $state(false);
    let busy = $state(false);
    let draft = $state("");
    let snapshot = $state<AuthorEditSnapshot | null>(null);
    let errorKey = $state("");
    let needsReload = $state(false);
    let settings = $state.raw<GleanSettings>(DEFAULT_SETTINGS);
    const aiOn = $derived(authorSuggestionEnabled(settings));
    let suggesting = $state(false);
    let suggestion = $state<AuthorSuggestion | null>(null);
    let suggestionMessage = $state("");
    let suggestionAdopted = $state(false);
    let suggestionDocId = "";
    let suggestionExpectedAuthor = "";
    let input = $state<HTMLInputElement | null>(null);
    let trigger = $state<HTMLButtonElement | null>(null);
    let mounted = false;
    const requests = createLatestRequestGate();
    const suggestionRequests = createLatestRequestGate();

    onMount(() => {
        mounted = true;
        const refreshSettings = () => {
            settings = activeAiSettings(facade.pluginInstance, facade.settings);
            if (!authorSuggestionEnabled(settings)) clearSuggestion();
        };
        refreshSettings();
        document.addEventListener("glean:data-changed", refreshSettings);
        return () => {
            mounted = false;
            requests.invalidate();
            suggestionRequests.invalidate();
            document.removeEventListener("glean:data-changed", refreshSettings);
        };
    });

    $effect(() => {
        docId;
        untrack(() => {
            requests.invalidate();
            clearSuggestion();
            editing = false;
            busy = false;
            draft = "";
            snapshot = null;
            errorKey = "";
            needsReload = false;
        });
    });

    async function load(keepDraft = false): Promise<void> {
        if (busy) return;
        clearSuggestion();
        const id = docId;
        const isCurrent = requests.begin();
        busy = true;
        editing = true;
        snapshot = null;
        errorKey = "";
        try {
            const next = await readClipAuthor(id);
            if (!mounted || !isCurrent() || docId !== id) return;
            snapshot = next;
            if (!keepDraft) draft = next.raw;
            needsReload = false;
            busy = false;
            await tick();
            if (mounted && isCurrent() && docId === id) input?.focus();
        } catch {
            if (mounted && isCurrent() && docId === id) { errorKey = "author.loadFailed"; needsReload = true; }
        } finally {
            if (mounted && isCurrent() && docId === id) busy = false;
        }
    }

    function close(): void {
        if (busy) return;
        requests.invalidate();
        clearSuggestion();
        editing = false;
        snapshot = null;
        draft = "";
        trigger?.focus();
    }

    async function save(): Promise<void> {
        if (busy || !snapshot || needsReload) return;
        clearSuggestion();
        const id = docId;
        const expected = snapshot.raw;
        const text = draft;
        const refresh = onSaved;
        const isCurrent = requests.begin();
        busy = true;
        errorKey = "";
        try {
            await saveClipAuthor(facade.pluginInstance, id, expected, text);
            facade.notifyDataChanged();
            if (!mounted || !isCurrent() || docId !== id) return;
            editing = false;
            draft = "";
            snapshot = null;
            showMessage(t(i18n, "author.saved"), 2500);
            trigger?.focus();
            await refresh?.();
        } catch (error) {
            if (!mounted || !isCurrent() || docId !== id) return;
            const reason = error instanceof AuthorEditError ? error.reason : "failed";
            errorKey = `author.${reason}`;
            needsReload = reason !== "invalid";
        } finally {
            if (mounted && isCurrent() && docId === id) busy = false;
        }
    }

    function clearSuggestion(): void {
        suggestionRequests.invalidate();
        suggesting = false;
        suggestion = null;
        suggestionMessage = "";
        suggestionAdopted = false;
        suggestionDocId = "";
        suggestionExpectedAuthor = "";
    }

    async function suggest(): Promise<void> {
        if (busy || suggesting || !snapshot || needsReload) return;
        clearSuggestion();
        settings = activeAiSettings(facade.pluginInstance, facade.settings);
        if (!authorSuggestionEnabled(settings)) { suggestionMessage = "author.suggestion.off"; return; }
        const id = docId;
        const expectedAuthor = snapshot.raw;
        const isCurrent = suggestionRequests.begin();
        const active = () => mounted && editing && isCurrent() && docId === id;
        suggesting = true;
        try {
            const outcome = await suggestClipAuthor(facade.pluginInstance, id, () => facade.settings, { expectedAuthor, isCurrent: active });
            if (!active()) return;
            settings = activeAiSettings(facade.pluginInstance, facade.settings);
            if (!authorSuggestionEnabled(settings)) { clearSuggestion(); return; }
            if (outcome.ok) {
                suggestion = outcome.suggestion;
                suggestionDocId = id;
                suggestionExpectedAuthor = expectedAuthor;
            } else if (outcome.reason !== "cancelled") {
                suggestionMessage = `author.suggestion.${outcome.reason}`;
                if (outcome.reason === "changed") needsReload = true;
            }
        } catch {
            if (active()) suggestionMessage = "author.suggestion.error";
        } finally {
            if (active()) suggesting = false;
        }
    }

    function adoptSuggestion(): void {
        settings = activeAiSettings(facade.pluginInstance, facade.settings);
        if (!authorSuggestionEnabled(settings)) { clearSuggestion(); return; }
        if (!mounted || busy || suggesting || !editing || !snapshot || needsReload || !suggestion || suggestionDocId !== docId || suggestionExpectedAuthor !== snapshot.raw) return;
        draft = suggestion.author;
        suggestionAdopted = true;
        input?.focus();
    }
</script>

<div class="glean-author-editor">
    <button type="button" class="glean-btn glean-btn--ghost" bind:this={trigger} aria-expanded={editing} aria-controls={`glean-author-editor-form-${docId}`} disabled={busy} onclick={(event) => { event.stopPropagation(); if (editing) close(); else void load(); }}>{t(i18n, "author.edit")}</button>
    {#if editing}
        <form id={`glean-author-editor-form-${docId}`} class="glean-author-editor__form" aria-busy={busy} onsubmit={(event) => { event.preventDefault(); void save(); }}>
            {#if busy}<p class="glean-author-editor__status glean-author-editor__status--busy" role="status" aria-live="polite"><span class="glean-author-editor__status-dot" aria-hidden="true"></span>{t(i18n, "panel.loading")}</p>{/if}
            <label for={`glean-author-editor-input-${docId}`}>{t(i18n, "author.label")}
                <input id={`glean-author-editor-input-${docId}`} class="b3-text-field" bind:this={input} bind:value={draft} disabled={busy} autocomplete="off" maxlength="120" />
            </label>
            <p class="glean-author-editor__hint">{t(i18n, "author.hint")}</p>
            {#if snapshot}<p class="glean-author-editor__current"><span>{t(i18n, "author.current")}</span><strong>{snapshot.raw || t(i18n, "author.unknown")}</strong></p>{/if}
            {#if snapshot && aiOn}
                <button type="button" class="glean-btn glean-btn--ghost" disabled={busy || suggesting || needsReload} onclick={() => void suggest()}>{t(i18n, "author.suggestion.request")}</button>
            {/if}
            {#if suggesting}<p class="glean-author-editor__status glean-author-editor__status--busy" role="status"><span class="glean-author-editor__status-dot" aria-hidden="true"></span>{t(i18n, "author.suggestion.loading")}</p>{/if}
            {#if suggestionMessage}<p class="glean-author-editor__status" role="status">{t(i18n, suggestionMessage)}</p>{/if}
            {#if suggestion && aiOn}
                <section class="glean-author-editor__suggestion" aria-labelledby={`glean-author-editor-suggestion-title-${docId}`}>
                    <p id={`glean-author-editor-suggestion-title-${docId}`} class="glean-author-editor__suggestion-head" role="heading" aria-level="4"><span>{t(i18n, "author.suggestion.source")}</span><span class="glean-author-editor__badge">AI</span></p>
                    <p class="glean-author-editor__suggested-author"><span>{t(i18n, "author.label")}</span><strong>{suggestion.author}</strong></p>
                    <p class="glean-author-editor__evidence-label">{t(i18n, "author.suggestion.evidence")}</p>
                    <blockquote>{suggestion.evidence}</blockquote>
                    <div class="glean-author-editor__actions">
                        <button type="button" class="glean-btn" disabled={busy || suggesting || needsReload} onclick={adoptSuggestion}>{t(i18n, "author.suggestion.adopt")}</button>
                        <button type="button" class="glean-btn glean-btn--ghost" onclick={clearSuggestion}>{t(i18n, "author.suggestion.discard")}</button>
                    </div>
                </section>
            {/if}
            {#if suggestionAdopted}<p class="glean-author-editor__status glean-author-editor__status--success" role="status">{t(i18n, "author.suggestion.draftHint")}</p>{/if}
            {#if errorKey}<p class="glean-author-editor__status glean-author-editor__status--error" role="alert">{t(i18n, errorKey)}</p>{/if}
            <div class="glean-author-editor__actions">
                <button type="submit" class="glean-btn" disabled={busy || !snapshot || needsReload}>{t(i18n, "author.save")}</button>
                <button type="button" class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => void load(true)}>{t(i18n, "author.reload")}</button>
                <button type="button" class="glean-btn glean-btn--ghost" disabled={busy} onclick={close}>{t(i18n, "author.cancel")}</button>
            </div>
        </form>
    {/if}
</div>

<style>
    .glean-author-editor { min-width: 0; }
    .glean-author-editor__form { display: grid; gap: var(--glean-space-3); padding: var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-status-surface); color: var(--b3-theme-on-surface); box-shadow: var(--glean-shadow-card); }
    .glean-author-editor__form label { display: grid; gap: var(--glean-space-1); color: var(--b3-theme-on-background); font-size: var(--glean-text-sm); font-weight: 600; }
    .glean-author-editor__form input { width: 100%; min-width: 0; min-height: 36px; box-sizing: border-box; border-color: var(--glean-border-soft); background: var(--glean-inset-surface); transition: border-color 160ms var(--glean-ease-out), box-shadow 160ms var(--glean-ease-out); }
    .glean-author-editor__form input:focus { border-color: color-mix(in srgb, var(--b3-theme-primary) 60%, var(--glean-border-soft)); box-shadow: 0 0 0 3px var(--glean-primary-soft); }
    .glean-author-editor__form p { margin: 0; font-size: var(--glean-text-sm); line-height: 1.55; overflow-wrap: anywhere; }
    .glean-author-editor__hint { color: var(--b3-theme-on-surface); }
    .glean-author-editor__current { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--glean-space-1); color: var(--b3-theme-on-surface); }
    .glean-author-editor__current span { font-size: var(--glean-text-xs); }
    .glean-author-editor__current strong { color: var(--b3-theme-on-background); font-weight: 600; }
    .glean-author-editor__actions { display: flex; flex-wrap: wrap; gap: var(--glean-space-2); }
    .glean-author-editor__suggestion { display: grid; gap: var(--glean-space-2); min-width: 0; padding: var(--glean-space-3); border: 1px solid color-mix(in srgb, var(--glean-accent-b) 26%, var(--glean-border-soft)); border-radius: var(--glean-radius-md); background: var(--glean-grad-soft); box-shadow: var(--glean-shadow-card); }
    .glean-author-editor__suggestion-head { display: flex; align-items: center; justify-content: space-between; gap: var(--glean-space-2); color: var(--b3-theme-on-background); font-weight: 600; }
    .glean-author-editor__badge { padding: 3px 7px; border: 1px solid color-mix(in srgb, var(--glean-accent-b) 32%, var(--glean-border-soft)); border-radius: 999px; color: var(--glean-accent-b); background: var(--glean-primary-soft); font-size: var(--glean-text-xs); letter-spacing: .04em; }
    .glean-author-editor__suggested-author { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--glean-space-2); }
    .glean-author-editor__suggested-author span, .glean-author-editor__evidence-label { color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); }
    .glean-author-editor__suggested-author strong { color: var(--b3-theme-on-background); font-size: var(--glean-text-lg); }
    .glean-author-editor__suggestion blockquote { margin: 0; padding: var(--glean-space-2) var(--glean-space-3); border-left: 3px solid var(--glean-accent-b); border-radius: 0 var(--glean-radius-sm) var(--glean-radius-sm) 0; background: color-mix(in srgb, var(--b3-theme-surface) 65%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
    .glean-author-editor__status { display: flex; align-items: center; gap: var(--glean-space-2); padding: var(--glean-space-2) var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-sm); background: var(--glean-status-surface); }
    .glean-author-editor__status--busy { color: var(--b3-theme-primary); }
    .glean-author-editor__status--success { color: var(--glean-st-done-text); border-color: color-mix(in srgb, var(--glean-st-done) 28%, var(--glean-border-soft)); background: color-mix(in srgb, var(--glean-st-done) 8%, transparent); }
    .glean-author-editor__status--error { color: var(--b3-theme-error); border-color: color-mix(in srgb, var(--b3-theme-error) 28%, var(--glean-border-soft)); background: var(--glean-error-surface); }
    .glean-author-editor__status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); animation: glean-author-pulse 1.4s ease-in-out infinite; }
    .glean-author-editor :global(button):focus-visible, .glean-author-editor input:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @keyframes glean-author-pulse { 50% { opacity: .45; transform: scale(.82); } }
    @media (max-width: 560px) {
        .glean-author-editor__form { padding: var(--glean-space-3); }
        .glean-author-editor__actions :global(button) { min-height: 44px; }
    }
</style>

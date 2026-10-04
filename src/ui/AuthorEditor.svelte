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
    <button class="glean-btn glean-btn--ghost" bind:this={trigger} aria-expanded={editing} disabled={busy} onclick={(event) => { event.stopPropagation(); if (editing) close(); else void load(); }}>{t(i18n, "author.edit")}</button>
    {#if editing}
        <form class="glean-author-editor__form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>{t(i18n, "author.label")}
                <input class="b3-text-field" bind:this={input} bind:value={draft} disabled={busy} autocomplete="off" />
            </label>
            <p>{t(i18n, "author.hint")}</p>
            {#if snapshot}<p>{t(i18n, "author.current")}: {snapshot.raw || t(i18n, "author.unknown")}</p>{/if}
            {#if snapshot && aiOn}
                <button type="button" class="glean-btn glean-btn--ghost" disabled={busy || suggesting || needsReload} onclick={() => void suggest()}>{t(i18n, "author.suggestion.request")}</button>
            {/if}
            {#if suggesting}<p role="status">{t(i18n, "author.suggestion.loading")}</p>{/if}
            {#if suggestionMessage}<p role="status">{t(i18n, suggestionMessage)}</p>{/if}
            {#if suggestion && aiOn}
                <section class="glean-author-editor__suggestion" aria-label={t(i18n, "author.suggestion.source")}>
                    <p>{t(i18n, "author.suggestion.source")}</p>
                    <p>{t(i18n, "author.label")}: <strong>{suggestion.author}</strong></p>
                    <p>{t(i18n, "author.suggestion.evidence")}</p>
                    <blockquote>{suggestion.evidence}</blockquote>
                    <div class="glean-author-editor__actions">
                        <button type="button" class="glean-btn" disabled={busy || suggesting || needsReload} onclick={adoptSuggestion}>{t(i18n, "author.suggestion.adopt")}</button>
                        <button type="button" class="glean-btn glean-btn--ghost" onclick={clearSuggestion}>{t(i18n, "author.suggestion.discard")}</button>
                    </div>
                </section>
            {/if}
            {#if suggestionAdopted}<p role="status">{t(i18n, "author.suggestion.draftHint")}</p>{/if}
            {#if errorKey}<p role="alert">{t(i18n, errorKey)}</p>{/if}
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
    .glean-author-editor__form { display: grid; gap: 8px; padding: 8px; color: var(--b3-theme-on-surface); }
    .glean-author-editor__form label { display: grid; gap: 6px; }
    .glean-author-editor__form input { width: 100%; min-width: 0; box-sizing: border-box; }
    .glean-author-editor__form p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
    .glean-author-editor__actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .glean-author-editor__suggestion { display: grid; gap: 6px; min-width: 0; padding: 8px; border: 1px solid var(--b3-border-color); border-radius: 6px; }
    .glean-author-editor__suggestion blockquote { margin: 0; padding-left: 8px; border-left: 2px solid var(--b3-theme-primary); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import { MAX_BACKUP_BYTES } from "../domain/backup";
    import { ATTR } from "../domain/schema";
    import { applyBackupRestore, BACKUP_PREVIEW_CANCELLED, exportLibraryBackup, previewBackupRestore, type RestoreReport, type RestoreSession } from "../services/backup-service";

    interface Props { facade: GleanFacade; settingsDirty?: boolean; settingsBusy?: boolean; onPreferencesRestored?: () => void }
    let { facade, settingsDirty = false, settingsBusy = false, onPreferencesRestored }: Props = $props();
    const i18n = $derived(facade.i18n);
    const instanceId = $props.id();
    const titleId = `glean-backup-title-${instanceId}`;
    let content = $state("");
    let filename = $state("");
    let busy = $state<"" | "file" | "export" | "preview" | "restore">("");
    let session = $state<RestoreSession | null>(null);
    let report = $state<RestoreReport | null>(null);
    let error = $state("");
    let page = $state(0);
    let processed = $state(0);
    let total = $state(0);
    let restoreSettings = $state(false);
    let restoreUiPrefs = $state(false);
    let mounted = false;
    let controller: AbortController | null = null;
    const requests = createLatestRequestGate();
    const pageCount = $derived(Math.max(1, Math.ceil((session?.rows.length ?? 0) / 25)));
    const pageRows = $derived(session?.rows.slice(page * 25, (page + 1) * 25) ?? []);
    const selectedFields = $derived(session?.rows.reduce((count, row) => count + row.fields.filter((field) => field.supported && field.selected).length, 0) ?? 0);
    const configAllowed = $derived(!settingsDirty && !settingsBusy && session?.preferences.settingsSupported);

    onMount(() => {
        mounted = true;
        return () => { mounted = false; requests.invalidate(); controller?.abort(); };
    });

    function reset(): void {
        session = null;
        report = null;
        error = "";
        page = 0;
        restoreSettings = false;
        restoreUiPrefs = false;
    }

    async function chooseFile(event: Event): Promise<void> {
        if (busy) return;
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        reset();
        content = "";
        filename = file.name;
        if (file.size > MAX_BACKUP_BYTES) { error = t(i18n, "backup.tooLarge"); return; }
        const isCurrent = requests.begin();
        busy = "file";
        try {
            const text = await file.text();
            if (mounted && isCurrent()) content = text;
        } catch (failure) {
            if (mounted && isCurrent()) error = t(i18n, "backup.failed", { error: String(failure).slice(0, 200) });
        } finally { if (mounted && isCurrent()) busy = ""; }
    }

    async function download(): Promise<void> {
        if (busy) return;
        busy = "export";
        error = "";
        try {
            const text = await exportLibraryBackup(facade.pluginInstance, facade.settings);
            if (!mounted) return;
            const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `siyuan-glean-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (failure) {
            if (mounted) error = t(i18n, "backup.failed", { error: String(failure).slice(0, 200) });
        } finally { if (mounted) busy = ""; }
    }

    async function preview(): Promise<void> {
        if (busy || !content) return;
        reset();
        const isCurrent = requests.begin();
        controller = new AbortController();
        busy = "preview";
        try {
            const next = await previewBackupRestore(facade.pluginInstance, content, controller.signal);
            if (mounted && isCurrent()) session = next;
        } catch (failure) {
            if (mounted && isCurrent() && !(failure instanceof Error && failure.message === BACKUP_PREVIEW_CANCELLED)) {
                error = t(i18n, "backup.failed", { error: String(failure).slice(0, 200) });
            }
        } finally { if (mounted && isCurrent()) { busy = ""; controller = null; } }
    }

    function selectMissing(): void {
        if (busy || !session || session.used) return;
        for (const row of pageRows) for (const field of row.fields) if (field.supported && field.kind === "add") field.selected = true;
    }

    function clearSelection(): void {
        if (busy || !session || session.used) return;
        for (const row of session.rows) for (const field of row.fields) field.selected = false;
    }

    async function apply(): Promise<void> {
        if (busy || !session || session.used || (restoreSettings && !configAllowed)) return;
        const restoring = session;
        controller = new AbortController();
        busy = "restore";
        error = "";
        report = null;
        processed = 0;
        total = restoring.rows.filter((row) => row.state === "ready" && row.fields.some((field) => field.supported && field.selected)).length;
        try {
            const result = await applyBackupRestore(facade.pluginInstance, restoring, {
                confirmed: true,
                signal: controller.signal,
                restoreSettings,
                restoreUiPrefs,
                updateSettings: (next, expected) => facade.updateSettings(next, { expected }),
                onProgress: (done, count) => { if (mounted) { processed = done; total = count; } },
            });
            facade.notifyDataChanged();
            if (!mounted) { showMessage(t(i18n, "backup.background", { n: result.applied }), 6000); return; }
            report = result;
            if (result.settings === "applied") onPreferencesRestored?.();
        } catch (failure) {
            facade.notifyDataChanged();
            if (mounted) error = t(i18n, "backup.failed", { error: String(failure).slice(0, 200) });
        } finally { if (mounted) { busy = ""; controller = null; } }
    }
</script>

<section class="glean-backup" aria-labelledby={titleId} aria-busy={Boolean(busy)}>
    <header class="glean-backup__head">
        <div>
            <h3 id={titleId}>{t(i18n, "backup.title")}</h3>
            <p>{t(i18n, "backup.desc")}</p>
        </div>
        <span class="glean-backup__mode">JSON</span>
    </header>
    <div class="glean-backup__actions glean-backup__actions--primary">
        <button class="glean-btn" disabled={Boolean(busy)} onclick={() => void download()}>
            {#if busy === "export"}<span class="glean-inline-spinner" aria-hidden="true"></span>{/if}
            {busy === "export" ? t(i18n, "panel.loading") : t(i18n, "backup.export")}
        </button>
        <label class="glean-backup__file">{t(i18n, "backup.import")}<input type="file" accept=".json,application/json" disabled={Boolean(busy)} onchange={(event) => void chooseFile(event)} /></label>
        <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || !content} onclick={() => void preview()}>
            {#if busy === "preview"}<span class="glean-inline-spinner" aria-hidden="true"></span>{/if}
            {busy === "preview" ? t(i18n, "panel.loading") : t(i18n, session ? "backup.repreview" : "backup.preview")}
        </button>
    </div>
    {#if filename}<p class="glean-backup__filename">{filename}</p>{/if}
    {#if session}
        <p class="glean-backup__meta">{t(i18n, "backup.previewInfo", { createdAt: session.backup.createdAt, n: session.rows.length })}</p>
        <div class="glean-backup__actions glean-backup__actions--tools">
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || session.used} onclick={selectMissing}>{t(i18n, "backup.selectMissing")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || session.used} onclick={clearSelection}>{t(i18n, "backup.clear")}</button>
        </div>
        {#each pageRows as row (row.document.id)}
            <details class="glean-backup__row">
                <summary><span class="glean-backup__row-title">{row.snapshot?.meta.title || row.document.title}</span><span class="glean-backup__row-state glean-backup__row-state--{row.state}">{t(i18n, `backup.state.${row.state}`)}</span></summary>
                <p class="glean-backup__row-meta">{row.document.id} · {row.snapshot?.meta.hpath || row.document.hpath}</p>
                {#if row.fields.length > 0}
                    <div class="glean-backup__table">
                        <table>
                            <thead><tr><th scope="col">{t(i18n, "backup.field")}</th><th scope="col">{t(i18n, "backup.before")}</th><th scope="col">{t(i18n, "backup.after")}</th></tr></thead>
                            <tbody>
                                {#each row.fields as field (field.key)}
                                    <tr>
                                        <th scope="row"><label><input type="checkbox" bind:checked={field.selected} disabled={Boolean(busy) || session.used || !field.supported} />{field.key} · {t(i18n, `backup.kind.${field.kind}`)}</label>{#if !field.supported}<p>{t(i18n, "backup.unsupported")}</p>{/if}</th>
                                        <td><pre>{field.before ?? t(i18n, "backup.empty")}</pre></td>
                                        <td><pre>{field.after ?? t(i18n, "backup.empty")}</pre></td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                    {#if row.fields.some((field) => field.key === ATTR.url || field.key === ATTR.status)}
                        <label class="glean-backup__check"><input type="checkbox" bind:checked={row.allowDuplicate} disabled={Boolean(busy) || session.used} />{t(i18n, "backup.allowDuplicate")}</label>
                    {/if}
                {:else if row.state === "ready"}<p>{t(i18n, "backup.noChanges")}</p>{/if}
            </details>
        {/each}
        <nav class="glean-backup__actions glean-backup__pagination" aria-label={t(i18n, "backup.page", { page: page + 1, total: pageCount })}>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || page === 0} onclick={() => page -= 1}>{t(i18n, "backup.previous")}</button>
            <span>{t(i18n, "backup.page", { page: page + 1, total: pageCount })}</span>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || page + 1 >= pageCount} onclick={() => page += 1}>{t(i18n, "backup.next")}</button>
        </nav>
        <p class="glean-backup__section-hint">{t(i18n, "backup.prefsHint")}</p>
        <label class="glean-backup__check"><input type="checkbox" bind:checked={restoreSettings} disabled={Boolean(busy) || session.used || !configAllowed} />{t(i18n, "backup.restoreSettings")}</label>
        {#if settingsDirty}<p>{t(i18n, "backup.settingsDraft")}</p>{/if}
        {#if !session.preferences.settingsSupported}<p>{t(i18n, "backup.settingsUnsupported")}</p>{/if}
        <label class="glean-backup__check"><input type="checkbox" bind:checked={restoreUiPrefs} disabled={Boolean(busy) || session.used} />{t(i18n, "backup.restoreUiPrefs")}</label>
        <details class="glean-backup__preferences">
            <summary>{t(i18n, "backup.preferences")}</summary>
            <div class="glean-backup__diff"><div>{t(i18n, "backup.before")}<pre>{JSON.stringify({ settings: session.preferences.beforeSettings, uiPrefs: session.preferences.beforeUiPrefs }, null, 2)}</pre></div><div>{t(i18n, "backup.after")}<pre>{JSON.stringify({ settings: session.preferences.afterSettings, uiPrefs: session.preferences.afterUiPrefs }, null, 2)}</pre></div></div>
        </details>
        <div class="glean-backup__actions glean-backup__actions--footer">
            <button class="glean-btn glean-btn--pri" disabled={Boolean(busy) || session.used || (!selectedFields && !restoreSettings && !restoreUiPrefs) || (restoreSettings && !configAllowed)} onclick={() => void apply()}>{t(i18n, "backup.apply")}</button>
            {#if busy === "restore" || busy === "preview"}<button class="glean-btn glean-btn--ghost" onclick={() => controller?.abort()}>{t(i18n, busy === "preview" ? "action.cancel" : "backup.stop")}</button>{/if}
        </div>
    {/if}
    {#if busy}<p class="glean-backup__status glean-backup__status--busy" role="status" aria-live="polite"><span class="glean-backup__status-dot" aria-hidden="true"></span>{busy === "restore" ? t(i18n, "backup.progress", { done: processed, total }) : t(i18n, "panel.loading")}</p>{/if}
    {#if error}<p class="glean-backup__status glean-backup__status--error" role="alert" aria-live="assertive">{error}</p>{/if}
    {#if report}
        <p class="glean-backup__status glean-backup__status--success" role="status" aria-live="polite">{t(i18n, "backup.report", { applied: report.applied, total: report.selected, settings: t(i18n, `backup.state.${report.settings}`), uiPrefs: t(i18n, `backup.state.${report.uiPrefs}`) })}</p>
        {#if report.stopped}<p class="glean-backup__status glean-backup__status--notice">{t(i18n, "backup.stopped")}</p>{/if}
        {#if !report.indexFresh}<p class="glean-backup__status glean-backup__status--error" role="alert" aria-live="assertive">{t(i18n, "backup.indexFailed")}</p>{/if}
    {/if}
</section>

<style>
    .glean-backup { padding: var(--glean-space-4); display: grid; gap: var(--glean-space-3); min-width: 0; color: var(--b3-theme-on-background); }
    .glean-backup h3, .glean-backup p { margin: 0; overflow-wrap: anywhere; }
    .glean-backup h3 { font-size: var(--glean-text-xl); line-height: 1.35; letter-spacing: -0.01em; }
    .glean-backup p { font-size: var(--glean-text-sm); line-height: 1.6; color: var(--b3-theme-on-surface); }
    .glean-backup__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--glean-space-3); padding: var(--glean-space-3) var(--glean-space-4); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-grad-soft); box-shadow: var(--glean-shadow-card); }
    .glean-backup__head p { margin-top: var(--glean-space-1); }
    .glean-backup__mode { flex: 0 0 auto; padding: 4px 8px; border: 1px solid color-mix(in srgb, var(--glean-accent-b) 24%, var(--glean-border-soft)); border-radius: 999px; color: var(--glean-accent-b); background: var(--glean-primary-soft); font: 600 var(--glean-text-xs)/1.2 var(--b3-font-family); letter-spacing: .05em; }
    .glean-backup__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--glean-space-2); }
    .glean-backup__pagination { justify-content: space-between; padding-top: var(--glean-space-1); }
    .glean-backup__pagination > span { min-width: 0; flex: 1 1 auto; text-align: center; color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); overflow-wrap: anywhere; }
    .glean-backup__actions--primary { padding-bottom: var(--glean-space-1); }
    .glean-backup__actions--tools { padding: var(--glean-space-2) 0; border-block: 1px solid var(--glean-border-soft); }
    .glean-backup__file { display: grid; gap: var(--glean-space-1); min-width: 160px; padding: 7px 10px; border: 1px dashed var(--glean-border-soft); border-radius: var(--glean-radius-sm); color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); cursor: pointer; transition: background-color 160ms var(--glean-ease-out), border-color 160ms var(--glean-ease-out); }
    .glean-backup__file:hover { background: var(--glean-primary-soft); border-color: color-mix(in srgb, var(--b3-theme-primary) 45%, var(--glean-border-soft)); }
    .glean-backup__file input { max-width: 100%; font-size: var(--glean-text-xs); }
    .glean-backup__filename { padding: 6px 10px; border-radius: var(--glean-radius-sm); background: var(--glean-inset-surface); font-family: var(--b3-font-family-code); font-size: var(--glean-text-xs) !important; }
    .glean-backup__meta, .glean-backup__section-hint { color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs) !important; }
    .glean-backup__row { padding: var(--glean-space-2) var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-status-surface); box-shadow: var(--glean-shadow-card); transition: border-color 160ms var(--glean-ease-out), background-color 160ms var(--glean-ease-out), box-shadow 160ms var(--glean-ease-out); }
    .glean-backup__row[open] { border-color: color-mix(in srgb, var(--b3-theme-primary) 36%, var(--glean-border-soft)); background: var(--glean-section-surface); box-shadow: var(--glean-shadow-float); }
    .glean-backup summary { display: flex; align-items: center; gap: var(--glean-space-2); cursor: pointer; overflow-wrap: anywhere; padding: var(--glean-space-1) 0; font-size: var(--glean-text-md); font-weight: 600; list-style-position: outside; }
    .glean-backup summary::marker { color: var(--b3-theme-primary); }
    .glean-backup__row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .glean-backup__row-state { flex: 0 0 auto; padding: 3px 7px; border: 1px solid var(--glean-border-soft); border-radius: 999px; color: var(--b3-theme-on-surface); background: var(--glean-inset-surface); font-size: var(--glean-text-xs); font-weight: 500; }
    .glean-backup__row-state--ready { color: var(--glean-st-done-text); border-color: color-mix(in srgb, var(--glean-st-done) 28%, var(--glean-border-soft)); background: color-mix(in srgb, var(--glean-st-done) 9%, transparent); }
    .glean-backup__row-state--missing, .glean-backup__row-state--unsupported { color: var(--glean-st-inbox-text); background: color-mix(in srgb, var(--glean-st-inbox) 9%, transparent); }
    .glean-backup__row-meta { margin: var(--glean-space-2) 0 !important; font-family: var(--b3-font-family-code); font-size: var(--glean-text-xs) !important; }
    .glean-backup__table { overflow-x: auto; margin-top: var(--glean-space-2); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-sm); }
    .glean-backup table { width: 100%; min-width: 420px; border-collapse: collapse; text-align: left; }
    .glean-backup th, .glean-backup td { padding: var(--glean-space-2); border-bottom: 1px solid var(--glean-border-soft); vertical-align: top; }
    .glean-backup tr:last-child th, .glean-backup tr:last-child td { border-bottom: 0; }
    .glean-backup th { max-width: 180px; overflow-wrap: anywhere; font-size: var(--glean-text-sm); }
    .glean-backup pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; margin: 0; padding: var(--glean-space-2); border-radius: var(--glean-radius-sm); background: var(--glean-inset-surface); font-family: var(--b3-font-family-code); font-size: var(--glean-text-xs); line-height: 1.55; }
    .glean-backup__check { display: flex; align-items: center; gap: var(--glean-space-2); color: var(--b3-theme-on-surface); font-size: var(--glean-text-sm); }
    .glean-backup__diff { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--glean-space-2); }
    .glean-backup__preferences { padding: var(--glean-space-2) var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-md); background: var(--glean-inset-surface); }
    .glean-backup__preferences summary { font-size: var(--glean-text-sm); }
    .glean-backup__status { display: flex; align-items: center; gap: var(--glean-space-2); padding: var(--glean-space-2) var(--glean-space-3); border: 1px solid var(--glean-border-soft); border-radius: var(--glean-radius-sm); background: var(--glean-status-surface); }
    .glean-backup__status--busy { color: var(--b3-theme-primary) !important; }
    .glean-backup__status--success { color: var(--glean-st-done-text) !important; border-color: color-mix(in srgb, var(--glean-st-done) 25%, var(--glean-border-soft)); background: color-mix(in srgb, var(--glean-st-done) 8%, transparent); }
    .glean-backup__status--notice { color: var(--glean-st-later-text) !important; }
    .glean-backup__status--error { color: var(--b3-theme-error) !important; border-color: color-mix(in srgb, var(--b3-theme-error) 28%, var(--glean-border-soft)); background: var(--glean-error-surface); }
    .glean-backup__status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); animation: glean-backup-pulse 1.4s ease-in-out infinite; }
    .glean-backup :is(input, button, summary):focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @keyframes glean-backup-pulse { 50% { opacity: .45; transform: scale(.82); } }
    @media (prefers-reduced-motion: reduce) { .glean-backup__status-dot { animation: none; } }
    @media (max-width: 560px) {
        .glean-backup { padding: var(--glean-space-3); }
        .glean-backup__head { padding: var(--glean-space-3); }
        .glean-backup__diff { grid-template-columns: 1fr; }
        .glean-backup__actions--primary > :global(button), .glean-backup__actions--tools > :global(button), .glean-backup :is(summary), .glean-backup__check, .glean-backup th label { min-height: 44px; }
        .glean-backup__file { min-width: min(100%, 220px); }
        .glean-backup summary { align-items: flex-start; }
        .glean-backup__row-state { margin-left: auto; }
        .glean-backup__pagination { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr); }
        .glean-backup__pagination > :is(button, span) { min-width: 0; text-align: center; }
        .glean-backup__pagination > button { width: 100%; }
    }
</style>

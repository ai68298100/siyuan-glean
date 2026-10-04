<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { createLatestRequestGate } from "../libs/latest-request";
    import { MAX_BACKUP_BYTES } from "../domain/backup";
    import { ATTR } from "../domain/schema";
    import { applyBackupRestore, exportLibraryBackup, previewBackupRestore, type RestoreReport, type RestoreSession } from "../services/backup-service";

    interface Props { facade: GleanFacade; settingsDirty?: boolean; settingsBusy?: boolean; onPreferencesRestored?: () => void }
    let { facade, settingsDirty = false, settingsBusy = false, onPreferencesRestored }: Props = $props();
    const i18n = $derived(facade.i18n);
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
        const file = (event.target as HTMLInputElement).files?.[0];
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
            if (mounted && isCurrent()) error = t(i18n, "backup.failed", { error: String(failure).slice(0, 200) });
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

<section class="glean-backup" aria-label={t(i18n, "backup.title")} aria-busy={Boolean(busy)}>
    <h3>{t(i18n, "backup.title")}</h3>
    <p>{t(i18n, "backup.desc")}</p>
    <div class="glean-backup__actions">
        <button class="glean-btn" disabled={Boolean(busy)} onclick={() => void download()}>{t(i18n, "backup.export")}</button>
        <label class="glean-backup__file">{t(i18n, "backup.import")}<input type="file" accept=".json,application/json" disabled={Boolean(busy)} onchange={(event) => void chooseFile(event)} /></label>
        <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || !content} onclick={() => void preview()}>{t(i18n, session ? "backup.repreview" : "backup.preview")}</button>
    </div>
    {#if filename}<p>{filename}</p>{/if}
    {#if session}
        <p>{t(i18n, "backup.previewInfo", { createdAt: session.backup.createdAt, n: session.rows.length })}</p>
        <div class="glean-backup__actions">
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || session.used} onclick={selectMissing}>{t(i18n, "backup.selectMissing")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || session.used} onclick={clearSelection}>{t(i18n, "backup.clear")}</button>
        </div>
        {#each pageRows as row (row.document.id)}
            <details class="glean-backup__row">
                <summary>{row.snapshot?.meta.title || row.document.title} · {t(i18n, `backup.state.${row.state}`)}</summary>
                <p>{row.document.id} · {row.snapshot?.meta.hpath || row.document.hpath}</p>
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
        <div class="glean-backup__actions">
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || page === 0} onclick={() => page -= 1}>{t(i18n, "backup.previous")}</button>
            <span>{t(i18n, "backup.page", { page: page + 1, total: pageCount })}</span>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(busy) || page + 1 >= pageCount} onclick={() => page += 1}>{t(i18n, "backup.next")}</button>
        </div>
        <p>{t(i18n, "backup.prefsHint")}</p>
        <label class="glean-backup__check"><input type="checkbox" bind:checked={restoreSettings} disabled={Boolean(busy) || session.used || !configAllowed} />{t(i18n, "backup.restoreSettings")}</label>
        {#if settingsDirty}<p>{t(i18n, "backup.settingsDraft")}</p>{/if}
        {#if !session.preferences.settingsSupported}<p>{t(i18n, "backup.settingsUnsupported")}</p>{/if}
        <label class="glean-backup__check"><input type="checkbox" bind:checked={restoreUiPrefs} disabled={Boolean(busy) || session.used} />{t(i18n, "backup.restoreUiPrefs")}</label>
        <details class="glean-backup__preferences">
            <summary>{t(i18n, "backup.preferences")}</summary>
            <div class="glean-backup__diff"><div>{t(i18n, "backup.before")}<pre>{JSON.stringify({ settings: session.preferences.beforeSettings, uiPrefs: session.preferences.beforeUiPrefs }, null, 2)}</pre></div><div>{t(i18n, "backup.after")}<pre>{JSON.stringify({ settings: session.preferences.afterSettings, uiPrefs: session.preferences.afterUiPrefs }, null, 2)}</pre></div></div>
        </details>
        <div class="glean-backup__actions">
            <button class="glean-btn glean-btn--pri" disabled={Boolean(busy) || session.used || (!selectedFields && !restoreSettings && !restoreUiPrefs) || (restoreSettings && !configAllowed)} onclick={() => void apply()}>{t(i18n, "backup.apply")}</button>
            {#if busy === "restore" || busy === "preview"}<button class="glean-btn glean-btn--ghost" onclick={() => controller?.abort()}>{t(i18n, "backup.stop")}</button>{/if}
        </div>
    {/if}
    {#if busy}<p role="status">{busy === "restore" ? t(i18n, "backup.progress", { done: processed, total }) : t(i18n, "panel.loading")}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if report}
        <p role="status">{t(i18n, "backup.report", { applied: report.applied, total: report.selected, settings: t(i18n, `backup.state.${report.settings}`), uiPrefs: t(i18n, `backup.state.${report.uiPrefs}`) })}</p>
        {#if report.stopped}<p>{t(i18n, "backup.stopped")}</p>{/if}
        {#if !report.indexFresh}<p role="alert">{t(i18n, "backup.indexFailed")}</p>{/if}
    {/if}
</section>

<style>
    .glean-backup { padding: 12px; display: grid; gap: 8px; min-width: 0; color: var(--b3-theme-on-background); }
    .glean-backup h3, .glean-backup p { margin: 0; overflow-wrap: anywhere; }
    .glean-backup p { font-size: 12px; line-height: 1.6; color: var(--b3-theme-on-surface); }
    .glean-backup__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .glean-backup__file { display: grid; gap: 4px; min-width: 0; }
    .glean-backup__file input { max-width: 100%; }
    .glean-backup__row { padding: 8px; border: 1px solid var(--b3-border-color); border-radius: 4px; }
    .glean-backup summary { cursor: pointer; overflow-wrap: anywhere; padding: 4px 0; }
    .glean-backup__table { overflow-x: auto; }
    .glean-backup table { width: 100%; min-width: 420px; border-collapse: collapse; text-align: left; }
    .glean-backup th, .glean-backup td { padding: 6px; border-bottom: 1px solid var(--b3-border-color); vertical-align: top; }
    .glean-backup th { max-width: 180px; overflow-wrap: anywhere; font-size: 12px; }
    .glean-backup pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; margin: 4px 0; font-family: var(--b3-font-family-code); font-size: 12px; }
    .glean-backup__check { display: flex; align-items: center; gap: 8px; }
    .glean-backup__diff { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .glean-backup :is(input, button, summary):focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
    @media (max-width: 560px) {
        .glean-backup__diff { grid-template-columns: 1fr; }
        .glean-backup :is(button, summary), .glean-backup__check, .glean-backup th label { min-height: 44px; }
    }
</style>

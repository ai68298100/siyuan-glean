<script lang="ts">
/** 迁移导入弹窗（T-1501）：Pocket HTML/CSV、Omnivore JSON、wallabag JSON → 思源读库。 */
import { onMount } from "svelte";
import { openMobileFileById, openTab, showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import {
    previewImport,
    runImport,
    ImportExecutionError,
    summarizeImportStatuses,
    type ImportPreview,
    type ImportPreviewRow,
    type ImportSummary,
} from "../services/import-service";
import type { ImportFormat } from "../domain/importers";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";
import { ImportProgressError, summarizeImportProgress, type ImportProgress } from "../domain/import-progress";
import { discardImportProgress, fingerprintImportSource, loadImportProgress } from "../services/import-progress";

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);

type Phase = "pick" | "preview" | "importing" | "done";

let phase = $state<Phase>("pick");
let format = $state<ImportFormat | "auto">("auto");
let notebooks = $state<NotebookMeta[]>([]);
let notebookLoading = $state(false);
let notebookError = $state(false);
let notebookId = $state("");
let folder = $state("");
let preview = $state<ImportPreview | null>(null);
let summary = $state<ImportSummary | null>(null);
let retryRows = $state<ImportPreviewRow[]>([]);
let busy = $state(false);
let progress = $state(0);
let importConfirmed = $state(false);
const PREVIEW_PAGE_SIZE = 50;
let previewPage = $state(1);
let fileInput = $state<HTMLInputElement | null>(null);
let progressRecord = $state<ImportProgress | null>(null);
let progressError = $state("");
let progressLoaded = $state(false);
let progressLoading = $state(false);
let progressReadFailed = $state(false);
let resumeConfirmed = $state(false);
let discardConfirmed = $state(false);
let stopping = $state(false);
let mounted = false;
let controller: AbortController | null = null;
const unfinished = $derived(Boolean(progressRecord && progressRecord.state !== "finished"));
const progressCounts = $derived(progressRecord ? summarizeImportProgress(progressRecord) : null);
const resumable = $derived(unfinished && Boolean(preview && progressRecord && preview.fingerprint === progressRecord.fingerprint && preview.format === progressRecord.format));
const targetAvailable = $derived(notebooks.some((notebook) => notebook.id === notebookId));

onMount(() => {
    mounted = true;
    notebookId = facade.settings.anchorNotebooks[0] ?? "";
    folder = t(i18n, "import.defaultFolder");
    void loadNotebooks();
    void refreshProgress();
    return () => { mounted = false; controller?.abort(); };
});

function progressFailure(error: unknown): string {
    return t(i18n, `import.progress.error.${error instanceof ImportProgressError ? error.reason : "read"}`);
}

async function refreshProgress(): Promise<void> {
    if (progressLoading) return;
    progressLoading = true;
    try {
        const record = await loadImportProgress(facade.pluginInstance);
        if (!mounted) return;
        progressRecord = record;
        progressError = "";
        progressReadFailed = false;
        progressLoaded = true;
        if (record && record.state !== "finished") { notebookId = record.notebookId; folder = record.folder; format = record.format; }
    } catch (error) {
        if (mounted) { progressError = progressFailure(error); progressReadFailed = true; progressLoaded = false; }
    } finally { if (mounted) progressLoading = false; }
}

async function discardProgress(): Promise<void> {
    if (busy || !progressRecord || !discardConfirmed) return;
    busy = true;
    try {
        await discardImportProgress(facade.pluginInstance, progressRecord.taskId, true);
        if (!mounted) return;
        progressRecord = null;
        progressError = "";
        discardConfirmed = false;
        resetToPick();
    } catch (error) { if (mounted) progressError = progressFailure(error); }
    finally { if (mounted) busy = false; }
}

async function loadNotebooks() {
    if (notebookLoading) return;
    notebookLoading = true;
    try {
        const items = await listNotebooks();
        if (!mounted) return;
        notebooks = items;
        if (!items.some((item) => item.id === notebookId) && !unfinished) notebookId = items[0]?.id ?? "";
        notebookError = false;
    } catch {
        if (mounted) notebookError = true;
    } finally {
        if (mounted) notebookLoading = false;
    }
}

const previewRows = $derived(preview ? preview.rows.filter((row, index) => unfinished && progressRecord ? ["pending", "created", "failed"].includes(progressRecord.rows[index]?.state ?? "") : !row.duplicate) : []);
const importable = $derived(previewRows.length);
const statusSummary = $derived(summarizeImportStatuses(previewRows.map((row) => ({ ...row, duplicate: false }))));

const previewPageCount = $derived(preview ? Math.max(1, Math.ceil(preview.rows.length / PREVIEW_PAGE_SIZE)) : 1);
const pagedRows = $derived.by(() => {
    if (!preview) return [];
    const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    return preview.rows.slice(start, start + PREVIEW_PAGE_SIZE);
});

function pickFile() {
    fileInput?.click();
}

async function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || busy) return;
    busy = true;
    preview = null;
    resumeConfirmed = false;
    importConfirmed = false;
    progressError = "";
    try {
        const record = await loadImportProgress(facade.pluginInstance);
        const bytes = await file.arrayBuffer();
        const fingerprint = await fingerprintImportSource(bytes);
        if (record && record.state !== "finished" && fingerprint !== record.fingerprint) throw new ImportProgressError("file");
        const parsed = await previewImport(new TextDecoder().decode(bytes), record && record.state !== "finished" ? record.format : format, fingerprint);
        if (!mounted) return;
        progressRecord = record;
        progressLoaded = true;
        progressReadFailed = false;
        if (record && record.state !== "finished") { notebookId = record.notebookId; folder = record.folder; format = record.format; }
        preview = parsed;
        summary = null;
        retryRows = [];
        previewPage = 1;
        phase = "preview";
    } catch (error) {
        if (mounted) { phase = "pick"; progressError = progressFailure(error); }
    } finally {
        if (mounted) busy = false;
        input.value = "";
    }
}

function mergeSummaries(next: ImportSummary, record: ImportProgress | null): ImportSummary {
    if (!record || !preview) return next;
    const counts = summarizeImportProgress(record);
    const failedRows = record.rows.map((entry, index) => ({ entry, row: preview!.rows[index] })).filter(({ entry }) => entry.state === "failed");
    return {
        ...next,
        imported: counts.applied,
        skippedDuplicate: counts.duplicate,
        failed: counts.failed,
        unknown: counts.unknown,
        docIds: record.rows.filter((entry) => entry.state === "applied").map((entry) => entry.docId),
        failedUrls: failedRows.map(({ row }) => row.url),
        failedItems: failedRows.map(({ entry, row }) => ({ url: row.url, docId: entry.docId })),
    };
}

async function startImport(rowsOverride?: ImportPreviewRow[]) {
    if (busy || notebookLoading || notebookError || !preview || !targetAvailable || !progressLoaded || progressReadFailed) return;
    if (unfinished ? !resumable || !resumeConfirmed : !importConfirmed) return;
    phase = "importing";
    busy = true;
    progress = 0;
    stopping = false;
    progressError = "";
    controller = new AbortController();
    let result: ImportSummary | null = null;
    try {
        result = await runImport(facade.pluginInstance, preview.rows, {
            fingerprint: preview.fingerprint,
            resumeTaskId: unfinished ? progressRecord?.taskId : undefined,
            notebookId,
            folder: folder.trim() || t(i18n, "import.defaultFolder"),
            format: preview.format ?? "pocket-html",
            retryFailures: rowsOverride ? summary?.failedItems : undefined,
            signal: controller.signal,
            onProgress: (done, total) => {
                if (mounted) progress = total > 0 ? Math.round((done / total) * 100) : 100;
            },
        });
    } catch (error) {
        if (error instanceof ImportExecutionError) result = error.summary;
        if (mounted) progressError = progressFailure(error);
    } finally {
        facade.notifyDataChanged();
        if (mounted) {
            await refreshProgress();
            if (!mounted) return;
            if (result) { summary = mergeSummaries(result, progressRecord); retryRows = preview.rows.filter((row) => summary!.failedUrls.includes(row.url)); phase = "done"; }
            else phase = "preview";
            busy = false;
            controller = null;
            resumeConfirmed = false;
        } else if (result) showMessage(t(i18n, "import.progress.closed", { n: result.imported }), 5000);
    }
}

function resetToPick() {
    phase = "pick";
    preview = null;
    summary = null;
    retryRows = [];
    importConfirmed = false;
    previewPage = 1;
    resumeConfirmed = false;
}

function openProgressDocument(id: string): void {
    if (facade.isMobile) openMobileFileById(facade.pluginInstance.app, id);
    else void openTab({ app: facade.pluginInstance.app, doc: { id } });
}
</script>

<div class="glean-migrate" aria-labelledby="glean-import-title" aria-busy={busy}>
    <div class="glean-dlg-head">
        <div class="glean-brand__mark glean-dlg-head__mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <h2 id="glean-import-title" class="glean-dlg-head__t">{t(i18n, "import.title")}</h2>
            <div class="glean-dlg-head__sub">{t(i18n, "import.intro")}</div>
        </div>
    </div>

    {#if progressError}<p class="glean-import-progress__error" role="alert">{progressError}</p>{/if}
    {#if progressLoading || progressReadFailed}
        <div class="glean-import-progress__actions">
            {#if progressLoading}<span role="status">{t(i18n, "panel.loading")}</span>{/if}
            <button class="glean-btn glean-btn--ghost" disabled={progressLoading || busy} onclick={() => void refreshProgress()}>{t(i18n, "action.retry")}</button>
        </div>
    {/if}
    {#if progressRecord && progressCounts}
        <section class="glean-import-progress" aria-label={t(i18n, "import.progress.title")}>
            <h3>{t(i18n, "import.progress.title")} · {t(i18n, `import.progress.state.${progressRecord.state}`)}</h3>
            <p>{t(i18n, "import.progress.target", { notebook: notebooks.find((notebook) => notebook.id === progressRecord?.notebookId)?.name ?? progressRecord.notebookId, folder: progressRecord.folder })}</p>
            <p role="status">{t(i18n, "import.progress.counts", { ...progressCounts, total: progressRecord.rows.length })}</p>
            {#if unfinished}<p>{t(i18n, "import.progress.hint")}</p>{/if}
            {#if progressCounts.unknown > 0}<p>{t(i18n, "import.progress.unknownHint")}</p>{/if}
            <details>
                <summary>{t(i18n, "import.progress.entries")}</summary>
                <div class="glean-import-progress__rows">
                    {#each progressRecord.rows as entry, index (entry.key)}
                        <div class="glean-import-progress__row">
                            <span>{preview?.rows[index]?.title || entry.hpath} · {t(i18n, `import.progress.row.${entry.state}`)}</span>
                            {#if entry.reason}<span>{t(i18n, `import.progress.reason.${entry.reason}`)}</span>{/if}
                            {#if entry.docId}<button class="glean-btn glean-btn--ghost" onclick={() => openProgressDocument(entry.docId)}>{t(i18n, "action.openDoc")}</button>{/if}
                        </div>
                    {/each}
                </div>
            </details>
            {#if unfinished && !busy}
                <label class="glean-import-progress__check"><input type="checkbox" bind:checked={resumeConfirmed} disabled={!resumable || !targetAvailable || progressReadFailed} />{t(i18n, "import.progress.confirmResume")}</label>
                <div class="glean-import-progress__actions">
                    <button class="glean-btn glean-btn--pri" disabled={!resumable || !resumeConfirmed || !targetAvailable || importable === 0 || progressReadFailed} onclick={() => void startImport()}>{t(i18n, "import.progress.resume")}</button>
                    <button class="glean-btn glean-btn--ghost" onclick={resetToPick}>{t(i18n, "import.pickFile")}</button>
                </div>
            {/if}
            <label class="glean-import-progress__check"><input type="checkbox" bind:checked={discardConfirmed} disabled={busy || progressLoading} />{t(i18n, "import.progress.confirmDiscard")}</label>
            <button class="glean-btn glean-btn--ghost" disabled={busy || progressLoading || !discardConfirmed} onclick={() => void discardProgress()}>{t(i18n, "import.progress.discard")}</button>
        </section>
    {/if}

    {#if phase === "pick" || phase === "preview"}
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "import.format")}</div>
                <select class="b3-select glean-import__select" aria-label={t(i18n, "import.format")} disabled={busy || unfinished} bind:value={format} onchange={() => { preview = null; importConfirmed = false; phase = "pick"; }}>
                    <option value="auto">{t(i18n, "import.formatAuto")}</option>
                    <option value="pocket-html">Pocket HTML</option>
                    <option value="pocket-csv">Pocket CSV</option>
                    <option value="omnivore-json">Omnivore JSON</option>
                    <option value="wallabag-json">wallabag JSON</option>
                </select>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "import.notebook")}
                    <div class="glean-set-row__desc">{t(i18n, "import.notebookDesc")}</div>
                </div>
                <select class="b3-select glean-import__select" aria-label={t(i18n, "import.notebook")} disabled={busy || unfinished || notebookLoading || notebookError} bind:value={notebookId} onchange={() => (importConfirmed = false)}>
                    {#each notebooks as notebook (notebook.id)}
                        <option value={notebook.id}>{notebook.name}</option>
                    {/each}
                </select>
                {#if notebookLoading}
                    <div class="glean-set-row__desc" role="status">{t(i18n, "panel.loading")}</div>
                {:else if notebookError}
                    <div class="glean-set-row__desc glean-import__warning" role="status">{t(i18n, "import.notebookFailed")}</div>
                {/if}
                {#if notebookError || (!notebookLoading && notebooks.length === 0)}
                    <button class="glean-btn glean-btn--ghost" disabled={notebookLoading} onclick={() => void loadNotebooks()}>{t(i18n, "action.retry")}</button>
                {/if}
                {#if !notebookLoading && !notebookError && notebooks.length === 0}
                    <div class="glean-set-row__desc glean-import__warning">{t(i18n, "import.noNotebook")}</div>
                {/if}
                {#if unfinished && !notebookLoading && !targetAvailable}<p role="alert">{t(i18n, "import.progress.error.target")}</p>{/if}
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "import.folder")}</div>
                <input class="glean-mini-input glean-import__folder" aria-label={t(i18n, "import.folder")} disabled={busy || unfinished} bind:value={folder} oninput={() => (importConfirmed = false)} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "import.file")}</div>
                <input
                    bind:this={fileInput}
                    type="file"
                    accept=".html,.csv,.json,.txt"
                    style="display:none"
                    onchange={(event) => void onFileChosen(event)}
                />
                <button class="glean-btn glean-import__pick" disabled={busy} onclick={() => pickFile()}>
                    {busy ? t(i18n, "panel.loading") : t(i18n, "import.pickFile")}
                </button>
            </div>
        </div>
    {/if}

    {#if phase === "preview" && preview}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{importable}</div><div class="glean-mstat__l">{t(i18n, "import.willImport")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{preview.duplicateCount}</div><div class="glean-mstat__l">{t(i18n, "import.dupCount")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{preview.rows.length}</div><div class="glean-mstat__l">{t(i18n, "import.parsedCount")}</div></div>
        </div>
        <div class="glean-import-confirm">
            <div class="glean-import-confirm__title">{t(i18n, "import.statusMapping")}</div>
            <div class="glean-import-confirm__desc">{t(i18n, "import.statusMappingDesc")}</div>
            <div class="glean-import-confirm__statuses">
                {#each statusSummary as item (item.status)}
                    <span class="glean-import-confirm__status">
                        <span>{item.status === "inbox" ? t(i18n, "import.sourceUnread") : item.status === "done" ? t(i18n, "import.sourceRead") : t(i18n, "import.sourceArchived")}</span>
                        <svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowRight" /></svg>
                        <strong>{t(i18n, `status.${item.status}`)} × {item.count}</strong>
                    </span>
                {/each}
                {#if statusSummary.length === 0}
                    <span class="glean-import-confirm__empty">{t(i18n, "import.noImportable")}</span>
                {/if}
            </div>
            <label class="glean-import-confirm__check">
                <input type="checkbox" bind:checked={importConfirmed} disabled={unfinished || importable === 0 || !targetAvailable || notebookLoading || notebookError} />
                <span>{t(i18n, "import.confirm", { n: importable })}</span>
            </label>
        </div>
        <div class="glean-mtable">
            {#each pagedRows as row (row.url)}
                <div class="glean-mrow">
                    <span class="glean-mrow__ti">{row.title || row.url}</span>
                    <span class="glean-mrow__url">{row.site || "—"}</span>
                    <span class="glean-mrow__st" class:glean-mrow__st--skip={row.duplicate}>
                        {row.duplicate ? t(i18n, "import.dupLabel") : row.status}
                    </span>
                </div>
            {/each}
        </div>
        {#if previewPageCount > 1}
            <div class="glean-prog-meta glean-import__pagination">
                <button class="glean-btn glean-btn--ghost glean-import__page-btn" disabled={previewPage <= 1} onclick={() => (previewPage -= 1)}><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowLeft" /></svg>{t(i18n, "import.prevPage")}</button>
                <span>{t(i18n, "import.pageInfo", { page: previewPage, total: previewPageCount })}</span>
                <button class="glean-btn glean-btn--ghost glean-import__page-btn" disabled={previewPage >= previewPageCount} onclick={() => (previewPage += 1)}>{t(i18n, "import.nextPage")}<svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowRight" /></svg></button>
            </div>
        {/if}
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--ghost" onclick={resetToPick}>{t(i18n, "migrate.rescan")}</button>
            <button class="glean-btn glean-btn--pri" disabled={busy || unfinished || !progressLoaded || progressReadFailed || importable === 0 || !targetAvailable || !importConfirmed || notebookLoading || notebookError} onclick={() => void startImport()}>
                {t(i18n, "import.start")}
            </button>
        </div>
    {:else if phase === "importing"}
        <div role="status" aria-live="polite" aria-atomic="true">
            <div class="glean-progress"><div class="glean-progress__bar" style={`width:${progress}%`}></div></div>
            <div class="glean-prog-meta"><span>{t(i18n, "import.importing")}</span><span>{progress}%</span></div>
        </div>
        <button class="glean-btn glean-btn--ghost" disabled={stopping} onclick={() => { stopping = true; controller?.abort(); }}>{t(i18n, stopping ? "import.progress.stopping" : "import.progress.pause")}</button>
    {:else if phase === "done" && summary}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.imported}</div><div class="glean-mstat__l">{t(i18n, "import.imported")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.skippedDuplicate}</div><div class="glean-mstat__l">{t(i18n, "import.dupCount")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.failed}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        {#if retryRows.length > 0}
            <p class="glean-set-row__desc" role="status">{t(i18n, "import.retryHint")}</p>
        {/if}
        <div class="glean-migrate__ops">
            {#if retryRows.length > 0}
                <button class="glean-btn glean-btn--ghost" disabled={busy || !resumeConfirmed || progressReadFailed} onclick={() => void startImport(retryRows)}>{t(i18n, "import.retryFailed")}</button>
            {/if}
            <button class="glean-btn glean-btn--pri" onclick={() => void onClose()}>{t(i18n, "action.close")}</button>
        </div>
    {/if}
</div>

<style>
    .glean-import-progress {
        display: grid;
        gap: var(--glean-space-2);
        padding: var(--glean-space-3);
        margin: var(--glean-space-2) 0;
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-lg);
        background: color-mix(in srgb, var(--b3-theme-surface) 84%, transparent);
        box-shadow: var(--glean-shadow-card);
    }
    .glean-import-progress h3,
    .glean-import-progress p { margin: 0; overflow-wrap: anywhere; }
    .glean-import-progress h3 {
        color: var(--b3-theme-on-background);
        font-size: var(--glean-text-sm);
        line-height: 1.4;
    }
    .glean-import-progress p { color: var(--b3-theme-on-surface); font-size: var(--glean-text-xs); line-height: 1.5; }
    .glean-import-progress__actions,
    .glean-import-progress__check { display: flex; align-items: center; gap: var(--glean-space-2); flex-wrap: wrap; }
    .glean-import-progress__rows { max-height: 260px; overflow: auto; padding-top: 2px; }
    .glean-import-progress__row { display: flex; align-items: center; gap: var(--glean-space-2); padding: 7px 0; border-top: 1px solid var(--glean-border-soft); flex-wrap: wrap; overflow-wrap: anywhere; }
    .glean-import-progress__error {
        margin: 0;
        padding: var(--glean-space-2) var(--glean-space-3);
        border: 1px solid color-mix(in srgb, var(--b3-theme-error) 24%, transparent);
        border-radius: var(--glean-radius-md);
        background: color-mix(in srgb, var(--b3-theme-error) 8%, transparent);
        color: var(--b3-theme-error);
        overflow-wrap: anywhere;
    }
    @media (max-width: 560px) { .glean-import-progress :is(button, summary), .glean-import-progress__check { min-height: 44px; } }
</style>

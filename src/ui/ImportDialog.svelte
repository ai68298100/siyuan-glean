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
import { IMPORT_PROGRESS_FILE } from "../domain/import-progress";

/** 导入文件读取上限（32 MiB，与备份同数量级）：整文件解码/指纹/解析都在主线程。 */
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);
const instanceId = $props.id();
const idPrefix = `glean-import-${instanceId}`;
const titleId = `${idPrefix}-title`;
const descId = `${idPrefix}-desc`;
const progressTitleId = `${idPrefix}-progress-title`;
const formatId = `${idPrefix}-format`;
const notebookIdControl = `${idPrefix}-notebook`;
const folderId = `${idPrefix}-folder`;

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
let sourceFileName = $state("");
let progressRecord = $state<ImportProgress | null>(null);
let progressError = $state("");
let progressLoaded = $state(false);
let progressLoading = $state(false);
let progressReadFailed = $state(false);
let resumeConfirmed = $state(false);
let discardConfirmed = $state(false);
let forceResetConfirmed = $state(false);
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

async function refreshProgress(): Promise<ImportProgress | null | undefined> {
    if (progressLoading) return;
    progressLoading = true;
    try {
        const record = await loadImportProgress(facade.pluginInstance);
        if (!mounted) return;
        progressRecord = record;
        progressError = "";
        progressReadFailed = false;
        progressLoaded = true;
        forceResetConfirmed = false;
        if (record && record.state !== "finished") { notebookId = record.notebookId; folder = record.folder; format = record.format; }
        return record;
    } catch (error) {
        if (mounted) { progressError = progressFailure(error); progressReadFailed = true; progressLoaded = false; }
    } finally { if (mounted) progressLoading = false; }
}

async function discardProgress(): Promise<void> {
    // 常规丢弃走 discardConfirmed；强制逃生（进度文件损坏、progressRecord 为 null）走 forceResetConfirmed
    if (busy) return;
    if (!progressRecord && !forceResetConfirmed) return;
    if (progressRecord && !discardConfirmed) return;
    busy = true;
    try {
        // 进度文件损坏（progressReadFailed）时无 taskId 可校验：传文件名走强制逃生路径
        const target = progressReadFailed || !progressRecord ? IMPORT_PROGRESS_FILE : progressRecord.taskId;
        await discardImportProgress(facade.pluginInstance, target, true);
        if (!mounted) return;
        progressRecord = null;
        progressError = "";
        progressReadFailed = false;
        discardConfirmed = false;
        forceResetConfirmed = false;
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
const previewNotice = $derived(preview?.issue ?? (preview && importable === 0
    ? unfinished ? "review" : preview.rows.length > 0 ? "duplicates" : null
    : null));

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
    sourceFileName = file.name;
    resumeConfirmed = false;
    importConfirmed = false;
    progressError = "";
    let stage: "progress" | "file" | "preview" = "progress";
    try {
        const record = await loadImportProgress(facade.pluginInstance);
        if (!mounted) return;
        progressRecord = record;
        progressLoaded = true;
        progressReadFailed = false;
        if (record && record.state !== "finished") { notebookId = record.notebookId; folder = record.folder; format = record.format; }
        stage = "file";
        // 与备份同数量级的读取上限：整文件解码/指纹/解析都在主线程，超大文件会冻结 UI
        if (file.size > MAX_IMPORT_BYTES) throw new ImportProgressError("size");
        const bytes = await file.arrayBuffer();
        const fingerprint = await fingerprintImportSource(bytes);
        if (record && record.state !== "finished" && fingerprint !== record.fingerprint) throw new ImportProgressError("file");
        stage = "preview";
        const parsed = await previewImport(new TextDecoder().decode(bytes), record && record.state !== "finished" ? record.format : format, fingerprint);
        if (!mounted) return;
        preview = parsed;
        summary = null;
        retryRows = [];
        previewPage = 1;
        phase = "preview";
    } catch (error) {
        if (mounted) {
            phase = "pick";
            if (stage === "progress") { progressReadFailed = true; progressLoaded = false; }
            progressError = error instanceof ImportProgressError ? progressFailure(error)
                : t(i18n, stage === "file" ? "import.fileReadFailed" : stage === "preview" ? "import.previewFailed" : "import.progress.error.read");
        }
    } finally {
        if (mounted) busy = false;
        input.value = "";
    }
}

function mergeSummaries(next: ImportSummary, record: ImportProgress | null): ImportSummary {
    if (!record || record.taskId !== next.taskId || !preview) return next;
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

function progressEntryTitle(entry: ImportProgress["rows"][number], index: number): string {
    if (preview && progressRecord && preview.fingerprint === progressRecord.fingerprint && preview.format === progressRecord.format) {
        return preview.rows[index]?.title || entry.hpath;
    }
    return entry.hpath;
}

async function startImport(rowsOverride?: ImportPreviewRow[]) {
    if (busy || notebookLoading || notebookError || !preview || !targetAvailable || !progressLoaded || progressReadFailed) return;
    if (preview.issue || preview.rows.length === 0 || !preview.format) return;
    if (unfinished ? !resumable || !resumeConfirmed : !importConfirmed) return;
    if (rowsOverride && progressRecord?.taskId !== summary?.taskId) return;
    phase = "importing";
    busy = true;
    progress = 0;
    stopping = false;
    progressError = "";
    controller = new AbortController();
    let result: ImportSummary | null = null;
    let executionError = "";
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
        executionError = progressFailure(error);
        if (mounted) progressError = executionError;
    } finally {
        facade.notifyDataChanged();
        if (mounted) {
            // 执行回执只与本次重读的同任务检查点合并；旧窗口快照可能属于上一文件。
            const refreshed = await refreshProgress();
            if (mounted) {
                if (result) {
                    // 保存失败时落盘阶段可能滞后于已完成动作，保留服务已确认的本轮结果。
                    summary = executionError ? result : mergeSummaries(result, refreshed ?? null);
                    retryRows = preview.rows.filter((row) => summary!.failedUrls.includes(row.url));
                    phase = "done";
                    if (refreshed !== undefined && refreshed?.taskId !== result.taskId) progressError = t(i18n, "import.progress.error.changed");
                } else phase = "preview";
                // 重读成功也不能清掉执行期的保存失败；重读失败则保留其明确错误。
                if (!progressError && executionError) progressError = executionError;
                busy = false;
                controller = null;
                resumeConfirmed = false;
            }
        }
        // 导入已完成的场合，即使浮窗在收尾期间被关闭，也要提示结果
        if (!mounted && result) showMessage(t(i18n, "import.progress.closed", { n: result.imported }), 5000);
    }
}

function resetToPick() {
    phase = "pick";
    preview = null;
    sourceFileName = "";
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

function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
        if (phase === "importing" || busy || stopping || progressLoading) return;
        event.preventDefault();
        event.stopPropagation();
        if (discardConfirmed || forceResetConfirmed || resumeConfirmed || importConfirmed) {
            discardConfirmed = false;
            forceResetConfirmed = false;
            resumeConfirmed = false;
            importConfirmed = false;
            return;
        }
        onClose();
    }
}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="glean-migrate glean-import" class:glean-import--busy={busy} data-phase={phase} aria-labelledby={titleId} aria-describedby={descId} aria-busy={busy}>
    <!-- 保持同一文件控件：导入/完成/暂停切换不能遗留被卸载的绑定或失去下一次选择。 -->
    <input bind:this={fileInput} type="file" accept=".html,.csv,.json,.txt" style="display:none" disabled={busy} onchange={(event) => void onFileChosen(event)} />
    <div class="glean-dlg-head glean-import__head">
        <div class="glean-brand__mark glean-dlg-head__mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <h2 id={titleId} class="glean-dlg-head__t">{t(i18n, "import.title")}</h2>
            <div id={descId} class="glean-dlg-head__sub">{t(i18n, "import.intro")}</div>
        </div>
    </div>

    {#if progressError}<p class="glean-import-progress__error" role="alert">{progressError}</p>{/if}
    {#if progressLoading || progressReadFailed}
        <div class="glean-import-progress__actions">
            {#if progressLoading}<span role="status">{t(i18n, "panel.loading")}</span>{/if}
            <button class="glean-btn glean-btn--ghost" disabled={progressLoading || busy} onclick={() => void refreshProgress()}>{t(i18n, "action.retry")}</button>
        </div>
        {#if progressReadFailed}
            <label class="glean-import-progress__check"><input type="checkbox" bind:checked={forceResetConfirmed} disabled={busy || progressLoading} /><span>{t(i18n, "import.progress.confirmForceReset")}</span></label>
            <div class="glean-import-progress__actions">
                <button class="glean-btn glean-btn--ghost" disabled={busy || progressLoading || !forceResetConfirmed} onclick={() => void discardProgress()}>{t(i18n, "import.progress.forceReset")}</button>
            </div>
        {/if}
    {/if}
    {#if progressRecord && progressCounts}
        <section class="glean-import-progress" aria-labelledby={progressTitleId}>
            <h3 id={progressTitleId}>{t(i18n, "import.progress.title")} · {t(i18n, `import.progress.state.${progressRecord.state}`)}</h3>
            <p>{t(i18n, "import.progress.target", { notebook: notebooks.find((notebook) => notebook.id === progressRecord?.notebookId)?.name ?? progressRecord.notebookId, folder: progressRecord.folder })}</p>
            <p role="status" aria-live="polite" aria-atomic="true">{t(i18n, "import.progress.counts", { ...progressCounts, total: progressRecord.rows.length })}</p>
            {#if unfinished}<p>{t(i18n, "import.progress.hint")}</p>{/if}
            {#if progressCounts.unknown > 0}<p>{t(i18n, "import.progress.unknownHint")}</p>{/if}
            <details>
                <summary>{t(i18n, "import.progress.entries")}</summary>
                <div class="glean-import-progress__rows">
                    <!-- 最多渲染前 200 条：5 万行全量建 DOM 会造成数秒级卡顿（T-3316） -->
                    {#each progressRecord.rows.slice(0, 200) as entry, index (entry.key)}
                        <div class="glean-import-progress__row">
                            <span>{progressEntryTitle(entry, index)} · {t(i18n, `import.progress.row.${entry.state}`)}</span>
                            {#if entry.reason}<span>{t(i18n, `import.progress.reason.${entry.reason}`)}</span>{/if}
                            {#if entry.docId}<button class="glean-btn glean-btn--ghost" onclick={() => openProgressDocument(entry.docId)}>{t(i18n, "action.openDoc")}</button>{/if}
                        </div>
                    {/each}
                    {#if progressRecord.rows.length > 200}
                        <div class="glean-import-progress__row"><span>{t(i18n, "import.progress.entriesTruncated", { n: progressRecord.rows.length - 200 })}</span></div>
                    {/if}
                </div>
            </details>
            {#if unfinished && !busy}
                <label class="glean-import-progress__check"><input type="checkbox" bind:checked={resumeConfirmed} disabled={!resumable || !targetAvailable || progressReadFailed} /><span>{t(i18n, "import.progress.confirmResume")}</span></label>
                <div class="glean-import-progress__actions">
                    <button class="glean-btn glean-btn--pri" disabled={!resumable || !resumeConfirmed || !targetAvailable || importable === 0 || progressReadFailed || notebookLoading || notebookError} onclick={() => void startImport()}>{t(i18n, "import.progress.resume")}</button>
                    <button class="glean-btn glean-btn--ghost" onclick={resetToPick}>{t(i18n, "import.pickFile")}</button>
                </div>
            {/if}
            <label class="glean-import-progress__check"><input type="checkbox" bind:checked={discardConfirmed} disabled={busy || progressLoading} /><span>{t(i18n, "import.progress.confirmDiscard")}</span></label>
            <button class="glean-btn glean-btn--ghost" disabled={busy || progressLoading || !discardConfirmed} onclick={() => void discardProgress()}>{t(i18n, "import.progress.discard")}</button>
        </section>
    {/if}

    {#if phase === "pick" || phase === "preview"}
        <div class="glean-set-group">
            <div class="glean-set-row glean-import__field">
                <label class="glean-set-row__lb" for={formatId}>{t(i18n, "import.format")}</label>
                <select id={formatId} class="b3-select glean-import__select" disabled={busy || unfinished} bind:value={format} onchange={resetToPick}>
                    <option value="auto">{t(i18n, "import.formatAuto")}</option>
                    <option value="pocket-html">Pocket HTML</option>
                    <option value="pocket-csv">Pocket CSV</option>
                    <option value="omnivore-json">Omnivore JSON</option>
                    <option value="wallabag-json">wallabag JSON</option>
                </select>
            </div>
            <div class="glean-set-row glean-import__field">
                <div class="glean-set-row__lb">
                    {t(i18n, "import.notebook")}
                    <div class="glean-set-row__desc">{t(i18n, "import.notebookDesc")}</div>
                </div>
                <label class="glean-sr-only" for={notebookIdControl}>{t(i18n, "import.notebook")}</label>
                <select id={notebookIdControl} class="b3-select glean-import__select" disabled={busy || unfinished || notebookLoading || notebookError} bind:value={notebookId} onchange={() => (importConfirmed = false)}>
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
            <div class="glean-set-row glean-import__field">
                <label class="glean-set-row__lb" for={folderId}>{t(i18n, "import.folder")}</label>
                <input id={folderId} class="glean-mini-input glean-import__folder" disabled={busy || unfinished} bind:value={folder} oninput={() => (importConfirmed = false)} />
            </div>
            <div class="glean-set-row glean-import__field glean-import__file-field">
                <div class="glean-set-row__lb">
                    {t(i18n, "import.file")}
                    {#if sourceFileName}<div class="glean-set-row__desc glean-import__filename" title={sourceFileName}>{sourceFileName}</div>{/if}
                </div>
                <button class="glean-btn glean-import__pick" disabled={busy} onclick={() => pickFile()}>
                    {busy ? t(i18n, "panel.loading") : t(i18n, "import.pickFile")}
                </button>
            </div>
        </div>
    {/if}

    {#if phase === "preview" && preview}
        {#if previewNotice}
            <section class="glean-import-confirm glean-import__notice" role="status" aria-live="polite" aria-atomic="true">
                <h3 class="glean-import-confirm__title">{t(i18n, `import.preview.${previewNotice}.title`)}</h3>
                <p class="glean-import-confirm__desc">{t(i18n, `import.preview.${previewNotice}.hint`, { n: preview.rows.length })}</p>
            </section>
        {/if}
        {#if preview.rows.length > 0}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{importable}</div><div class="glean-mstat__l">{t(i18n, "import.willImport")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{preview.duplicateCount}</div><div class="glean-mstat__l">{t(i18n, "import.dupCount")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{preview.rows.length}</div><div class="glean-mstat__l">{t(i18n, "import.parsedCount")}</div></div>
        </div>
        {/if}
        {#if importable > 0 && !preview.issue}
        <div class="glean-import-confirm glean-import__mapping">
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
        {/if}
        {#if preview.rows.length > 0}
        <div class="glean-mtable glean-import__table">
            {#each pagedRows as row (row.url)}
                <div class="glean-mrow" class:glean-mrow--duplicate={row.duplicate} data-status={row.duplicate ? "duplicate" : row.status}>
                    <span class="glean-mrow__ti" title={row.title || row.url}>{row.title || row.url}</span>
                    <span class="glean-mrow__url">{row.site || "—"}</span>
                    <span class="glean-mrow__st" class:glean-mrow__st--skip={row.duplicate}>
                        {row.duplicate ? t(i18n, "import.dupLabel") : row.status}
                    </span>
                </div>
            {/each}
        </div>
        {/if}
        {#if previewPageCount > 1}
            <nav class="glean-prog-meta glean-import__pagination" aria-label={t(i18n, "import.pageInfo", { page: previewPage, total: previewPageCount })}>
                <button class="glean-btn glean-btn--ghost glean-import__page-btn" disabled={previewPage <= 1} onclick={() => (previewPage -= 1)}><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowLeft" /></svg>{t(i18n, "import.prevPage")}</button>
                <span>{t(i18n, "import.pageInfo", { page: previewPage, total: previewPageCount })}</span>
                <button class="glean-btn glean-btn--ghost glean-import__page-btn" disabled={previewPage >= previewPageCount} onclick={() => (previewPage += 1)}>{t(i18n, "import.nextPage")}<svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowRight" /></svg></button>
            </nav>
        {/if}
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            <button class="glean-btn" class:glean-btn--ghost={!previewNotice || unfinished} class:glean-btn--pri={!!previewNotice && !unfinished} onclick={pickFile}>{t(i18n, "import.chooseAnother")}</button>
            {#if importable > 0 && !preview.issue}
            <button class="glean-btn glean-btn--pri" disabled={busy || unfinished || !progressLoaded || progressReadFailed || importable === 0 || !targetAvailable || !importConfirmed || notebookLoading || notebookError} onclick={() => void startImport()}>
                {t(i18n, "import.start")}
            </button>
            {/if}
        </div>
    {:else if phase === "importing"}
        <div role="group" aria-label={t(i18n, "import.importing")}>
            <div class="glean-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} aria-label={t(i18n, "import.importing")}><div class="glean-progress__bar" style={`width:${progress}%`}></div></div>
            <div class="glean-prog-meta" role="status" aria-live="polite" aria-atomic="true"><span>{t(i18n, "import.importing")}</span><span>{progress}%</span></div>
        </div>
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            <button class="glean-btn glean-btn--ghost" disabled={stopping} onclick={() => { stopping = true; controller?.abort(); }}>{t(i18n, stopping ? "import.progress.stopping" : "import.progress.pause")}</button>
        </div>
    {:else if phase === "done" && summary}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.imported}</div><div class="glean-mstat__l">{t(i18n, "import.imported")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.skippedDuplicate}</div><div class="glean-mstat__l">{t(i18n, "import.dupCount")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.failed}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        {#if retryRows.length > 0}
            <p class="glean-set-row__desc" role="status">{t(i18n, "import.retryHint")}</p>
            <label class="glean-import-progress__check">
                <input type="checkbox" bind:checked={resumeConfirmed} disabled={busy || progressReadFailed || notebookLoading || notebookError || !targetAvailable || progressRecord?.taskId !== summary.taskId} />
                <span>{t(i18n, "import.retryConfirm")}</span>
            </label>
        {/if}
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            {#if retryRows.length > 0}
                <button class="glean-btn glean-btn--ghost" disabled={busy || !resumeConfirmed || progressReadFailed || notebookLoading || notebookError || !targetAvailable || progressRecord?.taskId !== summary.taskId} aria-describedby={!targetAvailable ? `${idPrefix}-retry-target-error` : undefined} onclick={() => void startImport(retryRows)}>{t(i18n, "import.retryFailed")}</button>
            {/if}
            {#if retryRows.length > 0 && !targetAvailable}<p id={`${idPrefix}-retry-target-error`} class="glean-import-progress__error" role="alert">{t(i18n, "import.progress.error.target")}</p>{/if}
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
    .glean-import-progress__actions { display: flex; align-items: center; gap: var(--glean-space-2); flex-wrap: wrap; }
    .glean-import-progress__check { display: flex; align-items: flex-start; gap: var(--glean-space-2); flex-wrap: nowrap; min-width: 0; }
    .glean-import-progress__check input { flex-shrink: 0; }
    .glean-import-progress__check span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
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

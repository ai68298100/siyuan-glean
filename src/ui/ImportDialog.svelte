<script lang="ts">
/** 迁移导入弹窗（T-1501）：Pocket HTML/CSV、Omnivore JSON、wallabag JSON → 思源读库。 */
import { onMount } from "svelte";
import { showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { previewImport, runImport, loadImportOrphans, retryImportOrphans, type ImportPreview, type ImportSummary } from "../services/import-service";
import { normalizeImportFolder } from "../domain/importers";
import type { ImportFormat } from "../domain/importers";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";

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
/** 弹窗初值 = 打开时刻的会话快照（T-1790：经函数读取 props/派生值，消除顶层本地引用）。 */
function snapshotImportInit() {
    return {
        notebookId: facade.settings.anchorNotebooks[0] ?? "",
        defaultFolder: t(facade.i18n, "import.defaultFolder"),
    };
}
const importInit = snapshotImportInit();
let notebookId = $state(importInit.notebookId);
let folder = $state(importInit.defaultFolder);
let preview = $state<ImportPreview | null>(null);
let summary = $state<ImportSummary | null>(null);
let busy = $state(false);
let progress = $state(0);
const PREVIEW_PAGE_SIZE = 50;
let previewPage = $state(1);
let fileInput = $state<HTMLInputElement | null>(null);

onMount(() => {
    void listNotebooks().then((items) => {
        notebooks = items;
        if (!notebookId) notebookId = items[0]?.id ?? "";
    });
    // T-1840：上次导入遗留的孤儿（文档已建未收录）提供重试入口
    void loadImportOrphans(facade.pluginInstance).then((items) => (orphans = items.length));
});

let orphans = $state(0);
let retryingOrphans = $state(false);

async function retryOrphans(): Promise<void> {
    retryingOrphans = true;
    try {
        const result = await retryImportOrphans(facade.pluginInstance);
        showMessage(t(i18n, "import.orphansRetried", { n: result.restored, skip: result.remaining }), 4000);
        if (result.restored > 0) facade.notifyDataChanged();
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        retryingOrphans = false;
        orphans = 0;
        try {
            orphans = (await loadImportOrphans(facade.pluginInstance)).length;
        } catch { /* 保持 0 */ }
    }
}

const importable = $derived(preview ? preview.rows.filter((row) => !row.duplicate).length : 0);

// T-1988：预览区显示最终落点（规范化后的目标路径），不静默跨目录创建
const targetFolder = $derived(normalizeImportFolder(folder, t(i18n, "import.defaultFolder")));
const targetPathLabel = $derived.by(() => {
    const notebookName = notebooks.find((item) => item.id === notebookId)?.name ?? "";
    return notebookName ? `${notebookName}/${targetFolder}/` : `${targetFolder}/`;
});
const startIndex = $derived((previewPage - 1) * PREVIEW_PAGE_SIZE);

const previewPageCount = $derived(preview ? Math.max(1, Math.ceil(preview.rows.length / PREVIEW_PAGE_SIZE)) : 1);
const pagedRows = $derived.by(() => {
    if (!preview) return [];
    return preview.rows.slice(startIndex, startIndex + PREVIEW_PAGE_SIZE);
});

function pickFile() {
    fileInput?.click();
}

async function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
        const content = await file.text();
        const next = await previewImport(content, format);
        // T-1984：换文件必须重置预览分页与执行现场，旧文件的页码/进度不残留
        preview = next;
        summary = null;
        previewPage = 1;
        phase = "preview";
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        busy = false;
        input.value = "";
    }
}

async function startImport() {
    if (!preview || !notebookId) return;
    phase = "importing";
    busy = true;
    progress = 0;
    const rows = preview.rows.filter((row) => !row.duplicate);
    try {
        summary = await runImport(facade.pluginInstance, rows, {
            notebookId,
            folder: folder.trim() || t(i18n, "import.defaultFolder"),
            format: preview.format ?? "pocket-html",
            onProgress: (done, total) => {
                progress = total > 0 ? Math.round((done / total) * 100) : 100;
            },
        });
        phase = "done";
        facade.notifyDataChanged();
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
        phase = "preview";
    } finally {
        busy = false;
    }
}

function resetToPick() {
    phase = "pick";
    preview = null;
    summary = null;
    previewPage = 1;
}
</script>

<div class="glean-migrate">
    <div class="glean-dlg-head">
        <div class="glean-brand__mark" style="width:26px;height:26px;border-radius:9px">
            <svg style="width:13px;height:13px"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <div class="glean-dlg-head__t">{t(i18n, "import.title")}</div>
            <div class="glean-dlg-head__sub">{t(i18n, "import.intro")}</div>
        </div>
    </div>

    {#if orphans > 0 && (phase === "pick" || phase === "preview")}
        <div class="glean-empty" style="padding:8px 12px">
            <div class="glean-empty__hint">
                {t(i18n, "import.orphansPending", { n: orphans })}
                <button class="glean-linkish" disabled={retryingOrphans} onclick={() => void retryOrphans()}>
                    {retryingOrphans ? t(i18n, "panel.loading") : t(i18n, "import.orphansRetry")} →
                </button>
            </div>
        </div>
    {/if}

    {#if phase === "pick" || phase === "preview"}
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "import.format")}</div>
                <select class="b3-select" style="font-size:12px" bind:value={format}>
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
                <select class="b3-select" style="font-size:12px" bind:value={notebookId}>
                    {#each notebooks as notebook (notebook.id)}
                        <option value={notebook.id}>{notebook.name}</option>
                    {/each}
                </select>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "import.folder")}</div>
                <input class="glean-mini-input" style="width:160px" bind:value={folder} />
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
                <button class="glean-btn" style="flex-shrink:0" disabled={busy} onclick={() => pickFile()}>
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
        <div class="glean-empty" style="padding:4px 12px">
            <div class="glean-empty__hint">{t(i18n, "import.targetPath", { path: targetPathLabel })}</div>
        </div>
        <div class="glean-mtable">
            {#each pagedRows as row, index (startIndex + index)}
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
            <div class="glean-prog-meta" style="margin-top:6px">
                <button class="glean-btn glean-btn--ghost" style="font-size:11px; padding:4px 10px" disabled={previewPage <= 1} onclick={() => (previewPage -= 1)}>← {t(i18n, "import.prevPage")}</button>
                <span>{t(i18n, "import.pageInfo", { page: previewPage, total: previewPageCount })}</span>
                <button class="glean-btn glean-btn--ghost" style="font-size:11px; padding:4px 10px" disabled={previewPage >= previewPageCount} onclick={() => (previewPage += 1)}>{t(i18n, "import.nextPage")} →</button>
            </div>
        {/if}
        {#if !notebookId}
            <div class="glean-empty" style="padding:10px 12px">
                <div class="glean-empty__hint">
                    {t(i18n, "import.noNotebook")}
                    <button class="glean-linkish" onclick={() => facade.openSettings()}>{t(i18n, "action.openSettings")} →</button>
                </div>
            </div>
        {/if}
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--ghost" onclick={resetToPick}>{t(i18n, "migrate.rescan")}</button>
            <button class="glean-btn glean-btn--pri" disabled={importable === 0 || !notebookId} onclick={() => void startImport()}>
                {t(i18n, "import.start")}
            </button>
        </div>
    {:else if phase === "importing"}
        <div>
            <div class="glean-progress"><div class="glean-progress__bar" style={`width:${progress}%`}></div></div>
            <div class="glean-prog-meta"><span>{t(i18n, "import.importing")}</span><span>{progress}%</span></div>
        </div>
    {:else if phase === "done" && summary}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.imported}</div><div class="glean-mstat__l">{t(i18n, "import.imported")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.skippedDuplicate}</div><div class="glean-mstat__l">{t(i18n, "import.dupCount")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{summary.failed}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        {#if summary.orphanCount > 0}
            <!-- T-1840：半成功结算——孤儿已入账本，可重开导入器重试补收录 -->
            <div class="glean-empty" style="padding:8px 12px">
                <div class="glean-empty__hint">{t(i18n, "import.orphansCreated", { n: summary.orphanCount })}</div>
            </div>
        {/if}
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--pri" onclick={() => void onClose()}>{t(i18n, "action.close")}</button>
        </div>
    {/if}
</div>

<style>
    /* 样式集中在 src/index.scss（设计系统） */
</style>

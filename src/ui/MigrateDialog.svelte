<script lang="ts">
/** 存量迁移器弹窗（T-1102）：步进器（扫描报告→分批回填→完成）+ 统计卡 + 可暂停续跑。 */
import { onMount } from "svelte";
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import {
    buildDryRunReport,
    clearMigrateProgress,
    loadMigrateProgress,
    retryMigrateErrors,
    resolveMigrateRow,
    planMigrateRow,
    runBackfillBatch,
    startMigrateProgress,
    type MigrateRow,
} from "../services/migrate-service";

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);

/** 每批写入条数（UX 审计 #7）：控件从设置页迁到执行现场，回填前就近调整。 */
async function updateBatchSize(input: HTMLInputElement): Promise<void> {
    const fallback = facade.settings.migrateBatchSize;
    const parsed = Math.min(50, Math.max(1, Math.round(Number(input.value)) || fallback));
    input.value = String(parsed);
    if (parsed === fallback) return;
    await facade.updateSettings({ ...facade.settings, migrateBatchSize: parsed });
}

type Phase = "intro" | "scanning" | "report" | "running" | "paused" | "done";
type Step = 1 | 2 | 3;

let phase = $state<Phase>("intro");
let rows = $state<MigrateRow[]>([]);
let cursor = $state(0);
let filter = $state<"all" | "pending" | "ok" | "skipped" | "manual" | "error">("all");
let aborted = $state(false);
let resumeAvailable = $state(false);
let editingRowId = $state("");
let manualUrl = $state("");

const step = $derived<Step>(phase === "intro" || phase === "scanning" ? 1 : phase === "done" ? 3 : 2);

onMount(async () => {
    const progress = await loadMigrateProgress(facade.pluginInstance);
    if (phase === "intro" && progress && progress.rows.length > 0) {
        rows = progress.rows;
        cursor = progress.cursor;
        resumeAvailable = hasOutstanding(progress.rows, progress.finished);
    }
});

const counts = $derived.by(() => {
    let ok = 0;
    let skipped = 0;
    let manual = 0;
    let errors = 0;
    let pending = 0;
    for (const row of rows) {
        if (row.state === "ok") ok += 1;
        else if (row.state === "skipped") skipped += 1;
        else if (row.state === "manual") manual += 1;
        else if (row.state === "error") errors += 1;
        else pending += 1;
    }
    return { ok, skipped, manual, errors, pending };
});

const visibleRows = $derived(
    filter === "all" ? rows : rows.filter((row) => row.state === filter)
);

const progressPct = $derived(rows.length === 0 ? 0 : Math.round((cursor / rows.length) * 100));
const retryableErrors = $derived(rows.some((row) => row.state === "error" && (!!row.url || !!row.resolution)));

function hasOutstanding(items: MigrateRow[], finished: boolean): boolean {
    return !finished || items.some((row) => row.state === "manual" || row.state === "error" || row.state === "pending");
}

async function refreshProgress() {
    const progress = await loadMigrateProgress(facade.pluginInstance);
    if (!progress) return;
    rows = progress.rows;
    cursor = progress.cursor;
    resumeAvailable = hasOutstanding(progress.rows, progress.finished);
}

async function startScan() {
    phase = "scanning";
    rows = [];
    try {
        rows = await buildDryRunReport(facade.settings);
        cursor = 0;
        filter = "all";
        phase = "report";
    } catch (error) {
        showMessage(String(error), 5000);
        await refreshProgress();
        phase = "intro";
    }
}

async function resume() {
    const progress = await loadMigrateProgress(facade.pluginInstance);
    if (!progress) return;
    rows = progress.rows;
    cursor = progress.cursor;
    await startRun(false);
}

async function startRun(startNew: boolean) {
    phase = "running";
    aborted = false;
    const signal = { get aborted() { return aborted; } };
    let last: Awaited<ReturnType<typeof runBackfillBatch>> | null = null;
    let taskReady = !startNew;
    try {
        if (startNew) {
            await startMigrateProgress(facade.pluginInstance, rows);
            taskReady = true;
        }
        else if (cursor >= rows.length && retryableErrors) await retryMigrateErrors(facade.pluginInstance);
        await refreshProgress();
        while (true) {
            last = await runBackfillBatch(facade.pluginInstance, facade.settings, { signal });
            await refreshProgress();
            if (last.finished || aborted) break;
        }
        phase = last?.finished ? "done" : "paused";
        if (last?.finished && last.errors === 0 && counts.manual === 0) {
            await clearMigrateProgress(facade.pluginInstance);
            resumeAvailable = false;
        }
        if (last && last.ok > 0) facade.notifyDataChanged();
    } catch (error) {
        showMessage(String(error), 5000);
        if (taskReady) await refreshProgress();
        phase = taskReady ? "paused" : "report";
    }
}

function editManual(row: MigrateRow) {
    editingRowId = row.id;
    manualUrl = row.url || "";
}

function openExisting(row: MigrateRow) {
    if (!row.conflictDocId) return;
    void openTab({ app: facade.pluginInstance.app, doc: { id: row.conflictDocId }, keepCursor: false });
}

async function resolveManual(row: MigrateRow, decision: "url" | "local" | "exclude", allowDuplicate = false) {
    try {
        if (phase === "running") return;
        const decisionUrl = allowDuplicate ? row.url : manualUrl.trim() || row.url;
        if (phase === "report") {
            const planned = planMigrateRow(row, decision === "url" ? { kind: "url", url: decisionUrl, allowDuplicate } : { kind: decision });
            rows = rows.map((item) => item.id === planned.id ? planned : item);
            editingRowId = "";
            return;
        }
        const updated = await resolveMigrateRow(
            facade.pluginInstance,
            row,
            decision === "url" ? { kind: "url", url: decisionUrl, allowDuplicate } : { kind: decision },
        );
        rows = rows.map((item) => item.id === updated.id ? updated : item);
        editingRowId = "";
        const saved = await loadMigrateProgress(facade.pluginInstance);
        resumeAvailable = saved ? hasOutstanding(saved.rows, saved.finished) : false;
        if (saved && saved.finished && !hasOutstanding(saved.rows, saved.finished)) await clearMigrateProgress(facade.pluginInstance);
        facade.notifyDataChanged();
    } catch (error) {
        showMessage(String(error), 4000);
    }
}

function rowStateClass(row: MigrateRow): string {
    switch (row.state) {
        case "ok": return "glean-mrow__st glean-mrow__st--ok";
        case "skipped": return "glean-mrow__st glean-mrow__st--skip";
        case "manual": return "glean-mrow__st glean-mrow__st--manual";
        case "error": return "glean-mrow__st glean-mrow__st--err";
        default: return "glean-mrow__st";
    }
}

function rowStateLabel(row: MigrateRow): string {
    if (row.state === "pending" && row.resolution === "local") return t(i18n, "migrate.plannedLocal");
    if (row.state === "pending" && row.resolution === "exclude") return t(i18n, "migrate.plannedExclude");
    switch (row.state) {
        case "ok": return "✓";
        case "skipped": return t(i18n, "migrate.skipHasAttrs");
        case "manual": return t(i18n, "migrate.needUrl");
        case "error": return t(i18n, "import.failed");
        default: return t(i18n, "migrate.foundUrl");
    }
}
</script>

<div class="glean-migrate" aria-labelledby="glean-migrate-title" aria-busy={phase === "scanning" || phase === "running"}>
    <div class="glean-dlg-head">
        <div class="glean-brand__mark glean-dlg-head__mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <h2 id="glean-migrate-title" class="glean-dlg-head__t">{t(i18n, "migrate.title")}</h2>
            <div class="glean-dlg-head__sub">{t(i18n, "migrate.intro")}</div>
        </div>
    </div>

    {#if phase !== "intro"}
        <div class="glean-stepper">
            <div class="glean-step" class:glean-step--done={step > 1} class:glean-step--on={step === 1}>
                <div class="glean-step__ball">{step > 1 ? "✓" : "1"}</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepScan")}</div>
            </div>
            <div class="glean-stepper__line" class:glean-stepper__line--done={step > 2}></div>
            <div class="glean-step" class:glean-step--done={step > 2} class:glean-step--on={step === 2}>
                <div class="glean-step__ball">{step > 2 ? "✓" : "2"}</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepRun")}</div>
            </div>
            <div class="glean-stepper__line" class:glean-stepper__line--done={step > 2}></div>
            <div class="glean-step" class:glean-step--on={step === 3}>
                <div class="glean-step__ball">3</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepDone")}</div>
            </div>
        </div>
    {/if}

    {#if phase === "intro"}
        {#if resumeAvailable}
            <div class="glean-migrate__resume">
                <button class="glean-btn glean-btn--pri" onclick={() => void resume()}>
                    {t(i18n, "migrate.continue")}（{cursor}/{rows.length}）
                </button>
                <button class="glean-btn glean-btn--ghost" onclick={() => void clearMigrateProgress(facade.pluginInstance).then(() => (resumeAvailable = false))}>
                    {t(i18n, "migrate.discardProgress")}
                </button>
            </div>
        {/if}
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--pri" onclick={() => void startScan()}>
                {t(i18n, "migrate.dryRun")}
            </button>
        </div>
    {:else if phase === "scanning"}
        <div class="glean-panel__loading">{t(i18n, "migrate.scanning")}</div>
    {:else if phase === "report"}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.pending}</div><div class="glean-mstat__l">{t(i18n, "migrate.backfillableLabel")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.skipped}</div><div class="glean-mstat__l">{t(i18n, "migrate.skipHasAttrs")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.manual}</div><div class="glean-mstat__l">{t(i18n, "migrate.needUrl")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.errors}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        <div class="glean-mtable">
            {#each visibleRows as row (row.id)}
                <div class="glean-mrow">
                    <span class="glean-mrow__ti">{row.title || row.hpath}</span>
                        <span class="glean-mrow__url" title={row.detail || ""}>{row.url || "—"}</span>
                    <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if row.state === "manual" || !!row.resolution}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
                                {/if}
                            </span>
                        {/if}
                        {#if row.evidence?.length || row.missing?.length || row.conflictDocId}
                            <span class="glean-mrow__why">
                                {#each row.evidence ?? [] as evidence}
                                    <span>{t(i18n, `candidate.evidence.${evidence}`)}</span>
                                {/each}
                                {#each row.missing ?? [] as missing}
                                    <span>{t(i18n, `candidate.missing.${missing}`)}</span>
                                {/each}
                                {#if row.conflictDocId}<span>{t(i18n, "migrate.conflict")}</span>{/if}
                            </span>
                        {/if}
                </div>
                    {#if editingRowId === row.id}
                        <div class="glean-candidate-edit">
                            <input class="b3-text-field" type="url" bind:value={manualUrl} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} />
                            <button class="glean-btn" onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
            {/each}
        </div>
        <div class="glean-migrate__ops">
            <select class="b3-select" style="font-size:12px" aria-label={t(i18n, "migrate.filterAll")} bind:value={filter}>
                <option value="all">{t(i18n, "migrate.filterAll")}</option>
                <option value="pending">{t(i18n, "migrate.filterPending")}</option>
                <option value="manual">{t(i18n, "migrate.needUrl")}</option>
                <option value="skipped">{t(i18n, "migrate.skipHasAttrs")}</option>
                <option value="error">{t(i18n, "import.failed")}</option>
            </select>
            <button class="glean-btn glean-btn--ghost" onclick={() => void startScan()}>{t(i18n, "migrate.rescan")}</button>
            <label class="glean-migrate__batch-size">
                {t(i18n, "migrate.batchSize")}
                <input
                    class="glean-mini-input"
                    type="number"
                    min="1"
                    max="50"
                    style="width:64px"
                    value={facade.settings.migrateBatchSize}
                    onchange={(e) => void updateBatchSize(e.currentTarget)}
                />
            </label>
            <button class="glean-btn glean-btn--pri" onclick={() => void startRun(true)} disabled={rows.length === 0}>
                {t(i18n, "migrate.run")}
            </button>
        </div>
    {:else if phase === "running" || phase === "paused"}
        <div role="status" aria-live="polite" aria-atomic="true">
            <div class="glean-progress"><div class="glean-progress__bar" style={`width:${progressPct}%`}></div></div>
            <div class="glean-prog-meta">
                <span>{t(i18n, "migrate.writing")} {cursor} / {rows.length}{phase === "paused" ? `（${t(i18n, "migrate.paused")}）` : ""}</span>
                <span>{t(i18n, "migrate.batchNote", { n: facade.settings.migrateBatchSize })}</span>
            </div>
        </div>
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.ok}</div><div class="glean-mstat__l">{t(i18n, "migrate.okLabel")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.skipped}</div><div class="glean-mstat__l">{t(i18n, "migrate.skipHasAttrs")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.errors}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        <div class="glean-mtable">
            {#each rows as row (row.id)}
                <div class="glean-mrow">
                    <span class="glean-mrow__ti" title={row.hpath}>{row.title || row.hpath}</span>
                    <span class="glean-mrow__url">{row.url || "—"}</span>
                    <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if (row.state === "manual" || (phase === "paused" && !!row.resolution)) && phase !== "running"}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
                                {/if}
                            </span>
                        {/if}
                        {#if row.evidence?.length || row.missing?.length || row.conflictDocId}
                            <span class="glean-mrow__why">
                                {#each row.evidence ?? [] as evidence}<span>{t(i18n, `candidate.evidence.${evidence}`)}</span>{/each}
                                {#each row.missing ?? [] as missing}<span>{t(i18n, `candidate.missing.${missing}`)}</span>{/each}
                                {#if row.conflictDocId}<span>{t(i18n, "migrate.conflict")}</span>{/if}
                            </span>
                        {/if}
                </div>
                    {#if editingRowId === row.id}
                        <div class="glean-candidate-edit">
                            <input class="b3-text-field" type="url" bind:value={manualUrl} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} />
                            <button class="glean-btn" onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
            {/each}
        </div>
        <div class="glean-migrate__ops">
            {#if phase === "running"}
                <button class="glean-btn" onclick={() => (aborted = true)}>{t(i18n, "migrate.pause")}</button>
            {:else}
                <button class="glean-btn glean-btn--pri" onclick={() => void startRun(false)}>{t(i18n, "migrate.continue")}</button>
            {/if}
        </div>
    {:else if phase === "done"}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.ok}</div><div class="glean-mstat__l">{t(i18n, "migrate.okLabel")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.skipped}</div><div class="glean-mstat__l">{t(i18n, "migrate.skipHasAttrs")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.manual}</div><div class="glean-mstat__l">{t(i18n, "migrate.needUrl")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">{counts.errors}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        {#if counts.manual > 0 || counts.errors > 0}
            <div class="glean-mtable">
                {#each rows.filter((row) => row.state === "manual" || row.state === "error") as row (row.id)}
                    <div class="glean-mrow">
                        <span class="glean-mrow__ti" title={row.hpath}>{row.title || row.hpath}</span>
                        <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if row.state === "manual"}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
                                {/if}
                            </span>
                        {/if}
                    </div>
                    {#if editingRowId === row.id}
                        <div class="glean-candidate-edit">
                            <input class="b3-text-field" type="url" bind:value={manualUrl} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} />
                            <button class="glean-btn" onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
        <div class="glean-migrate__ops">
            {#if retryableErrors}
                <button class="glean-btn glean-btn--ghost" onclick={() => void startRun(false)}>{t(i18n, "action.retry")}</button>
            {/if}
            <button class="glean-btn glean-btn--pri" onclick={() => void onClose()}>{t(i18n, "action.close")}</button>
        </div>
    {/if}
</div>

<style>
    /* 样式集中在 src/index.scss（设计系统） */
</style>

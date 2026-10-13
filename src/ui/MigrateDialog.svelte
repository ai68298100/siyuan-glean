<script lang="ts">
/** 存量迁移器弹窗（T-1102）：步进器（扫描报告→分批回填→完成）+ 统计卡 + 可暂停续跑。 */
import { onMount, tick } from "svelte";
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import {
    buildDryRunReport,
    clearMigrateProgress,
    clearInvalidMigrateProgress,
    dropInterruptedMigrateDecisions,
    hydrateMigrateProgress,
    loadMigrateProgress,
    MigrateProgressError,
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
const instanceId = $props.id();
const idPrefix = `glean-migrate-${instanceId}`;
const titleId = `${idPrefix}-title`;
const descId = `${idPrefix}-desc`;

/** 每批写入条数（UX 审计 #7）：控件从设置页迁到执行现场，回填前就近调整。 */
async function updateBatchSize(input: HTMLInputElement): Promise<void> {
    const fallback = facade.settings.migrateBatchSize;
    const parsed = Math.min(50, Math.max(1, Math.round(Number(input.value)) || fallback));
    input.value = String(parsed);
    if (parsed === fallback) return;
    // T-1957：只传变化字段，避免旧快照覆盖并发保存的其他设置
    try {
        await facade.updateSettings({ migrateBatchSize: parsed });
    } catch (error) {
        console.warn("[glean] 迁移批次设置保存失败:", error);
        input.value = String(fallback);
        showMessage(t(i18n, "msg.actionFailed"), 4000);
    }
}

type Phase = "intro" | "scanning" | "report" | "running" | "paused" | "done";
type Step = 1 | 2 | 3;

let phase = $state<Phase>("intro");
let rows = $state<MigrateRow[]>([]);
let cursor = $state(0);
let filter = $state<"all" | "pending" | "ok" | "skipped" | "manual" | "error">("all");
let aborted = $state(false);
let resumeAvailable = $state(false);
let progressLoadState = $state<"loading" | "ready" | "error" | "invalid">("loading");
let progressReadStarted = false;
let confirmingDiscard = $state(false);
let discardingCorruptProgress = $state(false);
let discardBusy = $state(false);
let progressActionError = $state("");
let discardTrigger = $state<HTMLButtonElement>();
let discardCancel = $state<HTMLButtonElement>();
let scanTrigger = $state<HTMLButtonElement>();
let editingRowId = $state("");
let manualUrl = $state("");
/** 逐条决策写回期间锁住该行，避免快速点击触发重复端点请求。 */
let rowBusyId = $state("");
/** 绑定当前弹窗看到的检查点，防止旧窗口误操作后来创建的任务。 */
let activeTaskId = $state("");

const step = $derived<Step>(phase === "intro" || phase === "scanning" ? 1 : phase === "done" ? 3 : 2);

onMount(() => {
    void reloadResumeProgress();
});

async function reloadResumeProgress(): Promise<void> {
    if (progressReadStarted && progressLoadState === "loading") return;
    progressReadStarted = true;
    progressLoadState = "loading";
    progressActionError = "";
    try {
        const hydrated = await hydrateMigrateProgress(facade.pluginInstance, { refresh: true });
        if (hydrated?.reconciled) facade.notifyDataChanged();
        activeTaskId = hydrated?.progress.taskId ?? "";
        if (phase === "intro") {
            rows = hydrated?.rows ?? [];
            cursor = hydrated?.progress.cursor ?? 0;
            resumeAvailable = hydrated ? hasOutstanding(hydrated.progress.rows, hydrated.progress.finished) : false;
        }
        progressLoadState = "ready";
    } catch (error) {
        console.warn("[glean] 迁移进度读取失败:", error);
        // Hydration can repair the derived index before checkpoint persistence
        // fails; refresh other views even when recovery itself needs retry.
        facade.notifyDataChanged();
        progressLoadState = error instanceof MigrateProgressError && error.reason === "invalid" ? "invalid" : "error";
    }
}

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
const retryableErrors = $derived(rows.some((row) => row.state === "error"));

function hasOutstanding(items: { state: string }[], finished: boolean): boolean {
    return !finished || items.some((row) => row.state === "manual" || row.state === "error" || row.state === "pending");
}

async function refreshProgress() {
    try {
        const hydrated = await hydrateMigrateProgress(facade.pluginInstance, activeTaskId ? { expectedTaskId: activeTaskId } : undefined);
        if (!hydrated) return;
        if (hydrated.reconciled) facade.notifyDataChanged();
        rows = hydrated.rows;
        cursor = hydrated.progress.cursor;
        resumeAvailable = hasOutstanding(hydrated.progress.rows, hydrated.progress.finished);
    } catch (error) {
        console.warn("[glean] 迁移进度刷新失败:", error);
        facade.notifyDataChanged();
        showMessage(t(i18n, "msg.actionFailed"), 4000);
    }
}

async function startScan() {
    if (phase === "scanning" || progressLoadState !== "ready" || progressActionError) return;
    phase = "scanning";
    rows = [];
    try {
        rows = await buildDryRunReport(facade.settings);
        cursor = 0;
        filter = "all";
        phase = "report";
    } catch (error) {
        console.warn("[glean] 迁移扫描失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 5000);
        await refreshProgress();
        phase = "intro";
    }
}

async function resume() {
    if (phase !== "intro" || progressLoadState !== "ready" || progressActionError) return;
    phase = "scanning";
    try {
        const expectedTaskId = activeTaskId;
        const hydrated = await hydrateMigrateProgress(facade.pluginInstance, { refresh: true, ...(expectedTaskId ? { expectedTaskId } : {}) });
        if (!hydrated) {
            resumeAvailable = false;
            rows = [];
            cursor = 0;
            phase = "intro";
            return;
        }
        rows = hydrated.rows;
        cursor = hydrated.progress.cursor;
        activeTaskId = hydrated.progress.taskId;
        if (hydrated.reconciled) facade.notifyDataChanged();
        await startRun(false);
    } catch (error) {
        console.warn("[glean] 迁移恢复失败:", error);
        facade.notifyDataChanged();
        progressActionError = error instanceof MigrateProgressError && error.reason === "changed"
            ? t(i18n, "migrate.taskChanged")
            : t(i18n, "migrate.resumeFailed");
        phase = "intro";
    }
}

async function beginDiscardConfirmation(): Promise<void> {
    if (progressActionError || (progressLoadState !== "ready" && progressLoadState !== "invalid") || (!resumeAvailable && progressLoadState !== "invalid")) return;
    confirmingDiscard = true;
    discardingCorruptProgress = progressLoadState === "invalid";
    progressActionError = "";
    await tick();
    discardCancel?.focus();
}

async function cancelDiscardConfirmation(): Promise<void> {
    confirmingDiscard = false;
    discardingCorruptProgress = false;
    await tick();
    discardTrigger?.focus();
}

async function discardProgress() {
    if (discardBusy || (progressLoadState !== "ready" && progressLoadState !== "invalid") || (!resumeAvailable && progressLoadState !== "invalid")) return;
    discardBusy = true;
    try {
        if (discardingCorruptProgress) await clearInvalidMigrateProgress(facade.pluginInstance);
        else await clearMigrateProgress(facade.pluginInstance, activeTaskId);
        resumeAvailable = false;
        activeTaskId = "";
        progressLoadState = "ready";
        confirmingDiscard = false;
        discardingCorruptProgress = false;
        rows = [];
        cursor = 0;
    } catch (error) {
        console.warn("[glean] 迁移进度清理失败:", error);
        if (error instanceof MigrateProgressError && error.reason === "changed") {
            confirmingDiscard = false;
            discardingCorruptProgress = false;
            progressActionError = t(i18n, "migrate.taskChanged");
        } else {
            progressActionError = t(i18n, "migrate.discardFailed");
        }
    } finally {
        discardBusy = false;
        if (!confirmingDiscard) {
            await tick();
            scanTrigger?.focus();
        }
    }
}

async function startRun(startNew: boolean) {
    if (phase === "running") return;
    phase = "running";
    aborted = false;
    const signal = { get aborted() { return aborted; } };
    let last: Awaited<ReturnType<typeof runBackfillBatch>> | null = null;
    let taskReady = !startNew;
    let taskId = activeTaskId;
    let notifyAfterRun = false;
    try {
        if (startNew) {
            const created = await startMigrateProgress(facade.pluginInstance, rows);
            activeTaskId = created.taskId;
            taskId = created.taskId;
            taskReady = true;
        }
        else if (cursor >= rows.length && retryableErrors) {
            const retried = await retryMigrateErrors(facade.pluginInstance, taskId);
            cursor = retried.cursor;
            rows = rows.map((row) => row.state === "error" ? { ...row, state: "pending", detail: undefined } : row);
        }
        while (true) {
            last = await runBackfillBatch(facade.pluginInstance, facade.settings, { signal, expectedTaskId: taskId });
            cursor = last.cursor;
            if (last.updatedRows.length > 0) {
                const updatedById = new Map(last.updatedRows.map((row) => [row.id, row]));
                rows = rows.map((row) => updatedById.get(row.id) ?? row);
                // An error can follow a successful attribute write whose index
                // sync failed. Notify other views for every processed row.
                if (last.updatedRows.length > 0) notifyAfterRun = true;
            }
            resumeAvailable = hasOutstanding(rows, last.finished);
            if (last.finished || aborted) break;
        }
        if (aborted) {
            try { await dropInterruptedMigrateDecisions(facade.pluginInstance, taskId); } catch (cleanupError) { console.warn("[glean] 迁移暂停清理失败:", cleanupError); }
        }
        await refreshProgress();
        phase = last?.finished ? "done" : "paused";
        if (last?.finished && last.errors === 0 && counts.manual === 0) {
            await clearMigrateProgress(facade.pluginInstance, taskId);
            resumeAvailable = false;
            activeTaskId = "";
        }
    } catch (error) {
        console.warn("[glean] 迁移回填失败:", error);
        if (taskReady && taskId) {
            try { await dropInterruptedMigrateDecisions(facade.pluginInstance, taskId); } catch (cleanupError) { console.warn("[glean] 迁移失败后的计划清理失败:", cleanupError); }
        }
        if (!taskReady && error instanceof MigrateProgressError && error.reason === "exists") {
            phase = "intro";
            await reloadResumeProgress();
            progressActionError = t(i18n, "migrate.concurrentTask");
            return;
        }
        if (error instanceof MigrateProgressError && error.reason === "changed") {
            phase = "intro";
            progressActionError = t(i18n, "migrate.taskChanged");
            return;
        }
        showMessage(t(i18n, "msg.actionFailed"), 5000);
        if (taskReady) {
            await refreshProgress();
            notifyAfterRun = true;
        }
        phase = taskReady ? "paused" : "report";
    } finally {
        if (notifyAfterRun) facade.notifyDataChanged();
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
    if (rowBusyId) return;
    rowBusyId = row.id;
    try {
        if (phase === "running") return;
        const decisionUrl = allowDuplicate ? row.url : manualUrl.trim() || row.url;
        if (phase === "report") {
            const planned = planMigrateRow(row, decision === "url" ? { kind: "url", url: decisionUrl, allowDuplicate } : { kind: decision });
            rows = rows.map((item) => item.id === planned.id ? planned : item);
            editingRowId = "";
            return;
        }
        if (!activeTaskId) throw new MigrateProgressError("changed", "迁移任务已变化，请刷新后重试");
        const updated = await resolveMigrateRow(
            facade.pluginInstance,
            row,
            decision === "url" ? { kind: "url", url: decisionUrl, allowDuplicate } : { kind: decision },
            activeTaskId,
        );
        rows = rows.map((item) => item.id === updated.id ? updated : item);
        editingRowId = "";
        const saved = await loadMigrateProgress(facade.pluginInstance, activeTaskId);
        resumeAvailable = saved ? hasOutstanding(saved.rows, saved.finished) : false;
        if (saved && saved.finished && !hasOutstanding(saved.rows, saved.finished)) await clearMigrateProgress(facade.pluginInstance, activeTaskId);
        facade.notifyDataChanged();
    } catch (error) {
        console.warn("[glean] 迁移行处理失败:", error);
        if (error instanceof MigrateProgressError && error.reason === "changed") {
            phase = "intro";
            progressActionError = t(i18n, "migrate.taskChanged");
        } else {
            await refreshProgress();
            showMessage(t(i18n, "msg.actionFailed"), 4000);
        }
    } finally {
        rowBusyId = "";
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

function rowDetail(row: MigrateRow): string {
    switch (row.detail) {
        case "document-missing": return t(i18n, "migrate.rowDocumentMissing");
        case "attributes-unavailable": return t(i18n, "migrate.rowAttributesUnavailable");
        case "reconfirm-decision": return t(i18n, "migrate.rowReconfirmDecision");
        case "planned-action-failed": return t(i18n, "migrate.rowPlannedActionFailed");
        case "no-longer-eligible": return t(i18n, "migrate.rowNoLongerEligible");
        case "duplicate-url": return t(i18n, "migrate.conflict");
        case "already-clipped": return t(i18n, "migrate.skipHasAttrs");
        case "user-excluded": return t(i18n, "migrate.plannedExclude");
        default: return row.state === "error" ? t(i18n, "migrate.rowErrorRetry") : "";
    }
}
</script>

<div class="glean-migrate" data-phase={phase} aria-labelledby={titleId} aria-describedby={descId} aria-busy={progressLoadState === "loading" || phase === "scanning" || phase === "running"}>
    <div class="glean-dlg-head">
        <div class="glean-brand__mark glean-dlg-head__mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <h2 id={titleId} class="glean-dlg-head__t">{t(i18n, "migrate.title")}</h2>
            <div id={descId} class="glean-dlg-head__sub">{t(i18n, "migrate.intro")}</div>
        </div>
    </div>

    {#if phase !== "intro"}
        <div class="glean-stepper" role="list" aria-label={t(i18n, "migrate.title")}>
            <div class="glean-step" role="listitem" aria-current={step === 1 ? "step" : undefined} class:glean-step--done={step > 1} class:glean-step--on={step === 1}>
                <div class="glean-step__ball">{step > 1 ? "✓" : "1"}</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepScan")}</div>
            </div>
            <div class="glean-stepper__line" class:glean-stepper__line--done={step > 2}></div>
            <div class="glean-step" role="listitem" aria-current={step === 2 ? "step" : undefined} class:glean-step--done={step > 2} class:glean-step--on={step === 2}>
                <div class="glean-step__ball">{step > 2 ? "✓" : "2"}</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepRun")}</div>
            </div>
            <div class="glean-stepper__line" class:glean-stepper__line--done={step > 2}></div>
            <div class="glean-step" role="listitem" aria-current={step === 3 ? "step" : undefined} class:glean-step--on={step === 3}>
                <div class="glean-step__ball">3</div>
                <div class="glean-step__lb">{t(i18n, "migrate.stepDone")}</div>
            </div>
        </div>
    {/if}

    {#if phase === "intro"}
        {#if progressLoadState === "loading"}
            <div class="glean-panel__loading" role="status" aria-live="polite">{t(i18n, "migrate.progressLoading")}</div>
        {:else if progressLoadState === "error"}
            <div class="glean-load-error" role="alert">
                <span>{t(i18n, "migrate.progressLoadFailed")}</span>
                <button class="glean-btn glean-btn--ghost" onclick={() => void reloadResumeProgress()}>{t(i18n, "action.retry")}</button>
            </div>
        {:else if progressLoadState === "invalid"}
            <div class="glean-load-error" role="alert">
                <span>{t(i18n, "migrate.progressInvalid")}</span>
                <button class="glean-btn glean-btn--ghost" disabled={confirmingDiscard} onclick={() => void reloadResumeProgress()}>{t(i18n, "action.retry")}</button>
                <button class="glean-btn glean-btn--danger" bind:this={discardTrigger} disabled={confirmingDiscard} onclick={() => void beginDiscardConfirmation()}>{t(i18n, "migrate.clearCorruptProgress")}</button>
            </div>
        {/if}
        {#if progressActionError}
            <div class="glean-load-error" role="alert">
                <span>{progressActionError}</span>
                <button class="glean-btn glean-btn--ghost" disabled={progressLoadState === "loading"} onclick={() => void reloadResumeProgress()}>{t(i18n, "action.retry")}</button>
            </div>
        {/if}
        {#if confirmingDiscard}
            <div class="glean-migrate__confirm glean-confirm" role="group" aria-busy={discardBusy} aria-labelledby={`${idPrefix}-discard-title`} aria-describedby={`${idPrefix}-discard-description`}>
                <h3 id={`${idPrefix}-discard-title`}>{t(i18n, discardingCorruptProgress ? "migrate.corruptDiscardConfirmTitle" : "migrate.discardConfirmTitle")}</h3>
                <p id={`${idPrefix}-discard-description`}>{t(i18n, discardingCorruptProgress ? "migrate.corruptConfirmDiscard" : "migrate.confirmDiscard")}</p>
                <div class="glean-confirm__actions">
                    <button class="glean-btn glean-btn--ghost" bind:this={discardCancel} disabled={discardBusy} onclick={() => void cancelDiscardConfirmation()}>{t(i18n, "action.cancel")}</button>
                    <button class="glean-btn glean-btn--danger" disabled={discardBusy} aria-busy={discardBusy} onclick={() => void discardProgress()}>{t(i18n, discardBusy ? "panel.loading" : discardingCorruptProgress ? "migrate.corruptDiscardConfirmAction" : "migrate.discardConfirmAction")}</button>
                </div>
            </div>
        {:else}
            {#if resumeAvailable}
                <div class="glean-migrate__resume">
                    <button class="glean-btn glean-btn--pri" disabled={progressLoadState !== "ready" || Boolean(progressActionError)} onclick={() => void resume()}>
                        {t(i18n, "migrate.continue")}（{cursor}/{rows.length}）
                    </button>
                    <button class="glean-btn glean-btn--ghost" bind:this={discardTrigger} disabled={progressLoadState !== "ready" || Boolean(progressActionError)} onclick={() => void beginDiscardConfirmation()}>
                        {t(i18n, "migrate.discardProgress")}
                    </button>
                </div>
                <p class="glean-migrate__resume-hint" role="note">{t(i18n, "migrate.resumeFactsHint")}</p>
            {/if}
            <div class="glean-migrate__ops">
                <button class="glean-btn glean-btn--pri" bind:this={scanTrigger} disabled={progressLoadState !== "ready" || Boolean(progressActionError)} onclick={() => void startScan()}>
                    {t(i18n, "migrate.dryRun")}
                </button>
            </div>
        {/if}
    {:else if phase === "scanning"}
        <div class="glean-panel__loading" role="status" aria-live="polite">{t(i18n, "migrate.scanning")}</div>
    {:else if phase === "report"}
        <div class="glean-mstats">
            <!-- T-2027：语义染色 modifier（pending=待处理琥珀/skip=中性/manual=挂起紫/err=错误红），不按排位 -->
            <div class="glean-mstat glean-mstat--pending"><div class="glean-mstat__n">{counts.pending}</div><div class="glean-mstat__l">{t(i18n, "migrate.backfillableLabel")}</div></div>
            <div class="glean-mstat glean-mstat--skip"><div class="glean-mstat__n">{counts.skipped}</div><div class="glean-mstat__l">{t(i18n, "migrate.skipHasAttrs")}</div></div>
            <div class="glean-mstat glean-mstat--manual"><div class="glean-mstat__n">{counts.manual}</div><div class="glean-mstat__l">{t(i18n, "migrate.needUrl")}</div></div>
            <div class="glean-mstat glean-mstat--err"><div class="glean-mstat__n">{counts.errors}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        <div class="glean-mtable">
            {#if visibleRows.length === 0}
                <div class="glean-mtable__empty" role="status">
                    {rows.length > 0 && filter !== "all" ? t(i18n, "migrate.filterNoResults") : t(i18n, "migrate.noRows")}
                </div>
            {:else}
            {#each visibleRows as row (row.id)}
                <div class="glean-mrow" aria-busy={rowBusyId === row.id}>
                    <span class="glean-mrow__ti">{row.title || row.hpath}</span>
                        <span class="glean-mrow__url" title={row.detail || ""}>{row.url || "—"}</span>
                    <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if row.state === "manual" || !!row.resolution}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
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
                            <input class="b3-text-field" type="url" bind:value={manualUrl} disabled={Boolean(rowBusyId)} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolveManual(row, "url"); } }} />
                            <button class="glean-btn" disabled={Boolean(rowBusyId)} onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" disabled={Boolean(rowBusyId)} onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
            {/each}
            {/if}
        </div>
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            <select class="b3-select glean-migrate__filter" aria-label={t(i18n, "migrate.filterAll")} bind:value={filter}>
                <option value="all">{t(i18n, "migrate.filterAll")}</option>
                <option value="pending">{t(i18n, "migrate.filterPending")}</option>
                <option value="manual">{t(i18n, "migrate.needUrl")}</option>
                <option value="skipped">{t(i18n, "migrate.skipHasAttrs")}</option>
                <option value="error">{t(i18n, "import.failed")}</option>
            </select>
            <button class="glean-btn glean-btn--ghost" disabled={Boolean(rowBusyId)} onclick={() => void startScan()}>{t(i18n, "migrate.rescan")}</button>
            <label class="glean-migrate__batch-size">
                {t(i18n, "migrate.batchSize")}
                <input
                    type="number"
                    min="1"
                    max="50"
                    class="glean-mini-input glean-migrate__batch-input"
                    value={facade.settings.migrateBatchSize}
                    onchange={(e) => void updateBatchSize(e.currentTarget)}
                />
            </label>
            <button class="glean-btn glean-btn--pri" onclick={() => void startRun(true)} disabled={rows.length === 0}>
                {t(i18n, "migrate.run")}
            </button>
        </div>
    {:else if phase === "running" || phase === "paused"}
        <div role="group" aria-label={t(i18n, "migrate.writing")}>
            <div class="glean-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPct} aria-label={t(i18n, "migrate.writing")}><div class="glean-progress__bar" style={`width:${progressPct}%`}></div></div>
            <div class="glean-prog-meta" role="status" aria-live="polite" aria-atomic="true">
                <span>{t(i18n, "migrate.writing")} {cursor} / {rows.length}{phase === "paused" ? `（${t(i18n, "migrate.paused")}）` : ""}</span>
                <span>{t(i18n, "migrate.batchNote", { n: facade.settings.migrateBatchSize })}</span>
            </div>
        </div>
        <div class="glean-mstats">
            <div class="glean-mstat glean-mstat--ok"><div class="glean-mstat__n">{counts.ok}</div><div class="glean-mstat__l">{t(i18n, "migrate.okLabel")}</div></div>
            <div class="glean-mstat glean-mstat--skip"><div class="glean-mstat__n">{counts.skipped}</div><div class="glean-mstat__l">{t(i18n, "migrate.skipHasAttrs")}</div></div>
            <div class="glean-mstat glean-mstat--err"><div class="glean-mstat__n">{counts.errors}</div><div class="glean-mstat__l">{t(i18n, "import.failed")}</div></div>
        </div>
        <div class="glean-mtable">
            {#each rows as row (row.id)}
                <div class="glean-mrow" aria-busy={rowBusyId === row.id}>
                    <span class="glean-mrow__ti" title={row.hpath}>{row.title || row.hpath}</span>
                    <span class="glean-mrow__url">{row.url || "—"}</span>
                    <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if (row.state === "manual" || (phase === "paused" && !!row.resolution)) && phase !== "running"}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
                                {/if}
                            </span>
                        {/if}
                        {#if row.evidence?.length || row.missing?.length || row.conflictDocId || row.state === "error" || row.detail === "reconfirm-decision" || row.detail === "planned-action-failed" || row.detail === "no-longer-eligible"}
                            <span class="glean-mrow__why">
                                {#if rowDetail(row)}<span>{rowDetail(row)}</span>{/if}
                                {#each row.evidence ?? [] as evidence}<span>{t(i18n, `candidate.evidence.${evidence}`)}</span>{/each}
                                {#each row.missing ?? [] as missing}<span>{t(i18n, `candidate.missing.${missing}`)}</span>{/each}
                                {#if row.conflictDocId}<span>{t(i18n, "migrate.conflict")}</span>{/if}
                            </span>
                        {/if}
                </div>
                    {#if editingRowId === row.id}
                        <div class="glean-candidate-edit">
                            <input class="b3-text-field" type="url" bind:value={manualUrl} disabled={Boolean(rowBusyId)} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolveManual(row, "url"); } }} />
                            <button class="glean-btn" disabled={Boolean(rowBusyId)} onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" disabled={Boolean(rowBusyId)} onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
            {:else}
                <div class="glean-mtable__empty" role="status">{t(i18n, "panel.empty")}</div>
            {/each}
        </div>
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            {#if phase === "running"}
                <button class="glean-btn" disabled={aborted} onclick={() => (aborted = true)}>{t(i18n, aborted ? "migrate.pausing" : "migrate.pause")}</button>
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
                    <div class="glean-mrow" aria-busy={rowBusyId === row.id}>
                        <span class="glean-mrow__ti" title={row.hpath}>{row.title || row.hpath}</span>
                        <span class={rowStateClass(row)} title={row.detail || ""}>{rowStateLabel(row)}</span>
                        {#if row.state === "error" || row.detail === "reconfirm-decision" || row.detail === "planned-action-failed"}
                            <span class="glean-mrow__why">{rowDetail(row)}</span>
                        {/if}
                        {#if row.state === "manual"}
                            <span class="glean-mrow__ops">
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.fixUrl")} aria-label={t(i18n, "migrate.fixUrl")} onclick={() => editManual(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanEdit" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.asLocal")} aria-label={t(i18n, "migrate.asLocal")} onclick={() => void resolveManual(row, "local")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanLocal" /></svg></button>
                                <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.exclude")} aria-label={t(i18n, "migrate.exclude")} onclick={() => void resolveManual(row, "exclude")}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                                {#if row.conflictDocId}
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.openExisting")} aria-label={t(i18n, "migrate.openExisting")} onclick={() => openExisting(row)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg></button>
                                    <button class="glean-op-btn" disabled={Boolean(rowBusyId)} title={t(i18n, "migrate.keepDuplicate")} aria-label={t(i18n, "migrate.keepDuplicate")} onclick={() => void resolveManual(row, "url", true)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanPlus" /></svg></button>
                                {/if}
                            </span>
                        {/if}
                    </div>
                    {#if editingRowId === row.id}
                        <div class="glean-candidate-edit">
                            <input class="b3-text-field" type="url" bind:value={manualUrl} disabled={Boolean(rowBusyId)} placeholder={t(i18n, "candidate.urlPlaceholder")} aria-label={t(i18n, "candidate.urlPlaceholder")} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolveManual(row, "url"); } }} />
                            <button class="glean-btn" disabled={Boolean(rowBusyId)} onclick={() => void resolveManual(row, "url")}>{t(i18n, "action.save")}</button>
                            <button class="glean-btn glean-btn--ghost" disabled={Boolean(rowBusyId)} onclick={() => (editingRowId = "")}>{t(i18n, "action.cancel")}</button>
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
        <div class="glean-migrate__ops glean-migrate__ops--footer">
            {#if retryableErrors}
                <button class="glean-btn glean-btn--ghost" onclick={() => void startRun(false)}>{t(i18n, "action.retry")}</button>
            {/if}
            <button class="glean-btn glean-btn--pri" onclick={() => void onClose()}>{t(i18n, "action.close")}</button>
        </div>
    {/if}
</div>

<style>
    .glean-confirm {
        display: grid;
        gap: 10px;
        padding: 16px;
        border: 1px solid var(--glean-border-soft);
        border-radius: 6px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
    }

    .glean-confirm h3,
    .glean-confirm p {
        margin: 0;
    }

    .glean-confirm__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }

    .glean-btn--danger {
        border: 1px solid color-mix(in srgb, var(--b3-theme-error) 62%, var(--glean-border-soft));
        background: var(--b3-theme-error);
        color: var(--b3-theme-on-error, #fff);
    }

    .glean-btn--danger:hover:not(:disabled) {
        filter: brightness(0.94);
    }

    @media (max-width: 560px) {
        .glean-confirm__actions > .glean-btn {
            flex: 1 1 130px;
            min-height: 44px;
        }
    }
</style>

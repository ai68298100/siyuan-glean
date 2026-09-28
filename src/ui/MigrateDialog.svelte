<script lang="ts">
/** 存量迁移器弹窗（T-1102）：dry-run 报告 → 分批回填（可暂停/续跑）→ 完成报告三类。 */
import { onMount } from "svelte";
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import {
    buildDryRunReport,
    clearMigrateProgress,
    loadMigrateProgress,
    runBackfillBatch,
    type MigrateRow,
} from "../services/migrate-service";

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);

type Phase = "intro" | "scanning" | "report" | "running" | "paused" | "done";

let phase = $state<Phase>("intro");
let rows = $state<MigrateRow[]>([]);
let cursor = $state(0);
let filter = $state<"all" | "pending" | "ok" | "skipped" | "manual">("all");
let aborted = $state(false);
let resumeAvailable = $state(false);

onMount(async () => {
    const progress = await loadMigrateProgress(facade.pluginInstance);
    if (progress && !progress.finished && progress.rows.length > 0) {
        resumeAvailable = true;
        rows = progress.rows;
        cursor = progress.cursor;
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

async function startScan() {
    phase = "scanning";
    rows = [];
    try {
        rows = await buildDryRunReport(facade.settings);
        cursor = 0;
        phase = "report";
    } catch (error) {
        showMessage(String(error), 5000);
        phase = "intro";
    }
}

async function resume() {
    const progress = await loadMigrateProgress(facade.pluginInstance);
    if (!progress) return;
    rows = progress.rows;
    cursor = progress.cursor;
    phase = "report";
    await startRun();
}

async function startRun() {
    phase = "running";
    aborted = false;
    const signal = { get aborted() { return aborted; } };
    let last: Awaited<ReturnType<typeof runBackfillBatch>> | null = null;
    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            last = await runBackfillBatch(facade.pluginInstance, facade.settings, { signal });
            cursor = last.processed;
            if (last.finished || aborted) break;
        }
        phase = last.finished ? "done" : "paused";
        if (last.finished) {
            await clearMigrateProgress(facade.pluginInstance);
            resumeAvailable = false;
            facade.notifyDataChanged();
        }
    } catch (error) {
        showMessage(String(error), 5000);
        phase = "paused";
    }
}

async function closeAndClean() {
    if (phase !== "done") {
        // 保留进度，下次可续跑
        onClose();
        return;
    }
    onClose();
}

function rowStateLabel(row: MigrateRow): string {
    switch (row.state) {
        case "ok": return "✓";
        case "skipped": return t(i18n, "migrate.skipHasAttrs");
        case "manual": return t(i18n, "migrate.needUrl");
        case "error": return row.detail || "error";
        default: return t(i18n, "migrate.foundUrl");
    }
}
</script>

<div class="glean-migrate">
    {#if phase === "intro"}
        <p class="glean-migrate__intro">{t(i18n, "migrate.intro")}</p>
        {#if resumeAvailable}
            <div class="glean-migrate__resume">
                <button class="b3-button b3-button--outline" onclick={() => void resume()}>
                    {t(i18n, "migrate.continue")}（{cursor}/{rows.length}）
                </button>
                <button class="b3-button b3-button--text" onclick={() => void clearMigrateProgress(facade.pluginInstance).then(() => (resumeAvailable = false))}>
                    {t(i18n, "migrate.discardProgress")}
                </button>
            </div>
        {/if}
        <div class="glean-migrate__ops">
            <button class="b3-button b3-button--outline" onclick={() => void startScan()}>
                {t(i18n, "migrate.dryRun")}
            </button>
        </div>
    {:else if phase === "scanning"}
        <div class="glean-migrate__status">{t(i18n, "migrate.scanning")}</div>
    {:else if phase === "report"}
        <div class="glean-migrate__summary">
            <span>{t(i18n, "migrate.total", { n: rows.length })}</span>
            <span>· {t(i18n, "migrate.backfillable", { n: counts.pending })}</span>
            <span>· {t(i18n, "migrate.needUrl")} {counts.manual}</span>
            <span>· {t(i18n, "migrate.skipHasAttrs")} {counts.skipped}</span>
        </div>
        <div class="glean-migrate__table">
            <table class="glean-table">
                <thead>
                    <tr><th>{t(i18n, "migrate.columnTitle")}</th><th>{t(i18n, "migrate.columnUrl")}</th><th>{t(i18n, "migrate.columnWords")}</th><th>{t(i18n, "migrate.foundUrl")}</th></tr>
                </thead>
                <tbody>
                    {#each visibleRows as row (row.id)}
                        <tr>
                            <td class="glean-table__title">{row.title || row.hpath}</td>
                            <td class="glean-table__url">{row.url || "—"}</td>
                            <td>{row.words || "—"}</td>
                            <td>{rowStateLabel(row)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <div class="glean-migrate__ops">
            <select class="b3-select" bind:value={filter}>
                <option value="all">{t(i18n, "migrate.filterAll")}</option>
                <option value="pending">{t(i18n, "migrate.filterPending")}</option>
                <option value="manual">{t(i18n, "migrate.needUrl")}</option>
                <option value="skipped">{t(i18n, "migrate.skipHasAttrs")}</option>
            </select>
            <button class="b3-button b3-button--text" onclick={() => void startScan()}>{t(i18n, "migrate.rescan")}</button>
            <button class="b3-button" onclick={() => void startRun()} disabled={counts.pending === 0}>
                {t(i18n, "migrate.run")}
            </button>
        </div>
    {:else if phase === "running" || phase === "paused"}
        <div class="glean-migrate__progress">
            <div class="glean-progress"><div class="glean-progress__bar" style={`width:${progressPct}%`}></div></div>
            <div class="glean-migrate__status">
                {t(i18n, "migrate.writing")} {cursor}/{rows.length}
                {#if phase === "paused"}（{t(i18n, "migrate.paused")}）{/if}
            </div>
        </div>
        <div class="glean-migrate__ops">
            {#if phase === "running"}
                <button class="b3-button b3-button--outline" onclick={() => (aborted = true)}>
                    {t(i18n, "migrate.pause")}
                </button>
            {:else}
                <button class="b3-button" onclick={() => void startRun()}>{t(i18n, "migrate.continue")}</button>
            {/if}
        </div>
    {:else if phase === "done"}
        <div class="glean-migrate__done">
            <div class="glean-migrate__done-title">{t(i18n, "migrate.done")}</div>
            <div class="glean-migrate__summary">
                {t(i18n, "migrate.summary", { ok: counts.ok, skip: counts.skipped, manual: counts.manual })}
            </div>
            {#if counts.manual > 0}
                <div class="glean-migrate__manual-list">
                    <div class="glean-section-label">{t(i18n, "migrate.needUrl")}</div>
                    {#each rows.filter((row) => row.state === "manual") as row (row.id)}
                        <div class="glean-migrate__manual-row" title={row.hpath}>{row.title || row.hpath}</div>
                    {/each}
                </div>
            {/if}
        </div>
        <div class="glean-migrate__ops">
            <button class="b3-button" onclick={() => void closeAndClean()}>{t(i18n, "action.close")}</button>
        </div>
    {/if}
</div>

<style>
    /* 样式在 src/index.scss 全局维护 */
</style>

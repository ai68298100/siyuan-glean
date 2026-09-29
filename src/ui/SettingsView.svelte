<script lang="ts">
/** 设置视图（T-1101/T-1200）：iOS inset group 风格——锚点笔记本 chips、AI 开关、重浮参数、挂库、维护。 */
import { onMount } from "svelte";
import { showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { rebuildIndex } from "../services/clip-store";
import { bindAllClipsToLibrary } from "../services/library-db";
import { usageToday, loadAiLog, type AiLogEntry } from "../services/enrich-service";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

let notebooks = $state<NotebookMeta[]>([]);
let anchorNotebooks = $state<string[]>(facade.settings.anchorNotebooks);
let aiEnrichMode = $state<"off" | "manual" | "auto">(facade.settings.ai.enrichMode);
let aiDailyCap = $state(facade.settings.ai.enrichDailyCap);
let aiDedup = $state(facade.settings.ai.dedupOnEnrich);
let aiRelated = $state(facade.settings.ai.relatedWhileReading);
let aiActions = $state(facade.settings.ai.presetActions);
let usageCount = $state(0);
let dailyCount = $state(facade.settings.resurface.dailyCount);
let includeDone = $state(facade.settings.resurface.includeDoneHighlights);
let inboxQuota = $state(facade.settings.inboxQuota);
let staleDays = $state(facade.settings.staleDays);
let batchSize = $state(facade.settings.migrateBatchSize);
let boardBusy = $state(false);
let aiLog = $state<AiLogEntry[] | null>(null);

onMount(() => {
    void listNotebooks().then((items) => (notebooks = items));
    void usageToday(facade.pluginInstance).then((n) => (usageCount = n));
});

function toggleNotebook(id: string) {
    anchorNotebooks = anchorNotebooks.includes(id)
        ? anchorNotebooks.filter((item) => item !== id)
        : [...anchorNotebooks, id];
    void save();
}

async function save() {
    await facade.updateSettings({
        ...facade.settings,
        anchorNotebooks: [...anchorNotebooks],
        ai: {
            enrichMode: aiEnrichMode,
            enrichDailyCap: aiDailyCap,
            dedupOnEnrich: aiDedup,
            relatedWhileReading: aiRelated,
            presetActions: aiActions,
        },
        resurface: { dailyCount, includeDoneHighlights: includeDone },
        inboxQuota,
        staleDays,
        migrateBatchSize: batchSize,
    });
}

async function toggleAi(key: "dedup" | "related" | "actions") {
    if (key === "dedup") aiDedup = !aiDedup;
    else if (key === "related") aiRelated = !aiRelated;
    else aiActions = !aiActions;
    await save();
}

async function setMode(mode: "off" | "manual" | "auto") {
    aiEnrichMode = mode;
    await save();
}

async function doRebuildIndex() {
    await rebuildIndex(facade.pluginInstance, facade.settings);
    showMessage(t(i18n, "msg.indexRebuilt"), 2500);
}

async function toggleAiLog() {
    if (aiLog !== null) {
        aiLog = null;
        return;
    }
    aiLog = await loadAiLog(facade.pluginInstance);
}

async function doMountBoard() {
    boardBusy = true;
    try {
        const result = await bindAllClipsToLibrary(facade.pluginInstance, facade.settings);
        showMessage(t(i18n, "board.mounted", { n: result.bound }), 3500);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        boardBusy = false;
    }
}
</script>

<div class="glean-settings">
    <div class="glean-set-group" style="padding:12px 14px; display:flex; align-items:center; gap:9px">
        <div class="glean-brand__mark" style="width:28px;height:28px;border-radius:9px">
            <svg style="width:14px;height:14px"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <div style="font-size:13.5px; font-weight:700">{t(i18n, "settings.title")}</div>
            <div style="font-size:10px; color:var(--b3-theme-on-surface)">{t(i18n, "settings.sovereigntyNote")}</div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.anchorNotebooks")}</div>
        <div class="glean-set-group">
            <div class="glean-nb-wrap">
                {#each notebooks as notebook (notebook.id)}
                    <button
                        class="glean-nb"
                        class:glean-nb--on={anchorNotebooks.includes(notebook.id)}
                        onclick={() => toggleNotebook(notebook.id)}
                    >
                        {anchorNotebooks.includes(notebook.id) ? "✓ " : ""}{notebook.name}
                    </button>
                {/each}
                {#if notebooks.length === 0}
                    <span style="font-size:11.5px; color:var(--b3-theme-on-surface)">—</span>
                {/if}
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.anchorNotebooks")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.anchorNotebooksDesc")}</div>
                </div>
            </div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.aiGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiEnrichMode")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiEnrichModeDesc")}</div>
                </div>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-seg">
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "off"}
                        onclick={() => void setMode("off")}
                    >{t(i18n, "settings.modeOff")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "manual"}
                        onclick={() => void setMode("manual")}
                    >{t(i18n, "settings.modeManual")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "auto"}
                        onclick={() => void setMode("auto")}
                    >{t(i18n, "settings.modeAuto")}</button>
                </div>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiDailyCap")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiDailyCapDesc")}</div>
                </div>
                <input class="glean-mini-input" type="number" min="0" max="500" bind:value={aiDailyCap} onchange={() => void save()} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiTodayUsage")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiTodayUsageDesc")}</div>
                </div>
                <span class="chip glean-chip">{usageCount}{aiDailyCap > 0 ? " / " + aiDailyCap : ""}</span>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiDedup")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiDedupDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={aiDedup} onclick={() => void toggleAi("dedup")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiRelated")}</div>
                <button class="glean-sw" class:glean-sw--on={aiRelated} onclick={() => void toggleAi("related")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiSummaryActions")}</div>
                <button class="glean-sw" class:glean-sw--on={aiActions} onclick={() => void toggleAi("actions")}></button>
            </div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.resurfaceGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.resurfaceCount")}</div>
                <input class="glean-mini-input" type="number" min="1" max="10" bind:value={dailyCount} onchange={() => void save()} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.resurfaceIncludeDone")}</div>
                <button class="glean-sw" class:glean-sw--on={includeDone} onclick={() => { includeDone = !includeDone; void save(); }}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.inboxQuota")}</div>
                <input class="glean-mini-input" type="number" min="5" max="1000" bind:value={inboxQuota} onchange={() => void save()} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.staleDays")}</div>
                <input class="glean-mini-input" type="number" min="7" max="3650" bind:value={staleDays} onchange={() => void save()} />
            </div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "board.groupTitle")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "board.mountTitle")}
                    <div class="glean-set-row__desc">{t(i18n, "board.mountDesc")}</div>
                </div>
                <button class="glean-btn glean-btn--pri" style="flex-shrink:0" disabled={boardBusy} onclick={() => void doMountBoard()}>
                    {boardBusy ? t(i18n, "panel.loading") : t(i18n, "board.mountAction")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "migrate.batchSize")}
                </div>
                <input class="glean-mini-input" type="number" min="1" max="50" bind:value={batchSize} onchange={() => void save()} />
            </div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.dangerGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.rebuildIndex")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.rebuildIndexDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" onclick={() => void doRebuildIndex()}>
                    {t(i18n, "settings.rebuildIndex")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiLog")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiLogDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" onclick={() => void toggleAiLog()}>
                    {aiLog === null ? t(i18n, "settings.aiLogView") : t(i18n, "action.close")}
                </button>
            </div>
            {#if aiLog !== null && aiLog.length > 0}
                <div class="glean-set-row" style="flex-direction:column; align-items:stretch; gap:6px">
                    {#each aiLog as entry (entry.at + entry.docId)}
                        <div class="glean-logrow">
                            <span class="glean-logrow__time">{entry.at.slice(5, 16).replace("T", " ")}</span>
                            <span class="glean-logrow__stage">{entry.stage}</span>
                            <span class="glean-logrow__msg">{entry.message}</span>
                        </div>
                    {/each}
                </div>
            {:else if aiLog !== null}
                <div class="glean-set-row" style="font-size:11.5px; color:var(--b3-theme-on-surface)">
                    {t(i18n, "settings.aiLogEmpty")}
                </div>
            {/if}
        </div>
    </div>
</div>

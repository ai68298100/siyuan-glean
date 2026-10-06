<script lang="ts">
/** 设置视图（T-1101/T-1200）：iOS inset group 风格——锚点笔记本 chips、AI 开关、重浮参数、挂库、维护。 */
import { onMount } from "svelte";
import { getFrontend, showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { rebuildIndex } from "../services/clip-store";
import { bindAllClipsToLibrary } from "../services/library-db";
import { usageToday, loadAiLog, type AiLogEntry } from "../services/enrich-service";
import { listCheckinItems, type CheckinItemOption } from "../services/checkin-bridge";
import { testDirectChannel } from "../api/ai-direct";
import { t } from "../libs/i18n";
import { DEFAULT_SETTINGS, cloneSettings, mergeSettingsDraft, normalizeSettings, settingsEqual, type GleanSettings } from "../services/settings";
import { loadUiPrefs, saveUiPrefs } from "../services/prefs";
import type { GleanFacade } from "../types";
import { exportAnonymousDiagnostic, exportLibraryCsv } from "../services/library-export-service";
import BackupPanel from "./BackupPanel.svelte";
import FlashcardRecoveryPanel from "./FlashcardRecoveryPanel.svelte";

interface Props {
    facade: GleanFacade;
    onClose?: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);

let notebooks = $state<NotebookMeta[]>([]);
let anchorNotebooks = $state<string[]>([...DEFAULT_SETTINGS.anchorNotebooks]);
let snapshotOnCapture = $state(DEFAULT_SETTINGS.snapshotOnCapture);
let aiEnrichMode = $state<"off" | "manual" | "auto">(DEFAULT_SETTINGS.ai.enrichMode);
let aiDailyCap = $state(DEFAULT_SETTINGS.ai.enrichDailyCap);
let aiDedup = $state(DEFAULT_SETTINGS.ai.dedupOnEnrich);
let aiRelated = $state(DEFAULT_SETTINGS.ai.relatedWhileReading);
let aiFormatting = $state(DEFAULT_SETTINGS.ai.formattingEnabled);
let aiAuthorSuggestion = $state(DEFAULT_SETTINGS.ai.authorSuggestionEnabled);
let aiQuestionCard = $state(DEFAULT_SETTINGS.ai.questionCardEnabled);
let aiArticleQuestion = $state(DEFAULT_SETTINGS.ai.articleQuestionEnabled);
let aiActions = $state(DEFAULT_SETTINGS.ai.presetActions);
let usageCount = $state<number | null>(null);
let dailyCount = $state(DEFAULT_SETTINGS.resurface.dailyCount);
let includeDone = $state(DEFAULT_SETTINGS.resurface.includeDoneHighlights);
let inboxQuota = $state(DEFAULT_SETTINGS.inboxQuota);
let staleDays = $state(DEFAULT_SETTINGS.staleDays);
let boardBusy = $state(false);
let aiChannel = $state<"siyuan" | "custom">(DEFAULT_SETTINGS.ai.channel);
let customBaseUrl = $state(DEFAULT_SETTINGS.ai.customBaseUrl);
let customModel = $state(DEFAULT_SETTINGS.ai.customModel);
let customSecretName = $state(DEFAULT_SETTINGS.ai.customSecretName);
let testBusy = $state(false);
let checkinEnabled = $state(DEFAULT_SETTINGS.integration.checkinEnabled);
let checkinItemId = $state(DEFAULT_SETTINGS.integration.checkinItemId);
let bridgeWriteEnabled = $state(DEFAULT_SETTINGS.integration.bridgeWriteEnabled);
let checkinItems = $state<CheckinItemOption[]>([]);
let readerOpenInTab = $state(DEFAULT_SETTINGS.reader.openInTab);
let readerMode = $state<"read" | "edit">(DEFAULT_SETTINGS.reader.defaultMode);
let originalSettings = $state<GleanSettings>(cloneSettings(DEFAULT_SETTINGS));
let saveBusy = $state(false);
let showNewbieHint = $state(false);
let dismissHintBusy = $state(false);
let exportBusy = $state<"csv" | "diagnostic" | "">("");
let exportError = $state("");
let lastExport = $state<"csv" | "diagnostic" | "">("");

let aiLog = $state<AiLogEntry[] | null>(null);
let draftDirty = $derived(!settingsEqual(originalSettings, buildDraftSettings()));

onMount(() => {
    let active = true;
    originalSettings = cloneSettings(facade.settings);
    loadDraft(originalSettings);
    void loadUiPrefs(facade.pluginInstance).then((prefs) => {
        if (active) showNewbieHint = !prefs.onboardingDone && !prefs.onboardingHintDismissed;
    }).catch(() => undefined);
    void listNotebooks().then((items) => (notebooks = items));
    if (originalSettings.integration.checkinEnabled) {
        void listCheckinItems().then((items) => { checkinItems = items; });
    }
    let usageRequest = 0;
    const refreshUsage = () => {
        const request = ++usageRequest;
        usageCount = null;
        void usageToday(facade.pluginInstance).then((count) => {
            if (active && request === usageRequest) usageCount = count;
        }).catch(() => {
            if (active && request === usageRequest) usageCount = null;
        });
    };
    refreshUsage();
    document.addEventListener("glean:data-changed", refreshUsage);
    return () => {
        active = false;
        document.removeEventListener("glean:data-changed", refreshUsage);
    };
});

function toggleNotebook(id: string) {
    anchorNotebooks = anchorNotebooks.includes(id)
        ? anchorNotebooks.filter((item) => item !== id)
        : [...anchorNotebooks, id];
}

function loadDraft(settings: GleanSettings) {
    anchorNotebooks = [...settings.anchorNotebooks];
    snapshotOnCapture = settings.snapshotOnCapture;
    aiEnrichMode = settings.ai.enrichMode;
    aiDailyCap = settings.ai.enrichDailyCap;
    aiDedup = settings.ai.dedupOnEnrich;
    aiRelated = settings.ai.relatedWhileReading;
    aiFormatting = settings.ai.formattingEnabled;
    aiAuthorSuggestion = settings.ai.authorSuggestionEnabled;
    aiQuestionCard = settings.ai.questionCardEnabled;
    aiArticleQuestion = settings.ai.articleQuestionEnabled;
    aiActions = settings.ai.presetActions;
    dailyCount = settings.resurface.dailyCount;
    includeDone = settings.resurface.includeDoneHighlights;
    inboxQuota = settings.inboxQuota;
    staleDays = settings.staleDays;
    aiChannel = settings.ai.channel;
    customBaseUrl = settings.ai.customBaseUrl;
    customModel = settings.ai.customModel;
    customSecretName = settings.ai.customSecretName;
    checkinEnabled = settings.integration.checkinEnabled;
    checkinItemId = settings.integration.checkinItemId;
    bridgeWriteEnabled = settings.integration.bridgeWriteEnabled;
    readerOpenInTab = settings.reader.openInTab;
    readerMode = settings.reader.defaultMode;
}

function buildDraftSettings(): GleanSettings {
    return normalizeSettings({
        ...originalSettings,
        anchorNotebooks: [...anchorNotebooks],
        snapshotOnCapture,
        ai: {
            ...originalSettings.ai,
            enrichMode: aiEnrichMode,
            enrichDailyCap: aiDailyCap,
            dedupOnEnrich: aiDedup,
            relatedWhileReading: aiRelated,
            formattingEnabled: aiFormatting,
            authorSuggestionEnabled: aiAuthorSuggestion,
            questionCardEnabled: aiQuestionCard,
            articleQuestionEnabled: aiArticleQuestion,
            presetActions: aiActions,
            channel: aiChannel,
            customBaseUrl,
            customModel,
            customSecretName,
        },
        resurface: { dailyCount, includeDoneHighlights: includeDone },
        inboxQuota,
        staleDays,
        // migrateBatchSize 改在迁移器内调整（UX 审计 #7），不经设置草稿编辑。
        integration: { checkinEnabled, checkinItemId, bridgeWriteEnabled },
        reader: { openInTab: readerOpenInTab, defaultMode: readerMode },
    });
}

async function save() {
    if (saveBusy) return;
    saveBusy = true;
    try {
        const draft = buildDraftSettings();
        await facade.updateSettings(mergeSettingsDraft(facade.settings, draft));
        originalSettings = cloneSettings(facade.settings);
        loadDraft(originalSettings);
        showMessage(t(i18n, "settings.saved"), 2500);
        onClose?.();
    } catch (error) {
        showMessage(`${t(i18n, "settings.saveFailed")}: ${String(error).slice(0, 120)}`, 5000);
    } finally {
        saveBusy = false;
    }
}

async function dismissNewbieHint() {
    if (dismissHintBusy || !showNewbieHint) return;
    dismissHintBusy = true;
    try {
        await saveUiPrefs(facade.pluginInstance, { onboardingHintDismissed: true });
        showNewbieHint = false;
    } catch (error) {
        showMessage(`${t(i18n, "settings.saveFailed")}: ${String(error).slice(0, 120)}`, 5000);
    } finally {
        dismissHintBusy = false;
    }
}

function cancel() {
    loadDraft(originalSettings);
    onClose?.();
}

function resetDefaults() {
    loadDraft(cloneSettings(DEFAULT_SETTINGS));
}

function toggleAi(key: "dedup" | "related" | "actions") {
    if (key === "dedup") aiDedup = !aiDedup;
    else if (key === "related") aiRelated = !aiRelated;
    else aiActions = !aiActions;
}

function setMode(mode: "off" | "manual" | "auto") {
    aiEnrichMode = mode;
}

function setChannel(channel: "siyuan" | "custom") {
    aiChannel = channel;
}

async function testChannel() {
    if (testBusy) return;
    testBusy = true;
    try {
        const result = await testDirectChannel(facade.pluginInstance, buildDraftSettings());
        showMessage(
            result.ok ? t(i18n, "ai.testOk", { message: result.message }) : t(i18n, "ai.testFail", { message: result.message }),
            4500
        );
    } finally {
        testBusy = false;
    }
}

async function doRebuildIndex() {
    try {
        await rebuildIndex(facade.pluginInstance, buildDraftSettings());
        showMessage(t(i18n, "msg.indexRebuilt"), 2500);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    }
}

function downloadText(filename: string, content: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportData(kind: "csv" | "diagnostic"): Promise<void> {
    if (exportBusy) return;
    exportBusy = kind;
    lastExport = kind;
    exportError = "";
    try {
        if (kind === "csv") {
            const csv = await exportLibraryCsv(facade.pluginInstance, facade.settings);
            downloadText("siyuan-glean-library.csv", csv, "text/csv;charset=utf-8");
        } else {
            const diagnostic = await exportAnonymousDiagnostic(facade.pluginInstance, facade.settings, getFrontend());
            downloadText("siyuan-glean-diagnostic.json", diagnostic, "application/json;charset=utf-8");
        }
    } catch (error) {
        exportError = String(error).slice(0, 160);
        showMessage(exportError, 5000);
    } finally {
        exportBusy = "";
    }
}

async function toggleCheckin() {
    checkinEnabled = !checkinEnabled;
    if (checkinEnabled && checkinItems.length === 0) {
        checkinItems = await listCheckinItems();
    }
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
        const result = await bindAllClipsToLibrary(facade.pluginInstance, buildDraftSettings());
        showMessage(t(i18n, "board.projected", { bound: result.bound, synced: result.synced, failed: result.failures.length }), 3500);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        boardBusy = false;
    }
}
</script>

<div class="glean-settings" aria-labelledby="glean-settings-title" aria-busy={saveBusy}>
    <div class="glean-settings__head">
        <div class="glean-brand__mark glean-settings__head-mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div class="glean-settings__head-copy">
            <h2 id="glean-settings-title" class="glean-settings__head-title">{t(i18n, "settings.title")}</h2>
            <div class="glean-settings__head-sub">{t(i18n, "settings.sovereigntyNote")}</div>
        </div>
    </div>
    {#if showNewbieHint}
        <div class="glean-set-group glean-settings__newbie-hint" role="status">
            <span class="glean-settings__newbie-hint-text"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanWheat" /></svg>{t(i18n, "settings.newbieHint")}</span>
            <button class="glean-linkish glean-settings__newbie-hint-dismiss" disabled={dismissHintBusy} onclick={() => void dismissNewbieHint()}>
                {t(i18n, "settings.dismissNewbieHint")}
            </button>
        </div>
    {/if}

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.anchorNotebooks")}</div>
        <div class="glean-set-group">
            <div class="glean-nb-wrap">
                {#each notebooks as notebook (notebook.id)}
                    <button
                        class="glean-nb"
                        class:glean-nb--on={anchorNotebooks.includes(notebook.id)}
                        aria-pressed={anchorNotebooks.includes(notebook.id)}
                        onclick={() => toggleNotebook(notebook.id)}
                    >
                        {anchorNotebooks.includes(notebook.id) ? "✓ " : ""}{notebook.name}
                    </button>
                {/each}
                {#if notebooks.length === 0}
                    <span class="glean-settings__empty">—</span>
                {/if}
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.anchorNotebooks")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.anchorNotebooksDesc")}</div>
                </div>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.snapshotOnCapture")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.snapshotOnCaptureHint")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={snapshotOnCapture} aria-label={t(i18n, "settings.snapshotOnCapture")} aria-pressed={snapshotOnCapture} onclick={() => { snapshotOnCapture = !snapshotOnCapture; }}></button>
            </div>
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.aiGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiEnrichMode")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiEnrichModeDesc")}</div>
                </div>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-seg" role="group" aria-label={t(i18n, "settings.aiEnrichMode")}>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "off"}
                        aria-pressed={aiEnrichMode === "off"}
                        onclick={() => setMode("off")}
                    >{t(i18n, "settings.modeOff")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "manual"}
                        aria-pressed={aiEnrichMode === "manual"}
                        onclick={() => setMode("manual")}
                    >{t(i18n, "settings.modeManual")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiEnrichMode === "auto"}
                        aria-pressed={aiEnrichMode === "auto"}
                        onclick={() => setMode("auto")}
                    >{t(i18n, "settings.modeAuto")}</button>
                </div>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiDailyCap")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiDailyCapDesc")}</div>
                </div>
                <input class="glean-mini-input" type="number" min="0" max="500" aria-label={t(i18n, "settings.aiDailyCap")} bind:value={aiDailyCap} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiTodayUsage")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiTodayUsageDesc")}</div>
                </div>
                <span class="chip glean-chip glean-settings__usage">{usageCount ?? t(i18n, "settings.usageUnknown")}{usageCount !== null && aiDailyCap > 0 ? " / " + aiDailyCap : ""}</span>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiDedup")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiDedupDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={aiDedup} aria-label={t(i18n, "settings.aiDedup")} aria-pressed={aiDedup} onclick={() => void toggleAi("dedup")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiRelated")}</div>
                <button class="glean-sw" class:glean-sw--on={aiRelated} aria-label={t(i18n, "settings.aiRelated")} aria-pressed={aiRelated} onclick={() => void toggleAi("related")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "formatting.enable")}
                    <div class="glean-set-row__desc">{t(i18n, "formatting.enableHint")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={aiFormatting} aria-label={t(i18n, "formatting.enable")} aria-pressed={aiFormatting} onclick={() => { aiFormatting = !aiFormatting; }}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiSummaryActions")}</div>
                <button class="glean-sw" class:glean-sw--on={aiActions} aria-label={t(i18n, "settings.aiSummaryActions")} aria-pressed={aiActions} onclick={() => void toggleAi("actions")}></button>
            </div>
            <label class="glean-set-row glean-settings__ai-toggle">
                <span class="glean-set-row__lb">
                    {t(i18n, "author.suggestion.enable")}
                    <span class="glean-set-row__desc">{t(i18n, "author.suggestion.enableHint")}</span>
                </span>
                <input type="checkbox" bind:checked={aiAuthorSuggestion} />
            </label>
            <label class="glean-set-row glean-settings__ai-toggle">
                <span class="glean-set-row__lb">
                    {t(i18n, "flashcard.aiEnable")}
                    <span class="glean-set-row__desc">{t(i18n, "flashcard.aiEnableHint")}</span>
                </span>
                <input type="checkbox" bind:checked={aiQuestionCard} />
            </label>
            <label class="glean-set-row glean-settings__ai-toggle">
                <span class="glean-set-row__lb">
                    {t(i18n, "reader.articleQuestion.enable")}
                    <span class="glean-set-row__desc">{t(i18n, "reader.articleQuestion.enableHint")}</span>
                </span>
                <input type="checkbox" bind:checked={aiArticleQuestion} />
            </label>
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.aiChannelGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiChannel")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiChannelDesc")}</div>
                </div>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-seg" role="group" aria-label={t(i18n, "settings.aiChannel")}>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiChannel === "siyuan"}
                        aria-pressed={aiChannel === "siyuan"}
                        onclick={() => setChannel("siyuan")}
                    >{t(i18n, "settings.channelSiyuan")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiChannel === "custom"}
                        aria-pressed={aiChannel === "custom"}
                        onclick={() => setChannel("custom")}
                    >{t(i18n, "settings.channelCustom")}</button>
                </div>
            </div>
            {#if aiChannel === "custom"}
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.customBaseUrl")}</div>
                    <input class="glean-mini-input glean-settings__wide-input" aria-label={t(i18n, "settings.customBaseUrl")} placeholder="https://…/v1" bind:value={customBaseUrl} />
                </div>
                {#if /^http:\/\//i.test(customBaseUrl.trim())}
                    <div class="glean-set-row" role="alert">
                        <span class="glean-settings__error">{t(i18n, "settings.customBaseUrlInsecure")}</span>
                    </div>
                {/if}
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.customModel")}</div>
                    <input class="glean-mini-input glean-settings__wide-input" aria-label={t(i18n, "settings.customModel")} placeholder="free-model" bind:value={customModel} />
                </div>
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">
                        {t(i18n, "settings.customSecretName")}
                        <div class="glean-set-row__desc">{t(i18n, "settings.customSecretDesc")}</div>
                    </div>
                    <input class="glean-mini-input glean-settings__wide-input" aria-label={t(i18n, "settings.customSecretName")} bind:value={customSecretName} />
                </div>
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.testConnection")}</div>
                    <button class="glean-btn glean-action-btn" disabled={testBusy} onclick={() => void testChannel()}>
                        {testBusy ? t(i18n, "panel.loading") : t(i18n, "settings.testConnection")}
                    </button>
                </div>
            {/if}
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.resurfaceGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.resurfaceCount")}</div>
                <input class="glean-mini-input" type="number" min="1" max="10" aria-label={t(i18n, "settings.resurfaceCount")} bind:value={dailyCount} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.resurfaceIncludeDone")}</div>
                <button class="glean-sw" class:glean-sw--on={includeDone} aria-label={t(i18n, "settings.resurfaceIncludeDone")} aria-pressed={includeDone} onclick={() => { includeDone = !includeDone; }}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.inboxQuota")}</div>
                <input class="glean-mini-input" type="number" min="5" max="1000" aria-label={t(i18n, "settings.inboxQuota")} bind:value={inboxQuota} />
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.staleDays")}</div>
                <input class="glean-mini-input" type="number" min="7" max="3650" aria-label={t(i18n, "settings.staleDays")} bind:value={staleDays} />
            </div>
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "board.groupTitle")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "board.mountTitle")}
                    <div class="glean-set-row__desc">{t(i18n, "board.mountDesc")}</div>
                </div>
                <button class="glean-btn glean-btn--pri glean-action-btn" disabled={boardBusy} onclick={() => void doMountBoard()}>
                    {boardBusy ? t(i18n, "panel.loading") : t(i18n, "board.mountAction")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.exportLibraryCsv")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.exportLibraryCsvDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" disabled={Boolean(exportBusy)} onclick={() => void exportData("csv")}>
                    {exportBusy === "csv" ? t(i18n, "settings.exporting") : t(i18n, "settings.exportLibraryCsv")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.exportDiagnostic")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.exportDiagnosticDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" disabled={Boolean(exportBusy)} onclick={() => void exportData("diagnostic")}>
                    {exportBusy === "diagnostic" ? t(i18n, "settings.exporting") : t(i18n, "settings.exportDiagnostic")}
                </button>
            </div>
            {#if exportError}
                <div class="glean-set-row" role="alert">
                    <span class="glean-settings__error">{exportError}</span>
                    <button class="glean-btn glean-btn--ghost" disabled={Boolean(exportBusy)} onclick={() => lastExport && void exportData(lastExport)}>{t(i18n, "action.retry")}</button>
                </div>
            {/if}
            <BackupPanel {facade} settingsDirty={draftDirty} settingsBusy={saveBusy} onPreferencesRestored={() => { originalSettings = cloneSettings(facade.settings); loadDraft(originalSettings); }} />
            <FlashcardRecoveryPanel {facade} />
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.checkinGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.checkinEnable")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.checkinEnableDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={checkinEnabled} aria-label={t(i18n, "settings.checkinEnable")} aria-pressed={checkinEnabled} onclick={() => void toggleCheckin()}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.bridgeWriteEnable")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.bridgeWriteEnableDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={bridgeWriteEnabled} aria-label={t(i18n, "settings.bridgeWriteEnable")} aria-pressed={bridgeWriteEnabled} onclick={() => { bridgeWriteEnabled = !bridgeWriteEnabled; }}></button>
            </div>
            {#if checkinEnabled}
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">
                        {t(i18n, "settings.checkinItem")}
                        <div class="glean-set-row__desc">
                            {#if checkinItems.length === 0}{t(i18n, "settings.checkinNoItems")}{:else}{checkinItems.length} {t(i18n, "settings.checkinItemsFound")}{/if}
                        </div>
                    </div>
                    <select class="b3-select" style="font-size:12px" aria-label={t(i18n, "settings.checkinItem")} bind:value={checkinItemId}>
                        <option value="">—</option>
                        {#each checkinItems as item (item.id)}
                            <option value={item.id}>{item.name}</option>
                        {/each}
                    </select>
                </div>
            {/if}
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.readerGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.readerOpenInTab")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.readerOpenInTabHint")}</div>
                </div>
                <button
                    class="glean-sw"
                    class:glean-sw--on={readerOpenInTab}
                    title={t(i18n, "settings.readerOpenInTab")}
                    aria-label={t(i18n, "settings.readerOpenInTab")}
                    aria-pressed={readerOpenInTab}
                    onclick={() => { readerOpenInTab = !readerOpenInTab; }}
                ></button>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.readerMode")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.readerModeHint")}</div>
                </div>
                <div class="glean-seg" role="group" aria-label={t(i18n, "settings.readerMode")}>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={readerMode === "read"}
                        aria-pressed={readerMode === "read"}
                        onclick={() => { readerMode = "read"; }}
                    >{t(i18n, "reader.modeRead")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={readerMode === "edit"}
                        aria-pressed={readerMode === "edit"}
                        onclick={() => { readerMode = "edit"; }}
                    >{t(i18n, "reader.modeEdit")}</button>
                </div>
            </div>
        </div>
    </div>

    <div class="glean-settings__section">
        <div class="glean-set-title" role="heading" aria-level="2">{t(i18n, "settings.dangerGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.rebuildIndex")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.rebuildIndexDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" onclick={() => void doRebuildIndex()}>
                    {t(i18n, "settings.rebuildIndex")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "import.title")}
                    <div class="glean-set-row__desc">{t(i18n, "import.entryDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" onclick={() => facade.openImport()}>
                    {t(i18n, "import.entryAction")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiLog")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiLogDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" onclick={() => void toggleAiLog()}>
                    {aiLog === null ? t(i18n, "settings.aiLogView") : t(i18n, "action.close")}
                </button>
            </div>
            {#if aiLog !== null && aiLog.length > 0}
                <div class="glean-set-row glean-settings__log-list">
                    {#each aiLog as entry (entry.at + entry.docId)}
                        <div class="glean-logrow">
                            <span class="glean-logrow__time">{entry.at.slice(5, 16).replace("T", " ")}</span>
                            <span class="glean-logrow__stage">{entry.stage}</span>
                            <span class="glean-logrow__msg">{entry.message}</span>
                        </div>
                    {/each}
                </div>
            {:else if aiLog !== null}
                <div class="glean-set-row glean-settings__log-empty">
                    {t(i18n, "settings.aiLogEmpty")}
                </div>
            {/if}
        </div>
    </div>

    <div class="glean-settings__footer">
        <div class="glean-settings__status" class:glean-settings__status--dirty={draftDirty} aria-live="polite">
            {#if draftDirty}{t(i18n, "settings.unsavedChanges")}{:else}{t(i18n, "settings.saved")}{/if}
        </div>
        <button class="glean-btn" disabled={saveBusy} onclick={resetDefaults}>
            {t(i18n, "settings.resetDefaults")}
        </button>
        <button class="glean-btn" disabled={saveBusy} onclick={cancel}>
            {t(i18n, "action.cancel")}
        </button>
        <button class="glean-btn glean-btn--pri" aria-busy={saveBusy} disabled={saveBusy || !draftDirty} onclick={() => void save()}>
            {saveBusy ? t(i18n, "panel.loading") : t(i18n, "action.save")}
        </button>
    </div>
</div>

<style>
    .glean-settings__section {
        display: flex;
        flex-direction: column;
        gap: var(--glean-space-2);
        min-width: 0;
    }

    .glean-settings__section > .glean-set-title {
        margin: 0 var(--glean-space-1);
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        font-weight: 700;
        letter-spacing: 0.04em;
        line-height: 1.35;
    }

    .glean-settings__section > .glean-set-group {
        min-width: 0;
        border-color: var(--glean-border-soft);
        background: var(--glean-section-surface);
    }

    .glean-settings__section .glean-set-row {
        min-width: 0;
    }

    .glean-settings__section .glean-set-row__lb {
        line-height: 1.4;
    }

    .glean-settings__section .glean-set-row__desc {
        max-width: 58ch;
    }

    .glean-settings__ai-toggle input[type="checkbox"] {
        appearance: none;
        position: relative;
        box-sizing: border-box;
        width: 40px;
        height: 24px;
        margin: 0;
        flex: 0 0 auto;
        border: 1px solid var(--glean-border-soft);
        border-radius: 999px;
        background: var(--glean-inset-surface);
        cursor: pointer;
        transition: background-color 180ms var(--glean-ease-out), border-color 180ms var(--glean-ease-out), box-shadow 180ms var(--glean-ease-out);
    }

    .glean-settings__ai-toggle input[type="checkbox"]::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--b3-theme-on-surface);
        box-shadow: 0 1px 3px color-mix(in srgb, var(--b3-theme-on-background) 20%, transparent);
        transition: transform 180ms var(--glean-ease-out), background-color 180ms var(--glean-ease-out);
    }

    .glean-settings__ai-toggle input[type="checkbox"]:checked {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 58%, var(--glean-border-soft));
        background: var(--b3-theme-primary);
        box-shadow: 0 0 0 3px var(--glean-primary-soft);
    }

    .glean-settings__ai-toggle input[type="checkbox"]:checked::after {
        transform: translateX(16px);
        background: var(--b3-theme-on-primary);
    }

    .glean-settings__ai-toggle input[type="checkbox"]:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: 2px;
    }

    .glean-settings__ai-toggle input[type="checkbox"]:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .glean-settings .glean-nb.glean-nb--on {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 52%, var(--glean-border-soft));
        background: var(--glean-primary-soft);
        color: var(--b3-theme-primary);
    }

    @media (max-width: 560px) {
        .glean-settings__section .glean-set-row {
            align-items: flex-start;
            flex-wrap: wrap;
        }

        .glean-settings__section .glean-set-row > :last-child:not(.glean-set-row__lb) {
            margin-left: auto;
        }

        .glean-settings__ai-toggle input[type="checkbox"] {
            width: 44px;
            height: 26px;
        }

        .glean-settings__ai-toggle input[type="checkbox"]::after {
            width: 18px;
            height: 18px;
        }

        .glean-settings__ai-toggle input[type="checkbox"]:checked::after {
            transform: translateX(17px);
        }
    }
</style>

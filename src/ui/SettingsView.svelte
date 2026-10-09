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
import { DEFAULT_SETTINGS, cloneSettings, loadSettings, mergeSettingsDraft, normalizeSettings, SettingsConflictError, settingsEqual, type GleanSettings } from "../services/settings";
import { loadUiPrefs, saveUiPrefs } from "../services/prefs";
import type { GleanFacade } from "../types";
import { exportAnonymousDiagnostic, exportLibraryCsv } from "../services/library-export-service";
import BackupPanel from "./BackupPanel.svelte";
import FlashcardRecoveryPanel from "./FlashcardRecoveryPanel.svelte";
import AiTagMergePanel from "./AiTagMergePanel.svelte";

interface Props {
    facade: GleanFacade;
    onClose?: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);
const instanceId = $props.id();
const idPrefix = `glean-settings-${instanceId}`;
const titleId = `${idPrefix}-title`;
const navLabelId = `${idPrefix}-nav-label`;
const panelId = `${idPrefix}-panel`;

/** 设置分类（T-3314）：参照 Obsidian/思源的"左导航 + 右内容"设置范式，11 个平铺组归并为 8 个大类。 */
type SettingsSectionId = "workspace" | "resurface" | "reading" | "ai" | "aiChannel" | "integration" | "data" | "maintenance";
const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; labelKey: string; titleKey: string; descKey: string }> = [
    { id: "workspace", labelKey: "settings.nav.workspace", titleKey: "settings.workspaceGroup", descKey: "settings.desc.workspace" },
    { id: "resurface", labelKey: "settings.nav.resurface", titleKey: "settings.resurfaceGroup", descKey: "settings.desc.resurface" },
    { id: "reading", labelKey: "settings.nav.reading", titleKey: "settings.readerGroup", descKey: "settings.desc.reading" },
    { id: "ai", labelKey: "settings.nav.ai", titleKey: "settings.aiGroup", descKey: "settings.desc.ai" },
    { id: "aiChannel", labelKey: "settings.nav.aiChannel", titleKey: "settings.aiChannelGroup", descKey: "settings.desc.aiChannel" },
    { id: "integration", labelKey: "settings.nav.integration", titleKey: "settings.checkinGroup", descKey: "settings.desc.integration" },
    { id: "data", labelKey: "settings.nav.data", titleKey: "settings.dataGroup", descKey: "settings.desc.data" },
    { id: "maintenance", labelKey: "settings.nav.maintenance", titleKey: "settings.maintenanceToolsGroup", descKey: "settings.desc.maintenance" },
];
let activeSection = $state<SettingsSectionId>("workspace");
const activeSectionMeta = $derived(SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0]);

let notebooks = $state<NotebookMeta[]>([]);
let notebookLoading = $state(false);
let notebookLoadError = $state(false);
let notebookFilter = $state("");
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
let rebuildBusy = $state(false);
let aiChannel = $state<"siyuan" | "custom">(DEFAULT_SETTINGS.ai.channel);
let customBaseUrl = $state(DEFAULT_SETTINGS.ai.customBaseUrl);
let customModel = $state(DEFAULT_SETTINGS.ai.customModel);
let customSecretName = $state(DEFAULT_SETTINGS.ai.customSecretName);
let testBusy = $state(false);
let checkinEnabled = $state(DEFAULT_SETTINGS.integration.checkinEnabled);
let checkinItemId = $state(DEFAULT_SETTINGS.integration.checkinItemId);
let bridgeWriteEnabled = $state(DEFAULT_SETTINGS.integration.bridgeWriteEnabled);
let checkinItems = $state<CheckinItemOption[]>([]);
let checkinLoadError = $state(false);
let checkinLoading = $state(false);
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
let aiLogLoading = $state(false);
let aiLogError = $state(false);
let draftDirty = $derived(!settingsEqual(originalSettings, buildDraftSettings()));
/** 锚点笔记本筛选（T-3314）：按名称子串过滤 chips，大小写不敏感；清空搜索框即恢复全量。 */
const filteredNotebooks = $derived.by(() => {
    const query = notebookFilter.trim().toLocaleLowerCase();
    if (!query) return notebooks;
    return notebooks.filter((notebook) => notebook.name.toLocaleLowerCase().includes(query));
});

/** 长任务分类（备份恢复/闪卡恢复/AI 标签扫描）首次访问后保持挂载：切分类只隐藏不卸载，避免进行中的任务被静默中止（T-3315）。 */
let dataVisited = $state(false);
let maintenanceVisited = $state(false);

function selectSection(id: SettingsSectionId): void {
    activeSection = id;
    if (id === "data") dataVisited = true;
    if (id === "maintenance") maintenanceVisited = true;
}

/** ARIA tabs 键盘模式：左右（竖排时上下）方向键在分类间移动焦点并激活，Home/End 跳两端。 */
function onNavKeydown(event: KeyboardEvent): void {
    const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (backward ? -1 : 1) + tabs.length) % tabs.length;
    const target = tabs[next];
    if (!target) return;
    target.focus();
    selectSection(SETTINGS_SECTIONS[next].id);
}

function clearAnchorNotebooks(): void {
    anchorNotebooks = [];
}

let mounted = false;

onMount(() => {
    let active = true;
    mounted = true;
    originalSettings = cloneSettings(facade.settings);
    loadDraft(originalSettings);
    void loadUiPrefs(facade.pluginInstance).then((prefs) => {
        if (active) showNewbieHint = !prefs.onboardingDone && !prefs.onboardingHintDismissed;
    }).catch(() => undefined);
    void loadNotebookOptions();
    if (originalSettings.integration.checkinEnabled) {
        void loadCheckinItems();
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
        mounted = false;
        document.removeEventListener("glean:data-changed", refreshUsage);
    };
});

async function loadNotebookOptions(): Promise<void> {
    if (notebookLoading) return;
    notebookLoading = true;
    notebookLoadError = false;
    try {
        const items = await listNotebooks();
        if (mounted) notebooks = items;
    } catch {
        if (mounted) notebookLoadError = true;
    } finally {
        if (mounted) notebookLoading = false;
    }
}

async function loadCheckinItems(): Promise<void> {
    if (checkinLoading) return;
    checkinLoading = true;
    checkinLoadError = false;
    try {
        const items = await listCheckinItems();
        if (mounted) checkinItems = items;
    } catch {
        if (mounted) checkinLoadError = true;
    } finally {
        if (mounted) checkinLoading = false;
    }
}

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
        await facade.updateSettings(mergeSettingsDraft(facade.settings, draft), { expected: originalSettings });
        originalSettings = cloneSettings(facade.settings);
        loadDraft(originalSettings);
        showMessage(t(i18n, "settings.saved"), 2500);
        onClose?.();
    } catch (error) {
        if (error instanceof SettingsConflictError) {
            // 其他窗口已修改设置：以磁盘最新值重新对账，保留当前草稿，请用户核对后再保存
            try {
                facade.settings = await loadSettings(facade.pluginInstance);
                originalSettings = cloneSettings(facade.settings);
                facade.notifyDataChanged();
                showMessage(t(i18n, "settings.conflict"), 5000);
            } catch (reloadError) {
                console.warn("[glean] 设置冲突后重读失败:", reloadError);
                showMessage(t(i18n, "settings.saveFailed"), 5000);
            }
        } else {
            showMessage(`${t(i18n, "settings.saveFailed")}: ${String(error).slice(0, 120)}`, 5000);
        }
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
    } catch {
        console.warn("[glean] AI 通道测试异常");
        showMessage(t(i18n, "ai.testError"), 4500);
    } finally {
        testBusy = false;
    }
}

async function doRebuildIndex() {
    if (rebuildBusy) return;
    rebuildBusy = true;
    try {
        await rebuildIndex(facade.pluginInstance, buildDraftSettings());
        showMessage(t(i18n, "msg.indexRebuilt"), 2500);
    } catch (error) {
        console.warn("[glean] 索引重建失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 5000);
    } finally {
        rebuildBusy = false;
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
        console.warn("[glean] 读库导出失败:", error);
        exportError = t(i18n, "msg.actionFailed");
        showMessage(exportError, 5000);
    } finally {
        exportBusy = "";
    }
}

async function toggleCheckin() {
    if (!checkinEnabled) {
        checkinEnabled = true;
        await loadCheckinItems();
        if (checkinLoadError) checkinEnabled = false;
        return;
    }
    checkinEnabled = false;
}

async function toggleAiLog() {
    if (aiLogLoading) return;
    if (aiLog !== null && !aiLogError) {
        aiLog = null;
        aiLogError = false;
        return;
    }
    aiLogLoading = true;
    aiLogError = false;
    try {
        aiLog = await loadAiLog(facade.pluginInstance);
    } catch {
        aiLog = [];
        aiLogError = true;
    } finally {
        aiLogLoading = false;
    }
}

async function doMountBoard() {
    boardBusy = true;
    try {
        const result = await bindAllClipsToLibrary(facade.pluginInstance, buildDraftSettings());
        showMessage(t(i18n, "board.projected", { bound: result.bound, synced: result.synced, failed: result.failures.length }), 3500);
    } catch (error) {
        console.warn("[glean] 挂载读库看板失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 5000);
    } finally {
        boardBusy = false;
    }
}
</script>

<section class="glean-settings" aria-labelledby={titleId} aria-busy={saveBusy || testBusy || boardBusy || rebuildBusy || Boolean(exportBusy) || dismissHintBusy || notebookLoading || checkinLoading || aiLogLoading}>
    <div class="glean-settings__layout">
        <nav class="glean-settings__nav" aria-labelledby={navLabelId}>
            <div class="glean-settings__brand">
                <div class="glean-brand__mark glean-settings__brand-mark">
                    <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
                </div>
                <div class="glean-settings__brand-copy">
                    <h2 id={titleId} class="glean-settings__brand-title">{t(i18n, "settings.title")}</h2>
                    <div class="glean-settings__brand-sub">{t(i18n, "settings.sovereigntyNote")}</div>
                </div>
            </div>
            <div class="glean-settings__nav-list" id={navLabelId} role="tablist" aria-label={t(i18n, "settings.navLabel")} tabindex="-1" onkeydown={onNavKeydown}>
                {#each SETTINGS_SECTIONS as section (section.id)}
                    <button
                        id={`${idPrefix}-tab-${section.id}`}
                        class="glean-settings__tab"
                        class:glean-settings__tab--on={activeSection === section.id}
                        role="tab"
                        aria-selected={activeSection === section.id}
                        aria-controls={panelId}
                        disabled={saveBusy}
                        onclick={() => selectSection(section.id)}
                    >
                        <span class="glean-settings__tab-label">{t(i18n, section.labelKey)}</span>
                        {#if section.id === "workspace" && anchorNotebooks.length > 0}
                            <span class="glean-settings__tab-badge">{anchorNotebooks.length}</span>
                        {/if}
                    </button>
                {/each}
            </div>
        </nav>
        <div id={panelId} class="glean-settings__content" role="tabpanel" aria-labelledby={`${idPrefix}-tab-${activeSection}`} tabindex="-1" inert={saveBusy}>
            <header class="glean-settings__pagehead">
                <div class="glean-settings__page-title" role="heading" aria-level="2">{t(i18n, activeSectionMeta.titleKey)}</div>
                <div class="glean-settings__page-desc">{t(i18n, activeSectionMeta.descKey)}</div>
            </header>
            {#if showNewbieHint && activeSection === "workspace"}
                <div class="glean-set-group glean-settings__newbie-hint" role="status">
                    <span class="glean-settings__newbie-hint-text"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanWheat" /></svg>{t(i18n, "settings.newbieHint")}</span>
                    <button class="glean-linkish glean-settings__newbie-hint-dismiss" aria-busy={dismissHintBusy} disabled={dismissHintBusy} onclick={() => void dismissNewbieHint()}>
                        {t(i18n, "settings.dismissNewbieHint")}
                    </button>
                </div>
            {/if}
            {#if activeSection === "workspace"}
    <div class="glean-settings__section glean-settings__section--core glean-settings__section--workspace">
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.anchorNotebooks")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.anchorNotebooksDesc")}</div>
                </div>
            </div>
            <div class="glean-nb-tools">
                <div class="glean-nb-search">
                    <svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanSearch" /></svg>
                    <input
                        class="glean-nb-search__input"
                        type="text"
                        placeholder={t(i18n, "settings.anchorSearch")}
                        aria-label={t(i18n, "settings.anchorSearch")}
                        bind:value={notebookFilter}
                    />
                    {#if notebookFilter}
                        <button class="glean-linkish glean-nb-search__clear" type="button" aria-label={t(i18n, "settings.anchorSearchClear")} onclick={() => (notebookFilter = "")}>×</button>
                    {/if}
                </div>
                {#if !notebookLoading && !notebookLoadError}
                    <span class="glean-nb-count" role="status">{t(i18n, "settings.anchorSelected", { n: anchorNotebooks.length, total: notebooks.length })}</span>
                    {#if anchorNotebooks.length > 0}
                        <button class="glean-linkish" type="button" onclick={clearAnchorNotebooks}>{t(i18n, "settings.anchorClear")}</button>
                    {/if}
                {/if}
            </div>
            <div class="glean-nb-wrap" role="group" aria-label={t(i18n, "settings.anchorNotebooks")}>
                {#if notebookLoading}
                    <span class="glean-settings__empty" role="status">{t(i18n, "panel.loading")}</span>
                {:else if notebookLoadError}
                    <span class="glean-settings__empty glean-settings__error" role="alert">{t(i18n, "settings.notebookLoadFailed")}</span>
                    <button class="glean-btn glean-btn--ghost" type="button" onclick={() => void loadNotebookOptions()}>{t(i18n, "action.retry")}</button>
                {:else}
                {#each filteredNotebooks as notebook (notebook.id)}
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
                    <span class="glean-settings__empty" role="status">{t(i18n, "settings.anchorEmpty")}</span>
                {:else if filteredNotebooks.length === 0}
                    <span class="glean-settings__empty" role="status">{t(i18n, "settings.anchorNoMatch")}</span>
                {/if}
                {/if}
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

    {/if}
    {#if activeSection === "ai"}
    <div class="glean-settings__section glean-settings__section--core" aria-labelledby={`${idPrefix}-ai-title`}>
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

    {/if}
    {#if activeSection === "aiChannel"}
    <div class="glean-settings__section glean-settings__section--advanced" aria-labelledby={`${idPrefix}-ai-channel-title`}>
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
                    <button class="glean-btn glean-action-btn" aria-busy={testBusy} disabled={testBusy} onclick={() => void testChannel()}>
                        {testBusy ? t(i18n, "panel.loading") : t(i18n, "settings.testConnection")}
                    </button>
                </div>
            {/if}
        </div>
    </div>

    {/if}
    {#if activeSection === "resurface"}
    <div class="glean-settings__section glean-settings__section--core" aria-labelledby={`${idPrefix}-resurface-title`}>
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

    {/if}
    {#if dataVisited}
    <div class="glean-settings__section glean-settings__section--maintenance" style:display={activeSection === "data" ? "" : "none"}>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "board.mountTitle")}
                    <div class="glean-set-row__desc">{t(i18n, "board.mountDesc")}</div>
                </div>
                <button class="glean-btn glean-btn--pri glean-action-btn" aria-busy={boardBusy} disabled={boardBusy} onclick={() => void doMountBoard()}>
                    {boardBusy ? t(i18n, "panel.loading") : t(i18n, "board.mountAction")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.exportLibraryCsv")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.exportLibraryCsvDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" aria-busy={exportBusy === "csv"} disabled={Boolean(exportBusy)} onclick={() => void exportData("csv")}>
                    {exportBusy === "csv" ? t(i18n, "settings.exporting") : t(i18n, "settings.exportLibraryCsv")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.exportDiagnostic")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.exportDiagnosticDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" aria-busy={exportBusy === "diagnostic"} disabled={Boolean(exportBusy)} onclick={() => void exportData("diagnostic")}>
                    {exportBusy === "diagnostic" ? t(i18n, "settings.exporting") : t(i18n, "settings.exportDiagnostic")}
                </button>
            </div>
            {#if exportError}
                <div class="glean-set-row" role="alert">
                    <span class="glean-settings__error">{exportError}</span>
                    <button class="glean-btn glean-btn--ghost" disabled={Boolean(exportBusy)} onclick={() => lastExport && void exportData(lastExport)}>{t(i18n, "action.retry")}</button>
                </div>
            {/if}
        </div>
    </div>

    {/if}
    {#if dataVisited}
    <div class="glean-settings__section glean-settings__section--maintenance glean-settings__section--data" style:display={activeSection === "data" ? "" : "none"}>
        <div class="glean-set-group">
            <div class="glean-settings__extension-card">
                <BackupPanel {facade} settingsDirty={draftDirty} settingsBusy={saveBusy} onPreferencesRestored={() => { originalSettings = cloneSettings(facade.settings); loadDraft(originalSettings); }} />
            </div>
            <div class="glean-settings__extension-card glean-settings__extension-card--recovery">
                <FlashcardRecoveryPanel {facade} />
            </div>
            <div class="glean-set-row glean-settings__import-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "import.title")}
                    <div class="glean-set-row__desc">{t(i18n, "import.entryDesc")}</div>
                </div>
                <button class="glean-btn glean-btn--pri glean-action-btn" onclick={() => facade.openImport()}>
                    {t(i18n, "import.entryAction")}
                </button>
            </div>
        </div>
    </div>

    {/if}
    {#if maintenanceVisited}
    <div class="glean-settings__section glean-settings__section--maintenance" style:display={activeSection === "maintenance" ? "" : "none"}>
        <div class="glean-set-group glean-settings__extension-card">
            <AiTagMergePanel {facade} />
        </div>
    </div>

    {/if}
    {#if activeSection === "integration"}
    <div class="glean-settings__section glean-settings__section--integration" aria-labelledby={`${idPrefix}-checkin-title`}>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.checkinEnable")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.checkinEnableDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={checkinEnabled} aria-label={t(i18n, "settings.checkinEnable")} aria-pressed={checkinEnabled} aria-busy={checkinLoading} disabled={checkinLoading} onclick={() => void toggleCheckin()}></button>
            </div>
            {#if checkinLoadError}
                <div class="glean-set-row" role="alert">
                    <span class="glean-settings__error">{t(i18n, "settings.checkinLoadFailed")}</span>
                    <button class="glean-btn glean-btn--ghost" type="button" disabled={checkinLoading} onclick={() => void loadCheckinItems()}>{t(i18n, "action.retry")}</button>
                </div>
            {/if}
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
                            {#if checkinLoading}{t(i18n, "settings.checkinLoading")}{:else if checkinLoadError}{t(i18n, "settings.checkinLoadFailed")}{:else if checkinItems.length === 0}{t(i18n, "settings.checkinNoItems")}{:else}{checkinItems.length} {t(i18n, "settings.checkinItemsFound")}{/if}
                        </div>
                    </div>
                    <select class="b3-select" style="font-size:12px" aria-label={t(i18n, "settings.checkinItem")} disabled={checkinLoading || checkinLoadError || checkinItems.length === 0} bind:value={checkinItemId}>
                        <option value="">—</option>
                        {#each checkinItems as item (item.id)}
                            <option value={item.id}>{item.name}</option>
                        {/each}
                    </select>
                </div>
            {/if}
        </div>
    </div>

    {/if}
    {#if activeSection === "reading"}
    <div class="glean-settings__section glean-settings__section--experimental" aria-labelledby={`${idPrefix}-reader-title`}>
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

    {/if}
    {#if maintenanceVisited}
    <div class="glean-settings__section glean-settings__section--maintenance glean-settings__section--danger" style:display={activeSection === "maintenance" ? "" : "none"}>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.rebuildIndex")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.rebuildIndexDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" aria-busy={rebuildBusy} disabled={rebuildBusy} onclick={() => void doRebuildIndex()}>
                    {rebuildBusy ? t(i18n, "panel.loading") : t(i18n, "settings.rebuildIndex")}
                </button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiLog")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiLogDesc")}</div>
                </div>
                <button class="glean-btn glean-action-btn" disabled={aiLogLoading} aria-busy={aiLogLoading} onclick={() => void toggleAiLog()}>
                    {aiLogLoading ? t(i18n, "panel.loading") : aiLog === null || aiLogError ? t(i18n, "settings.aiLogView") : t(i18n, "action.close")}
                </button>
            </div>
            {#if aiLogError}
                <div class="glean-set-row" role="alert">
                    <span class="glean-settings__error">{t(i18n, "settings.aiLogLoadFailed")}</span>
                    <button class="glean-btn glean-btn--ghost" type="button" disabled={aiLogLoading} onclick={() => void toggleAiLog()}>{t(i18n, "action.retry")}</button>
                </div>
            {/if}
            {#if aiLog !== null && !aiLogError && aiLog.length > 0}
                <div class="glean-set-row glean-settings__log-list">
                    {#each aiLog as entry (entry.at + entry.docId)}
                        <div class="glean-logrow">
                            <span class="glean-logrow__time">{entry.at.slice(5, 16).replace("T", " ")}</span>
                            <span class="glean-logrow__stage">{entry.stage}</span>
                            <span class="glean-logrow__msg">{entry.message}</span>
                        </div>
                    {/each}
                </div>
            {:else if aiLog !== null && !aiLogError}
                <div class="glean-set-row glean-settings__log-empty">
                    {t(i18n, "settings.aiLogEmpty")}
                </div>
            {/if}
        </div>
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
</section>

<style>
    /* T-3314：分类导航版式。左导航 + 右内容；glean-settings 作为容器，窄容器降级为顶部横向 tab。 */
    .glean-settings__layout {
        display: flex;
        align-items: stretch;
        gap: var(--glean-space-3);
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
    }

    .glean-settings__nav {
        flex: 0 0 158px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--glean-space-2);
        padding: 2px;
        border-right: 1px solid var(--glean-border-soft);
    }

    .glean-settings__brand {
        display: flex;
        align-items: center;
        gap: var(--glean-space-2);
        padding: var(--glean-space-2) var(--glean-space-2) var(--glean-space-3);
        border-bottom: 1px solid var(--glean-border-soft);
    }

    .glean-settings__brand-mark {
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        border-radius: var(--glean-radius-md);
    }

    .glean-settings__brand-mark svg {
        width: 15px;
        height: 15px;
    }

    .glean-settings__brand-copy {
        min-width: 0;
    }

    .glean-settings__brand-title {
        margin: 0;
        font-size: var(--glean-text-md);
        font-weight: 700;
        line-height: 1.3;
        color: var(--b3-theme-on-background);
    }

    .glean-settings__brand-sub {
        margin-top: 2px;
        font-size: var(--glean-text-xs);
        line-height: 1.5;
        color: var(--b3-theme-on-surface);
    }

    .glean-settings__nav-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow-y: auto;
        min-height: 0;
        padding: var(--glean-space-1) 0;
    }

    .glean-settings__tab {
        display: flex;
        align-items: center;
        gap: var(--glean-space-2);
        width: 100%;
        min-height: 34px;
        padding: 7px 10px;
        border: none;
        border-radius: var(--glean-radius-sm);
        background: none;
        color: var(--b3-theme-on-background);
        font: inherit;
        font-size: var(--glean-text-sm);
        text-align: left;
        cursor: pointer;
        position: relative;
        transition: background-color 160ms var(--glean-ease-out), color 160ms var(--glean-ease-out);
    }

    .glean-settings__tab:hover {
        background: var(--glean-inset-surface);
    }

    .glean-settings__tab:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: -2px;
    }

    .glean-settings__tab--on {
        background: var(--glean-primary-soft);
        color: var(--glean-accent-b);
        font-weight: 700;
    }

    .glean-settings__tab--on::before {
        content: "";
        position: absolute;
        left: 0;
        top: 7px;
        bottom: 7px;
        width: 3px;
        border-radius: 2px;
        background: var(--glean-accent-b);
    }

    .glean-settings__tab-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .glean-settings__tab-badge {
        flex: 0 0 auto;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--glean-inset-surface);
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        line-height: 18px;
    }

    .glean-settings__tab--on .glean-settings__tab-badge {
        background: color-mix(in srgb, var(--glean-accent-b) 18%, transparent);
        color: var(--glean-accent-b);
    }

    .glean-settings__content {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--glean-space-3);
        padding: 2px 2px 2px 0;
    }

    .glean-settings__pagehead {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .glean-settings__page-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--b3-theme-on-background);
    }

    .glean-settings__page-desc {
        font-size: var(--glean-text-xs);
        line-height: 1.6;
        color: var(--b3-theme-on-surface);
    }

    /* 锚点笔记本工具行：搜索 + 计数 + 清空 */
    .glean-nb-tools {
        display: flex;
        align-items: center;
        gap: var(--glean-space-2);
        flex-wrap: wrap;
    }

    .glean-nb-search {
        flex: 1 1 180px;
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding: 5px 10px;
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-sm);
        background: var(--glean-inset-surface);
        color: var(--b3-theme-on-surface);
    }

    .glean-nb-search:focus-within {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 45%, var(--glean-border-soft));
        box-shadow: 0 0 0 3px var(--glean-primary-soft);
    }

    .glean-nb-search__input {
        flex: 1 1 auto;
        min-width: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-background);
        font: inherit;
        font-size: var(--glean-text-sm);
        outline: none;
    }

    .glean-nb-search__clear {
        flex: 0 0 auto;
        font-size: 15px;
        line-height: 1;
        padding: 2px 4px;
    }

    .glean-nb-count {
        flex: 0 0 auto;
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        white-space: nowrap;
    }

    .glean-settings__section {
        display: flex;
        flex-direction: column;
        gap: var(--glean-space-2);
        min-width: 0;
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

    /* 本组件作为尺寸容器：窄容器（移动端 / 窄 Dock）时导航降级为顶部横向 tab */
    .glean-settings {
        container: glean-settings / inline-size;
        overflow: hidden;
    }

    @container glean-settings (max-width: 600px) {
        .glean-settings__layout {
            flex-direction: column;
            gap: var(--glean-space-2);
        }

        .glean-settings__nav {
            flex: 0 0 auto;
            border-right: none;
            border-bottom: 1px solid var(--glean-border-soft);
            padding: 0 0 2px;
        }

        .glean-settings__brand {
            padding: var(--glean-space-1) var(--glean-space-1) var(--glean-space-2);
            border-bottom: none;
        }

        .glean-settings__brand-sub {
            display: none;
        }

        .glean-settings__nav-list {
            flex-direction: row;
            align-items: center;
            overflow-x: auto;
            overflow-y: hidden;
            gap: 4px;
            padding: 0 0 var(--glean-space-1);
        }

        .glean-settings__tab {
            width: auto;
            flex: 0 0 auto;
            min-height: 44px;
            padding: 6px 12px;
            border-radius: 999px;
            border: 1px solid var(--glean-border-soft);
        }

        .glean-settings__tab--on {
            border-color: color-mix(in srgb, var(--glean-accent-b) 45%, transparent);
        }

        .glean-settings__tab--on::before {
            display: none;
        }

        .glean-settings__tab-badge {
            display: none;
        }

        /* 触控命中区随容器断点走：宽视口下的窄 Dock 同样生效（T-3315） */
        .glean-nb-search {
            min-height: 44px;
        }
    }
</style>

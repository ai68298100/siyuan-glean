<script lang="ts">
/** 设置视图（T-1101/T-1200）：iOS inset group 风格——锚点笔记本 chips、AI 开关、重浮参数、挂库、维护。 */
import { onMount } from "svelte";
import { showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { rebuildIndex } from "../services/clip-store";
import { bindAllClipsToLibrary } from "../services/library-db";
import { usageToday, loadAiLog, type AiLogEntry } from "../services/enrich-service";
import { restoreBackup, previewRestore, backupFileName } from "../services/backup-service";
import { suggestAiTagMerges, applyAiTagMerge, type AiTagMergePlan } from "../services/ai-tag-service";
import { listMissingAuthors, inferAuthor, applyAuthor } from "../services/author-service";
import type { ClipIndexEntry } from "../services/index-store";
import { listCheckinItems, type CheckinItemOption } from "../services/checkin-bridge";
import { testDirectChannel } from "../api/ai-direct";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

let notebooks = $state<NotebookMeta[]>([]);

/**
 * 表单编辑态 = 打开设置弹窗时刻的设置快照（T-1790）：
 * 经函数读取 props 初始值，消除"顶层本地引用响应式值"告警，语义也更明确。
 */
function snapshotFormState() {
    const s = facade.settings;
    return {
        anchorNotebooks: [...s.anchorNotebooks],
        aiEnrichMode: s.ai.enrichMode,
        aiDailyCap: s.ai.enrichDailyCap,
        aiDedup: s.ai.dedupOnEnrich,
        aiRelated: s.ai.relatedWhileReading,
        aiActions: s.ai.presetActions,
        dailyCount: s.resurface.dailyCount,
        includeDone: s.resurface.includeDoneHighlights,
        inboxQuota: s.inboxQuota,
        staleDays: s.staleDays,
        aiChannel: s.ai.channel,
        customBaseUrl: s.ai.customBaseUrl,
        customModel: s.ai.customModel,
        customSecretName: s.ai.customSecretName,
        checkinEnabled: s.integration.checkinEnabled,
        checkinItemId: s.integration.checkinItemId,
        readerOpenInTab: s.reader.openInTab,
        readerMode: s.reader.defaultMode,
    };
}
const formInit = snapshotFormState();

let anchorNotebooks = $state<string[]>(formInit.anchorNotebooks);
let aiEnrichMode = $state<"off" | "manual" | "auto">(formInit.aiEnrichMode);
let aiDailyCap = $state(formInit.aiDailyCap);
let aiDedup = $state(formInit.aiDedup);
let aiRelated = $state(formInit.aiRelated);
let aiActions = $state(formInit.aiActions);
let usageCount = $state(0);
let dailyCount = $state(formInit.dailyCount);
let includeDone = $state(formInit.includeDone);
let inboxQuota = $state(formInit.inboxQuota);
let staleDays = $state(formInit.staleDays);
let boardBusy = $state(false);
let aiChannel = $state<"siyuan" | "custom">(formInit.aiChannel);
let customBaseUrl = $state(formInit.customBaseUrl);
let customModel = $state(formInit.customModel);
let customSecretName = $state(formInit.customSecretName);
let testBusy = $state(false);
let checkinEnabled = $state(formInit.checkinEnabled);
let checkinItemId = $state(formInit.checkinItemId);
let checkinItems = $state<CheckinItemOption[]>([]);
let readerOpenInTab = $state(formInit.readerOpenInTab);
let readerMode = $state<"read" | "edit">(formInit.readerMode);

let aiLog = $state<AiLogEntry[] | null>(null);

// T-1761 AI 标签规范化：扫描相似组建议 → 用户逐组确认合并（aiTags 非手填字段，合并是显式动作）
let tagScanBusy = $state(false);
let tagMergePlans = $state<AiTagMergePlan[] | null>(null);
let tagMergeBusyKey = $state("");

async function scanAiTags(): Promise<void> {
    tagScanBusy = true;
    try {
        tagMergePlans = await suggestAiTagMerges(facade.pluginInstance);
        if (tagMergePlans.length === 0) showMessage(t(i18n, "settings.aiTagsClean"), 3000);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        tagScanBusy = false;
    }
}

async function mergeTagGroup(plan: AiTagMergePlan): Promise<void> {
    tagMergeBusyKey = plan.variants.join("|");
    try {
        const ok = await applyAiTagMerge(facade.pluginInstance, plan.variants, plan.keep);
        showMessage(t(i18n, "settings.aiTagsMerged", { n: ok }), 3000);
        tagMergePlans = (tagMergePlans ?? []).filter((item) => item !== plan);
        facade.notifyDataChanged();
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        tagMergeBusyKey = "";
    }
}

// T-1813 来源作者回填：扫描缺作者 → AI 逐条推断 → 用户改/确认写入
let authorScanBusy = $state(false);
let authorCandidates = $state<ClipIndexEntry[] | null>(null);
let authorDrafts = $state<Record<string, string>>({});
let authorBusyId = $state("");

async function scanMissingAuthors(): Promise<void> {
    authorScanBusy = true;
    try {
        authorCandidates = await listMissingAuthors(facade.pluginInstance);
        authorDrafts = {};
        if (authorCandidates.length === 0) showMessage(t(i18n, "settings.authorNone"), 3000);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        authorScanBusy = false;
    }
}

/** 单篇 AI 推断：建议值填入草稿输入框，用户可改后确认写入。 */
async function inferOneAuthor(entry: ClipIndexEntry): Promise<void> {
    authorBusyId = entry.id;
    try {
        const result = await inferAuthor(facade.pluginInstance, entry.id, entry.title, facade.settings);
        if (result.ok) {
            if (result.author) {
                authorDrafts = { ...authorDrafts, [entry.id]: result.author };
            } else {
                showMessage(t(i18n, "settings.authorInferUnknown"), 3000);
            }
        } else if (result.skipped === "cap") {
            showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
        } else if (result.skipped !== "off") {
            showMessage(t(i18n, "ai.enrichFailed"), 3000);
        }
    } finally {
        authorBusyId = "";
    }
}

async function confirmAuthor(entry: ClipIndexEntry): Promise<void> {
    const value = (authorDrafts[entry.id] ?? "").trim();
    if (!value) return;
    authorBusyId = entry.id;
    try {
        if (await applyAuthor(facade.pluginInstance, entry.id, value)) {
            authorCandidates = (authorCandidates ?? []).filter((item) => item.id !== entry.id);
            facade.notifyDataChanged();
            showMessage(t(i18n, "settings.authorSaved", { name: value }), 2500);
        } else {
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        }
    } finally {
        authorBusyId = "";
    }
}

// T-1780 备份/恢复：导出经浏览器下载；恢复两步（选文件预览 → 确认执行）
let backupBusy = $state(false);
let restoreFileInput = $state<HTMLInputElement | null>(null);
let restorePreview = $state<{ pkg: Parameters<typeof restoreBackup>[1]; preview: Awaited<ReturnType<typeof previewRestore>>["preview"] } | null>(null);

async function doExportBackup() {
    backupBusy = true;
    try {
        const { buildBackupPackage, backupPackageJson } = await import("../services/backup-service");
        const pkg = await buildBackupPackage(facade.pluginInstance, facade.settings);
        const blob = new Blob([backupPackageJson(pkg)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = backupFileName();
        anchor.click();
        URL.revokeObjectURL(url);
        showMessage(t(i18n, "backup.exportDone"), 3000);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        backupBusy = false;
    }
}

async function onRestoreFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    backupBusy = true;
    try {
        const result = await previewRestore(await file.text());
        restorePreview = result;
        showMessage(t(i18n, "backup.previewReady"), 3000);
    } catch (error) {
        restorePreview = null;
        showMessage(String(error).slice(0, 160), 6000);
    } finally {
        backupBusy = false;
    }
}

async function doRestore() {
    if (!restorePreview) return;
    backupBusy = true;
    try {
        const { pkg } = restorePreview;
        const summary = await restoreBackup(facade.pluginInstance, pkg);
        // 包内设置已落盘：同步壳层缓存并广播（合并语义下等价全量覆盖）
        if (summary.settingsRestored && pkg.settings) {
            await facade.updateSettings(pkg.settings as Parameters<typeof facade.updateSettings>[0]);
        } else {
            facade.notifyDataChanged();
        }
        restorePreview = null;
        showMessage(t(i18n, "backup.restoreDone", { n: summary.restored, skip: summary.skipped }), 5000);
    } catch (error) {
        showMessage(String(error).slice(0, 160), 6000);
    } finally {
        backupBusy = false;
    }
}

onMount(() => {
    void listNotebooks().then((items) => (notebooks = items));
    if (facade.settings.integration.checkinEnabled) {
        void listCheckinItems().then((items) => { checkinItems = items; });
    }
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
            channel: aiChannel,
            customBaseUrl,
            customModel,
            customSecretName,
        },
        resurface: { dailyCount, includeDoneHighlights: includeDone },
        inboxQuota,
        staleDays,
        // migrateBatchSize 改在迁移器内调整（UX 审计 #7），不再经设置页保存
        // 本地状态显式入 patch；此前漏写 integration，打卡开关实际不持久化（已修复）
        integration: { checkinEnabled, checkinItemId },
        reader: { openInTab: readerOpenInTab, defaultMode: readerMode },
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

async function setChannel(channel: "siyuan" | "custom") {
    aiChannel = channel;
    await save();
}

async function testChannel() {
    if (testBusy) return;
    testBusy = true;
    try {
        await save();
        const result = await testDirectChannel(facade.pluginInstance, facade.settings);
        showMessage(
            result.ok ? t(i18n, "ai.testOk", { message: result.message }) : t(i18n, "ai.testFail", { message: result.message }),
            4500
        );
    } finally {
        testBusy = false;
    }
}

async function doRebuildIndex() {
    await rebuildIndex(facade.pluginInstance, facade.settings);
    showMessage(t(i18n, "msg.indexRebuilt"), 2500);
}

async function toggleCheckin() {
    checkinEnabled = !checkinEnabled;
    if (checkinEnabled && checkinItems.length === 0) {
        checkinItems = await listCheckinItems();
    }
    await save();
}

async function saveCheckin() {
    await save();
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
    <div class="glean-set-group" style="padding:9px 14px; font-size:11px; color:var(--b3-theme-on-surface)">
        🌾 {t(i18n, "settings.newbieHint")}
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
                <button class="glean-sw" class:glean-sw--on={aiDedup} role="switch" aria-checked={aiDedup} aria-label={t(i18n, "settings.aiDedup")} onclick={() => void toggleAi("dedup")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiRelated")}</div>
                <button class="glean-sw" class:glean-sw--on={aiRelated} role="switch" aria-checked={aiRelated} aria-label={t(i18n, "settings.aiRelated")} onclick={() => void toggleAi("related")}></button>
            </div>
            <div class="glean-set-row">
                <div class="glean-set-row__lb">{t(i18n, "settings.aiSummaryActions")}</div>
                <button class="glean-sw" class:glean-sw--on={aiActions} role="switch" aria-checked={aiActions} aria-label={t(i18n, "settings.aiSummaryActions")} onclick={() => void toggleAi("actions")}></button>
            </div>
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.aiChannelGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiChannel")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiChannelDesc")}</div>
                </div>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-seg">
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiChannel === "siyuan"}
                        onclick={() => void setChannel("siyuan")}
                    >{t(i18n, "settings.channelSiyuan")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={aiChannel === "custom"}
                        onclick={() => void setChannel("custom")}
                    >{t(i18n, "settings.channelCustom")}</button>
                </div>
            </div>
            {#if aiChannel === "custom"}
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.customBaseUrl")}</div>
                    <input class="glean-mini-input" style="width:220px; text-align:left" placeholder="https://…/v1" bind:value={customBaseUrl} onchange={() => void save()} />
                </div>
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.customModel")}</div>
                    <input class="glean-mini-input" style="width:180px; text-align:left" placeholder="free-model" bind:value={customModel} onchange={() => void save()} />
                </div>
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">
                        {t(i18n, "settings.customSecretName")}
                        <div class="glean-set-row__desc">{t(i18n, "settings.customSecretDesc")}</div>
                    </div>
                    <input class="glean-mini-input" style="width:160px; text-align:left" bind:value={customSecretName} onchange={() => void save()} />
                </div>
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">{t(i18n, "settings.testConnection")}</div>
                    <button class="glean-btn" style="flex-shrink:0" disabled={testBusy} onclick={() => void testChannel()}>
                        {testBusy ? t(i18n, "panel.loading") : t(i18n, "settings.testConnection")}
                    </button>
                </div>
            {/if}
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
                <button class="glean-sw" class:glean-sw--on={includeDone} role="switch" aria-checked={includeDone} aria-label={t(i18n, "settings.resurfaceIncludeDone")} onclick={() => { includeDone = !includeDone; void save(); }}></button>
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
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.checkinGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.checkinEnable")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.checkinEnableDesc")}</div>
                </div>
                <button class="glean-sw" class:glean-sw--on={checkinEnabled} role="switch" aria-checked={checkinEnabled} aria-label={t(i18n, "settings.checkinEnable")} onclick={() => void toggleCheckin()}></button>
            </div>
            {#if checkinEnabled}
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">
                        {t(i18n, "settings.checkinItem")}
                        <div class="glean-set-row__desc">
                            {#if checkinItems.length === 0}{t(i18n, "settings.checkinNoItems")}{:else}{checkinItems.length} {t(i18n, "settings.checkinItemsFound")}{/if}
                        </div>
                    </div>
                    <select class="b3-select" style="font-size:12px" bind:value={checkinItemId} onchange={() => void saveCheckin()}>
                        <option value="">—</option>
                        {#each checkinItems as item (item.id)}
                            <option value={item.id}>{item.name}</option>
                        {/each}
                    </select>
                </div>
            {/if}
        </div>
    </div>

    <div>
        <div class="glean-set-title">{t(i18n, "settings.readerGroup")}</div>
        <div class="glean-set-group">
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.readerOpenInTab")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.readerOpenInTabHint")}</div>
                </div>
                <button
                    class="glean-sw"
                    class:glean-sw--on={readerOpenInTab}
                    role="switch"
                    aria-checked={readerOpenInTab}
                    aria-label={t(i18n, "settings.readerOpenInTab")}
                    title={t(i18n, "settings.readerOpenInTab")}
                    onclick={() => { readerOpenInTab = !readerOpenInTab; void save(); }}
                ></button>
            </div>
            <div class="glean-set-row glean-seg-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.readerMode")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.readerModeHint")}</div>
                </div>
                <div class="glean-seg">
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={readerMode === "read"}
                        onclick={() => { readerMode = "read"; void save(); }}
                    >{t(i18n, "reader.modeRead")}</button>
                    <button
                        class="glean-seg__btn"
                        class:glean-seg__btn--on={readerMode === "edit"}
                        onclick={() => { readerMode = "edit"; void save(); }}
                    >{t(i18n, "reader.modeEdit")}</button>
                </div>
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
                    {t(i18n, "import.title")}
                    <div class="glean-set-row__desc">{t(i18n, "import.entryDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" onclick={() => facade.openImport()}>
                    {t(i18n, "import.entryAction")}
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
            <!-- T-1780 一键备份/恢复（DATA-CONTRACT §0.1）：导出下载；恢复两步确认 -->
            <!-- T-1761 AI 标签规范化：相似组建议 + 用户确认合并 -->
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.aiTagsTitle")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.aiTagsDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" disabled={tagScanBusy} onclick={() => void scanAiTags()}>
                    {tagScanBusy ? t(i18n, "panel.loading") : t(i18n, "settings.aiTagsScan")}
                </button>
            </div>
            {#if tagMergePlans && tagMergePlans.length > 0}
                <div class="glean-set-row" style="flex-direction:column; align-items:stretch; gap:6px">
                    {#each tagMergePlans as plan (plan.keep + plan.variants.join("|"))}
                        <div class="glean-logrow" style="align-items:center">
                            <span class="glean-logrow__msg" style="flex:1">
                                {plan.variants.filter((v) => v !== plan.keep).join(" / ")}
                                → <strong>{plan.keep}</strong>
                                （{t(i18n, "settings.aiTagsAffected", { n: plan.affected })}）
                            </span>
                            <button
                                class="glean-btn"
                                style="flex-shrink:0"
                                disabled={tagMergeBusyKey !== ""}
                                onclick={() => void mergeTagGroup(plan)}
                            >{tagMergeBusyKey === plan.variants.join("|") ? t(i18n, "panel.loading") : t(i18n, "settings.aiTagsMerge")}</button>
                        </div>
                    {/each}
                </div>
            {/if}
            <!-- T-1813 来源作者回填：扫描缺作者 → AI 逐条推断 → 用户改/确认 -->
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "settings.authorTitle")}
                    <div class="glean-set-row__desc">{t(i18n, "settings.authorDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" disabled={authorScanBusy} onclick={() => void scanMissingAuthors()}>
                    {authorScanBusy ? t(i18n, "panel.loading") : t(i18n, "settings.authorScan")}
                </button>
            </div>
            {#if authorCandidates && authorCandidates.length > 0}
                <div class="glean-set-row" style="flex-direction:column; align-items:stretch; gap:6px">
                    {#each authorCandidates.slice(0, 20) as entry (entry.id)}
                        <div class="glean-logrow" style="align-items:center; flex-wrap:wrap">
                            <span class="glean-logrow__msg" style="flex:1; min-width:140px" title={entry.title}>
                                {entry.title || t(i18n, "panel.untitled")}
                            </span>
                            <input
                                class="glean-mini-input"
                                type="text"
                                style="width:120px; flex-shrink:0"
                                placeholder={t(i18n, "settings.authorPlaceholder")}
                                aria-label={t(i18n, "settings.authorTitle")}
                                value={authorDrafts[entry.id] ?? ""}
                                oninput={(event) => (authorDrafts = { ...authorDrafts, [entry.id]: event.currentTarget.value })}
                            />
                            <button
                                class="glean-btn"
                                style="flex-shrink:0"
                                disabled={authorBusyId !== ""}
                                title={t(i18n, "settings.authorInferHint")}
                                onclick={() => void inferOneAuthor(entry)}
                            >{authorBusyId === entry.id ? "…" : "✨"}</button>
                            <button
                                class="glean-btn"
                                style="flex-shrink:0"
                                disabled={authorBusyId !== "" || !(authorDrafts[entry.id] ?? "").trim()}
                                onclick={() => void confirmAuthor(entry)}
                            >{t(i18n, "settings.authorSave")}</button>
                        </div>
                    {/each}
                    {#if authorCandidates.length > 20}
                        <span style="font-size:11px; color:var(--b3-theme-on-surface)">{t(i18n, "settings.authorMore", { n: authorCandidates.length - 20 })}</span>
                    {/if}
                </div>
            {/if}
            <div class="glean-set-row">
                <div class="glean-set-row__lb">
                    {t(i18n, "backup.export")}
                    <div class="glean-set-row__desc">{t(i18n, "backup.exportDesc")}</div>
                </div>
                <button class="glean-btn" style="flex-shrink:0" disabled={backupBusy} onclick={() => void doExportBackup()}>
                    {backupBusy ? t(i18n, "panel.loading") : t(i18n, "backup.exportAction")}
                </button>
            </div>
            <div class="glean-set-row" style="flex-direction:column; align-items:stretch; gap:6px">
                <div class="glean-set-row">
                    <div class="glean-set-row__lb">
                        {t(i18n, "backup.restore")}
                        <div class="glean-set-row__desc">{t(i18n, "backup.restoreDesc")}</div>
                    </div>
                    <button class="glean-btn" style="flex-shrink:0" disabled={backupBusy} onclick={() => restoreFileInput?.click()}>
                        {t(i18n, "backup.restorePick")}
                    </button>
                    <input
                        bind:this={restoreFileInput}
                        type="file"
                        accept=".json,application/json"
                        style="display:none"
                        onchange={(event) => void onRestoreFileChosen(event)}
                    />
                </div>
                {#if restorePreview}
                    <div class="glean-set-row" style="flex-direction:column; align-items:stretch; gap:4px; font-size:11.5px">
                        <span>{t(i18n, "backup.previewTotal", { n: restorePreview.preview.totalClips })}</span>
                        <span>{t(i18n, "backup.previewRestore", { n: restorePreview.preview.restorable })}</span>
                        <span>{t(i18n, "backup.previewMissing", { n: restorePreview.preview.missing })}</span>
                        <button class="glean-btn" style="flex-shrink:0" disabled={backupBusy || restorePreview.preview.restorable === 0} onclick={() => void doRestore()}>
                            {backupBusy ? t(i18n, "panel.loading") : t(i18n, "backup.restoreConfirm")}
                        </button>
                    </div>
                {/if}
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

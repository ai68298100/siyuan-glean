<script lang="ts">
/** 首启引导向导（平静原则：三步走完，可随时跳过，不催促不羞辱）。
 * T-1719：第 3 步为只读扫描预览——只读属性并展示分类计数，逐篇确认才写入。 */
import { onMount } from "svelte";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";
import { saveUiPrefs } from "../services/prefs";
import { reconcileIndex } from "../services/clip-store";

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);

let step = $state(1);
let notebooks = $state<NotebookMeta[]>([]);
let anchorNotebooks = $state<string[]>(facade.settings.anchorNotebooks);

let scanning = $state(false);
let scanFailed = $state(false);
let scannedClips = $state(0);
let scannedCandidates = $state(0);
let candidatesMissingUrl = $state(0);

onMount(() => {
    void listNotebooks().then((items) => (notebooks = items));
});

function toggleNotebook(id: string) {
    anchorNotebooks = anchorNotebooks.includes(id)
        ? anchorNotebooks.filter((item) => item !== id)
        : [...anchorNotebooks, id];
}

async function persist(): Promise<void> {
    // T-1709 后首启不再询问 AI：enrichMode 保持默认 manual（D-0013），能力卡引导稍后在设置开启。
    await facade.updateSettings({
        ...facade.settings,
        anchorNotebooks: [...anchorNotebooks],
    });
}

async function markDone(): Promise<void> {
    await saveUiPrefs(facade.pluginInstance, { onboardingDone: true });
}

/** T-1719：只读扫描（读属性 + 重建派生索引缓存），不写任何文章属性。 */
async function runScan(): Promise<void> {
    scanning = true;
    scanFailed = false;
    try {
        const index = await reconcileIndex(facade.pluginInstance, facade.settings);
        scannedClips = Object.keys(index.clips).length;
        const candidates = Object.values(index.candidates);
        scannedCandidates = candidates.length;
        candidatesMissingUrl = candidates.filter((candidate) => candidate.missing.includes("url")).length;
    } catch (error) {
        console.warn("[glean] 引导扫描失败:", error);
        scanFailed = true;
    } finally {
        scanning = false;
    }
}

async function next(): Promise<void> {
    await persist();
    step = 3;
    void runScan();
}

async function finish(openMigrate: boolean): Promise<void> {
    await markDone();
    await persist();
    onClose();
    if (openMigrate) facade.openMigrate();
}

/** 有待确认候选时，完成键直达工作台逐篇确认（T-1719 的行动闭环）。 */
async function finishByConfirmingCandidates(): Promise<void> {
    await markDone();
    await persist();
    onClose();
    facade.openWorkbenchPopup();
}

async function skip(): Promise<void> {
    await markDone();
    onClose();
}
</script>

<div class="glean-migrate">
    <div class="glean-dlg-head">
        <div class="glean-brand__mark" style="width:28px;height:28px;border-radius:9px">
            <svg style="width:14px;height:14px"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <div class="glean-dlg-head__t">{t(i18n, "onboarding.title")}</div>
            <div class="glean-dlg-head__sub">{t(i18n, "tagline")}</div>
        </div>
    </div>

    {#if step === 1}
        <div class="glean-onb-hero">
            <div class="glean-empty__art">🌾</div>
            <div class="glean-empty__title">{t(i18n, "onboarding.welcomeTitle")}</div>
            <div class="glean-empty__hint">{t(i18n, "onboarding.welcomeBody")}</div>
        </div>
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--ghost" onclick={() => void skip()}>
                {t(i18n, "onboarding.skip")}
            </button>
            <button class="glean-btn glean-btn--pri" onclick={() => (step = 2)}>{t(i18n, "onboarding.next")}</button>
        </div>
    {:else if step === 2}
        <div class="glean-sect">{t(i18n, "settings.anchorNotebooks")}</div>
        <div class="glean-set-group">
            <div class="glean-nb-wrap">
                {#each notebooks as notebook (notebook.id)}
                    <button
                        class="glean-nb"
                        class:glean-nb--on={anchorNotebooks.includes(notebook.id)}
                        onclick={() => toggleNotebook(notebook.id)}
                    >{anchorNotebooks.includes(notebook.id) ? "✓ " : ""}{notebook.name}</button>
                {/each}
                {#if notebooks.length === 0}
                    <span style="font-size:11.5px; color:var(--b3-theme-on-surface)">—</span>
                {/if}
            </div>
            <div class="glean-empty" style="padding: 10px 4px 2px">
                <div class="glean-empty__hint">{t(i18n, "onboarding.anchorHint")}</div>
            </div>
        </div>
        <div class="glean-migrate__ops">
            <button class="glean-btn glean-btn--ghost" onclick={() => (step = 1)}>{t(i18n, "onboarding.back")}</button>
            <button class="glean-btn glean-btn--pri" onclick={() => void next()}>{t(i18n, "onboarding.next")}</button>
        </div>
    {:else if step === 3}
        <div class="glean-sect">{t(i18n, "onboarding.previewTitle")}</div>
        {#if scanning}
            <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
        {:else if scanFailed}
            <div class="glean-empty" style="padding:12px">
                <div class="glean-empty__hint">{t(i18n, "onboarding.scanFailed")}</div>
            </div>
            <div class="glean-migrate__ops">
                <button class="glean-btn glean-btn--ghost" onclick={() => (step = 2)}>{t(i18n, "onboarding.back")}</button>
                <button class="glean-btn glean-btn--pri" onclick={() => void runScan()}>{t(i18n, "action.retry")}</button>
            </div>
        {:else}
            <div class="glean-mstats">
                <div class="glean-mstat"><div class="glean-mstat__n">{scannedClips}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewClips")}</div></div>
                <div class="glean-mstat"><div class="glean-mstat__n">{scannedCandidates}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewCandidates")}</div></div>
                <div class="glean-mstat"><div class="glean-mstat__n">{candidatesMissingUrl}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewMissingUrl")}</div></div>
            </div>
            <div class="glean-empty" style="padding: 12px">
                <div class="glean-empty__hint">{t(i18n, "onboarding.previewNote")}</div>
            </div>
            <div class="glean-migrate__ops">
                <button class="glean-btn glean-btn--ghost" onclick={() => (step = 2)}>{t(i18n, "onboarding.back")}</button>
                <button class="glean-btn glean-btn--pri" onclick={() => (step = 4)}>{t(i18n, "onboarding.next")}</button>
            </div>
        {/if}
    {:else}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n">📥</div><div class="glean-mstat__l">{t(i18n, "onboarding.cap1")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">🔄</div><div class="glean-mstat__l">{t(i18n, "onboarding.cap2")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n">✨</div><div class="glean-mstat__l">{t(i18n, "onboarding.cap3")}</div></div>
        </div>
        <div class="glean-empty" style="padding: 8px 12px 0">
            <div class="glean-empty__hint">{t(i18n, "onboarding.aiLater")}</div>
        </div>
        <div class="glean-empty" style="padding: 10px 12px">
            <div class="glean-empty__hint">{t(i18n, "onboarding.doneHint")}</div>
        </div>
        <div class="glean-empty" style="padding: 0 12px">
            <div class="glean-empty__hint">
                {t(i18n, "onboarding.importLink")}
                <button class="glean-linkish" onclick={() => void finish(true)}>{t(i18n, "import.title")} →</button>
            </div>
        </div>
        <div class="glean-migrate__ops">
            {#if scannedCandidates > 0}
                <button class="glean-btn glean-btn--pri" onclick={() => void finishByConfirmingCandidates()}>{t(i18n, "onboarding.ctaConfirm")}</button>
            {:else}
                <button class="glean-btn glean-btn--pri" onclick={() => void finish(false)}>{t(i18n, "onboarding.finish")}</button>
            {/if}
        </div>
    {/if}
</div>

<script lang="ts">
/** 首启引导向导（平静原则：三步走完，可随时跳过，不催促不羞辱）。
 * T-1719：第 3 步为只读扫描预览——只读属性并展示分类计数，逐篇确认才写入。 */
import { onDestroy, onMount } from "svelte";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";
import { loadUiPrefs, saveUiPrefs, type OnboardingStep } from "../services/prefs";
import { scanPreview, type ScanPreview } from "../services/clip-store";

interface Props {
    facade: GleanFacade;
    onClose: () => void;
}

let { facade, onClose }: Props = $props();

const i18n = $derived(facade.i18n);
const instanceId = $props.id();
const idPrefix = `glean-onboarding-${instanceId}`;
const titleId = `${idPrefix}-title`;
const descId = `${idPrefix}-desc`;
const anchorTitleId = `${idPrefix}-anchor-title`;
const previewTitleId = `${idPrefix}-preview-title`;

let step = $state<OnboardingStep>(1);
let notebooks = $state<NotebookMeta[]>([]);
let anchorNotebooks = $state<string[]>([]);

let scanning = $state(false);
let scanFailed = $state(false);
let actionFailed = $state(false);
let preview = $state<ScanPreview | null>(null);
let completed = false;
let disposed = false;
let progressTouched = false;
/** 用户已请求的目标步骤：moveTo 的 await 期间关窗时，onDestroy 保存意图步骤而非旧值 */
let requestedStep: OnboardingStep = 1;

onMount(() => {
    anchorNotebooks = [...facade.settings.anchorNotebooks];
    let active = true;
    void loadUiPrefs(facade.pluginInstance).then((prefs) => {
        if (!active || disposed || completed || progressTouched || prefs.onboardingDone) return;
        // 扫描预览是派生数据，关闭后不落盘；从第 4 步恢复时回到第 3 步重算。
        step = prefs.onboardingStep === 4 ? 3 : prefs.onboardingStep;
        if (step === 3) void runScan();
    }).catch((error) => {
        if (!active || disposed || completed) return;
        console.warn("[glean] 引导进度读取失败:", error);
        actionFailed = true;
    });
    void listNotebooks().then((items) => {
        if (active && !disposed) notebooks = items;
    }).catch((error) => {
        if (!active || disposed || completed) return;
        console.warn("[glean] 引导笔记本读取失败:", error);
        actionFailed = true;
    });
    return () => {
        active = false;
    };
});

onDestroy(() => {
    disposed = true;
    if (completed) return;
    // 原生弹窗右上角关闭与“稍后继续”都会走这里；只记 UI 进度，不记扫描结果。
    void saveUiPrefs(facade.pluginInstance, {
        onboardingDone: false,
        onboardingStep: requestedStep > step ? requestedStep : step,
        onboardingInterrupted: true,
    }).catch(() => undefined);
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

function reportActionFailure(label: string, error: unknown): void {
    console.warn(`[glean] ${label}:`, error);
    actionFailed = true;
}

async function markDone(): Promise<void> {
    await saveUiPrefs(facade.pluginInstance, {
        onboardingDone: true,
        onboardingStep: 1,
        onboardingInterrupted: false,
        onboardingHintDismissed: true,
    });
}

async function moveTo(nextStep: OnboardingStep): Promise<void> {
    if (disposed || completed) return;
    requestedStep = nextStep;
    progressTouched = true;
    try {
        await saveUiPrefs(facade.pluginInstance, {
            onboardingDone: false,
            onboardingStep: nextStep,
            onboardingInterrupted: false,
        });
        actionFailed = false;
        step = nextStep;
    } catch (error) {
        reportActionFailure("引导进度保存失败", error);
    }
}

/** T-1719：只读扫描（读属性 + 重建派生索引缓存），不写任何文章属性。 */
async function runScan(): Promise<void> {
    if (disposed || completed) return;
    scanning = true;
    scanFailed = false;
    preview = null;
    try {
        const nextPreview = await scanPreview(facade.pluginInstance, facade.settings);
        if (!disposed && !completed) preview = nextPreview;
    } catch (error) {
        if (!disposed && !completed) {
            console.warn("[glean] 引导扫描失败:", error);
            scanFailed = true;
        }
    } finally {
        if (!disposed) scanning = false;
    }
}

async function next(): Promise<void> {
    try {
        await persist();
    } catch (error) {
        reportActionFailure("引导设置保存失败", error);
        return;
    }
    await moveTo(3);
    if (!actionFailed) void runScan();
}

async function moveToCapabilities(): Promise<void> {
    await moveTo(4);
}

async function finish(openImport: boolean): Promise<void> {
    try {
        await persist();
        await markDone();
        actionFailed = false;
        completed = true;
        onClose();
        if (openImport) facade.openImport();
    } catch (error) {
        reportActionFailure("引导完成失败", error);
    }
}

/** 有待确认候选时，完成键直达工作台逐篇确认（T-1719 的行动闭环）。 */
async function finishByConfirmingCandidates(): Promise<void> {
    try {
        await persist();
        await markDone();
        actionFailed = false;
        completed = true;
        onClose();
        facade.openWorkbenchPopup(preview?.examples.candidates[0]?.id);
    } catch (error) {
        reportActionFailure("引导候选确认入口失败", error);
    }
}

async function skip(): Promise<void> {
    try {
        await markDone();
        actionFailed = false;
        completed = true;
        onClose();
    } catch (error) {
        reportActionFailure("跳过引导失败", error);
    }
}

function continueLater(): void {
    onClose();
}
</script>

<div class="glean-migrate glean-onboarding" class:glean-onboarding--scanning={scanning} aria-labelledby={titleId} aria-describedby={descId} aria-busy={scanning}>
    <div class="glean-dlg-head">
        <div class="glean-brand__mark glean-dlg-head__mark">
            <svg aria-hidden="true"><use href="#iconGleanWheat" /></svg>
        </div>
        <div>
            <h2 id={titleId} class="glean-dlg-head__t">{t(i18n, "onboarding.title")}</h2>
            <div id={descId} class="glean-dlg-head__sub">{t(i18n, "tagline")}</div>
        </div>
    </div>
    <div class="glean-sr-only" aria-live="polite">{t(i18n, "onboarding.stepProgress", { n: step })}</div>
    <nav class="glean-onb-progress" aria-label={t(i18n, "onboarding.stepProgress", { n: step })}>
        {#each [1, 2, 3, 4] as progressStep, index}
            <span class="glean-onb-progress__item" class:glean-onb-progress__item--done={progressStep < step} class:glean-onb-progress__item--current={progressStep === step} aria-current={progressStep === step ? "step" : undefined}>
                <span class="glean-onb-progress__dot" aria-hidden="true">{progressStep < step ? "✓" : progressStep}</span>
                <span class="glean-sr-only">{t(i18n, "onboarding.stepProgress", { n: progressStep })}</span>
            </span>
            {#if index < 3}<span class="glean-onb-progress__line" class:glean-onb-progress__line--done={progressStep < step} aria-hidden="true"></span>{/if}
        {/each}
    </nav>
    {#if actionFailed}
        <div class="glean-empty glean-onb-empty glean-onb-empty--error" role="alert">{t(i18n, "msg.actionFailed")}</div>
    {/if}

    {#if step === 1}
        <div class="glean-onb-hero" role="region" aria-labelledby={`${idPrefix}-welcome-title`}>
            <div class="glean-empty__art"><svg aria-hidden="true"><use href="#iconGleanWheat" /></svg></div>
            <h3 id={`${idPrefix}-welcome-title`} class="glean-empty__title">{t(i18n, "onboarding.welcomeTitle")}</h3>
            <div class="glean-empty__hint">{t(i18n, "onboarding.welcomeBody")}</div>
        </div>
        <div class="glean-migrate__ops">
            <button class="glean-linkish glean-onb-pause" onclick={continueLater}>{t(i18n, "onboarding.continueLater")}</button>
            <button class="glean-btn glean-btn--ghost" onclick={() => void skip()}>
                {t(i18n, "onboarding.skip")}
            </button>
            <button class="glean-btn glean-btn--pri" onclick={() => void moveTo(2)}>{t(i18n, "onboarding.next")}</button>
        </div>
    {:else if step === 2}
        <div id={anchorTitleId} class="glean-sect" role="heading" aria-level="3">{t(i18n, "settings.anchorNotebooks")}</div>
        <div class="glean-set-group">
            <div class="glean-nb-wrap" role="group" aria-labelledby={anchorTitleId}>
                {#each notebooks as notebook (notebook.id)}
                    <button
                        class="glean-nb"
                        class:glean-nb--on={anchorNotebooks.includes(notebook.id)}
                        aria-pressed={anchorNotebooks.includes(notebook.id)}
                        onclick={() => toggleNotebook(notebook.id)}
                    >{anchorNotebooks.includes(notebook.id) ? "✓ " : ""}{notebook.name}</button>
                {/each}
                {#if notebooks.length === 0}
                    <span class="glean-onb-empty__mark" role="status">{t(i18n, "onboarding.anchorNone")}</span>
                {/if}
            </div>
            <div class="glean-empty glean-onb-empty">
                <div class="glean-empty__hint">{t(i18n, "onboarding.anchorHint")}</div>
            </div>
            <div class="glean-onb-selection" role="status" aria-live="polite">
                <strong>{t(i18n, "onboarding.anchorSelected", { n: anchorNotebooks.length })}</strong>
                {#if anchorNotebooks.length === 0}
                    <span>{t(i18n, "onboarding.anchorNone")}</span>
                {/if}
            </div>
        </div>
        <div class="glean-migrate__ops">
            <button class="glean-linkish glean-onb-pause" onclick={continueLater}>{t(i18n, "onboarding.continueLater")}</button>
            <button class="glean-btn glean-btn--ghost" onclick={() => void moveTo(1)}>{t(i18n, "onboarding.back")}</button>
            <button class="glean-btn glean-btn--pri" onclick={() => void next()}>{t(i18n, "onboarding.next")}</button>
        </div>
    {:else if step === 3}
        <div id={previewTitleId} class="glean-sect" role="heading" aria-level="3">{t(i18n, "onboarding.previewTitle")}</div>
        {#if scanning}
            <div class="glean-panel__loading" role="status" aria-live="polite">{t(i18n, "panel.loading")}</div>
        {:else if scanFailed}
            <div class="glean-empty glean-onb-empty glean-onb-empty--error" role="alert">
                <div class="glean-empty__hint">{t(i18n, "onboarding.scanFailed")}</div>
            </div>
            <div class="glean-migrate__ops">
                <button class="glean-linkish glean-onb-pause" onclick={continueLater}>{t(i18n, "onboarding.continueLater")}</button>
                <button class="glean-btn glean-btn--ghost" onclick={() => void moveTo(2)}>{t(i18n, "onboarding.back")}</button>
                <button class="glean-btn glean-btn--pri" onclick={() => void runScan()}>{t(i18n, "onboarding.rescan")}</button>
            </div>
        {:else if preview}
            <div class="glean-mstats" role="region" aria-labelledby={previewTitleId}>
                <div class="glean-mstat"><div class="glean-mstat__n">{preview.confirmed}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewClips")}</div></div>
                <div class="glean-mstat"><div class="glean-mstat__n">{preview.candidates}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewCandidates")}</div></div>
                <div class="glean-mstat"><div class="glean-mstat__n">{preview.candidatesMissingUrl}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewMissingUrl")}</div></div>
                <div class="glean-mstat"><div class="glean-mstat__n">{preview.ordinary}</div><div class="glean-mstat__l">{t(i18n, "onboarding.previewOrdinary")}</div></div>
            </div>
            <div class="glean-onb-preview__total">{t(i18n, "onboarding.previewTotal", { n: preview.total })}</div>
            <div class="glean-onb-preview__examples">
                <div class="glean-onb-preview__group">
                    <div class="glean-onb-preview__label">{t(i18n, "onboarding.previewClips")}</div>
                    {#if preview.examples.confirmed.length === 0}
                        <div class="glean-onb-preview__empty">{t(i18n, "onboarding.previewNoExamples")}</div>
                    {:else}
                        {#each preview.examples.confirmed as item (item.id)}
                            <div class="glean-onb-preview__item" title={item.hpath || item.id}>
                                <span>{item.title || item.hpath || item.id}</span>
                                <span class="glean-onb-preview__meta">{item.status}</span>
                            </div>
                        {/each}
                    {/if}
                </div>
                <div class="glean-onb-preview__group">
                    <div class="glean-onb-preview__label">{t(i18n, "onboarding.previewCandidates")}</div>
                    {#if preview.examples.candidates.length === 0}
                        <div class="glean-onb-preview__empty">{t(i18n, "onboarding.previewNoExamples")}</div>
                    {:else}
                        {#each preview.examples.candidates as item (item.id)}
                            <div class="glean-onb-preview__item" title={item.hpath || item.id}>
                                <span>{item.title || item.hpath || item.id}</span>
                                <span class="glean-onb-preview__meta">{item.url || t(i18n, "onboarding.previewMissingUrl")}</span>
                            </div>
                        {/each}
                    {/if}
                </div>
                <div class="glean-onb-preview__group">
                    <div class="glean-onb-preview__label">{t(i18n, "onboarding.previewOrdinary")}</div>
                    {#if preview.examples.ordinary.length === 0}
                        <div class="glean-onb-preview__empty">{t(i18n, "onboarding.previewNoExamples")}</div>
                    {:else}
                        {#each preview.examples.ordinary as item (item.id)}
                            <div class="glean-onb-preview__item" title={item.hpath || item.id}>
                                <span>{item.title || item.hpath || item.id}</span>
                            </div>
                        {/each}
                    {/if}
                </div>
            </div>
            <div class="glean-empty glean-onb-empty glean-onb-empty--note">
                <div class="glean-empty__hint">{t(i18n, "onboarding.previewNote")}</div>
            </div>
            <div class="glean-migrate__ops">
                <button class="glean-linkish glean-onb-pause" onclick={continueLater}>{t(i18n, "onboarding.continueLater")}</button>
                <button class="glean-btn glean-btn--ghost" onclick={() => void moveTo(2)}>{t(i18n, "onboarding.back")}</button>
                <button class="glean-btn glean-btn--ghost" onclick={() => void runScan()}>{t(i18n, "onboarding.rescan")}</button>
                <button class="glean-btn glean-btn--pri" onclick={() => void moveToCapabilities()}>{t(i18n, "onboarding.next")}</button>
            </div>
        {/if}
    {:else}
        <div class="glean-mstats">
            <div class="glean-mstat"><div class="glean-mstat__n"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanInbox" /></svg></div><div class="glean-mstat__l">{t(i18n, "onboarding.cap1")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanRefresh" /></svg></div><div class="glean-mstat__l">{t(i18n, "onboarding.cap2")}</div></div>
            <div class="glean-mstat"><div class="glean-mstat__n"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanSpark" /></svg></div><div class="glean-mstat__l">{t(i18n, "onboarding.cap3")}</div></div>
        </div>
        <div class="glean-empty glean-onb-empty glean-onb-empty--capability">
            <div class="glean-empty__hint">{t(i18n, "onboarding.aiLater")}</div>
        </div>
        <div class="glean-empty glean-onb-empty glean-onb-empty--capability">
            <div class="glean-empty__hint">{t(i18n, "onboarding.doneHint")}</div>
        </div>
        <div class="glean-empty glean-onb-empty glean-onb-empty--import">
            <div class="glean-empty__hint">
                {t(i18n, "onboarding.importLink")}
                <button class="glean-linkish" onclick={() => void finish(true)}>{t(i18n, "import.title")} <svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanArrowRight" /></svg></button>
            </div>
        </div>
        <div class="glean-migrate__ops">
            <button class="glean-linkish glean-onb-pause" onclick={continueLater}>{t(i18n, "onboarding.continueLater")}</button>
            {#if (preview?.candidates ?? 0) > 0}
                <button class="glean-btn glean-btn--pri" onclick={() => void finishByConfirmingCandidates()}>{t(i18n, "onboarding.ctaConfirm")}</button>
            {:else}
                <button class="glean-btn glean-btn--pri" onclick={() => void finish(false)}>{t(i18n, "onboarding.finish")}</button>
            {/if}
        </div>
    {/if}
</div>

<script lang="ts">
/** 今日拾遗视图（T-1400/T-1402/T-1717）：确定性挑选，读了/改天/归档，平静原则文案。
 * 重浮是纯投影：输入是父级刚对账过的索引（T-1710），本组件不再另读缓存。 */
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { computeDailyFromIndex, actOnSurface } from "../services/resurface-service";
import { dailyDigest, readerAiEnabled } from "../services/reader-ai";
import { speakText, stopSpeaking, ttsAvailable } from "../services/tts";
import type { GleanIndex } from "../services/index-store";
import { type SurfacePick, type SurfaceReason } from "../domain/resurface";
import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";

interface Props {
    facade: GleanFacade;
    /** 面板对账后的派生索引；每次属性变化由父级传入新引用触发重算。 */
    index: GleanIndex;
    onMutated: () => void;
}

let { facade, index, onMutated }: Props = $props();

const i18n = $derived(facade.i18n);

const daily = $derived(computeDailyFromIndex(index, facade.settings));
const picks = $derived(daily.picks);
const recentCount = $derived(daily.recentCount);
let actingId = $state("");

// T-1764 AI 每日简报：三篇速览（手动触发、额度共享、会话状态仅复制）
let digestBusy = $state(false);
let digestText = $state("");
const digestOn = $derived(readerAiEnabled(facade.settings) && !facade.isMobile);
// T-1764×T-1744 衔接：速览文本朗读（TTS 可用时显示）
const digestTtsOn = $derived(ttsAvailable() && !facade.isMobile);
let digestSpeaking = $state(false);

function speakDigest(): void {
    if (!digestText || digestSpeaking) return;
    digestSpeaking = true;
    speakText(digestText, 1, () => (digestSpeaking = false));
}

function stopDigestSpeech(): void {
    stopSpeaking();
    digestSpeaking = false;
}

async function generateDigest(): Promise<void> {
    if (digestBusy || picks.length === 0) return;
    digestBusy = true;
    try {
        const items = picks.slice(0, 3).map((pick) => ({
            title: pick.item.title || "",
            site: pick.item.site || "",
            summary: pick.item.summary || "",
        }));
        const outcome = await dailyDigest(facade.pluginInstance, items, facade.settings);
        if (outcome.ok && outcome.text) {
            digestText = outcome.text;
        } else if (outcome.skipped === "cap") {
            showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
        } else if (outcome.skipped !== "off") {
            showMessage(t(i18n, "ai.enrichFailed"), 3000);
        }
    } finally {
        digestBusy = false;
    }
}

async function copyDigest(): Promise<void> {
    try {
        await navigator.clipboard.writeText(digestText);
        showMessage(t(i18n, "reader.copied"), 2000);
    } catch {
        showMessage(t(i18n, "reader.actionFailed"), 2500);
    }
}
/** UX 审计 #10：本会话"开始阅读"过的文章回执（纯视图状态，不写属性）。 */
let startedToday = $state<Array<{ id: string; title: string }>>([]);

function openDoc(docId: string) {
    facade.openReadingDocument(docId);
}

function openSource(pick: SurfacePick) {
    const url = sourceUrlForCarrier(pick.item.contentType, pick.item.url);
    if (!url) {
        showMessage(t(i18n, "clip.sourceMissing"), 3000);
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
}

function openReading(pick: SurfacePick) {
    if (openTargetForCarrier(pick.item.contentType, pick.item.url) === "source") {
        openSource(pick);
        return;
    }
    if (resolveCarrier(pick.item.contentType) === "link") showMessage(t(i18n, "clip.sourceMissing"), 3000);
    openDoc(pick.item.id);
}

function carrierLabel(pick: SurfacePick): string {
    return t(i18n, `clip.type.${resolveCarrier(pick.item.contentType)}`);
}

async function act(pick: SurfacePick, action: "read" | "later" | "archive" | "pin") {
    if (actingId) return;
    actingId = pick.item.id;
    try {
        await actOnSurface(facade.pluginInstance, pick.item.id, action);
        if (action === "read") {
            startedToday = [
                ...startedToday.filter((item) => item.id !== pick.item.id),
                { id: pick.item.id, title: pick.item.title || t(i18n, "panel.untitled") },
            ];
            openReading(pick);
        }
        if (action === "pin") showMessage(t(i18n, "resurface.pinned"), 2500);
        // T-1866：今日拾遗的快速归档 = 三选对话框默认项语义（保留原位置），反馈文案统一
        if (action === "archive") showMessage(t(i18n, "archive.doneInPlace"), 2500);
        onMutated();
    } catch (error) {
        showMessage(String(error).slice(0, 120), 4000);
    } finally {
        actingId = "";
    }
}

const dateLabel = $derived.by(() => {
    const now = new Date();
    return t(i18n, "resurface.date", {
        m: now.getMonth() + 1,
        d: now.getDate(),
    });
});

function summaryText(pick: SurfacePick): string {
    return pick.item.summary || t(i18n, "resurface.noSummary");
}

function reasonText(reason: SurfaceReason): string {
    switch (reason.kind) {
        case "stale": return t(i18n, "resurface.reason.stale", { n: reason.days ?? 0 });
        case "priority": return t(i18n, "resurface.reason.priority", { n: reason.priority ?? 3 });
        case "site": return t(i18n, "resurface.reason.site", { site: reason.site ?? "" });
        case "freshTopic": return t(i18n, "resurface.reason.freshTopic");
    }
}
</script>

<div class="glean-panel">
    <header class="glean-panel__head" style="padding-bottom: 4px">
        <div class="glean-brand">
            <div class="glean-brand__mark"><svg><use href="#iconGleanWheat" /></svg></div>
            <div>
                <div class="glean-brand__name">{t(i18n, "resurface.title")}</div>
                <div class="glean-brand__sub">
                    {dateLabel} · {t(i18n, "resurface.subtitle", { n: picks.length })}
                    {#if recentCount > 0}· {t(i18n, "resurface.recent", { n: recentCount })}{/if}
                </div>
            </div>
            <div class="glean-head-actions">
                <button class="glean-icon-btn" title={t(i18n, "action.refresh")} onclick={() => onMutated()}>
                    <svg><use href="#iconGleanRefresh" /></svg>
                </button>
            </div>
        </div>
    </header>

    {#if picks.length === 0 && facade.settings.anchorNotebooks.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art">🌾</div>
            <div class="glean-empty__title">{t(i18n, "resurface.noAnchor")}</div>
            <div class="glean-empty__hint">{t(i18n, "panel.noAnchorHint")}</div>
            <button class="glean-btn" style="margin-top:10px" onclick={() => facade.openSettings()}>
                {t(i18n, "panel.setupAnchor")}
            </button>
        </div>
    {:else if picks.length === 0 && startedToday.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art">🌱</div>
            <div class="glean-empty__title">{t(i18n, "resurface.allDone")}</div>
            <div class="glean-empty__hint">{t(i18n, "resurface.allDoneHint")}</div>
        </div>
    {:else}
        {#if digestOn && picks.length > 0}
            <!-- T-1764 AI 每日简报：三篇速览（手动、额度、会话状态仅复制） -->
            <div class="glean-surf-digest">
                {#if digestText}
                    <div class="glean-surf-digest__text">{digestText}</div>
                    <div class="glean-surf__acts">
                        <button class="glean-surf-act" onclick={() => void copyDigest()}>{t(i18n, "reader.copy")}</button>
                        {#if digestTtsOn}
                            <!-- T-1764×T-1744 衔接：速览朗读（TTS 可用时显示） -->
                            {#if digestSpeaking}
                                <button class="glean-surf-act" onclick={() => { stopDigestSpeech(); }}>{t(i18n, "reader.ttsStop")}</button>
                            {:else}
                                <button class="glean-surf-act" onclick={() => speakDigest()}>{t(i18n, "reader.ttsSpeak")}</button>
                            {/if}
                        {/if}
                        <button class="glean-surf-act" onclick={() => (digestText = "")}>{t(i18n, "action.close")}</button>
                    </div>
                {:else}
                    <button class="glean-surf-act" disabled={digestBusy} onclick={() => void generateDigest()}>
                        {digestBusy ? t(i18n, "panel.loading") : `✨ ${t(i18n, "resurface.digest")}`}
                    </button>
                {/if}
            </div>
        {/if}
        {#if startedToday.length > 0}
            <div class="glean-surf-started">
                {#each startedToday as item (item.id)}
                    <span class="glean-surf-started__item" title={item.title}>
                        <span class="glean-surf-started__label">今天已开始</span>
                        <span class="glean-surf-started__title">{item.title}</span>
                        <button class="glean-surf-act" onclick={() => facade.openReadingDocument(item.id)}>
                            {t(i18n, "resurface.continueReading")}
                        </button>
                    </span>
                {/each}
            </div>
        {/if}
        {#if picks.length === 0}
            <div class="glean-empty" style="padding: 24px 12px">
                <div class="glean-empty__hint">{t(i18n, "resurface.allDoneHint")}</div>
            </div>
        {/if}
        <div class="glean-surf">
            {#each picks as pick, index (pick.item.id)}
                <article class="glean-surf-card" style="--glean-surf-index: {index}">
                    <div class="glean-surf__tag">✨ {t(i18n, "resurface.cardTag", { n: index + 1 })}</div>
                    <div
                        class="glean-surf__title"
                        onclick={() => openDoc(pick.item.id)}
                        onkeydown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openDoc(pick.item.id);
                            }
                        }}
                        role="button"
                        tabindex="0"
                    >
                        {pick.item.title || t(i18n, "panel.untitled")}
                    </div>
                    <div class="glean-surf__summary">{summaryText(pick)}</div>
                    <div class="glean-surf__meta">
                        <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(pick.item.contentType)}`}>{carrierLabel(pick)}</span>
                        {#if pick.item.aiTags.length > 0}
                            <span>#{pick.item.aiTags.slice(0, 3).join(" #")}</span>
                        {/if}
                    </div>
                    {#if pick.reasons.length > 0}
                        <div class="glean-surf__why" title={t(i18n, "resurface.why")}>
                            <span class="glean-surf__why-label">{t(i18n, "resurface.why")}</span>
                            {#each pick.reasons as reason (reason.kind + (reason.site ?? ""))}
                                <span class="glean-stale">{reasonText(reason)}</span>
                            {/each}
                        </div>
                    {/if}
                    <div class="glean-surf__acts">
                        {#if hasSourceAction(pick.item.contentType, pick.item.url)}
                            <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => openSource(pick)}>
                                ↗ {t(i18n, "clip.openSource")}
                            </button>
                        {:else if pick.item.contentType === "link"}
                            <span class="glean-surf-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                        {/if}
                        <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => void act(pick, "later")}>
                            {t(i18n, "resurface.later")}
                        </button>
                        <!-- T-1797 钉住：当日置顶，隔日自然回池 -->
                        <button
                            class="glean-surf-act"
                            disabled={actingId === pick.item.id}
                            title={t(i18n, "resurface.pinHint")}
                            onclick={() => void act(pick, "pin")}
                        >📌 {t(i18n, "resurface.pin")}</button>
                        <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => void act(pick, "archive")}>
                            {t(i18n, "resurface.archive")}
                        </button>
                        <button class="glean-surf-act glean-surf-act--pri" disabled={actingId === pick.item.id} onclick={() => void act(pick, "read")}>
                            ✓ {t(i18n, "resurface.read")}
                        </button>
                    </div>
                </article>
            {/each}
            <div class="glean-surf-foot">{t(i18n, "resurface.calmNote")}</div>
        </div>
    {/if}
</div>

<script lang="ts">
/** 今日拾遗视图（T-1400/T-1402/T-1717）：确定性挑选，读了/改天/归档，平静原则文案。
 * 重浮是纯投影：输入是父级刚对账过的索引（T-1710），本组件不再另读缓存。 */
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { actOnSurface, computeDailyFromIndex, setSurfacePinned, undoSurfaceAction, type SurfaceAction, type SurfaceUndoToken } from "../services/resurface-service";
import type { GleanIndex } from "../services/index-store";
import { todayStamp, type SurfacePick, type SurfaceReason } from "../domain/resurface";
import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
import { isActivationKey } from "../domain/keyboard";
import { clampSurfaceSwipe, resolveSurfaceSwipe, type SurfaceSwipeAction } from "../domain/surface-swipe";

interface Props {
    facade: GleanFacade;
    /** 面板对账后的派生索引；每次属性变化由父级传入新引用触发重算。 */
    index: GleanIndex;
    onMutated: () => void;
    embedded?: boolean;
}

let { facade, index, onMutated, embedded = false }: Props = $props();

const i18n = $derived(facade.i18n);

const daily = $derived(computeDailyFromIndex(index, facade.settings));
const picks = $derived(daily.picks);
const recentCount = $derived(daily.recentCount);
let actingId = $state("");
let undoingId = $state("");
let undoNotice = $state<{ id: string; title: string; action: SurfaceAction; token: SurfaceUndoToken } | null>(null);
let suppressedClickId = $state("");
let swipeState = $state<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    locked: boolean;
} | null>(null);
/** UX 审计 #10：本会话"开始阅读"过的文章回执（纯视图状态，不写属性）。 */
let startedToday = $state<Array<{ id: string; title: string }>>([]);

function openDoc(docId: string) {
    if (suppressedClickId === docId) {
        suppressedClickId = "";
        return;
    }
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

function isPinnedToday(pick: SurfacePick): boolean {
    return pick.item.pinned === todayStamp();
}

async function togglePin(pick: SurfacePick): Promise<void> {
    if (actingId || undoingId) return;
    actingId = pick.item.id;
    try {
        await setSurfacePinned(facade.pluginInstance, pick.item.id, !isPinnedToday(pick));
        onMutated();
    } catch (error) {
        showMessage(String(error).slice(0, 120), 4000);
    } finally {
        actingId = "";
    }
}

async function act(pick: SurfacePick, action: SurfaceAction) {
    if (actingId || undoingId) return;
    actingId = pick.item.id;
    try {
        const token = await actOnSurface(facade.pluginInstance, pick.item.id, action);
        if (facade.isMobile) {
            undoNotice = {
                id: pick.item.id,
                title: pick.item.title || t(i18n, "panel.untitled"),
                action,
                token,
            };
        }
        if (action === "read") {
            startedToday = [
                ...startedToday.filter((item) => item.id !== pick.item.id),
                { id: pick.item.id, title: pick.item.title || t(i18n, "panel.untitled") },
            ];
            openReading(pick);
        }
        onMutated();
    } catch (error) {
        showMessage(String(error).slice(0, 120), 4000);
    } finally {
        actingId = "";
    }
}

function swipeOffsetFor(docId: string): number {
    return swipeState?.id === docId ? swipeState.offsetX : 0;
}

function isSwipeBlockedTarget(event: PointerEvent): boolean {
    const target = event.target;
    return target instanceof HTMLElement && Boolean(target.closest("button,a,input,select,textarea"));
}

function beginSwipe(pick: SurfacePick, event: PointerEvent): void {
    if (!facade.isMobile || actingId || undoingId || isSwipeBlockedTarget(event)) return;
    swipeState = {
        id: pick.item.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: 0,
        locked: false,
    };
}

function moveSwipe(pick: SurfacePick, event: PointerEvent): void {
    if (!swipeState || swipeState.id !== pick.item.id || swipeState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipeState.startX;
    const deltaY = event.clientY - swipeState.startY;
    if (!swipeState.locked) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
            swipeState = null;
            return;
        }
        if (Math.abs(deltaX) < 8) return;
        swipeState = { ...swipeState, locked: true };
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
            return;
        }
    }
    event.preventDefault();
    swipeState = { ...swipeState, offsetX: clampSurfaceSwipe(deltaX) };
}

function finishSwipe(pick: SurfacePick, event: PointerEvent): void {
    if (!swipeState || swipeState.id !== pick.item.id || swipeState.pointerId !== event.pointerId) return;
    const current = swipeState;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    const action: SurfaceSwipeAction | null = resolveSurfaceSwipe(deltaX, deltaY);
    if (!action) {
        swipeState = null;
        return;
    }
    event.preventDefault();
    suppressedClickId = pick.item.id;
    swipeState = { ...current, offsetX: action === "later" ? 132 : -132 };
    window.setTimeout(() => {
        if (swipeState?.id === pick.item.id) swipeState = null;
        void act(pick, action);
    }, 120);
    window.setTimeout(() => {
        if (suppressedClickId === pick.item.id) suppressedClickId = "";
    }, 360);
}

function cancelSwipe(pick: SurfacePick, event: PointerEvent): void {
    if (swipeState?.id === pick.item.id && swipeState.pointerId === event.pointerId) swipeState = null;
}

function actionLabel(action: SurfaceAction): string {
    return t(i18n, action === "read" ? "resurface.read" : action === "archive" ? "resurface.archive" : "resurface.later");
}

async function undoLastAction(): Promise<void> {
    const notice = undoNotice;
    if (!notice || actingId || undoingId) return;
    undoingId = notice.id;
    try {
        await undoSurfaceAction(facade.pluginInstance, notice.id, notice.token);
        undoNotice = null;
        onMutated();
    } catch {
        showMessage(t(i18n, "resurface.undoUnavailable"), 4000);
    } finally {
        undoingId = "";
    }
}

function dismissUndo(): void {
    if (!undoingId) undoNotice = null;
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

<div class="glean-panel glean-resurface" class:glean-resurface--embedded={embedded}>
    {#if !embedded}<header class="glean-panel__head" style="padding-bottom: 4px">
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
                <button class="glean-icon-btn" title={t(i18n, "action.refresh")} aria-label={t(i18n, "action.refresh")} onclick={() => onMutated()}>
                    <svg><use href="#iconGleanRefresh" /></svg>
                </button>
            </div>
        </div>
    </header>{/if}

    {#if facade.isMobile && picks.length > 0}
        <div class="glean-surf-swipe-hint" role="note">{t(i18n, "resurface.swipeHint")}</div>
    {/if}

    {#if undoNotice}
        <div class="glean-surf-undo" role="status" aria-live="polite">
            <span class="glean-surf-undo__text">{t(i18n, "resurface.actionApplied", { action: actionLabel(undoNotice.action) })} · {undoNotice.title}</span>
            <button class="glean-surf-undo__button" disabled={undoingId === undoNotice.id} onclick={() => void undoLastAction()}>
                {undoingId === undoNotice.id ? t(i18n, "resurface.undoing") : t(i18n, "resurface.undo")}
            </button>
            <button class="glean-surf-undo__dismiss" aria-label={t(i18n, "resurface.dismissUndo")} onclick={dismissUndo}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
        </div>
    {/if}

    {#if picks.length === 0 && facade.settings.anchorNotebooks.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art"><svg aria-hidden="true"><use href="#iconGleanWheat" /></svg></div>
            <div class="glean-empty__title">{t(i18n, "resurface.noAnchor")}</div>
            <div class="glean-empty__hint">{t(i18n, "panel.noAnchorHint")}</div>
            <button class="glean-btn" style="margin-top:10px" onclick={() => facade.openSettings()}>
                {t(i18n, "panel.setupAnchor")}
            </button>
        </div>
    {:else if picks.length === 0 && startedToday.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art"><svg aria-hidden="true"><use href="#iconGleanSpark" /></svg></div>
            <div class="glean-empty__title">{t(i18n, "resurface.allDone")}</div>
            <div class="glean-empty__hint">{t(i18n, "resurface.allDoneHint")}</div>
        </div>
    {:else}
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
                <div class="glean-surf-swipe">
                    <div class="glean-surf-swipe__action glean-surf-swipe__action--archive" aria-hidden="true">← {t(i18n, "resurface.swipeArchive")}</div>
                    <div class="glean-surf-swipe__action glean-surf-swipe__action--later" aria-hidden="true">{t(i18n, "resurface.swipeLater")} →</div>
                    <article
                        class:glean-surf-card--swiping={swipeState?.id === pick.item.id}
                        class="glean-surf-card"
                        style="--glean-surf-index: {index}; --glean-swipe-offset: {swipeOffsetFor(pick.item.id)}px"
                        onpointerdown={(event) => beginSwipe(pick, event)}
                        onpointermove={(event) => moveSwipe(pick, event)}
                        onpointerup={(event) => finishSwipe(pick, event)}
                        onpointercancel={(event) => cancelSwipe(pick, event)}
                    >
                    <div class="glean-surf__tag">✨ {t(i18n, "resurface.cardTag", { n: index + 1 })}</div>
                    <div
                        class="glean-surf__title"
                        onclick={() => openDoc(pick.item.id)}
                        onkeydown={(event) => {
                            if (isActivationKey(event.key)) {
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
                        {#if isPinnedToday(pick)}<span class="glean-surf__pinned"><svg class="glean-icon glean-icon--xs" aria-hidden="true"><use href="#iconGleanPin" /></svg>{t(i18n, "resurface.pinnedToday")}</span>{/if}
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
                        <button class="glean-surf-act" aria-pressed={isPinnedToday(pick)} disabled={actingId === pick.item.id} onclick={() => void togglePin(pick)}>
                            <svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanPin" /></svg>{t(i18n, isPinnedToday(pick) ? "resurface.unpinToday" : "resurface.pinToday")}
                        </button>
                        {#if hasSourceAction(pick.item.contentType, pick.item.url)}
                            <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => openSource(pick)}>
                                <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg>{t(i18n, "clip.openSource")}
                            </button>
                        {:else if pick.item.contentType === "link"}
                            <span class="glean-surf-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                        {/if}
                        <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => void act(pick, "later")}>
                            {t(i18n, "resurface.later")}
                        </button>
                        <button class="glean-surf-act" disabled={actingId === pick.item.id} onclick={() => void act(pick, "archive")}>
                            {t(i18n, "resurface.archive")}
                        </button>
                        <button class="glean-surf-act glean-surf-act--pri" disabled={actingId === pick.item.id} onclick={() => void act(pick, "read")}>
                            ✓ {t(i18n, "resurface.read")}
                        </button>
                    </div>
                    </article>
                </div>
            {/each}
            <div class="glean-surf-foot">{t(i18n, "resurface.calmNote")}</div>
        </div>
    {/if}
</div>

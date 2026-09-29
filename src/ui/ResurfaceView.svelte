<script lang="ts">
/** 今日拾遗视图（T-1400/T-1402）：确定性挑选，读了/改天/归档，平静原则文案。 */
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { computeDaily, actOnSurface } from "../services/resurface-service";
import { recordReadingDone } from "../services/checkin-bridge";
import { ageDays, type SurfacePick } from "../domain/resurface";

interface Props {
    facade: GleanFacade;
    onMutated: () => void;
}

let { facade, onMutated }: Props = $props();

const i18n = $derived(facade.i18n);

let picks = $state<SurfacePick[]>([]);
let recentCount = $state(0);
let loading = $state(true);
let actingId = $state("");

async function reload() {
    loading = true;
    try {
        const daily = await computeDaily(facade.pluginInstance, facade.settings);
        picks = daily.picks;
        recentCount = daily.recentCount;
    } catch {
        picks = [];
    } finally {
        loading = false;
    }
}

$effect(() => {
    void reload();
});

function openDoc(docId: string) {
    void openTab({ app: facade.pluginInstance.app, doc: { id: docId }, keepCursor: false });
}

async function act(pick: SurfacePick, action: "read" | "later" | "archive") {
    if (actingId) return;
    actingId = pick.item.id;
    try {
        await actOnSurface(facade.pluginInstance, pick.item.id, action);
        // T-1505 小驴协同：读完 → 打卡记录（写能力，开关开启才调用；fire-and-forget 失败静默）
        if (action === "read" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
            void recordReadingDone(facade.settings.integration.checkinItemId, pick.item.id, pick.item.title);
        }
        await reload();
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

function staleOf(pick: SurfacePick): number {
    return ageDays(pick.item.time);
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
                <button class="glean-icon-btn" title={t(i18n, "action.refresh")} onclick={() => void reload()}>
                    <svg><use href="#iconGleanRefresh" /></svg>
                </button>
            </div>
        </div>
    </header>

    {#if loading}
        <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
    {:else if picks.length === 0}
        <div class="glean-empty">
            <div class="glean-empty__art">🌱</div>
            <div class="glean-empty__title">{t(i18n, "resurface.allDone")}</div>
            <div class="glean-empty__hint">{t(i18n, "resurface.allDoneHint")}</div>
        </div>
    {:else}
        <div class="glean-surf">
            {#each picks as pick, index (pick.item.id)}
                <article class="glean-surf-card" style="--glean-surf-index: {index}">
                    <div class="glean-surf__tag">✨ {t(i18n, "resurface.cardTag", { n: index + 1 })}</div>
                    <div class="glean-surf__title" onclick={() => openDoc(pick.item.id)} role="button" tabindex="0">
                        {pick.item.title || t(i18n, "panel.untitled")}
                    </div>
                    <div class="glean-surf__summary">{summaryText(pick)}</div>
                    <div class="glean-surf__meta">
                        {#if pick.item.aiTags.length > 0}
                            <span>#{pick.item.aiTags.slice(0, 3).join(" #")}</span>
                        {/if}
                        <span>· {t(i18n, "panel.staleDays", { n: staleOf(pick) })}</span>
                    </div>
                    <div class="glean-surf__acts">
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
            {/each}
            <div class="glean-surf-foot">{t(i18n, "resurface.calmNote")}</div>
        </div>
    {/if}
</div>

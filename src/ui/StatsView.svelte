<script lang="ts">
/** 统计视图（T-1201）：Bento 卡 + 站点/标签分布 + 周报导出。数据全部从派生索引聚合。 */
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { GleanIndex } from "../services/index-store";
import { buildStats, exportWeeklyReport } from "../services/stats-service";
import type { ReadingStats } from "../domain/stats";

interface Props {
    facade: GleanFacade;
    index: GleanIndex;
    onCaptured?: () => void;
}

let { facade, index, onCaptured }: Props = $props();

const i18n = $derived(facade.i18n);

let stats = $state<ReadingStats | null>(null);
let exporting = $state(false);

const spark = $derived.by<number[]>(() => {
    if (!stats) return [];
    const daily = stats.dailyCaptured;
    const max = Math.max(...daily, 1);
    // 生成 7 根柱的相对高度（0.15 底线），今日高亮
    return daily.map((value) => 0.15 + 0.85 * (value / max));
});

const doneRatio = $derived(stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0);

function fmtWords(words: number): { num: string; unit: string } {
    if (words >= 10_000) return { num: (words / 10_000).toFixed(1), unit: t(i18n, "stats.wan") };
    return { num: String(words), unit: "" };
}

async function doExport() {
    exporting = true;
    try {
        await exportWeeklyReport(index, facade.settings, facade.pluginInstance);
        showMessage(t(i18n, "stats.exportDone"), 3000);
        onCaptured?.();
    } catch (error) {
        showMessage(String(error).slice(0, 120), 5000);
    } finally {
        exporting = false;
    }
}

$effect(() => {
    stats = buildStats(index);
});
</script>

<div class="glean-stats">
    {#if stats}
        <div class="glean-bento">
            <div class="glean-tile">
                <div class="glean-tile__glow" style="background: radial-gradient(circle, rgba(245,158,11,.32), transparent 70%)"></div>
                <div class="glean-tile__k">📚 {t(i18n, "stats.total")}</div>
                <div class="glean-tile__v">{stats.total}</div>
                <div class="glean-tile__spark">
                    {#each spark as height, i (i)}
                        <i class:hot={i >= 4} style={`height:${Math.round(height * 100)}%`}></i>
                    {/each}
                </div>
            </div>
            <div class="glean-tile">
                <div class="glean-tile__glow" style="background: radial-gradient(circle, rgba(16,185,129,.3), transparent 70%)"></div>
                <div class="glean-tile__k">✅ {t(i18n, "stats.read")}</div>
                <div class="glean-tile__v">{stats.done}<span class="glean-tile__u">{doneRatio}%</span></div>
            </div>
            <div class="glean-tile">
                <div class="glean-tile__glow" style="background: radial-gradient(circle, rgba(139,92,246,.28), transparent 70%)"></div>
                <div class="glean-tile__k">📖 {t(i18n, "stats.words")}</div>
                <div class="glean-tile__v">{fmtWords(stats.totalWords).num}{#if fmtWords(stats.totalWords).unit}<span class="glean-tile__u">{fmtWords(stats.totalWords).unit}</span>{/if}</div>
            </div>
            <div class="glean-tile">
                <div class="glean-tile__glow" style="background: radial-gradient(circle, rgba(59,130,246,.28), transparent 70%)"></div>
                <div class="glean-tile__k">🔥 {t(i18n, "stats.thisWeek")}</div>
                <div class="glean-tile__v">{stats.doneThisWeek}<span class="glean-tile__u">{t(i18n, "stats.doneUnit")}</span></div>
            </div>
        </div>

        {#if stats.bySite.length > 0}
            <div class="glean-sect">{t(i18n, "stats.bySite")}</div>
            <div class="glean-block">
                {#each stats.bySite as site (site.name)}
                    <div class="glean-bar-row">
                        <span class="glean-bar-row__nm">{site.name}</span>
                        <div class="glean-bar-row__bar"><i style={`width:${Math.round((site.count / Math.max(...stats.bySite.map((item) => item.count), 1)) * 100)}%`}></i></div>
                        <span class="glean-bar-row__ct">{site.count}</span>
                    </div>
                {/each}
            </div>
        {/if}

        {#if stats.byTag.length > 0}
            <div class="glean-sect">{t(i18n, "stats.byTag")}</div>
            <div class="glean-block">
                <div class="glean-tagcloud">
                    {#each stats.byTag as tag (tag.name)}
                        <span class="glean-tag">{tag.name} ×{tag.count}</span>
                    {/each}
                </div>
            </div>
        {/if}

        <button class="glean-primary-btn" disabled={exporting} onclick={() => void doExport()}>
            📝 {exporting ? t(i18n, "panel.loading") : t(i18n, "stats.exportWeekly")}
        </button>
    {:else}
        <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
    {/if}
</div>

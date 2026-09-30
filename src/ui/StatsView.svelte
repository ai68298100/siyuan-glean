<script lang="ts">
/** 统计视图（T-1201）：Bento 卡 + 站点/标签分布 + 周报导出。数据全部从派生索引聚合。 */
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import type { GleanIndex } from "../services/index-store";
import { buildStats, exportWeeklyReport, exportMonthlyReview } from "../services/stats-service";
import { readingHeatmap, captureFunnel, type HeatmapGrid, type ReadingStats } from "../domain/stats";

interface Props {
    facade: GleanFacade;
    index: GleanIndex;
    onCaptured?: () => void;
}

let { facade, index, onCaptured }: Props = $props();

const i18n = $derived(facade.i18n);

let stats = $state<ReadingStats | null>(null);
let exporting = $state(false);
let exportingMonthly = $state(false);
let exportingCsv = $state(false);

/** T-1771：生成本月回顾文档（/读库月报/YYYYMM，幂等定位）。 */
async function doExportMonthly() {
    exportingMonthly = true;
    try {
        await exportMonthlyReview(index, facade.settings, facade.pluginInstance);
        showMessage(t(i18n, "stats.exportMonthlyDone"), 3000);
        onCaptured?.();
    } catch (error) {
        showMessage(String(error).slice(0, 120), 5000);
    } finally {
        exportingMonthly = false;
    }
}

const HEATMAP_WEEKS = 26;

// T-1770：近半年阅读热力图（只认 doneTime，D-0028 契约）
const heatmap = $derived.by<HeatmapGrid | null>(() => {
    if (!stats) return null;
    const doneTimes = Object.values(index.clips).map((clip) => clip.doneTime);
    return readingHeatmap(doneTimes, HEATMAP_WEEKS);
});

// T-1773 收录漏斗：候选→收录→完成转化率（纯投影）
const funnel = $derived.by(() => {
    if (!stats) return null;
    const doneCount = Object.values(index.clips).filter((clip) => /^\d{14}$/.test(clip.doneTime)).length;
    return captureFunnel(Object.keys(index.clips).length, doneCount, Object.keys(index.candidates).length);
});

function heatLevel(count: number, max: number): number {
    if (count <= 0 || max <= 0) return 0;
    // 四档强度（含零档）：按相对最大值的 1/4 分档，至少一档
    return Math.min(4, 1 + Math.floor(((count - 1) / Math.max(max, 1)) * 4));
}

function heatCellLabel(cell: { date: string; count: number }): string {
    const date = `${cell.date.slice(0, 4)}-${cell.date.slice(4, 6)}-${cell.date.slice(6, 8)}`;
    return cell.count > 0 ? `${date} · ${t(i18n, "stats.heatDay", { n: cell.count })}` : date;
}

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

/** T-1772：读库全量属性表 CSV 下载（BOM 由 buildLibraryCsv 提供）。 */
async function doExportCsv() {
    exportingCsv = true;
    try {
        const { buildLibraryCsv } = await import("../services/stats-service");
        const csv = buildLibraryCsv(index);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `glean-library-${Date.now()}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
        showMessage(t(i18n, "stats.exportCsvDone"), 3000);
    } catch (error) {
        showMessage(String(error).slice(0, 120), 5000);
    } finally {
        exportingCsv = false;
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

        {#if funnel && funnel.captured + funnel.candidates > 0}
            <div class="glean-sect">{t(i18n, "stats.funnel")}</div>
            <div class="glean-block">
                <div class="glean-bar-row">
                    <span class="glean-bar-row__nm">{t(i18n, "stats.funnelCaptured")}</span>
                    <div class="glean-bar-row__bar"><i style="width:100%"></i></div>
                    <span class="glean-bar-row__ct">{funnel.captured}</span>
                </div>
                <div class="glean-bar-row">
                    <span class="glean-bar-row__nm">{t(i18n, "stats.funnelDone")}</span>
                    <div class="glean-bar-row__bar"><i style={`width:${Math.max(funnel.doneRate, funnel.done > 0 ? 4 : 0)}%`}></i></div>
                    <span class="glean-bar-row__ct">{funnel.done}（{funnel.doneRate}%）</span>
                </div>
                {#if funnel.candidates > 0}
                    <div class="glean-bar-row">
                        <span class="glean-bar-row__nm">{t(i18n, "stats.funnelPending")}</span>
                        <div class="glean-bar-row__bar"><i style={`width:${Math.max(100 - funnel.captureRate, 4)}%`}></i></div>
                        <span class="glean-bar-row__ct">{funnel.candidates}</span>
                    </div>
                {/if}
            </div>
        {/if}

        {#if heatmap && heatmap.totalDone > 0}
            <div class="glean-sect">{t(i18n, "stats.heatmap", { n: HEATMAP_WEEKS })}</div>
            <div class="glean-block glean-heat-block">
                <!-- T-1770/T-1976：格子附 aria-label 文本替代，另给文字摘要，不单靠颜色表达事实 -->
                <div class="glean-heat" role="img" aria-label={t(i18n, "stats.heatmapSummary", { total: heatmap.totalDone, days: heatmap.activeDays })}>
                    {#each heatmap.cells as cell (cell.date)}
                        <i
                            class="glean-heat__cell glean-heat__cell--l{heatLevel(cell.count, heatmap.maxCount)}"
                            title={heatCellLabel(cell)}
                        ></i>
                    {/each}
                </div>
                <div class="glean-heat__meta">
                    <span>{t(i18n, "stats.heatmapSummary", { total: heatmap.totalDone, days: heatmap.activeDays })}</span>
                    <span class="glean-heat__scale">
                        <i class="glean-heat__cell glean-heat__cell--l0"></i>
                        <i class="glean-heat__cell glean-heat__cell--l1"></i>
                        <i class="glean-heat__cell glean-heat__cell--l2"></i>
                        <i class="glean-heat__cell glean-heat__cell--l3"></i>
                        <i class="glean-heat__cell glean-heat__cell--l4"></i>
                    </span>
                </div>
            </div>
        {/if}

        <button class="glean-primary-btn" disabled={exporting} onclick={() => void doExport()}>
            📝 {exporting ? t(i18n, "panel.loading") : t(i18n, "stats.exportWeekly")}
        </button>
        <button class="glean-primary-btn" disabled={exportingMonthly} onclick={() => void doExportMonthly()}>
            🗓️ {exportingMonthly ? t(i18n, "panel.loading") : t(i18n, "stats.exportMonthly")}
        </button>
        <button class="glean-primary-btn" disabled={exportingCsv} onclick={() => void doExportCsv()}>
            📊 {exportingCsv ? t(i18n, "panel.loading") : t(i18n, "stats.exportCsv")}
        </button>
    {:else}
        <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
    {/if}
</div>

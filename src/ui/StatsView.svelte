<script lang="ts">
// 宽屏布局按 src/index.scss 的 glean-content 内容容器计算（扣除工作台导航）；
// @container glean-content (min-width: 760px)
// 下 .glean-stats__metrics 有四列基础网格；本页首屏覆盖为三张主卡和 30 天趋势，
// 其余指标、全年热力图与分布收进可展开区，避免统计页一打开就被次要数字淹没。
// .glean-stats__distributions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }，
// .glean-stats__distribution { min-width: 0; }。
import { onDestroy } from "svelte";
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import DistributionList from "./DistributionList.svelte";
import { t } from "../libs/i18n";
import type { GleanIndex } from "../services/index-store";
import { buildReadingReview, previewReadingReview, resolveUnknownReadingReview, saveReadingReviewReport, type ReadingReviewSession } from "../services/stats-service";
import { computeConversionFunnel, parseReviewDate, reviewDateInput, type ReadingReviewLabels, type ReviewPeriodKind } from "../domain/stats";

interface Props {
    facade: GleanFacade;
    index: GleanIndex;
    currentTime: Date;
    onCaptured?: () => void;
    loading?: boolean;
    loadError?: boolean;
    onRetry?: () => void;
}

let { facade, index, currentTime, onCaptured, loading = false, loadError = false, onRetry }: Props = $props();

const i18n = $derived(facade.i18n);
const instanceId = $props.id();
const idPrefix = `glean-stats-${instanceId}`;
const idFor = (part: string) => `${idPrefix}-${part}`;
const freshnessStamp = $derived(Number.isFinite(Date.parse(index.updatedAt))
    ? new Date(index.updatedAt).toLocaleString()
    : index.updatedAt.slice(0, 40));

let period = $state<ReviewPeriodKind>("week");
let referenceDate = $state(reviewDateInput());
let session = $state.raw<ReadingReviewSession | null>(null);
let saveState = $state<ReadingReviewSession["state"]>("ready");
let busy = $state(false);
let message = $state("");
let disposed = false;
const reference = $derived(parseReviewDate(referenceDate));
const liveReview = $derived(buildReadingReview(index, { period, reference: reference ?? currentTime, now: currentTime }));
const review = $derived(session?.review ?? liveReview);
const stats = $derived(review.stats);
const maxHeat = $derived(Math.max(1, ...stats.heatmap.map((day) => day.count)));
const heatmapPadding = $derived((new Date(`${stats.heatmap[0].date}T12:00:00`).getDay() + 6) % 7);
const recentDays = $derived(stats.recentCompletionTrend);
const funnel = $derived(computeConversionFunnel(index.clips, index.candidates));
const maxRecent = $derived(Math.max(1, ...recentDays.map((day) => day.count)));
const distributions = $derived([
    { key: "review.bySite", counts: stats.periodBySite },
    { key: "review.byAuthor", counts: stats.periodByAuthor },
    { key: "review.byUserTag", counts: stats.periodByUserTag },
    { key: "review.byAiTag", counts: stats.periodByAiTag },
]);
const primaryMetrics = $derived([
    { key: "review.completed", count: stats.periodCompleted, hint: "review.completedHint" },
    { key: "stats.total", count: stats.total, hint: "stats.totalHint" },
    { key: "review.candidateMetric", count: review.candidateCount, hint: "review.candidateHint" },
]);
const supplementaryMetrics = $derived([
    { key: "review.completionStreak", count: stats.completionStreak, hint: "review.completionStreakHint" },
    { key: "review.doneState", count: stats.done },
    { key: "review.archived", count: stats.archived },
    { key: "review.libraryWords", count: stats.totalWords },
    { key: "review.captured", count: stats.periodCaptured },
    { key: "review.unknownDoneTime", count: stats.unknownDoneTime },
    { key: "review.archivedUnknown", count: stats.archivedWithoutCompletion },
]);

onDestroy(() => { disposed = true; });

function reportLabels(): ReadingReviewLabels {
    return {
        title: t(i18n, "review.title"), scope: t(i18n, "review.scope"), snapshot: t(i18n, "review.snapshot"),
        period: t(i18n, "review.period"), total: t(i18n, "stats.total"), done: t(i18n, "review.doneState"),
        archived: t(i18n, "review.archived"), reading: t(i18n, "status.reading"), words: t(i18n, "review.libraryWords"),
        completed: t(i18n, "review.completed"), captured: t(i18n, "review.captured"),
        unknownDoneTime: t(i18n, "review.unknownDoneTime"), archivedWithoutCompletion: t(i18n, "review.archivedUnknown"),
        candidates: t(i18n, "review.candidates"), bySite: t(i18n, "review.bySite"),
        byAuthor: t(i18n, "review.byAuthor"), authorUnknown: t(i18n, "review.authorUnknownLabel"),
        byUserTag: t(i18n, "review.byUserTag"), byAiTag: t(i18n, "review.byAiTag"),
        completedList: t(i18n, "review.completedList"), noCompleted: t(i18n, "review.noCompleted"), untitled: t(i18n, "review.untitled"),
    };
}

async function preview(): Promise<void> {
    if (busy || session) return;
    if (!reference) {
        message = t(i18n, "review.invalidDate");
        return;
    }
    busy = true;
    message = "";
    try {
        const next = await previewReadingReview(facade.pluginInstance, facade.settings, { period, reference, labels: reportLabels() });
        if (disposed) return;
        session = next;
        saveState = next.state;
        message = next.state === "unknown"
            ? t(i18n, "review.save.createUnknown", { id: "", path: next.path })
            : next.state === "created"
                ? t(i18n, "review.save.resumed", { id: next.createdDocId })
                : "";
    } catch (error) {
        console.warn("[glean] 回顾预览失败:", error);
        if (!disposed) message = t(i18n, "review.previewFailed");
    } finally {
        if (!disposed) busy = false;
    }
}

async function save(): Promise<void> {
    if (!session || busy || saveState === "unknown" || saveState === "saved") return;
    const saving = session;
    busy = true;
    message = "";
    try {
        const outcome = await saveReadingReviewReport(facade.pluginInstance, saving, true);
        const resultMessage = outcome.ok
            ? t(i18n, "review.saved", { id: outcome.docId ?? "" })
            : outcome.reason === "sessionPending"
                ? t(i18n, "review.save.sessionPending")
                : outcome.reason === "sessionStale"
                    ? t(i18n, "review.save.sessionStale")
                    : outcome.reason === "sessionReleased"
                        ? t(i18n, "review.save.sessionReleased")
                        : t(i18n, `review.save.${outcome.reason ?? "readFailed"}`, { id: outcome.docId ?? saving.createdDocId, path: saving.path });
        if (outcome.ok) {
            facade.notifyDataChanged();
            onCaptured?.();
        }
        if (disposed) {
            showMessage(resultMessage, 10000);
            return;
        }
        saveState = saving.state;
        if (outcome.reason === "sessionPending" || outcome.reason === "sessionStale" || outcome.reason === "sessionReleased") {
            session = null;
            saveState = "ready";
        }
        message = resultMessage;
    } catch (error) {
        console.warn("[glean] 阅读回顾保存失败:", error);
        if (!disposed) message = t(i18n, "msg.actionFailed");
    } finally {
        if (!disposed) busy = false;
    }
}

function discard(): void {
    if (busy || saveState === "created" || saveState === "unknown") return;
    session = null;
    saveState = "ready";
    message = "";
}

function resolveUnknown(): void {
    if (!session || busy || saveState !== "unknown") return;
    if (!resolveUnknownReadingReview(facade.pluginInstance, session)) {
        if (session.state === "released" || session.state === "saved") {
            session = null;
            saveState = "ready";
            message = t(i18n, "review.save.sessionReleased");
        }
        return;
    }
    session = null;
    saveState = "ready";
    message = t(i18n, "review.unknownReleased");
}

function downloadCsv(): void {
    if (!session || busy) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", session.csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reading-review-${session.review.stats.period.start}-${session.review.stats.period.end}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<div class="glean-stats" aria-busy={busy}>
    {#if loading && !index.updatedAt}
        <div class="glean-stats__load-state" role="status" aria-live="polite" aria-busy="true">
            <div class="glean-empty__art" aria-hidden="true"><svg><use href="#iconGleanSpark" /></svg></div>
            <p>{t(i18n, "review.indexLoading")}</p>
        </div>
    {:else if loadError && !index.updatedAt}
        <div class="glean-stats__load-state glean-stats__load-state--error" role="alert" aria-live="assertive">
            <div class="glean-empty__art" aria-hidden="true"><svg><use href="#iconGleanClose" /></svg></div>
            <p>{t(i18n, "review.indexLoadFailed")}</p>
            {#if onRetry}<button class="glean-btn" aria-busy={loading} disabled={loading} onclick={onRetry}>{t(i18n, "review.retryLoad")}</button>{/if}
        </div>
    {:else}
        {#if loadError}
            <div class="glean-stats__freshness glean-stats__freshness--stale" role="alert" aria-live="assertive">
                <span>{t(i18n, "review.cachedStale", { at: freshnessStamp })}</span>
                {#if onRetry}<button class="glean-btn" aria-busy={loading} disabled={loading} onclick={onRetry}>{t(i18n, "review.retryLoad")}</button>{/if}
            </div>
        {:else if index.updatedAt}
            <p class="glean-stats__freshness" role="status">{t(i18n, "review.indexUpdated", { at: freshnessStamp })}</p>
        {/if}
    <section class="glean-stats__overview" aria-labelledby={idFor("overview-title")}>
        <div class="glean-stats__intro">
            <div>
                <h2 id={idFor("overview-title")}>{t(i18n, "review.title")}</h2>
                <p class="glean-stats__hint">{t(i18n, "review.scopeShort")}</p>
            </div>
            <div class="glean-stats__toolbar glean-stats__toolbar--filters">
                <label>
                    {t(i18n, "review.period")}
                    <select class="glean-stats__field" bind:value={period} disabled={busy || !!session}>
                        <option value="week">{t(i18n, "review.week")}</option>
                        <option value="month">{t(i18n, "review.month")}</option>
                        <option value="year">{t(i18n, "review.year")}</option>
                    </select>
                </label>
                <label>
                    {t(i18n, "review.referenceDate")}
                    <input class="glean-stats__field" type="date" min="0001-01-01" max="9998-12-31" bind:value={referenceDate} disabled={busy || !!session} />
                </label>
            </div>
        </div>
        <div class="glean-stats__toolbar glean-stats__toolbar--actions">
            {#if !session}
                <button class="glean-btn glean-btn--pri" disabled={busy || !reference} onclick={() => void preview()}>{t(i18n, "review.preview")}</button>
            {:else}
                <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={downloadCsv}>{t(i18n, "review.csv")}</button>
                {#if saveState === "ready" || saveState === "created"}
                    <button class="glean-btn glean-btn--pri" disabled={busy} onclick={() => void save()}>{t(i18n, saveState === "created" ? "review.retryMark" : "review.confirm")}</button>
                {/if}
                {#if session.createdDocId}
                    <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={() => facade.openReadingDocument(session!.createdDocId)}>{t(i18n, "review.openReport")}</button>
                {/if}
                {#if saveState === "ready" || saveState === "saved"}
                    <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={discard}>{t(i18n, "review.discard")}</button>
                {/if}
                {#if saveState === "unknown"}
                    <button class="glean-btn glean-btn--ghost" disabled={busy} onclick={resolveUnknown}>{t(i18n, "review.resolveUnknown")}</button>
                {/if}
            {/if}
        </div>
        <details class="glean-stats__scope">
            <summary>{t(i18n, "review.scopeDetails")}</summary>
            <p>{t(i18n, "review.scope")}</p>
            {#if review.snapshotAt}<p>{t(i18n, "review.snapshot")}: {review.snapshotAt}</p>{/if}
        </details>
        <p class="glean-stats__period">{t(i18n, "review.period")}: {stats.period.label}</p>
        {#if !reference}<p class="glean-stats__warning">{t(i18n, "review.invalidDate")}</p>{/if}
        <dl class="glean-stats__metrics">
            {#each primaryMetrics as metric (metric.key)}
                <div class="glean-stats__metric"><dt>{t(i18n, metric.key)}</dt><dd>{metric.count}</dd><dd class="glean-stats__metric-hint">{t(i18n, metric.hint)}</dd></div>
            {/each}
        </dl>
        <div class="glean-stats__funnel" role="region" aria-label={t(i18n, "stats.funnel.title")}>
            <div class="glean-stats__funnel-head">
                <span class="glean-stats__funnel-title">{t(i18n, "stats.funnel.title")}</span>
                <span class="glean-stats__funnel-desc">{t(i18n, "stats.funnel.desc")}</span>
            </div>
            <div class="glean-stats__funnel-stages">
                <div class="glean-stats__funnel-stage">
                    <span class="glean-stats__funnel-label">{t(i18n, "stats.funnel.candidate")}</span>
                    <span class="glean-stats__funnel-count">{funnel.candidateCount}</span>
                </div>
                <div class="glean-stats__funnel-arrow" aria-hidden="true">→</div>
                <div class="glean-stats__funnel-stage">
                    <span class="glean-stats__funnel-label">{t(i18n, "stats.funnel.captured")}</span>
                    <span class="glean-stats__funnel-count">{funnel.capturedCount}</span>
                </div>
                <div class="glean-stats__funnel-arrow" aria-hidden="true">→</div>
                <div class="glean-stats__funnel-stage">
                    <span class="glean-stats__funnel-label">{t(i18n, "stats.funnel.done")}</span>
                    <span class="glean-stats__funnel-count">{funnel.doneCount}</span>
                    <span class="glean-badge glean-badge--pri" title={t(i18n, "stats.funnel.completionRate")}>{(funnel.completionRate * 100).toFixed(1)}%</span>
                </div>
                <div class="glean-stats__funnel-stage glean-stats__funnel-stage--archived">
                    <span class="glean-stats__funnel-label">{t(i18n, "stats.funnel.archived")}</span>
                    <span class="glean-stats__funnel-count">{funnel.archivedCount}</span>
                    <span class="glean-badge" title={t(i18n, "stats.funnel.archiveRate")}>{(funnel.archiveRate * 100).toFixed(1)}%</span>
                </div>
            </div>
        </div>
        <details class="glean-stats__supplement">
            <summary>{t(i18n, "review.moreMetrics")}</summary>
            <dl class="glean-stats__metrics glean-stats__metrics--supplemental">
                {#each supplementaryMetrics as metric (metric.key)}
                    <div class="glean-stats__metric"><dt>{t(i18n, metric.key)}</dt><dd>{metric.count}</dd>{#if metric.hint}<dd class="glean-stats__metric-hint">{t(i18n, metric.hint)}</dd>{/if}</div>
                {/each}
            </dl>
        </details>
    </section>
    <section class="glean-stats__activity" aria-labelledby={idFor("activity-title")}>
        <h3 id={idFor("activity-title")}>{t(i18n, "review.recentTrend")}</h3>
        <div class="glean-stats__trend" role="group" aria-label={t(i18n, "review.recentTrend")}>
            {#each recentDays as day (day.date)}
                <span class="glean-stats__trend-bar" class:glean-stats__trend-bar--empty={day.count === 0} role="img" aria-label={t(i18n, "review.heatmapDay", { date: day.date, n: day.count })} title={`${day.date}: ${day.count}`} style={`--glean-trend-height:${day.count ? Math.max(12, Math.round(112 * day.count / maxRecent)) : 3}px`}></span>
            {/each}
        </div>
        <div class="glean-stats__trend-meta" aria-hidden="true">
            <span>{recentDays[0]?.date ?? referenceDate}</span>
            <span>{recentDays.at(-1)?.date ?? referenceDate}</span>
        </div>
        <details class="glean-stats__detail">
            <summary>{t(i18n, "review.detailedActivity")}</summary>
            <div class="glean-stats__heatmap-scroll" role="group" aria-label={t(i18n, "review.heatmap", { year: reference?.getFullYear() ?? new Date().getFullYear() })}>
                <div class="glean-stats__heatmap">
                    {#each Array.from({ length: heatmapPadding }, (_, index) => index) as padding (padding)}<span></span>{/each}
                    {#each stats.heatmap as day (day.date)}
                        <span class="glean-stats__day" role="img" aria-label={t(i18n, "review.heatmapDay", { date: day.date, n: day.count })} title={`${day.date}: ${day.count}`} style={`background:${day.count ? "var(--b3-theme-primary)" : "var(--b3-theme-surface)"};opacity:${day.count ? 0.25 + 0.75 * day.count / maxHeat : 1}`}></span>
                    {/each}
                </div>
                <div class="glean-stats__heatmap-legend" aria-hidden="true">
                    <span class="glean-stats__heatmap-legend-label">0</span>
                    <i class="glean-stats__legend-swatch glean-stats__legend-swatch--0"></i>
                    <i class="glean-stats__legend-swatch glean-stats__legend-swatch--1"></i>
                    <i class="glean-stats__legend-swatch glean-stats__legend-swatch--2"></i>
                    <i class="glean-stats__legend-swatch glean-stats__legend-swatch--3"></i>
                    <span class="glean-stats__heatmap-legend-label">{maxHeat}</span>
                </div>
            </div>
            <details class="glean-stats__days">
                <summary>{t(i18n, "review.dailyList")}</summary>
                <div class="glean-stats__table-scroll">
                    <table>
                        <caption>{t(i18n, "review.heatmap", { year: reference?.getFullYear() ?? new Date().getFullYear() })}</caption>
                        <thead><tr><th scope="col">{t(i18n, "review.date")}</th><th scope="col">{t(i18n, "review.completed")}</th></tr></thead>
                        <tbody>{#each stats.heatmap as day (day.date)}<tr><th scope="row">{day.date}</th><td>{day.count}</td></tr>{/each}</tbody>
                    </table>
                </div>
            </details>
        </details>
    </section>
    <details class="glean-stats__analysis">
      <summary>{t(i18n, "review.detailedAnalysis")}</summary>
      <section class="glean-stats__breakdown" aria-labelledby={idFor("breakdown-title")}>
        <h3 id={idFor("breakdown-title")} class="glean-sr-only">{t(i18n, "review.bySite")}</h3>
        <div class="glean-stats__distributions">
        {#each distributions as distribution, distributionIndex (distribution.key)}
            <section class="glean-stats__distribution" aria-labelledby={idFor(`distribution-${distributionIndex}`)}>
            <h3 id={idFor(`distribution-${distributionIndex}`)}>{t(i18n, distribution.key)}</h3>
            <DistributionList {i18n} counts={distribution.counts}>
                {#snippet detailsFor(group)}
                    {#if distribution.key === "review.bySite"}
                        {@const site = stats.periodSiteAuthors.find((entry) => entry.site === group.name)}
                        <details class="glean-stats__site-authors">
                            <summary>{t(i18n, "review.siteAuthors")}</summary>
                            <DistributionList {i18n} counts={site?.authors ?? []} />
                            <p>{t(i18n, "review.authorUnknown", { n: site?.unknownAuthorCount ?? 0 })}</p>
                        </details>
                    {/if}
                {/snippet}
            </DistributionList>
            {#if distribution.key === "review.byAuthor"}<p>{t(i18n, "review.authorUnknown", { n: stats.periodAuthorUnknown })}</p>{/if}
            </section>
        {/each}
        </div>
        <p class="glean-stats__hint">{t(i18n, "review.authorHint")}</p>
      </section>
    </details>
    <details class="glean-stats__completed-detail">
        <summary>{t(i18n, "review.completedList")}</summary>
        <section class="glean-stats__completed-section" aria-labelledby={idFor("completed-title")}>
            <h3 id={idFor("completed-title")} class="glean-sr-only">{t(i18n, "review.completedList")}</h3>
            <ul class="glean-stats__completed">
                {#each review.completedItems as item (item.id)}
                    <li>
                        <button class="glean-stats__link" title={item.title || t(i18n, "review.untitled")} onclick={() => facade.openReadingDocument(item.id)}>{item.title || t(i18n, "review.untitled")}</button>
                        <span>{item.doneTime.slice(0, 4)}-{item.doneTime.slice(4, 6)}-{item.doneTime.slice(6, 8)}</span>
                    </li>
                {:else}<li class="glean-stats__completed-empty">{t(i18n, "review.noCompleted")}</li>{/each}
            </ul>
        </section>
    </details>
    <p class="glean-stats__status" role="status" aria-live="polite" aria-busy={busy}>{busy ? t(i18n, "panel.loading") : message}</p>
    {#if session}
        <label class="glean-stats__preview">
            {t(i18n, "review.preview")}
            <textarea class="glean-stats__field" readonly value={session.markdown} spellcheck="false"></textarea>
        </label>
    {/if}
    {/if}
</div>

<style>
    .glean-stats {
        min-height: 0;
        padding: 24px;
        gap: 20px;
        font-size: 14px;
        line-height: 1.6;
    }

    .glean-stats__load-state,
    .glean-stats__freshness {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--glean-space-3);
        min-width: 0;
        padding: var(--glean-space-3) var(--glean-space-4);
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-md);
        background: var(--glean-status-surface);
        overflow-wrap: anywhere;
    }

    .glean-stats__load-state {
        min-height: 190px;
        flex-direction: column;
        justify-content: center;
        text-align: center;
    }

    .glean-stats__load-state p,
    .glean-stats__freshness { margin: 0; }

    .glean-stats__load-state--error,
    .glean-stats__freshness--stale {
        color: var(--b3-theme-error);
        border-color: color-mix(in srgb, var(--b3-theme-error) 30%, var(--glean-border-soft));
        background: var(--glean-error-surface);
    }

    .glean-stats__overview {
        padding: 0;
        gap: 16px;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
    }

    .glean-stats__overview h2 {
        font-size: 26px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: 0;
    }

    .glean-stats__overview .glean-stats__hint {
        margin-top: 8px;
        font-size: 13px;
        line-height: 1.7;
    }

    .glean-stats__activity {
        padding: 20px;
        border: 1px solid var(--glean-border-soft);
        border-radius: 16px;
        background: var(--b3-theme-surface);
        box-shadow: none;
    }

    .glean-stats__activity h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
        line-height: 1.5;
    }

    .glean-stats__metric,
    .glean-stats__metric:hover {
        min-height: 120px;
        padding: 18px 20px;
        border: 1px solid var(--glean-border-soft);
        border-radius: 16px;
        background: var(--b3-theme-surface);
        box-shadow: none;
        transform: none;
        transition: none;
    }

    .glean-stats__metric dt {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.5;
    }

    .glean-stats__metric > dd:not(.glean-stats__metric-hint) {
        margin: 8px 0 0;
        color: var(--b3-theme-on-background);
        background: none;
        -webkit-text-fill-color: currentColor;
        font-size: 28px;
        font-weight: 680;
        line-height: 1.25;
        letter-spacing: 0;
    }

    .glean-stats__metric dd.glean-stats__metric-hint {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.6;
        opacity: 1;
    }

    .glean-stats__metrics {
        gap: 12px;
        margin: 0;
    }

    .glean-stats__analysis,
    .glean-stats__completed-detail {
        border-radius: 16px;
        background: var(--b3-theme-surface);
        box-shadow: none;
    }

    .glean-stats__analysis > summary,
    .glean-stats__completed-detail > summary,
    .glean-stats__detail > summary {
        min-height: 44px;
        font-size: 13px;
        font-weight: 550;
    }

    .glean-stats__completed-section {
        background: transparent;
        border: 0;
        box-shadow: none;
    }

    .glean-stats__toolbar .glean-btn {
        min-height: 36px;
        box-shadow: none;
        font-size: 13px;
    }

    .glean-stats__intro {
        align-items: flex-start;
    }

    .glean-stats__overview .glean-stats__toolbar--filters label {
        flex: 0 1 160px;
        min-width: 0;
        color: var(--b3-theme-on-surface);
        font-size: 12px;
        font-weight: 650;
        line-height: 1.35;
        white-space: normal;
        overflow-wrap: anywhere;
    }

    .glean-stats__overview .glean-stats__toolbar--filters {
        display: grid;
        flex: 0 1 320px;
        width: min(100%, 320px);
        min-width: 0;
        max-width: 100%;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 136px), 1fr));
        gap: var(--glean-space-2);
        align-items: start;
    }

    .glean-stats__overview .glean-stats__field {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        min-height: 36px;
        margin-top: 4px;
        padding: 7px 10px;
        border-radius: 10px;
        font-size: 13px;
        box-shadow: none;
    }

    .glean-stats__supplement {
        min-width: 0;
    }

    .glean-stats__scope {
        margin: calc(var(--glean-space-1) * -1) 0 0;
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
    }

    .glean-stats__scope > summary {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
    }

    .glean-stats__scope > summary:hover,
    .glean-stats__scope[open] > summary {
        color: var(--b3-theme-primary);
    }

    .glean-stats__scope > p {
        max-width: 88ch;
        margin: var(--glean-space-1) 0 0;
        line-height: 1.55;
    }

    .glean-stats__overview > .glean-stats__metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .glean-stats__overview > .glean-stats__metrics > .glean-stats__metric {
        background: var(--b3-theme-surface);
        border-color: var(--glean-border-soft);
    }

    .glean-stats__supplement > summary {
        display: flex;
        align-items: center;
        min-height: 40px;
        padding: 0 var(--glean-space-3);
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-sm);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        transition: color 160ms var(--glean-ease-out), border-color 160ms var(--glean-ease-out), background-color 160ms var(--glean-ease-out);
    }

    .glean-stats__supplement > summary:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 28%, var(--glean-border-soft));
        color: var(--b3-theme-primary);
    }

    .glean-stats__supplement > summary::before,
    .glean-stats__scope > summary::before {
        content: "›";
        display: inline-block;
        margin-right: var(--glean-space-2);
        font-size: 17px;
        line-height: 1;
        transform: rotate(0deg);
        transition: transform 160ms var(--glean-ease-out);
    }

    .glean-stats__supplement[open] > summary::before,
    .glean-stats__scope[open] > summary::before {
        transform: rotate(90deg);
    }

    .glean-stats__metrics--supplemental {
        margin-top: var(--glean-space-3);
    }

    .glean-stats__metrics--supplemental .glean-stats__metric,
    .glean-stats__metrics--supplemental .glean-stats__metric:nth-child(-n + 3) {
        min-height: 72px;
        padding: var(--glean-space-3);
        border-color: var(--glean-border-soft);
        background: var(--glean-section-surface);
        box-shadow: none;
    }

    .glean-stats__metrics--supplemental .glean-stats__metric dd {
        font-size: 19px;
    }

    .glean-stats__metrics--supplemental .glean-stats__metric > dd:not(.glean-stats__metric-hint) {
        font-size: 22px;
    }

    .glean-stats__period {
        margin: 0;
        align-self: flex-start;
        font-weight: 600;
    }

    .glean-stats__days summary,
    .glean-stats__site-authors summary {
        display: flex;
        align-items: center;
        min-height: 36px;
        border-radius: var(--glean-radius-sm);
        transition: color 160ms var(--glean-ease-out), background-color 160ms var(--glean-ease-out);
    }

    .glean-stats__days summary:hover,
    .glean-stats__site-authors summary:hover {
        background: var(--glean-inset-surface);
        color: var(--b3-theme-primary);
    }

    .glean-stats__table-scroll {
        scrollbar-gutter: stable;
        border: 1px solid var(--glean-border-soft);
        border-radius: var(--glean-radius-md);
        background: var(--glean-inset-surface);
    }

    .glean-stats table thead {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--glean-inset-surface);
    }

    .glean-stats th {
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        font-weight: 700;
    }

    .glean-stats td,
    .glean-stats th {
        border-bottom-color: var(--glean-border-soft);
    }

    .glean-stats__status:not(:empty) {
        display: inline-flex;
        align-items: center;
        gap: var(--glean-space-2);
        width: fit-content;
        max-width: 100%;
        color: var(--b3-theme-on-surface);
    }

    .glean-stats__status:not(:empty)::before {
        content: "";
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--b3-theme-primary);
    }

    .glean-stats__completed li {
        min-height: 34px;
        box-sizing: border-box;
    }

    .glean-stats__completed .glean-stats__link {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    @media (max-width: 560px) {
        .glean-stats__overview .glean-stats__toolbar--filters {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
        }

        .glean-stats__overview .glean-stats__field {
            width: 100%;
            min-width: 0;
            min-height: 44px;
        }

        .glean-stats__overview > .glean-stats__metrics {
            grid-template-columns: 1fr;
        }

        .glean-stats__overview .glean-stats__toolbar--filters label {
            flex: 1 1 0;
            white-space: normal;
        }

        .glean-stats__metrics--supplemental {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .glean-stats__metric,
        .glean-stats__metric:nth-child(n + 4) {
            min-width: 0;
            padding: var(--glean-space-3);
        }

        .glean-stats__metric dt {
            min-height: 2.7em;
            line-height: 1.35;
        }

        .glean-stats__metric > dd:not(.glean-stats__metric-hint) {
            font-size: 20px;
        }
    }

    @media (max-width: 640px) {
        .glean-stats__overview .glean-stats__toolbar--filters {
            flex: 0 1 auto;
            width: 100%;
        }

        .glean-stats__overview .glean-stats__toolbar--filters label {
            flex: 1 1 0;
            white-space: normal;
        }
    }

    @container glean-workbench (max-width: 640px) {
        .glean-stats__overview .glean-stats__toolbar--filters {
            flex: 0 1 auto;
            width: 100%;
        }

        .glean-stats__overview .glean-stats__toolbar--filters label {
            flex: 1 1 0;
            white-space: normal;
        }
    }

    @container glean-workbench (max-width: 560px) {
        .glean-stats {
            padding: 16px;
            gap: 16px;
        }

        .glean-stats__overview h2 {
            font-size: 24px;
        }

        .glean-stats__activity {
            padding: 16px;
        }

        .glean-stats__overview .glean-stats__toolbar--filters {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
        }

        .glean-stats__overview > .glean-stats__metrics {
            grid-template-columns: 1fr;
        }

        .glean-stats__overview .glean-stats__field {
            width: 100%;
            min-width: 0;
            min-height: 44px;
        }

        .glean-stats__metric,
        .glean-stats__metric:hover {
            min-height: 0;
            padding: 16px;
        }

        .glean-stats__metric > dd:not(.glean-stats__metric-hint) {
            font-size: 24px;
        }

        .glean-stats__toolbar .glean-btn {
            min-height: 44px;
        }
    }
</style>

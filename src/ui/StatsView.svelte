<script lang="ts">
// 宽屏布局契约集中在 src/index.scss：@container glean-workbench (min-width: 760px)
// 下 .glean-stats__metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }，
// .glean-stats__distributions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }，
// .glean-stats__distribution { min-width: 0; }。
import { onDestroy } from "svelte";
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import DistributionList from "./DistributionList.svelte";
import { t } from "../libs/i18n";
import type { GleanIndex } from "../services/index-store";
import { buildReadingReview, previewReadingReview, saveReadingReviewReport, type ReadingReviewSession } from "../services/stats-service";
import { parseReviewDate, reviewDateInput, type ReadingReviewLabels, type ReviewPeriodKind } from "../domain/stats";

interface Props {
    facade: GleanFacade;
    index: GleanIndex;
    onCaptured?: () => void;
}

let { facade, index, onCaptured }: Props = $props();

const i18n = $derived(facade.i18n);

let period = $state<ReviewPeriodKind>("week");
let referenceDate = $state(reviewDateInput());
let session = $state.raw<ReadingReviewSession | null>(null);
let saveState = $state<ReadingReviewSession["state"]>("ready");
let busy = $state(false);
let message = $state("");
let disposed = false;
const reference = $derived(parseReviewDate(referenceDate));
const liveReview = $derived(buildReadingReview(index, { period, reference: reference ?? new Date() }));
const review = $derived(session?.review ?? liveReview);
const stats = $derived(review.stats);
const maxHeat = $derived(Math.max(1, ...stats.heatmap.map((day) => day.count)));
const heatmapPadding = $derived((new Date(`${stats.heatmap[0].date}T12:00:00`).getDay() + 6) % 7);
const distributions = $derived([
    { key: "review.bySite", counts: stats.periodBySite },
    { key: "review.byAuthor", counts: stats.periodByAuthor },
    { key: "review.byUserTag", counts: stats.periodByUserTag },
    { key: "review.byAiTag", counts: stats.periodByAiTag },
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
    } catch (error) {
        if (!disposed) message = t(i18n, "review.previewFailed", { error: String(error).slice(0, 200) });
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
        message = resultMessage;
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
    <section class="glean-stats__overview">
        <div class="glean-stats__intro">
            <div>
                <h2>{t(i18n, "review.title")}</h2>
                <p class="glean-stats__hint">{t(i18n, "review.scope")}</p>
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
        <p class="glean-stats__period">{t(i18n, "review.period")}: {stats.period.label}</p>
        {#if review.snapshotAt}<p class="glean-stats__hint">{t(i18n, "review.snapshot")}: {review.snapshotAt}</p>{/if}
        {#if !reference}<p class="glean-stats__warning">{t(i18n, "review.invalidDate")}</p>{/if}
        <dl class="glean-stats__metrics">
            {#each [
                { key: "stats.total", count: stats.total },
                { key: "review.doneState", count: stats.done },
                { key: "review.archived", count: stats.archived },
                { key: "review.libraryWords", count: stats.totalWords },
                { key: "review.completed", count: stats.periodCompleted },
                { key: "review.captured", count: stats.periodCaptured },
                { key: "review.unknownDoneTime", count: stats.unknownDoneTime },
                { key: "review.archivedUnknown", count: stats.archivedWithoutCompletion },
            ] as metric (metric.key)}
                <div class="glean-stats__metric"><dt>{t(i18n, metric.key)}</dt><dd>{metric.count}</dd></div>
            {/each}
        </dl>
        <p class="glean-stats__candidates">{t(i18n, "review.candidates")}: {review.candidateCount}</p>
    </section>
    <section class="glean-stats__activity">
        <h3>{t(i18n, "review.heatmap", { year: reference?.getFullYear() ?? new Date().getFullYear() })}</h3>
        <div class="glean-stats__heatmap-scroll" role="img" aria-label={t(i18n, "review.heatmap", { year: reference?.getFullYear() ?? new Date().getFullYear() })}>
            <div class="glean-stats__heatmap">
                {#each Array.from({ length: heatmapPadding }, (_, index) => index) as padding (padding)}<span></span>{/each}
                {#each stats.heatmap as day (day.date)}
                    <span class="glean-stats__day" title={`${day.date}: ${day.count}`} style={`background:${day.count ? "var(--b3-theme-primary)" : "var(--b3-theme-surface)"};opacity:${day.count ? 0.25 + 0.75 * day.count / maxHeat : 1}`}></span>
                {/each}
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
    </section>
    <section class="glean-stats__breakdown">
      <div class="glean-stats__distributions">
        {#each distributions as distribution (distribution.key)}
            <section class="glean-stats__distribution">
            <h3>{t(i18n, distribution.key)}</h3>
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
    <section class="glean-stats__completed-section">
        <h3>{t(i18n, "review.completedList")}</h3>
        <ul class="glean-stats__completed">
            {#each review.completedItems as item (item.id)}
                <li>
                    <button class="glean-stats__link" onclick={() => facade.openReadingDocument(item.id)}>{item.title || t(i18n, "review.untitled")}</button>
                    <span>{item.doneTime.slice(0, 4)}-{item.doneTime.slice(4, 6)}-{item.doneTime.slice(6, 8)}</span>
                </li>
            {:else}<li class="glean-stats__completed-empty">{t(i18n, "review.noCompleted")}</li>{/each}
        </ul>
    </section>
    <p class="glean-stats__status" role="status" aria-live="polite">{busy ? t(i18n, "panel.loading") : message}</p>
    <div class="glean-stats__toolbar">
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
        {/if}
    </div>
    {#if session}
        <label class="glean-stats__preview">
            {t(i18n, "review.preview")}
            <textarea class="glean-stats__field" readonly value={session.markdown} spellcheck="false"></textarea>
        </label>
    {/if}
</div>

<style>
    .glean-stats__overview .glean-stats__toolbar--filters label {
        color: var(--b3-theme-on-surface);
        font-size: var(--glean-text-xs);
        font-weight: 650;
        line-height: 1.35;
    }

    .glean-stats__overview .glean-stats__field {
        min-width: 136px;
        margin-top: 3px;
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
        .glean-stats__overview .glean-stats__field {
            width: 100%;
            min-width: 0;
            min-height: 44px;
        }

        .glean-stats__metrics {
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

        .glean-stats__metric dd {
            font-size: 20px;
        }
    }
</style>

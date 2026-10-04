/**
 * 统计服务（T-1201）：索引 → 统计聚合 + 周报导出。
 * 聚合逻辑在 domain/stats.ts（纯函数）；这里只做取数与落盘。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd, newNodeId } from "../api/client";
import {
    aggregateStats, aggregateReadingReview, buildReadingReviewCsv, buildReadingReviewMarkdown, completedReviewItems,
    DEFAULT_REVIEW_LABELS, type ReadingReview, type ReadingReviewLabels, type ReviewPeriodKind, type StatsInput,
} from "../domain/stats";
import type { GleanIndex } from "./index-store";
import { readClipDocument, reconcileIndex, writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

function statsItems(index: GleanIndex): StatsInput[] {
    return Object.values(index.clips).filter((clip) => !clip.internal).map((clip) => ({
        id: clip.id,
        title: clip.title,
        site: clip.site,
        author: clip.author,
        status: clip.status,
        words: clip.words,
        minutes: clip.minutes,
        rating: clip.rating,
        time: clip.time,
        doneTime: clip.doneTime,
        tags: [...(clip.tags ?? [])],
        aiTags: [...(clip.aiTags ?? [])],
        updated: clip.updated,
    }));
}

export function buildStats(index: GleanIndex, now: Date = new Date()) {
    return aggregateStats(statsItems(index), now);
}

export interface ReviewOptions {
    period?: ReviewPeriodKind;
    reference?: Date;
    now?: Date;
    labels?: Partial<ReadingReviewLabels>;
}

export interface ReadingReviewSession {
    review: ReadingReview;
    markdown: string;
    csv: string;
    notebookId: string;
    path: string;
    state: "ready" | "created" | "saved" | "unknown";
    createdDocId: string;
    busy: boolean;
}

export type ReviewSaveReason = "confirmationRequired" | "notebookMissing" | "createUnknown" | "markFailed" | "readFailed" | "busy";

export interface ReviewSaveResult {
    ok: boolean;
    docId?: string;
    reason?: ReviewSaveReason;
}

export function buildReadingReview(index: GleanIndex, options: ReviewOptions = {}): ReadingReview {
    const now = options.now ?? new Date();
    const items = statsItems(index);
    const stats = aggregateReadingReview(items, now, options.period ?? "week", options.reference ?? now);
    return {
        stats,
        completedItems: completedReviewItems(items, stats.period, now),
        candidateCount: Object.keys(index.candidates).filter((id) => !index.clips[id]).length,
        snapshotAt: index.updatedAt,
    };
}

export const buildReview = buildReadingReview;

export async function previewReadingReview(plugin: Plugin, settings: GleanSettings, options: ReviewOptions = {}): Promise<ReadingReviewSession> {
    const index = await reconcileIndex(plugin, settings);
    const now = options.now ?? new Date();
    const review = buildReadingReview(index, { ...options, now });
    const labels = { ...DEFAULT_REVIEW_LABELS, ...options.labels };
    const period = review.stats.period;
    return {
        review,
        markdown: buildReadingReviewMarkdown(review, labels),
        csv: buildReadingReviewCsv(review, labels),
        notebookId: settings.anchorNotebooks[0] ?? "",
        path: `/读库周报/${period.kind}-${period.start}-${period.end} ${newNodeId(now)}`,
        state: "ready",
        createdDocId: "",
        busy: false,
    };
}

export async function saveReadingReviewReport(plugin: Plugin, session: ReadingReviewSession, confirmed = false): Promise<ReviewSaveResult> {
    if (session.busy) return { ok: false, reason: "busy" };
    if (session.state === "saved") return { ok: true, docId: session.createdDocId };
    if (session.state === "unknown") return { ok: false, reason: "createUnknown" };
    if (!confirmed) return { ok: false, reason: "confirmationRequired" };
    if (!session.notebookId) return { ok: false, reason: "notebookMissing" };
    session.busy = true;
    try {
        if (!session.createdDocId) {
            try {
                const docId = await createDocWithMd(session.notebookId, session.path, session.markdown);
                if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("Invalid created document ID");
                session.createdDocId = docId;
                session.state = "created";
            } catch {
                session.state = "unknown";
                return { ok: false, reason: "createUnknown" };
            }
        }
        let internal: boolean | undefined;
        try {
            const document = await readClipDocument(session.createdDocId, { yfm: false, addTitle: false, refMode: 2 });
            if (document.meta.box !== session.notebookId || document.meta.hpath !== session.path || document.attrs.status) throw new Error("Report document changed");
            internal = document.attrs.internal;
        } catch {
            return { ok: false, docId: session.createdDocId, reason: "readFailed" };
        }
        try {
            await writeClip(plugin, session.createdDocId, internal ? {} : { internal: true });
            session.state = "saved";
            return { ok: true, docId: session.createdDocId };
        } catch {
            return { ok: false, docId: session.createdDocId, reason: "markFailed" };
        }
    } finally {
        session.busy = false;
    }
}

export async function exportWeeklyReport(_index: GleanIndex, _settings: GleanSettings, plugin: Plugin, session?: ReadingReviewSession): Promise<string> {
    if (!session || session.review.stats.period.kind !== "week") throw new Error("Preview the weekly report before confirming creation");
    const result = await saveReadingReviewReport(plugin, session, true);
    if (!result.ok) throw new Error(`Reading review: ${result.reason}${result.docId ? ` (${result.docId})` : ""}`);
    return result.docId!;
}


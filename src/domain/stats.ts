/**
 * 阅读统计纯函数（T-1201）：从索引投影聚合统计 + 阅读回顾（review）口径生成。
 * 旧的 weeklyReport 直出 markdown 已由 buildReadingReviewMarkdown 取代并移除。
 * 输入是轻量索引条目切片，输出是可渲染/可导出的聚合结构；全部可单测。
 */
import { CLIP_STATUSES, siyuanDate, siyuanTimestamp } from "./schema.ts";
import { normalizeAuthor } from "./author.ts";

export interface StatsInput {
    id: string;
    title: string;
    site: string;
    author?: string;
    internal?: boolean;
    status: string;
    words: number;
    minutes: number;
    rating: number;
    time: string;
    /** 最近一次显式完成时刻；空串 = 完成时间未知（D-0028）。 */
    doneTime: string;
    tags?: string[];
    aiTags: string[];
    updated: string;
}

export interface NameCount {
    name: string;
    count: number;
}

export interface ReadingStats {
    total: number;
    done: number;
    reading: number;
    inbox: number;
    totalWords: number;
    /** 最近 7 天每天新增收录数（旧→新，最后一位是今天） */
    dailyCaptured: number[];
    bySite: NameCount[];
    byTag: NameCount[];
    doneThisWeek: number;
}

const DAY_MS = 86_400_000;

export function aggregateStats(items: StatsInput[], now: Date = new Date()): ReadingStats {
    const dailyCaptured = new Array(7).fill(0) as number[];
    let done = 0;
    let reading = 0;
    let inbox = 0;
    let totalWords = 0;
    let doneThisWeek = 0;
    const siteCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const todayOrdinal = calendarOrdinal(siyuanDate(now));

    for (const item of items) {
        if (item.status === "done") done += 1;
        else if (item.status === "reading") reading += 1;
        else if (item.status === "inbox") inbox += 1;
        totalWords += Number.isFinite(item.words) && item.words > 0 ? item.words : 0;

        if (trustedTimestamp(item.time, now)) {
            const daysAgo = todayOrdinal - calendarOrdinal(item.time.slice(0, 8));
            if (daysAgo >= 0 && daysAgo < 7) dailyCaptured[6 - daysAgo] += 1;
        }
        // 本周完成只按可信完成时间（D-0028）；无 done-time 的已读是"完成时间未知"，
        // 不用 updated 伪造，只计入上面的状态总数。
        if (item.status === "done" && trustedTimestamp(item.doneTime, now) && withinWeek(item.doneTime, todayNoon)) doneThisWeek += 1;

        const site = (item.site || "").trim().toLocaleLowerCase();
        if (site) siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
        // 与 reviewNameCounts 同口径：同一篇文章的重复标签只计一次
        for (const tag of new Set((item.aiTags ?? []).map((value) => value.trim()).filter(Boolean))) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
    }

    return {
        total: items.length,
        done,
        reading,
        inbox,
        totalWords,
        dailyCaptured,
        bySite: topNameCounts(siteCounts, 6),
        byTag: topNameCounts(tagCounts, 10),
        doneThisWeek,
    };
}

function topNameCounts(map: Map<string, number>, limit: number): NameCount[] {
    return [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

/** 完成时间戳（YYYYMMDDHHmmss）是否落在以 todayNoon 结尾的 7 天窗口内。 */
export function withinWeek(stamp: string, todayNoon: number): boolean {
    const reference = new Date(todayNoon);
    if (!Number.isFinite(reference.getTime()) || !parseLocalTimestamp(stamp)) return false;
    const daysAgo = calendarOrdinal(siyuanDate(reference)) - calendarOrdinal(stamp.slice(0, 8));
    return daysAgo >= 0 && daysAgo < 7;
}

export function nowStamp(now: Date = new Date()): string {
    return siyuanTimestamp(now);
}


export type ReviewPeriodKind = "week" | "month" | "year";

export interface ReviewPeriod {
    kind: ReviewPeriodKind;
    start: string;
    end: string;
    endExclusive: string;
    label: string;
}

export interface CompletionDay {
    date: string;
    count: number;
}

export interface ReviewStats extends ReadingStats {
    archived: number;
    later: number;
    completed: number;
    unknownDoneTime: number;
    archivedWithoutCompletion: number;
    period: ReviewPeriod;
    periodCompleted: number;
    periodCaptured: number;
    periodBySite: NameCount[];
    periodByAuthor: NameCount[];
    periodAuthorUnknown: number;
    periodSiteAuthors: SiteAuthorCount[];
    periodByUserTag: NameCount[];
    periodByAiTag: NameCount[];
    heatmap: CompletionDay[];
    /** 最近 30 个本地日历日，包含没有完成记录的日期，供趋势卡直接展示。 */
    recentCompletionTrend: CompletionDay[];
}

export interface ReadingReview {
    stats: ReviewStats;
    completedItems: StatsInput[];
    candidateCount: number;
    snapshotAt: string;
}

export interface SiteAuthorCount {
    site: string;
    count: number;
    authors: NameCount[];
    unknownAuthorCount: number;
}

export interface ReadingReviewLabels {
    title: string;
    scope: string;
    snapshot: string;
    period: string;
    total: string;
    done: string;
    archived: string;
    reading: string;
    words: string;
    completed: string;
    captured: string;
    unknownDoneTime: string;
    archivedWithoutCompletion: string;
    candidates: string;
    bySite: string;
    byAuthor: string;
    authorUnknown: string;
    byUserTag: string;
    byAiTag: string;
    completedList: string;
    noCompleted: string;
    untitled: string;
}

export const DEFAULT_REVIEW_LABELS: ReadingReviewLabels = {
    title: "阅读回顾",
    scope: "按本地日历统计最近一次可信完成时间；归档、恢复或重读保留完成事实，不代表完整重读历史。完成时间缺失、无效或在未来时不按更新时间推算。收录时间可能来自原服务或文档创建时间，并非插件新增操作次数。库内状态、字数和候选是当前索引快照；站点、用户标签和 AI 标签按所选期间完成文章的当前元数据分别统计，每篇每标签只计一次。候选不进入读库总量或完成数。",
    snapshot: "索引快照",
    period: "统计期间",
    total: "库内文章",
    done: "当前已读状态",
    archived: "当前归档状态",
    reading: "阅读中",
    words: "库内累计字数",
    completed: "期间完成",
    captured: "期间收录时间落入数",
    unknownDoneTime: "已读完成时间未知",
    archivedWithoutCompletion: "归档但无可信完成记录",
    candidates: "待确认候选快照（独立）",
    bySite: "期间完成 · 站点",
    byAuthor: "期间完成 · 作者",
    authorUnknown: "未记录作者",
    byUserTag: "期间完成 · 用户标签",
    byAiTag: "期间完成 · AI 标签",
    completedList: "期间完成文章",
    noCompleted: "此期间没有可信完成记录",
    untitled: "无标题",
};

const VALID_REVIEW_STATUSES = new Set<string>(CLIP_STATUSES);

function calendarDate(year: number, monthIndex: number, day: number): Date {
    const date = new Date(0);
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCFullYear(year, monthIndex, day);
    return date;
}

function calendarKey(date: Date): string {
    return `${String(date.getUTCFullYear()).padStart(4, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function calendarOrdinal(key: string): number {
    return Math.floor(calendarDate(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))).getTime() / DAY_MS);
}

export function parseLocalTimestamp(stamp: string): Date | null {
    if (typeof stamp !== "string" || !/^\d{14}$/.test(stamp)) return null;
    const year = Number(stamp.slice(0, 4));
    const monthIndex = Number(stamp.slice(4, 6)) - 1;
    const day = Number(stamp.slice(6, 8));
    const hours = Number(stamp.slice(8, 10));
    const minutes = Number(stamp.slice(10, 12));
    const seconds = Number(stamp.slice(12, 14));
    if (year < 1 || monthIndex < 0 || monthIndex > 11 || day < 1 || hours > 23 || minutes > 59 || seconds > 59) return null;
    const calendar = calendarDate(year, monthIndex, day);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== monthIndex || calendar.getUTCDate() !== day) return null;
    const date = new Date(0);
    date.setHours(12, 0, 0, 0);
    date.setFullYear(year, monthIndex, day);
    date.setHours(hours, minutes, seconds, 0);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes || date.getSeconds() !== seconds) return null;
    return date;
}

export function parseReviewDate(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    if (Number(value.slice(0, 4)) > 9998) return null;
    return parseLocalTimestamp(value.replace(/-/g, "") + "120000");
}

export function displayReviewDate(key: string): string {
    return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

export function reviewDateInput(now: Date = new Date()): string {
    return displayReviewDate(siyuanDate(now));
}

export function reviewPeriod(kind: ReviewPeriodKind = "week", reference: Date = new Date()): ReviewPeriod {
    if (!Number.isFinite(reference.getTime()) || reference.getFullYear() < 1 || reference.getFullYear() > 9998) throw new Error("Invalid review date");
    const start = calendarDate(reference.getFullYear(), reference.getMonth(), reference.getDate());
    if (kind === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    else if (kind === "month") start.setUTCDate(1);
    else if (kind === "year") start.setUTCMonth(0, 1);
    else throw new Error("Invalid review period");
    const endExclusive = new Date(start);
    if (kind === "week") endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
    else if (kind === "month") endExclusive.setUTCMonth(endExclusive.getUTCMonth() + 1);
    else endExclusive.setUTCFullYear(endExclusive.getUTCFullYear() + 1);
    const end = new Date(endExclusive);
    end.setUTCDate(end.getUTCDate() - 1);
    const startKey = calendarKey(start);
    const endKey = calendarKey(end);
    return { kind, start: startKey, end: endKey, endExclusive: calendarKey(endExclusive), label: `${displayReviewDate(startKey)} – ${displayReviewDate(endKey)}` };
}

function trustedTimestamp(stamp: string, now: Date): boolean {
    const parsed = parseLocalTimestamp(stamp);
    return parsed !== null && parsed.getTime() <= now.getTime();
}

function withinPeriod(stamp: string, period: ReviewPeriod): boolean {
    const key = stamp.slice(0, 8);
    return key >= period.start && key < period.endExclusive;
}

function reviewNameCounts(items: StatsInput[], select: (item: StatsInput) => string[]): NameCount[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        const names = new Set(select(item).map((name) => name.trim()).filter(Boolean));
        for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
}

export function completedReviewItems(items: StatsInput[], period: ReviewPeriod, now: Date = new Date()): StatsInput[] {
    return items.filter((item) => !item.internal && VALID_REVIEW_STATUSES.has(item.status) && trustedTimestamp(item.doneTime, now) && withinPeriod(item.doneTime, period))
        .sort((first, second) => second.doneTime.localeCompare(first.doneTime) || first.id.localeCompare(second.id));
}

function reviewAuthorCounts(items: StatsInput[]): NameCount[] {
    const counts = new Map<string, NameCount>();
    for (const item of items) {
        const name = normalizeAuthor(item.author);
        if (!name) continue;
        const key = name.toLocaleLowerCase();
        const previous = counts.get(key);
        if (previous) {
            previous.count += 1;
            if (name < previous.name) previous.name = name;
        }
        else counts.set(key, { name, count: 1 });
    }
    return [...counts.values()].sort((first, second) => second.count - first.count || (first.name < second.name ? -1 : first.name > second.name ? 1 : 0));
}

function siteAuthorCounts(items: StatsInput[]): SiteAuthorCount[] {
    const sites = new Map<string, StatsInput[]>();
    for (const item of items) {
        const site = item.site.trim().toLocaleLowerCase();
        if (!site) continue;
        const current = sites.get(site) ?? [];
        current.push(item);
        sites.set(site, current);
    }
    return [...sites.entries()].map(([site, entries]) => {
        const authors = reviewAuthorCounts(entries);
        return { site, count: entries.length, authors, unknownAuthorCount: entries.length - authors.reduce((total, author) => total + author.count, 0) };
    }).sort((first, second) => second.count - first.count || (first.site < second.site ? -1 : first.site > second.site ? 1 : 0));
}

export function aggregateReadingReview(items: StatsInput[], now: Date = new Date(), kind: ReviewPeriodKind = "week", reference: Date = now): ReviewStats {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid snapshot date");
    const confirmed = items.filter((item) => !item.internal && VALID_REVIEW_STATUSES.has(item.status));
    const period = reviewPeriod(kind, reference);
    const periodItems = completedReviewItems(confirmed, period, now);
    const authors = reviewAuthorCounts(periodItems);
    const completions = confirmed.filter((item) => trustedTimestamp(item.doneTime, now));
    const referenceKey = calendarKey(calendarDate(reference.getFullYear(), reference.getMonth(), reference.getDate()));
    const completionCounts = new Map<string, number>();
    for (const item of completions) {
        const key = item.doneTime.slice(0, 8);
        if (key > referenceKey) continue;
        completionCounts.set(key, (completionCounts.get(key) ?? 0) + 1);
    }
    const heatmap: CompletionDay[] = [];
    const heatmapDate = calendarDate(reference.getFullYear(), 0, 1);
    while (heatmapDate.getUTCFullYear() === reference.getFullYear()) {
        const key = calendarKey(heatmapDate);
        heatmap.push({ date: displayReviewDate(key), count: completionCounts.get(key) ?? 0 });
        heatmapDate.setUTCDate(heatmapDate.getUTCDate() + 1);
    }
    const recentCompletionTrend: CompletionDay[] = [];
    const recentDate = calendarDate(reference.getFullYear(), reference.getMonth(), reference.getDate());
    recentDate.setUTCDate(recentDate.getUTCDate() - 29);
    if (recentDate.getUTCFullYear() < 1) recentDate.setUTCFullYear(1, 0, 1);
    while (recentDate <= calendarDate(reference.getFullYear(), reference.getMonth(), reference.getDate()) && recentCompletionTrend.length < 30) {
        const key = calendarKey(recentDate);
        recentCompletionTrend.push({ date: displayReviewDate(key), count: completionCounts.get(key) ?? 0 });
        recentDate.setUTCDate(recentDate.getUTCDate() + 1);
    }
    return {
        ...aggregateStats(confirmed, now),
        totalWords: confirmed.reduce((total, item) => total + (Number.isFinite(item.words) && item.words > 0 ? item.words : 0), 0),
        archived: confirmed.filter((item) => item.status === "archived").length,
        later: confirmed.filter((item) => item.status === "later").length,
        completed: completions.length,
        unknownDoneTime: confirmed.filter((item) => item.status === "done" && !trustedTimestamp(item.doneTime, now)).length,
        archivedWithoutCompletion: confirmed.filter((item) => item.status === "archived" && !trustedTimestamp(item.doneTime, now)).length,
        period,
        periodCompleted: periodItems.length,
        periodCaptured: confirmed.filter((item) => trustedTimestamp(item.time, now) && withinPeriod(item.time, period)).length,
        periodBySite: reviewNameCounts(periodItems, (item) => [String(item.site ?? "").toLowerCase()]),
        periodByAuthor: authors,
        periodAuthorUnknown: periodItems.length - authors.reduce((total, author) => total + author.count, 0),
        periodSiteAuthors: siteAuthorCounts(periodItems),
        periodByUserTag: reviewNameCounts(periodItems, (item) => item.tags ?? []),
        periodByAiTag: reviewNameCounts(periodItems, (item) => item.aiTags ?? []),
        heatmap,
        recentCompletionTrend,
    };
}

function escapeReviewMarkdown(value: string): string {
    return String(value).replace(/[\r\n\u0000-\u001f]/g, " ").replace(/[\\`*_{}\[\]()#+.!<>|]/g, "\\$&");
}

export function buildReadingReviewMarkdown(review: ReadingReview, labels: ReadingReviewLabels = DEFAULT_REVIEW_LABELS): string {
    const { stats } = review;
    const lines = [
        `# ${escapeReviewMarkdown(labels.title)} · ${stats.period.label}`, "",
        `> ${escapeReviewMarkdown(labels.scope)}`, "",
        `${escapeReviewMarkdown(labels.snapshot)}: ${review.snapshotAt.replace(/[\r\n\u0000-\u001f]/g, " ")}`,
        `${escapeReviewMarkdown(labels.period)}: ${stats.period.kind} · ${stats.period.label}`, "",
    ];
    for (const [label, count] of [
        [labels.total, stats.total], [labels.done, stats.done], [labels.archived, stats.archived], [labels.reading, stats.reading],
        [labels.words, stats.totalWords], [labels.completed, stats.periodCompleted], [labels.captured, stats.periodCaptured],
        [labels.unknownDoneTime, stats.unknownDoneTime], [labels.archivedWithoutCompletion, stats.archivedWithoutCompletion],
    ] as const) lines.push(`- ${escapeReviewMarkdown(label)}: **${count}**`);
    lines.push("", `## ${escapeReviewMarkdown(labels.completedList)}`, "");
    if (review.completedItems.length === 0) lines.push(escapeReviewMarkdown(labels.noCompleted));
    for (const item of review.completedItems) {
        const title = escapeReviewMarkdown(item.title || labels.untitled);
        const link = /^\d{14}-[0-9a-z]{7}$/.test(item.id) ? `[${title}](siyuan://blocks/${item.id})` : title;
        lines.push(`- ${displayReviewDate(item.doneTime.slice(0, 8))} · ${link}${item.site ? ` · ${escapeReviewMarkdown(item.site)}` : ""}${item.author ? ` · ${escapeReviewMarkdown(item.author)}` : ""}${item.rating > 0 ? ` · ⭐${item.rating}` : ""}`);
    }
    for (const [label, counts] of [[labels.bySite, stats.periodBySite], [labels.byAuthor, stats.periodByAuthor], [labels.byUserTag, stats.periodByUserTag], [labels.byAiTag, stats.periodByAiTag]] as const) {
        lines.push("", `## ${escapeReviewMarkdown(label)}`, "");
        for (const { name, count } of counts) {
            lines.push(`- ${escapeReviewMarkdown(name)} × ${count}`);
            if (counts === stats.periodBySite) {
                const detail = stats.periodSiteAuthors.find((site) => site.site === name);
                for (const author of detail?.authors ?? []) lines.push(`  - ${escapeReviewMarkdown(author.name)} × ${author.count}`);
                if (detail?.unknownAuthorCount) lines.push(`  - ${escapeReviewMarkdown(labels.authorUnknown)} × ${detail.unknownAuthorCount}`);
            }
        }
        if (counts === stats.periodByAuthor) lines.push(`- ${escapeReviewMarkdown(labels.authorUnknown)} × ${stats.periodAuthorUnknown}`);
    }
    lines.push("", `## ${escapeReviewMarkdown(labels.candidates)}`, "", String(review.candidateCount), "");
    return lines.join("\n");
}

export function csvCell(value: string | number): string {
    const text = String(value);
    const safe = /^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
}

export function buildReadingReviewCsv(review: ReadingReview, labels: ReadingReviewLabels = DEFAULT_REVIEW_LABELS): string {
    const { stats } = review;
    const rows: Array<Array<string | number>> = [
        ["section", "key", "count", "id", "title", "site", "status", "done_time", "capture_time", "user_tags", "ai_tags", "words", "author"],
        ["metadata", "scope", "", "", labels.scope],
        ["metadata", "snapshot_at", "", "", review.snapshotAt],
        ["metadata", "period", "", "", `${stats.period.kind}: ${stats.period.label}`],
    ];
    for (const [key, count] of [
        ["library_total", stats.total], ["status_done", stats.done], ["status_archived", stats.archived], ["status_reading", stats.reading],
        ["library_words", stats.totalWords], ["period_completed", stats.periodCompleted], ["period_captured", stats.periodCaptured],
        ["done_time_unknown", stats.unknownDoneTime], ["archived_without_completion", stats.archivedWithoutCompletion],
    ] as const) rows.push(["summary", key, count]);
    for (const item of review.completedItems) rows.push(["completed", "", 1, item.id, item.title, item.site, item.status, item.doneTime, item.time, JSON.stringify(item.tags ?? []), JSON.stringify(item.aiTags ?? []), item.words, item.author ?? ""]);
    for (const [section, counts] of [["site", stats.periodBySite], ["author", stats.periodByAuthor], ["user-tag", stats.periodByUserTag], ["ai-tag", stats.periodByAiTag]] as const) {
        for (const { name, count } of counts) rows.push([section, name, count]);
    }
    rows.push(["author-unknown", "", stats.periodAuthorUnknown]);
    for (const site of stats.periodSiteAuthors) {
        for (const author of site.authors) rows.push(["site-author", site.site, author.count, "", "", "", "", "", "", "", "", "", author.name]);
        rows.push(["site-author-unknown", site.site, site.unknownAuthorCount]);
    }
    for (const day of stats.heatmap) rows.push(["heatmap", day.date, day.count]);
    rows.push(["candidate-snapshot", "unconfirmed", review.candidateCount]);
    return rows.map((row) => Array.from({ length: 13 }, (_, index) => csvCell(row[index] ?? "")).join(",")).join("\r\n");
}

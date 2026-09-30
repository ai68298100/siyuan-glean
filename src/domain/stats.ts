/**
 * 阅读统计纯函数（T-1201）：从索引投影聚合统计 + 周报 markdown 生成。
 * 输入是轻量索引条目切片，输出是可渲染/可导出的聚合结构；全部可单测。
 */
import { siyuanDate, siyuanTimestamp } from "./schema.ts";

export interface StatsInput {
    id: string;
    title: string;
    site: string;
    status: string;
    words: number;
    minutes: number;
    rating: number;
    time: string;
    /** 最近一次显式完成时刻；空串 = 完成时间未知（D-0028）。 */
    doneTime: string;
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
    // 与条目桶的 12:00 对齐，避免时段差把"今天"算成 -1 天
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();

    for (const item of items) {
        if (item.status === "done") done += 1;
        else if (item.status === "reading") reading += 1;
        else if (item.status === "inbox") inbox += 1;
        totalWords += item.words || 0;

        // 入库时间（clip-time）距今天的天数 → 桶
        if (/^\d{14}$/.test(item.time)) {
            const t = new Date(
                Number(item.time.slice(0, 4)),
                Number(item.time.slice(4, 6)) - 1,
                Number(item.time.slice(6, 8)),
                12
            ).getTime();
            const daysAgo = Math.round((todayNoon - t) / DAY_MS);
            if (daysAgo >= 0 && daysAgo < 7) dailyCaptured[6 - daysAgo] += 1;
        }
        // 本周完成只按可信完成时间（D-0028）；完成事实由 doneTime 表达，
        // 与当前状态解耦（T-1885）：读完后又归档的文章不丢本周完成记录。
        // 无 done-time 的已读是"完成时间未知"，不用 updated 伪造，只计入状态总数。
        if (withinWeek(item.doneTime, todayNoon)) doneThisWeek += 1;

        const site = (item.site || "").trim().toLowerCase();
        if (site) siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
        for (const tag of item.aiTags ?? []) {
            const key = tag.trim();
            if (key) tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
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
    if (!/^\d{14}$/.test(stamp)) return false;
    const t = new Date(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8)),
        12
    ).getTime();
    return Number.isFinite(t) && todayNoon - t >= 0 && todayNoon - t < 7 * DAY_MS;
}

/* ---------- 周报 ---------- */

export interface WeeklyReportInput {
    stats: ReadingStats;
    doneItems: StatsInput[];
    rangeLabel: string;
    author?: string;
}

/** 生成 Markdown 周报（供 createDocWithMd 导出）。 */
export function buildWeeklyReportMarkdown(input: WeeklyReportInput, now: Date = new Date()): string {
    const { stats, doneItems, rangeLabel } = input;
    const lines: string[] = [];
    lines.push(`# 阅读周报 · ${rangeLabel}`);
    lines.push("");
    lines.push(`> 由小驴拾遗生成于 ${formatDate(now)} —— 把吃灰的收藏捡回来喂给自己`);
    lines.push("");
    lines.push("## 概览");
    lines.push("");
    lines.push(`- 库内文章 **${stats.total}** 篇，已读 **${stats.done}** 篇，阅读中 **${stats.reading}** 篇`);
    lines.push(`- 累计字数 **${formatWords(stats.totalWords)}** 字`);
    lines.push(`- 本周完成 **${stats.doneThisWeek}** 篇，新增收录 **${stats.dailyCaptured.reduce((a, b) => a + b, 0)}** 篇`);
    lines.push("");
    if (doneItems.length > 0) {
        lines.push("## 本周读完");
        lines.push("");
        for (const item of doneItems.slice(0, 12)) {
            const site = item.site ? `（${item.site}）` : "";
            const rating = item.rating > 0 ? ` ⭐${item.rating}` : "";
            lines.push(`- [${item.title || "无标题"}](siyuan://blocks/${item.id})${site}${rating}`);
        }
        lines.push("");
    }
    if (stats.bySite.length > 0) {
        lines.push("## 站点分布");
        lines.push("");
        for (const { name, count } of stats.bySite) {
            lines.push(`- ${name} × ${count}`);
        }
        lines.push("");
    }
    if (stats.byTag.length > 0) {
        lines.push("## 标签分布");
        lines.push("");
        for (const { name, count } of stats.byTag) {
            lines.push(`- ${name} × ${count}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

/** 周报文档标题：读库周报/YYYYMMDD-YYYYMMDD */
export function weeklyReportDocPath(now: Date = new Date()): { title: string; rangeLabel: string } {
    const end = siyuanDate(now);
    const start = siyuanDate(new Date(now.getTime() - 6 * DAY_MS));
    return { title: `${start}-${end}`, rangeLabel: `${start.slice(4, 6)}.${start.slice(6, 8)} – ${end.slice(4, 6)}.${end.slice(6, 8)}` };
}

export function nowStamp(now: Date = new Date()): string {
    return siyuanTimestamp(now);
}

function formatDate(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatWords(words: number): string {
    if (words >= 10_000) return `${(words / 10_000).toFixed(1)} 万`;
    return String(words);
}

/* ---------- 阅读热力图（T-1770） ---------- */

export interface HeatmapCell {
    /** 本地日期 YYYYMMDD */
    date: string;
    /** 当日显式完成篇数（D-0028：只认 doneTime） */
    count: number;
}

export interface HeatmapGrid {
    /** 旧→新、按列（周）排列的格子；当前周截断到今天 */
    cells: HeatmapCell[];
    /** 网格内最大单日完成数（分档用；全 0 时为 0） */
    maxCount: number;
    /** 有完成记录的天数 */
    activeDays: number;
    /** 网格覆盖的完成总数 */
    totalDone: number;
}

/**
 * 按可信完成时间生成热力图网格（列=周、行=周一..周日）。
 * 只统计 14 位时间戳的 doneTime；未来的格子（当前周 tail）不出现在结果里。
 */
export function readingHeatmap(doneTimes: string[], weeks: number, now: Date = new Date()): HeatmapGrid {
    const counts = new Map<string, number>();
    for (const stamp of doneTimes) {
        if (!/^\d{14}$/.test(stamp)) continue;
        const key = stamp.slice(0, 8);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    // 列从周一开始（GitHub 风格）；当前列只画到今天，避免出现"未来"的空格子
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() - mondayOffset);
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - (Math.max(1, weeks) - 1) * 7);

    const cells: HeatmapCell[] = [];
    let maxCount = 0;
    let activeDays = 0;
    let totalDone = 0;
    for (const day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
        const key = siyuanDate(day);
        const count = counts.get(key) ?? 0;
        cells.push({ date: key, count });
        if (count > maxCount) maxCount = count;
        if (count > 0) {
            activeDays += 1;
            totalDone += count;
        }
    }
    return { cells, maxCount, activeDays, totalDone };
}

/* ---------- 月度回顾（T-1771） ---------- */

export interface MonthlyReview {
    /** 本月标签 YYYYMM */
    monthKey: string;
    /** 完成篇数（只认 doneTime 在本月，D-0028） */
    doneCount: number;
    /** 完成条目累计字数 */
    doneWords: number;
    topSites: NameCount[];
    topTags: NameCount[];
    /** 本月完成清单（旧→新），供回顾文档列条目 */
    doneItems: StatsInput[];
}

export function monthKeyOf(now: Date): string {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 本月回顾聚合：完成篇数/字数/站点与标签分布，只统计可信完成时间在本月的条目。 */
export function monthlyReview(items: StatsInput[], now: Date = new Date()): MonthlyReview {
    const key = monthKeyOf(now);
    const siteCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const doneItems: StatsInput[] = [];
    let doneWords = 0;
    for (const item of items) {
        if (!/^\d{14}$/.test(item.doneTime) || item.doneTime.slice(0, 6) !== key) continue;
        doneItems.push(item);
        doneWords += item.words || 0;
        const site = (item.site || "").trim().toLowerCase();
        if (site) siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
        for (const tag of item.aiTags ?? []) {
            const name = tag.trim();
            if (name) tagCounts.set(name, (tagCounts.get(name) ?? 0) + 1);
        }
    }
    doneItems.sort((a, b) => a.doneTime.localeCompare(b.doneTime));
    return {
        monthKey: key,
        doneCount: doneItems.length,
        doneWords,
        topSites: topNameCounts(siteCounts, 6),
        topTags: topNameCounts(tagCounts, 8),
        doneItems,
    };
}

/** 月度回顾 Markdown（供 createDocWithMd 导出）。 */
export function buildMonthlyReviewMarkdown(review: MonthlyReview, now: Date = new Date()): string {
    const monthLabel = `${review.monthKey.slice(0, 4)} 年 ${Number(review.monthKey.slice(4, 6))} 月`;
    const lines: string[] = [];
    lines.push(`# 阅读月报 · ${monthLabel}`);
    lines.push("");
    lines.push(`> 由小驴拾遗生成于 ${formatDate(now)} —— 把吃灰的收藏捡回来喂给自己`);
    lines.push("");
    lines.push("## 概览");
    lines.push("");
    lines.push(`- 本月完成 **${review.doneCount}** 篇，累计 **${formatWords(review.doneWords)}** 字`);
    lines.push("");
    if (review.doneItems.length > 0) {
        lines.push("## 本月读完");
        lines.push("");
        for (const item of review.doneItems.slice(0, 30)) {
            const site = item.site ? `（${item.site}）` : "";
            const rating = item.rating > 0 ? ` ⭐${item.rating}` : "";
            lines.push(`- [${item.title || "无标题"}](siyuan://blocks/${item.id})${site}${rating}`);
        }
        lines.push("");
    }
    if (review.topSites.length > 0) {
        lines.push("## 站点分布");
        lines.push("");
        for (const { name, count } of review.topSites) lines.push(`- ${name} × ${count}`);
        lines.push("");
    }
    if (review.topTags.length > 0) {
        lines.push("## 标签分布");
        lines.push("");
        for (const { name, count } of review.topTags) lines.push(`- ${name} × ${count}`);
        lines.push("");
    }
    return lines.join("\n");
}

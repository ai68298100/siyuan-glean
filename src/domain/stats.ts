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
        // 本周完成只按可信完成时间（D-0028）；无 done-time 的已读是"完成时间未知"，
        // 不用 updated 伪造，只计入上面的状态总数。
        if (item.status === "done" && withinWeek(item.doneTime, todayNoon)) doneThisWeek += 1;

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

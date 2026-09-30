/**
 * 统计服务（T-1201）：索引 → 统计聚合 + 周报导出。
 * 聚合逻辑在 domain/stats.ts（纯函数）；这里只做取数与落盘。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd, querySql } from "../api/client";
import {
    buildMonthlyReviewMarkdown,
    buildWeeklyReportMarkdown,
    aggregateStats,
    monthlyReview,
    weeklyReportDocPath,
    withinWeek,
    type StatsInput,
} from "../domain/stats";
import type { GleanIndex } from "./index-store";
import { writeClip } from "./clip-store";
import { toCsv } from "../domain/csv";
import type { GleanSettings } from "./settings";

export function buildStats(index: GleanIndex) {
    const items: StatsInput[] = Object.values(index.clips).map((clip) => ({
        id: clip.id,
        title: clip.title,
        site: clip.site,
        status: clip.status,
        words: clip.words,
        minutes: clip.minutes,
        rating: clip.rating,
        time: clip.time,
        doneTime: clip.doneTime,
        aiTags: clip.aiTags,
        updated: clip.updated,
    }));
    return aggregateStats(items);
}

/** 生成本周周报文档（写入第一个锚点笔记本 /读库周报/ 下）。返回文档 ID。 */
export async function exportWeeklyReport(index: GleanIndex, settings: GleanSettings, plugin: Plugin): Promise<string> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");
    const stats = await buildStats(index);
    const { title, rangeLabel } = weeklyReportDocPath();
    const todayNoon = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12).getTime();

    // 周报"本周读完"只列有可信完成时间的条目（D-0028）；完成事实与当前状态解耦
    //（T-1885）：读完后又归档的文章不丢本周记录；无 done-time 的已读不进列表。
    const doneItems: StatsInput[] = Object.values(index.clips)
        .filter((clip) => withinWeek(clip.doneTime, todayNoon))
        .map((clip) => ({
            id: clip.id,
            title: clip.title,
            site: clip.site,
            status: clip.status,
            words: clip.words,
            minutes: clip.minutes,
            rating: clip.rating,
            time: clip.time,
            doneTime: clip.doneTime,
            aiTags: clip.aiTags,
            updated: clip.updated,
        }));

    const markdown = buildWeeklyReportMarkdown({ stats, doneItems, rangeLabel });
    // T-1958：同周重复生成/失败重试都定位同一份周报，不再堆积同名宿主文档。
    // 内容以首次生成为准；追加式更新待文档覆盖端点行为实证后再补（见 TODO T-1958 备注）。
    const existing = await querySql<{ id: string }>(
        `SELECT id FROM blocks WHERE type = 'd' AND box = '${notebookId.replace(/'/g, "''")}' AND hpath = '/读库周报/${title}' LIMIT 1`
    );
    if (existing[0]?.id) return existing[0].id;
    const docId = await createDocWithMd(notebookId, `/读库周报/${title}`, markdown);
    if (!docId) throw new Error("创建读库周报宿主文档失败");
    // 周报是插件内部文档：经 clip-store 写属性并同步派生索引，避免裸写 custom-clip-*。
    await writeClip(plugin, docId, { internal: true });
    return docId;
}


/** 生成本月回顾文档（/读库月报/YYYYMM；同周报幂等定位，重复生成不堆积）。返回文档 ID。 */
export async function exportMonthlyReview(index: GleanIndex, settings: GleanSettings, plugin: Plugin): Promise<string> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");
    const items: StatsInput[] = Object.values(index.clips).map((clip) => ({
        id: clip.id,
        title: clip.title,
        site: clip.site,
        status: clip.status,
        words: clip.words,
        minutes: clip.minutes,
        rating: clip.rating,
        time: clip.time,
        doneTime: clip.doneTime,
        aiTags: clip.aiTags,
        updated: clip.updated,
    }));
    const review = monthlyReview(items);
    const title = review.monthKey;
    const existing = await querySql<{ id: string }>(
        `SELECT id FROM blocks WHERE type = 'd' AND box = '${notebookId.replace(/'/g, "''")}' AND hpath = '/读库月报/${title}' LIMIT 1`
    );
    if (existing[0]?.id) return existing[0].id;
    const markdown = buildMonthlyReviewMarkdown(review);
    const docId = await createDocWithMd(notebookId, `/读库月报/${title}`, markdown);
    if (!docId) throw new Error("创建读库月报宿主文档失败");
    await writeClip(plugin, docId, { internal: true });
    return docId;
}

/** 读库全量属性表 CSV（T-1772）：导出当前索引投影，含 BOM（Excel 中文兼容）。 */
export function buildLibraryCsv(index: GleanIndex): string {
    const header = [
        "id", "title", "status", "site", "url", "words", "minutes", "priority", "rating",
        "tags", "aiTags", "time", "timeSource", "doneTime", "src", "contentType", "hpath", "summary",
    ];
    const rows: Array<Array<string | number>> = [header];
    for (const clip of Object.values(index.clips)) {
        rows.push([
            clip.id,
            clip.title,
            clip.status,
            clip.site,
            clip.url,
            clip.words,
            clip.minutes,
            clip.priority,
            clip.rating,
            clip.tags.join(" "),
            clip.aiTags.join(" "),
            clip.time,
            clip.timeSource,
            clip.doneTime,
            clip.src,
            clip.contentType,
            clip.hpath,
            clip.summary,
        ]);
    }
    return "\uFEFF" + toCsv(rows);
}

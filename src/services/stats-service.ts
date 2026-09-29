/**
 * 统计服务（T-1201）：索引 → 统计聚合 + 周报导出。
 * 聚合逻辑在 domain/stats.ts（纯函数）；这里只做取数与落盘。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd } from "../api/client";
import { buildWeeklyReportMarkdown, aggregateStats, weeklyReportDocPath, type StatsInput } from "../domain/stats";
import type { GleanIndex } from "./index-store";
import { writeClip } from "./clip-store";
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

    const doneItems: StatsInput[] = Object.values(index.clips)
        .filter((clip) => clip.status === "done")
        .map((clip) => ({
            id: clip.id,
            title: clip.title,
            site: clip.site,
            status: clip.status,
            words: clip.words,
            minutes: clip.minutes,
            rating: clip.rating,
            time: clip.time,
            aiTags: clip.aiTags,
            updated: clip.updated,
        }));

    const markdown = buildWeeklyReportMarkdown({ stats, doneItems, rangeLabel });
    const docId = await createDocWithMd(notebookId, `/读库周报/${title}`, markdown);
    if (!docId) throw new Error("创建读库周报宿主文档失败");
    // 周报是插件内部文档：经 clip-store 写属性并同步派生索引，避免裸写 custom-clip-*。
    await writeClip(plugin, docId, { internal: true });
    return docId;
}


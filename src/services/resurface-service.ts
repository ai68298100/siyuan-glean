/**
 * 每日重浮服务（T-1400/T-1402）：池选取、行动落盘、幂等。
 * lastSurfaced 只在用户行动（读了/改天/归档）时写——未行动的文章明天自然回池（平静原则）。
 * "改天" = 写 lastSurfaced=今天（当天不再出现，属性可复算，无后台进程）。
 */
import type { Plugin } from "siyuan";
import { parseClipAttrs } from "../domain/schema";
import {
    pickDaily,
    recentlySurfaced,
    staleCandidates,
    tagSetsOf,
    todayStamp,
    type SurfaceItem,
    type SurfacePick,
} from "../domain/resurface";
import { loadIndex, type GleanIndex } from "./index-store";
import { writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

function indexToSurfaceItems(index: GleanIndex): SurfaceItem[] {
    return Object.values(index.clips).map((clip) => ({
        id: clip.id,
        title: clip.title,
        status: clip.status,
        priority: clip.priority || 3,
        time: clip.time,
        aiTags: clip.aiTags,
        lastSurfaced: clip.surfaced,
        summary: clip.summary,
    }));
}

export interface DailySurfaces {
    picks: SurfacePick[];
    /** 近 7 天被重浮过的篇数（视图副标题用） */
    recentCount: number;
}

/** 计算今日拾遗（确定性；不写任何属性）。 */
export async function computeDaily(plugin: Plugin, settings: GleanSettings): Promise<DailySurfaces> {
    const index = await loadIndex(plugin);
    const items = indexToSurfaceItems(index);
    const recent = recentlySurfaced(items);
    const picks = pickDaily(items, tagSetsOf(recent), {
        count: settings.resurface.dailyCount,
        includeDone: settings.resurface.includeDoneHighlights,
    });
    return { picks, recentCount: recent.length };
}

export type SurfaceAction = "read" | "later" | "archive";

/** 重浮卡行动：落状态 + 写 last-surfaced（当天幂等），返回下一位（由视图重算）。 */
export async function actOnSurface(plugin: Plugin, docId: string, action: SurfaceAction): Promise<void> {
    const patch =
        action === "read"
            ? { status: "done" as const, lastSurfaced: todayStamp() }
            : action === "archive"
              ? { status: "archived" as const, lastSurfaced: todayStamp() }
              : { lastSurfaced: todayStamp() };
    await writeClip(plugin, docId, patch, { force: true });
}

/** 超龄归档候选（T-1401），一键批量归档入口。 */
export async function listStaleCandidates(plugin: Plugin, settings: GleanSettings): Promise<SurfaceItem[]> {
    const index = await loadIndex(plugin);
    return staleCandidates(indexToSurfaceItems(index), settings.staleDays);
}

/** 一键批量归档超龄候选；返回归档篇数。 */
export async function archiveStale(plugin: Plugin, settings: GleanSettings): Promise<number> {
    const candidates = await listStaleCandidates(plugin, settings);
    for (const candidate of candidates) {
        await writeClip(plugin, candidate.id, { status: "archived" }, { force: true });
    }
    return candidates.length;
}

/** 供测试/诊断：直接从批量属性构建 SurfaceItem 切片（不经索引）。 */
export function surfaceItemsFromAttrs(pairs: Array<{ id: string; attrs: Record<string, string> }>): SurfaceItem[] {
    return pairs.map((pair) => {
        const attrs = parseClipAttrs(pair.attrs);
        return {
            id: pair.id,
            title: "",
            status: attrs.status ?? "",
            priority: attrs.priority ?? 3,
            time: attrs.time ?? "",
            aiTags: attrs.aiTags,
            lastSurfaced: attrs.lastSurfaced ?? "",
            summary: attrs.summary ?? "",
        };
    });
}

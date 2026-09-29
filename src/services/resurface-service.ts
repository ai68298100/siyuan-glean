/**
 * 每日重浮服务（T-1400/T-1402）：池选取、行动落盘、幂等。
 * lastSurfaced 只在用户行动（读了/改天/归档）时写——未行动的文章明天自然回池（平静原则）。
 * "改天" = 写 lastSurfaced=今天（当天不再出现，属性可复算，无后台进程）。
 * “开始阅读”只进入 reading；读完必须由用户明确执行“标记已读”。
 */
import type { Plugin } from "siyuan";
import { parseClipAttrs } from "../domain/schema";
import {
    pickDaily,
    recentlySurfaced,
    staleCandidates,
    surfaceReasons,
    tagSetsOf,
    todayStamp,
    type SurfaceItem,
    type SurfacePick,
    type SurfaceReason,
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
        contentType: clip.contentType,
        url: clip.url,
        site: clip.site,
    }));
}

export interface DailySurfaces {
    picks: Array<SurfacePick & { reasons: SurfaceReason[] }>;
    /** 近 7 天被重浮过的篇数（视图副标题用） */
    recentCount: number;
}

/**
 * 在给定索引上计算今日拾遗（T-1710）：重浮是纯投影，不读缓存文件。
 * 调用方必须传入刚对账过的索引（面板打开/刷新时的 reconcileIndex 结果），
 * 保证挑选、略过判断与超龄清单和文档属性一致。
 */
export function computeDailyFromIndex(index: GleanIndex, settings: GleanSettings): DailySurfaces {
    const items = indexToSurfaceItems(index);
    const recent = recentlySurfaced(items);
    const recentTagSets = tagSetsOf(recent);
    const picks = pickDaily(items, recentTagSets, {
        count: settings.resurface.dailyCount,
        includeDone: settings.resurface.includeDoneHighlights,
    }).map((pick) => ({ ...pick, reasons: surfaceReasons(pick.item, recentTagSets) }));
    return { picks, recentCount: recent.length };
}

/** 兼容入口：先读当前缓存索引再投影；UI 主路径应使用 computeDailyFromIndex。 */
export async function computeDaily(plugin: Plugin, settings: GleanSettings): Promise<DailySurfaces> {
    return computeDailyFromIndex(await loadIndex(plugin), settings);
}

export type SurfaceAction = "read" | "later" | "archive";

/** 重浮卡行动：落状态 + 写 last-surfaced（当天幂等），返回下一位（由视图重算）。 */
export async function actOnSurface(plugin: Plugin, docId: string, action: SurfaceAction): Promise<void> {
    const patch =
        action === "read"
            ? { status: "reading" as const, lastSurfaced: todayStamp() }
            : action === "archive"
              ? { status: "archived" as const, lastSurfaced: todayStamp() }
              : { lastSurfaced: todayStamp() };
    await writeClip(plugin, docId, patch, { force: true });
}

/** 超龄归档候选（T-1401/T-1710）：在对账后的索引上列清单，归档前供用户勾选。 */
export function staleCandidatesFromIndex(index: GleanIndex, settings: GleanSettings): SurfaceItem[] {
    return staleCandidates(indexToSurfaceItems(index), settings.staleDays);
}

/**
 * 按用户勾选的显式清单批量归档（T-1710）。逐篇写并统计真实成功数；
 * 不再"先扫后全归"，清单之外的篇目不受影响。
 */
export async function archiveStaleCandidates(
    plugin: Plugin,
    docIds: string[]
): Promise<{ ok: number; succeeded: string[] }> {
    const succeeded: string[] = [];
    for (const docId of docIds) {
        try {
            await writeClip(plugin, docId, { status: "archived" }, { force: true });
            succeeded.push(docId);
        } catch {
            // 单篇失败不阻断批量；调用方以真实成功数反馈
        }
    }
    return { ok: succeeded.length, succeeded };
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
            contentType: attrs.contentType,
            url: attrs.url,
            site: attrs.site ?? "",
        };
    });
}

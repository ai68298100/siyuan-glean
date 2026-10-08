/**
 * 每日重浮服务（T-1400/T-1402）：池选取、行动落盘、幂等。
 * lastSurfaced 只在用户行动（读了/改天/归档）时写——未行动的文章明天自然回池（平静原则）。
 * "改天" = 写 lastSurfaced=今天（当天不再出现，属性可复算，无后台进程）。
 * “开始阅读”只进入 reading；读完必须由用户明确执行“标记已读”。
 */
import type { Plugin } from "siyuan";
import { parseClipAttrs, type ClipStatus } from "../domain/schema";
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
import { readClip, writeClip } from "./clip-store";
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
        pinned: clip.pinned ?? "",
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

export interface SurfaceStateSnapshot {
    status: ClipStatus;
    lastSurfaced: string;
}

export interface SurfaceUndoToken {
    before: SurfaceStateSnapshot;
    after: SurfaceStateSnapshot;
}

export async function actOnSurface(plugin: Plugin, docId: string, action: SurfaceAction): Promise<SurfaceUndoToken> {
    const current = await readClip(docId);
    if (!current.status) throw new Error("文章状态缺失，无法执行重浮动作");
    const before: SurfaceStateSnapshot = {
        status: current.status,
        lastSurfaced: current.lastSurfaced ?? "",
    };
    const after: SurfaceStateSnapshot = {
        status: action === "read" ? "reading" : action === "archive" ? "archived" : before.status,
        lastSurfaced: todayStamp(),
    };
    const patch = { status: after.status, lastSurfaced: after.lastSurfaced };
    await writeClip(plugin, docId, patch, { force: true });
    return { before, after };
}

export async function setSurfacePinned(plugin: Plugin, docId: string, pinned: boolean): Promise<string> {
    const current = await readClip(docId);
    if (!current.status) throw new Error("文章状态缺失，无法修改今日置顶");
    const next = pinned ? todayStamp() : "";
    await writeClip(plugin, docId, { pinned: next || null }, { force: true });
    return next;
}

export async function undoSurfaceAction(plugin: Plugin, docId: string, token: SurfaceUndoToken): Promise<void> {
    const current = await readClip(docId);
    if (current.status !== token.after.status || (current.lastSurfaced ?? "") !== token.after.lastSurfaced) {
        throw new Error("文章状态已变化，无法撤销");
    }
    await writeClip(
        plugin,
        docId,
        { status: token.before.status, lastSurfaced: token.before.lastSurfaced },
        { force: true },
    );
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

/**
 * "读完并下一篇"（T-1723）的下一篇选择：显式动作，不自动前进。
 * 投影基于当前派生索引（面板打开/写入时已对账）；排除当前篇，挑选口径与今日拾遗一致，
 * 池空（全部 surfaced 或无未读）时回退等待最久的 inbox/later。返回空串表示没有下一篇。
 */
export async function pickNextUnread(plugin: Plugin, excludeDocId: string): Promise<string> {
    const index = await loadIndex(plugin);
    const pool = indexToSurfaceItems(index).filter((item) => item.id !== excludeDocId);
    const picks = pickDaily(pool, [], { count: 1, includeDone: false });
    if (picks.length > 0) return picks[0].item.id;
    const stalest = pool
        .filter((item) => item.status === "inbox" || item.status === "later")
        // 缺 time 的旧数据垫底，不抢占"下一篇"
        .sort((a, b) => (a.time || "9999").localeCompare(b.time || "9999") || a.id.localeCompare(b.id));
    return stalest[0]?.id ?? "";
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
            pinned: attrs.pinned ?? "",
            summary: attrs.summary ?? "",
            contentType: attrs.contentType,
            url: attrs.url,
            site: attrs.site ?? "",
        };
    });
}

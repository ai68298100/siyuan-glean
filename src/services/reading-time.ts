/**
 * 阅读计时服务（T-1747，契约 DATA-CONTRACT §1 `custom-clip-read-minutes`）：
 * 内嵌页签前台计时（可见状态累计），切文/销毁/标记已读时结算——增量累加进既有值，
 * 不足 1 分钟不写。与 `custom-clip-minutes`（字数估算）语义分离、互不读写。
 * 会话时长/累加为纯计算可测；写入统一经 writeClip。
 */
import type { Plugin } from "siyuan";
import { readClip, writeClip } from "./clip-store";

/** 会话已读分钟（向下取整；不足 1 分钟为 0——不写）。 */
export function sessionMinutes(sessionStartMs: number, nowMs: number = Date.now()): number {
    if (!Number.isFinite(sessionStartMs) || sessionStartMs <= 0) return 0;
    return Math.max(0, Math.floor((nowMs - sessionStartMs) / 60_000));
}

/**
 * 结算并累加：读当前 read-minutes，加上本会话分钟，≥1 分钟增量才写。
 * 返回本次会话新增分钟数（0 = 未写）。
 */
export async function settleReadingMinutes(
    plugin: Plugin,
    docId: string,
    sessionStartMs: number,
    nowMs: number = Date.now()
): Promise<number> {
    const gained = sessionMinutes(sessionStartMs, nowMs);
    if (gained <= 0) return 0;
    const attrs = await readClip(docId);
    const next = (attrs.readMinutes ?? 0) + gained;
    await writeClip(plugin, docId, { readMinutes: next });
    return gained;
}

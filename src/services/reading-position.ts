/**
 * 阅读断点服务（T-1746，契约 DATA-CONTRACT §3.1a）：
 * 断点 = 锚定块 ID；写入时适配到当前唯一事实源
 * `custom-clip-reading-position` 的 JSON 结构。旧的 `custom-clip-reading-pos`
 * 只作为同步分支历史数据的只读兼容键，不再新增写入。
 * 原生编辑器不写；块被删时静默降级从头阅读并清除断点。进度条按块序比例做结构估计，
 * 不显示百分比数字（T-1728 反伪精确纪律）。纯函数在 domain 层可测。
 */
import { querySql } from "../api/client";
import { type ReadingPosition } from "../domain/reading-position";
import { writeClip } from "./clip-store";

/** 视口锚定块：容器 scrollTop 附近（顶部 1/3 内）第一个可见块；找不到取第一个可见块。 */
export function anchorBlockInViewport(container: Element): string {
    const blocks = Array.from(container.querySelectorAll("[data-node-id]"));
    const containerTop = container.getBoundingClientRect().top;
    let firstVisible = "";
    for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        if (rect.bottom < containerTop) continue;
        if (!firstVisible) firstVisible = block.getAttribute("data-node-id") ?? "";
        // 顶部 1/3 视口高度内的第一个块即为阅读锚点
        if (rect.top <= containerTop + container.clientHeight / 3) {
            return block.getAttribute("data-node-id") ?? firstVisible;
        }
        break;
    }
    return firstVisible;
}

/** 文档块总数（SQL 计数；供进度条结构估计）。失败返回 0（进度条隐藏）。 */
export async function countDocBlocks(rootDocId: string): Promise<number> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootDocId)) return 0;
    try {
        const rows = await querySql<{ count: number }>(
            `SELECT COUNT(*) AS count FROM blocks WHERE root_id = '${rootDocId}' AND type IN ('p','h','b','c','t','i')`
        );
        return Number(rows[0]?.count ?? 0);
    } catch {
        return 0;
    }
}

/** 某块在文档块序列中的序号（1-based；找不到返回 0，进度条按 0 处理）。 */
export async function blockPosition(rootDocId: string, blockId: string): Promise<number> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootDocId) || !/^\d{14}-[0-9a-z]{7}$/.test(blockId)) return 0;
    try {
        const rows = await querySql<{ position: number }>(
            `SELECT COUNT(*) AS position FROM blocks
             WHERE root_id = '${rootDocId}' AND type IN ('p','h','b','c','t','i')
             AND sort <= (SELECT sort FROM blocks WHERE id = '${blockId}')`
        );
        return Number(rows[0]?.position ?? 0);
    } catch {
        return 0;
    }
}

/** 写阅读断点（防抖节流由调用方负责）。 */
export async function saveReadingPos(docId: string, blockId: string, plugin: Parameters<typeof writeClip>[0]): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) return;
    const position: ReadingPosition = {
        version: 1,
        blockId,
        offset: 0,
        at: new Date().toISOString(),
    };
    await writeClip(plugin, docId, { readingPosition: position });
}

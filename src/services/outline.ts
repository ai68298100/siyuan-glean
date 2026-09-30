/**
 * 大纲服务（T-1740）：从内核 blocks 表读标题树（querySql 既有端点，无新端点）。
 * 点击定位用标准 DOM scrollIntoView 到 `[data-node-id]`（IProtyle.element 是 SDK 公开字段），
 * 真机滚动行为随 B-0002 验收。
 */
import { querySql } from "../api/client";

export interface OutlineHeading {
    id: string;
    text: string;
    /** h1..h6（异常值归一为 h6，展示层按层级缩进） */
    level: number;
}

export async function fetchDocOutline(rootDocId: string): Promise<OutlineHeading[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootDocId)) return [];
    const rows = await querySql<{ id: string; content: string; subtype: string }>(
        `SELECT id, content, subtype FROM blocks
         WHERE root_id = '${rootDocId}' AND type = 'h'
         ORDER BY sort ASC LIMIT 500`
    );
    return rows
        .map((row) => ({
            id: row.id,
            text: (row.content || "").replace(/\s+/g, " ").trim(),
            level: headingLevel(row.subtype),
        }))
        .filter((heading) => heading.text.length > 0);
}

function headingLevel(subtype: string): number {
    const parsed = Number(/^h([1-6])$/.exec(subtype || "")?.[1]);
    return Number.isFinite(parsed) ? parsed : 6;
}

/** 大纲缩进档位：相对本文最小层级的归一化深度（0..5），避免 h3 开头的文档缩进过深。 */
export function outlineIndent(headings: OutlineHeading[]): number[] {
    const min = headings.length > 0 ? Math.min(...headings.map((heading) => heading.level)) : 1;
    return headings.map((heading) => Math.min(5, heading.level - min));
}

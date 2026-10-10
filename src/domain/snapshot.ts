/**
 * 快照路径纯函数（T-1504）。
 * 资产路径 = /<笔记本>/assets/glean-<docId>-<时间戳>.html（思源资产按笔记本 assets 目录识别）。
 */

export function snapshotAssetPath(box: string, docId: string, now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeBox = box.replace(/[^0-9a-zA-Z-]/g, "") || "assets";
    return `/${safeBox}/assets/glean-${docId}-${stamp}.html`;
}

/** 快照覆盖率只看已收录文章的当前索引投影；候选不参与统计。 */
export interface SnapshotCoverageEntry {
    id: string;
    title?: string;
    snapshot?: string | null;
}

export interface SnapshotCoverage {
    total: number;
    captured: number;
    missing: number;
    /** 0..100，空库为 100（没有需要补拍的文章）。 */
    percent: number;
}

export function snapshotCoverage(entries: readonly SnapshotCoverageEntry[]): SnapshotCoverage {
    const total = entries.length;
    const captured = entries.reduce((count, entry) => count + (typeof entry.snapshot === "string" && entry.snapshot.trim().length > 0 ? 1 : 0), 0);
    const missing = total - captured;
    return {
        total,
        captured,
        missing,
        percent: total === 0 ? 100 : Math.round((captured / total) * 100),
    };
}

export function missingSnapshotEntries<T extends SnapshotCoverageEntry>(entries: readonly T[]): T[] {
    return entries.filter((entry) => typeof entry.snapshot !== "string" || entry.snapshot.trim().length === 0);
}

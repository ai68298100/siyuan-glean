/**
 * 全页快照服务（T-1504）：把剪藏文档导出为单文件 HTML 存入笔记本 assets，
 * 快照路径写 custom-clip-snapshot。防内容/链接腐烂——文档后续被改动，快照仍是收录时原貌。
 */
import type { Plugin } from "siyuan";
import { exportDocHtml, putFile } from "../api/assets";
import { snapshotAssetPath } from "../domain/snapshot";
import { ATTR, parseClipAttrs } from "../domain/schema";
import { readClipAttributeSnapshot, writeClip, type WriteClipOptions } from "./clip-store";

const snapshotFlights = new WeakMap<object, Map<string, Promise<{ path: string; created: boolean }>>>();

export async function snapshotClip(plugin: Plugin, docId: string, options: Pick<WriteClipOptions, "expectedAttrs"> = {}): Promise<{ path: string; created: boolean }> {
    let flights = snapshotFlights.get(plugin);
    if (!flights) { flights = new Map(); snapshotFlights.set(plugin, flights); }
    const running = flights.get(docId);
    if (running) return running;
    const promise = snapshotClipOnce(plugin, docId, options);
    flights.set(docId, promise);
    try { return await promise; }
    finally { if (flights.get(docId) === promise) flights.delete(docId); }
}

async function snapshotClipOnce(plugin: Plugin, docId: string, options: Pick<WriteClipOptions, "expectedAttrs">): Promise<{ path: string; created: boolean }> {
    const before = await readClipAttributeSnapshot(docId);
    const current = parseClipAttrs(before.attrs);
    if (!current.status || current.internal) throw new Error("仅已收录的非内部文章可生成快照");
    const currentPath = before.attrs[ATTR.snapshot] ?? "";
    if (currentPath) return { path: currentPath, created: false };
    const path = snapshotAssetPath(before.meta.box, docId);
    const exported = await exportDocHtml(docId);
    const html = exported?.content ?? "";
    if (!html) throw new Error("快照导出为空");
    await putFile(path, new Blob([html], { type: "text/html" }), path.split("/").pop() ?? "snapshot.html");
    await writeClip(plugin, docId, { snapshot: path }, {
        force: true,
        ...options,
        expectedAttrs: { ...options.expectedAttrs, [ATTR.snapshot]: null },
    });
    return { path, created: true };
}

export interface SnapshotBatchEntry {
    id: string;
    title?: string;
    snapshot?: string | null;
}

export interface SnapshotBatchSuccess {
    id: string;
    title: string;
    path: string;
}

export interface SnapshotBatchFailure {
    id: string;
    title: string;
}

export interface SnapshotBatchResult {
    attempted: number;
    succeeded: SnapshotBatchSuccess[];
    skipped: number;
    failed: SnapshotBatchFailure[];
}

/** 批量补拍逐篇串行执行；单篇失败不会阻断其他文章，调用方可只重试 failed。 */
export async function batchSnapshotClips(plugin: Plugin, entries: readonly SnapshotBatchEntry[]): Promise<SnapshotBatchResult> {
    const pending = entries.filter((entry) => typeof entry.snapshot !== "string" || entry.snapshot.trim().length === 0);
    const succeeded: SnapshotBatchSuccess[] = [];
    const failed: SnapshotBatchFailure[] = [];
    let skipped = 0;
    for (const entry of pending) {
        try {
            const result = await snapshotClip(plugin, entry.id, { expectedAttrs: { [ATTR.snapshot]: null } });
            if (result.created) succeeded.push({ id: entry.id, title: entry.title ?? "", path: result.path });
            else skipped += 1;
        } catch {
            // 保留失败项但不把宿主异常/正文泄露到 UI 或 saveData；用户可显式重试。
            failed.push({ id: entry.id, title: entry.title ?? "" });
        }
    }
    return { attempted: pending.length, succeeded, skipped, failed };
}

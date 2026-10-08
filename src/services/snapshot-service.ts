/**
 * 全页快照服务（T-1504）：把剪藏文档导出为单文件 HTML 存入笔记本 assets，
 * 快照路径写 custom-clip-snapshot。防内容/链接腐烂——文档后续被改动，快照仍是收录时原貌。
 */
import type { Plugin } from "siyuan";
import { exportDocHtml, putFile } from "../api/assets";
import { querySql } from "../api/client";
import { snapshotAssetPath } from "../domain/snapshot";
import { writeClip, type WriteClipOptions } from "./clip-store";

/** 查文档所属笔记本（box）。 */
async function docBox(docId: string): Promise<string> {
    const rows = await querySql<{ box: string }>(`SELECT box FROM blocks WHERE id = '${docId.replace(/'/g, "''")}' AND type = 'd' LIMIT 1`);
    return rows[0]?.box ?? "";
}

export async function snapshotClip(plugin: Plugin, docId: string, options: Pick<WriteClipOptions, "expectedAttrs"> = {}): Promise<{ path: string }> {
    const box = await docBox(docId);
    const path = snapshotAssetPath(box, docId);
    const exported = await exportDocHtml(docId);
    const html = exported?.content ?? "";
    if (!html) throw new Error("快照导出为空");
    await putFile(path, new Blob([html], { type: "text/html" }), path.split("/").pop() ?? "snapshot.html");
    await writeClip(plugin, docId, { snapshot: path }, { force: true, ...options });
    return { path };
}

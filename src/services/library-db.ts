/**
 * 挂库向导编排（T-1200）：一键创建/找回「读库数据库」并把收录文档挂入。
 * 幂等可续建（照搬人脉 D-0019 语义）：按标题找回宿主文档 → 找回库块 → 对账补绑 → 补字段。
 */
import type { Plugin } from "siyuan";
import { createDocWithMd } from "../api/client";
import {
    addField,
    bindDocsAsRows,
    createDatabaseInDoc,
    findAvInDoc,
    findDocByTitle,
    mapBoundDocIds,
    renderView,
    setCellSelect,
    type AvRef,
} from "../api/av";
import { readClipAttributeSnapshot, reconcileIndex, writeClip } from "./clip-store";
import { parseClipAttrs } from "../domain/schema";
import type { GleanSettings } from "./settings";

export const LIBRARY_DOC_TITLE = "读库数据库";

const LIBRARY_FIELDS: Array<{ key: string; name: string; type: "select" | "number" | "url" }> = [
    { key: "status", name: "状态", type: "select" },
    { key: "words", name: "字数", type: "number" },
    { key: "minutes", name: "时长", type: "number" },
    { key: "url", name: "来源", type: "url" },
];

export interface LibraryAnchor {
    notebookId: string;
    hostDocId: string;
    av: AvRef;
    /** 稳定键 → keyID */
    fieldMap: Record<string, string>;
}

/** 找回或创建读库库锚点（幂等）。 */
export async function ensureLibraryAnchor(settings: GleanSettings, plugin: Plugin): Promise<LibraryAnchor> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");
    let hostDoc = await findDocByTitle(notebookId, LIBRARY_DOC_TITLE);
    if (!hostDoc) {
        const created = await createDocWithMd(notebookId, `/${LIBRARY_DOC_TITLE}`, `# ${LIBRARY_DOC_TITLE}\n\n`);
        if (!created) throw new Error("创建读库数据库宿主文档失败");
        // 仅对本次新建的插件宿主打标；旧同名文档仍由路径/标题回退识别，避免误标用户文档。
        await writeClip(plugin, created, { internal: true });
        hostDoc = { id: created, content: LIBRARY_DOC_TITLE, hpath: `/${LIBRARY_DOC_TITLE}`, box: notebookId, updated: "" };
    }
    let av = await findAvInDoc(hostDoc.id);
    if (!av) {
        av = await createDatabaseInDoc(hostDoc.id);
    }
    const fieldMap = await ensureFields(av);
    return { notebookId, hostDocId: hostDoc.id, av, fieldMap };
}

/** 对账补字段：按列名找回 keyID，缺的补建（返回 fieldMap）。 */
async function ensureFields(av: AvRef): Promise<Record<string, string>> {
    const rendered = await renderWithRetry(av.avId, av.dbBlockId, 3);
    const columns = rendered?.view?.columns;
    if (!Array.isArray(columns)) throw new Error("Database columns unavailable");
    const fieldMap: Record<string, string> = {};
    let previousKeyId = columns.length > 0 ? columns[columns.length - 1].id : "";
    for (const field of LIBRARY_FIELDS) {
        const found = columns.find((column) => column.name === field.name);
        if (found) {
            fieldMap[field.key] = found.id;
        } else {
            fieldMap[field.key] = await addField(av.avId, field.name, field.type, previousKeyId);
            previousKeyId = fieldMap[field.key];
        }
    }
    return fieldMap;
}

async function renderWithRetry(avId: string, dbBlockId: string, attempts: number) {
    let last: Awaited<ReturnType<typeof renderView>> | null = null;
    for (let i = 0; i < attempts; i += 1) {
        last = await renderView(avId, dbBlockId, false);
        if ((last?.view?.rows?.length ?? -1) >= 0) return last;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return last;
}

export interface BindResult {
    bound: number;
    boundDocIds: string[];
    /** 库内已有的绑定文档 ID */
    existingDocIds: string[];
    synced: number;
    failures: Array<{ docId: string; reason: "unbound" | "unavailable" | "changed" | "write" | "readback" }>;
}

/** 把索引里全部收录文档挂入库（跳过已绑定的），并把状态列对齐。 */
const bindingPlugins = new WeakSet<Plugin>();

export async function bindAllClipsToLibrary(plugin: Plugin, settings: GleanSettings): Promise<BindResult> {
    if (bindingPlugins.has(plugin)) throw new Error("Database refresh already running");
    bindingPlugins.add(plugin);
    try { return await bindClipsToLibrary(plugin, settings); }
    finally { bindingPlugins.delete(plugin); }
}

async function bindClipsToLibrary(plugin: Plugin, settings: GleanSettings): Promise<BindResult> {
    const index = await reconcileIndex(plugin, settings);
    const clips = Object.values(index.clips).filter((clip) => clip.status && !clip.internal);
    const anchor = await ensureLibraryAnchor(settings, plugin);

    const rendered = await renderWithRetry(anchor.av.avId, anchor.av.dbBlockId, 3);
    const rows = rendered?.view?.rows ?? [];
    // 主键单元格 value.block.id = 绑定文档 ID（人脉 DATA-CONTRACT §1.3）
    const existingDocIds = rows
        .map((row) => row.cells.find((cell) => cell.value.type === "block")?.value.block?.id)
        .filter((id): id is string => Boolean(id));

    const missing = clips.filter((clip) => !existingDocIds.includes(clip.id));
    const bindingErrors = new Set<string>();
    if (missing.length > 0) {
        // 分批 ≤50 绑定（与迁移器同款纪律）
        for (let i = 0; i < missing.length; i += 50) {
            const batch = missing.slice(i, i + 50);
            try {
                await bindDocsAsRows(
                    anchor.av.avId,
                    anchor.av.dbBlockId,
                    batch.map((clip) => clip.id),
                    batch.map((clip) => clip.title || "无标题")
                );
            } catch { batch.forEach((clip) => bindingErrors.add(clip.id)); }
        }
    }

    // 状态列对齐：换算 itemID 后把 select 列补到与文档属性一致
    const allDocIds = clips.map((clip) => clip.id);
    const idMap = await mapBoundDocIds(anchor.av.avId, allDocIds);
    const failures: BindResult["failures"] = [];
    const attempted: Array<{ docId: string; itemId: string; status: string; writeFailed: boolean }> = [];
    for (const clip of clips) {
        const itemId = idMap[clip.id];
        if (!itemId) { failures.push({ docId: clip.id, reason: bindingErrors.has(clip.id) ? "write" : "unbound" }); continue; }
        let status: string;
        try {
            const current = parseClipAttrs((await readClipAttributeSnapshot(clip.id)).attrs);
            if (!current.status || current.internal) { failures.push({ docId: clip.id, reason: "changed" }); continue; }
            status = current.status;
        } catch { failures.push({ docId: clip.id, reason: "unavailable" }); continue; }
        let writeFailed = false;
        try {
            await setCellSelect(anchor.av.avId, anchor.fieldMap.status, itemId, status);
        } catch { writeFailed = true; }
        attempted.push({ docId: clip.id, itemId, status, writeFailed });
    }

    let observed: Awaited<ReturnType<typeof renderView>> | null = null;
    try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            observed = await renderView(anchor.av.avId, anchor.av.dbBlockId, false);
            if (attempted.every((entry) => observed?.view?.rows?.some((row) => row.id === entry.itemId
                && row.cells.some((cell) => cell.value.keyID === anchor.fieldMap.status && cell.value.mSelect?.[0]?.content === entry.status)))) break;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200));
        }
    } catch { observed = null; }
    let synced = 0;
    for (const entry of attempted) {
        try {
            const current = parseClipAttrs((await readClipAttributeSnapshot(entry.docId)).attrs);
            if (current.status !== entry.status || current.internal) { failures.push({ docId: entry.docId, reason: "changed" }); continue; }
        } catch { failures.push({ docId: entry.docId, reason: "unavailable" }); continue; }
        const value = observed?.view?.rows?.find((row) => row.id === entry.itemId)?.cells.find((cell) => cell.value.keyID === anchor.fieldMap.status)?.value;
        if (value?.mSelect?.[0]?.content === entry.status) synced += 1;
        else failures.push({ docId: entry.docId, reason: entry.writeFailed ? "write" : "readback" });
    }
    const boundDocIds = missing.filter((clip) => Boolean(idMap[clip.id])).map((clip) => clip.id);
    return { bound: boundDocIds.length, boundDocIds, existingDocIds, synced, failures };
}

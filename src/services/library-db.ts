/**
 * 挂库向导编排（T-1200）：一键创建/找回「读库数据库」并把收录文档挂入。
 * 幂等可续建（照搬人脉 D-0019 语义）：按标题找回宿主文档 → 找回库块 → 对账补绑 → 补字段。
 * 双向语义（M2 v1）：看板拖卡改状态 = 内核侧写库值；插件内改状态 = 写文档属性 + 看板值由用户手动刷新。
 * 看板列即状态机五态（reading 视图列用 select 字段）。
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
import { loadIndex } from "./index-store";
import type { GleanSettings } from "./settings";

export const LIBRARY_DOC_TITLE = "读库数据库";

/** 库字段稳定键 → 列名（字段映射的稳定锚点，用户改列名通过 fieldMap 记忆） */
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
export async function ensureLibraryAnchor(settings: GleanSettings): Promise<LibraryAnchor> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");
    let hostDoc = await findDocByTitle(notebookId, LIBRARY_DOC_TITLE);
    if (!hostDoc) {
        const created = await createDocWithMd(notebookId, `/${LIBRARY_DOC_TITLE}`, `# ${LIBRARY_DOC_TITLE}\n\n`);
        if (!created) throw new Error("创建读库数据库宿主文档失败");
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
    const columns = rendered?.view?.columns ?? [];
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
}

/** 把索引里全部收录文档挂入库（跳过已绑定的），并把状态列对齐。 */
export async function bindAllClipsToLibrary(plugin: Plugin, settings: GleanSettings): Promise<BindResult> {
    const anchor = await ensureLibraryAnchor(settings);
    const index = await loadIndex(plugin);
    const clips = Object.values(index.clips);

    const rendered = await renderWithRetry(anchor.av.avId, anchor.av.dbBlockId, 3);
    const rows = rendered?.view?.rows ?? [];
    // 主键单元格 value.block.id = 绑定文档 ID（人脉 DATA-CONTRACT §1.3）
    const existingDocIds = rows
        .map((row) => row.cells.find((cell) => cell.value.type === "block")?.value.block?.id)
        .filter((id): id is string => Boolean(id));

    const missing = clips.filter((clip) => !existingDocIds.includes(clip.id));
    if (missing.length > 0) {
        // 分批 ≤50 绑定（与迁移器同款纪律）
        for (let i = 0; i < missing.length; i += 50) {
            const batch = missing.slice(i, i + 50);
            await bindDocsAsRows(
                anchor.av.avId,
                anchor.av.dbBlockId,
                batch.map((clip) => clip.id),
                batch.map((clip) => clip.title || "无标题")
            );
        }
    }

    // 状态列对齐：换算 itemID 后把 select 列补到与文档属性一致
    const allDocIds = clips.map((clip) => clip.id);
    const idMap = await mapBoundDocIds(anchor.av.avId, allDocIds);
    let synced = 0;
    for (const clip of clips) {
        const itemId = idMap[clip.id];
        const status = clip.status;
        if (!itemId || !status) continue;
        try {
            await setCellSelect(anchor.av.avId, anchor.fieldMap.status, itemId, status);
            synced += 1;
        } catch {
            // 单元格写失败不阻断（可能被用户删列）
        }
    }

    return { bound: missing.length, boundDocIds: missing.map((clip) => clip.id), existingDocIds };
}

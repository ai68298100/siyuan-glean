/**
 * 思源数据库（AV）操作层（T-1200）。
 * 端点形状经 av-spike.mjs 在 v3.8.5 隔离内核复验（6/6），
 * 并与小驴人脉同版本内核实证一致（其 DATA-CONTRACT + api/av.ts）。
 * 铁律：itemID（行 ID）≠ 绑定文档 ID；换算只经 getAttributeViewItemIDsByBoundIDs。
 */
import { kernelPost, newNodeId, type DocRow } from "./client";
import { querySql } from "./client";

/** 思源节点 ID 形状（进 SQL 的值必须严格校验） */
const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export function isNodeId(value: string): boolean {
    return ID_PATTERN.test(value);
}

function sqlQuote(value: string): string {
    return value.replace(/'/g, "''");
}

/* ---------- 建库 / 建字段 ---------- */

export interface AvRef {
    avId: string;
    dbBlockId: string;
    hostDocId: string;
}

/** 在宿主文档末尾插入数据库块并物化（客户端先定 avId；createIfNotExist 必须为 true）。 */
export async function createDatabaseInDoc(hostDocId: string): Promise<AvRef> {
    const avId = newNodeId();
    const dom = `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`;
    const data = await kernelPost<Array<{ doOperations?: Array<{ id?: string }> }>>("/api/block/insertBlock", {
        dataType: "dom",
        parentID: hostDocId,
        data: dom,
    });
    const results = Array.isArray(data) ? data : data ? [data] : [];
    const dbBlockId = results[0]?.doOperations?.[0]?.id ?? "";
    if (!dbBlockId) throw new Error("insertBlock 未返回数据库块 ID");
    await renderView(avId, dbBlockId, true);
    return { avId, dbBlockId, hostDocId };
}

export interface AvColumn {
    id: string;
    name: string;
    type: string;
}

export interface AvRow {
    id: string;
    cells: Array<{ value: AvValue }>;
}

export interface AvValue {
    keyID: string;
    type: string;
    block?: { id?: string; content?: string };
    text?: { content?: string };
    number?: { content?: number; isNotEmpty?: boolean };
    url?: { content?: string };
    mSelect?: Array<{ content: string; color?: string }>;
}

export interface AvRenderResult {
    view: { columns: AvColumn[]; rows: AvRow[] };
}

export async function renderView(avId: string, dbBlockId: string, createIfNotExist = false): Promise<AvRenderResult> {
    // 事务落库存在异步滞后，调用方需要行数据时应自行重试（av-spike 实证）
    return kernelPost<AvRenderResult>("/api/av/renderAttributeView", {
        id: avId,
        blockID: dbBlockId,
        query: "",
        pageSize: -1,
        createIfNotExist,
    });
}

/** 建字段。keyIcon 在 v3.8.5 必传（空串即可，官方文档漏写）。 */
export async function addField(
    avId: string,
    name: string,
    type: "select" | "number" | "url" | "text" | "date" | "checkbox" | "mSelect",
    previousKeyId: string
): Promise<string> {
    const keyId = newNodeId();
    await kernelPost("/api/av/addAttributeViewKey", {
        avID: avId,
        keyID: keyId,
        keyName: name,
        keyType: type,
        keyIcon: "",
        previousKeyID: previousKeyId,
    });
    return keyId;
}

/* ---------- 行 ---------- */

/** 把文档绑定为行（isDetached: false → 行随文档走）。 */
export async function bindDocsAsRows(avId: string, dbBlockId: string, docIds: string[], contents: string[]): Promise<void> {
    await kernelPost("/api/av/addAttributeViewBlocks", {
        avID: avId,
        blockID: dbBlockId,
        srcs: docIds.map((id, index) => ({ id, isDetached: false, content: contents[index] ?? "" })),
    });
}

/** 绑定文档 ID → 行 itemID 的官方换算端点。 */
export async function mapBoundDocIds(avId: string, docIds: string[]): Promise<Record<string, string>> {
    const data = await kernelPost<unknown>("/api/av/getAttributeViewItemIDsByBoundIDs", {
        avID: avId,
        blockIDs: docIds,
    });
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid AV binding map");
    const mapped: Record<string, string> = {};
    const items = new Set<string>();
    for (const docId of docIds) {
        const itemId = (data as Record<string, unknown>)[docId];
        if (itemId === undefined || itemId === "") continue;
        if (typeof itemId !== "string" || !isNodeId(itemId) || items.has(itemId)) throw new Error("Invalid AV item ID");
        items.add(itemId);
        mapped[docId] = itemId;
    }
    return mapped;
}

export async function setCellNumber(avId: string, keyId: string, itemId: string, value: number): Promise<void> {
    await kernelPost("/api/av/setAttributeViewBlockAttr", {
        avID: avId,
        keyID: keyId,
        itemID: itemId,
        value: { number: { content: value, isNotEmpty: true } },
    });
}

export async function setCellText(avId: string, keyId: string, itemId: string, content: string): Promise<void> {
    await kernelPost("/api/av/setAttributeViewBlockAttr", {
        avID: avId,
        keyID: keyId,
        itemID: itemId,
        value: { text: { content } },
    });
}

/** select 写值：content 不存在时内核自动创建选项。 */
export async function setCellSelect(avId: string, keyId: string, itemId: string, content: string): Promise<void> {
    await kernelPost("/api/av/setAttributeViewBlockAttr", {
        avID: avId,
        keyID: keyId,
        itemID: itemId,
        value: { mSelect: [{ content }] },
    });
}

/* ---------- 找回已有读库数据库（续建幂等） ---------- */

/** 从数据库块 markdown 还原 avId（块 IAL 不含 avId，唯一还原通道） */
function parseAvIdFromMarkdown(markdown: string): string {
    const match = markdown.match(/data-av-id="(\d{14}-[0-9a-z]{7})"/);
    return match ? match[1] : "";
}

/**
 * 在指定宿主文档里找回读库数据库块。
 * 识别语义：该文档内的 type='av' 块（同名文档是向导自建的「读库数据库」宿主，
 * 用户无关数据库不会出现在这个文档里）。
 */
export async function findAvInDoc(hostDocId: string): Promise<AvRef | null> {
    if (!isNodeId(hostDocId)) return null;
    const rows = await querySql<{ id: string; parent_id: string; markdown: string }>(
        `SELECT id, parent_id, markdown FROM blocks WHERE parent_id = '${sqlQuote(hostDocId)}' AND type = 'av' LIMIT 1`
    );
    const row = rows[0];
    if (!row) return null;
    const avId = parseAvIdFromMarkdown(row.markdown || "");
    if (!avId || !isNodeId(row.id)) return null;
    return { avId, dbBlockId: row.id, hostDocId: row.parent_id };
}

/** 按标题在笔记本内找宿主文档（幂等续建：不重名新建） */
export async function findDocByTitle(notebookId: string, title: string): Promise<DocRow | null> {
    const rows = await querySql<DocRow>(
        `SELECT id, content, hpath, box, updated FROM blocks
         WHERE type = 'd' AND box = '${sqlQuote(notebookId)}' AND content = '${sqlQuote(title)}' LIMIT 1`
    );
    return rows[0] ?? null;
}

export { ID_PATTERN };

/**
 * 属性服务层（T-1100）：读库文章属性的单点读写封装。
 * 全插件只有这里允许写 custom-clip-* 键（schema.ts 定义键名，这里执行纪律）：
 * - schema 校验 + 序列化（domain/schema.ts）
 * - 幂等：captureClip 对已有有效状态的文档不重复写时间戳；URL-only 文档补齐缺失字段
 * - 用户手填字段保护：captureClip/updateClip 对"已有值的手填字段"拒绝静默覆盖（除非显式 force）
 * - 每次写成功后增量同步派生索引
 */
import type { Plugin } from "siyuan";
import {
    batchGetBlockAttrs,
    getBlockAttrs,
    querySql,
    setBlockAttrs,
    type DocRow,
    type Ial,
} from "../api/client";
import {
    ATTR,
    parseClipAttrs,
    captureDefaults,
    serializePatch,
    siteFromUrl,
    type ClipAttrs,
    type ClipStatus,
} from "../domain/schema";
import { applyAttrsToIndex, emptyIndex, loadIndex, saveIndex, type GleanIndex } from "./index-store";
import type { GleanSettings } from "./settings";

export interface DocMeta {
    id: string;
    title: string;
    hpath: string;
    box: string;
    updated: string;
}

/** 读单篇属性（强类型视图） */
export async function readClip(docId: string): Promise<ClipAttrs> {
    const ial = await getBlockAttrs(docId);
    return parseClipAttrs(ial);
}

/** 批量读取原始 IAL，供迁移预检与导入去重使用；属性端点仍只经本服务进入。 */
export async function batchReadClipAttrs(ids: string[]) {
    return batchGetBlockAttrs(ids);
}

export interface WriteClipOptions {
    /**
     * 手填字段保护：patch 里包含 url/status/priority/rating 且文档已有非空值时，
     * 默认跳过该键（返回 skippedKeys）；force=true 才允许覆盖（UI 显式操作）。
     */
    force?: boolean;
    /** 仅覆盖已有状态，用于显式收录或状态动作；其余手填字段继续保护。 */
    forceStatus?: boolean;
}

export interface WriteClipResult {
    attrs: ClipAttrs;
    skippedKeys: string[];
}

const USER_GUARDED_KEYS = [ATTR.url, ATTR.status, ATTR.priority, ATTR.rating] as const;

/** 写属性补丁（增量），成功后同步索引。返回实际跳过的键。 */
export async function writeClip(
    plugin: Plugin,
    docId: string,
    patch: Partial<ClipAttrs> & { aiTags?: string[] | null },
    options: WriteClipOptions = {}
): Promise<WriteClipResult> {
    const ial = await getBlockAttrs(docId);
    const serialized = serializePatch(patch);

    const skippedKeys: string[] = [];
    if (!options.force) {
        for (const key of USER_GUARDED_KEYS) {
            if (key === ATTR.status && options.forceStatus) continue;
            if (key in serialized && serialized[key] !== null && ial[key]) {
                delete serialized[key];
                skippedKeys.push(key);
            }
        }
    }
    if (Object.keys(serialized).length > 0) {
        await setBlockAttrs(docId, serialized);
    }

    const merged: Ial = { ...ial };
    for (const [key, value] of Object.entries(serialized)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
    }
    const meta = await fetchDocMeta(docId);
    const index = await loadIndex(plugin);
    applyAttrsToIndex(index, { ...meta, id: docId }, merged);
    await saveIndex(plugin, index);

    return { attrs: parseClipAttrs(merged), skippedKeys };
}

/** 收录（三入口共用）：首次收录补缺失字段；已带有效状态时幂等跳过。 */
export async function captureClip(
    plugin: Plugin,
    docId: string,
    options: { url?: string; site?: string; src?: ClipAttrs["src"]; time?: string; status?: ClipStatus } = {}
): Promise<{ captured: boolean; attrs: ClipAttrs }> {
    const ial = await getBlockAttrs(docId);
    const current = parseClipAttrs(ial);
    if (current.status) {
        return { captured: false, attrs: current };
    }
    const defaults = captureDefaults();
    const patch: Partial<ClipAttrs> = {};
    // 显式收录可修复无效状态；其余已有属性均保留，尤其是来源 URL 和原时间。
    patch.status = options.status ?? defaults.status;
    if (!ial[ATTR.time]) patch.time = options.time ?? defaults.time;
    if (!ial[ATTR.priority]) patch.priority = defaults.priority;
    if (!ial[ATTR.src]) patch.src = options.src ?? defaults.src;
    if (!ial[ATTR.url] && options.url) patch.url = options.url;
    const url = ial[ATTR.url] || options.url;
    if (!ial[ATTR.site]) patch.site = options.site || (url ? siteFromUrl(url) : "") || undefined;
    const result = await writeClip(plugin, docId, patch, { forceStatus: true });
    return { captured: true, attrs: result.attrs };
}

/** 批量改状态（T-1103）。逐篇写，保证每篇的索引同步；返回成功篇数。 */
export async function batchSetStatus(
    plugin: Plugin,
    docIds: string[],
    status: ClipStatus
): Promise<number> {
    let ok = 0;
    for (const docId of docIds) {
        try {
            // 这是用户显式状态动作，不适用自动写入的手填字段保护。
            await writeClip(plugin, docId, { status }, { forceStatus: true });
            ok += 1;
        } catch {
            // 单篇失败不阻断批量；UI 通过刷新反映真实状态
        }
    }
    return ok;
}

/* ---------- 查询 ---------- */

async function fetchDocMeta(docId: string): Promise<DocMeta> {
    const rows = await querySql<DocRow>(
        `SELECT id, content AS title, hpath, box, updated FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
    );
    const row = rows[0];
    if (row) return { id: row.id, title: row.content || "", hpath: row.hpath || "", box: row.box || "", updated: row.updated || "" };
    return { id: docId, title: "", hpath: "", box: "", updated: "" };
}

function sqlQuote(value: string): string {
    return value.replace(/'/g, "''");
}

/** 全库读库文章/半成品（状态或 URL 次锚点），按更新时间倒序。 */
export async function listClipDocs(limit = 2000): Promise<DocRow[]> {
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated FROM blocks
         WHERE type = 'd' AND (ial LIKE '%${ATTR.status}%' OR ial LIKE '%${ATTR.url}%')
         ORDER BY updated DESC LIMIT ${limit}`
    );
}

/** 标签锚点（DATA-CONTRACT §2 补充）：任意笔记本里带指定标签的老文档也算候选。 */
export async function listTaggedDocs(tag: string, limit = 500): Promise<DocRow[]> {
    const safe = tag.replace(/'/g, "''");
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated FROM blocks
         WHERE type = 'd' AND (tag LIKE '%${safe}%' OR ial LIKE '%"tags":"%${safe}%')
         ORDER BY updated DESC LIMIT ${limit}`
    );
}

/** 锚点笔记本内的文档（主锚点圈定，含未收录候选）。 */
export async function listAnchorDocs(notebookIds: string[], limit = 500): Promise<DocRow[]> {
    if (notebookIds.length === 0) return [];
    const boxes = notebookIds.map((id) => `'${sqlQuote(id)}'`).join(",");
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated FROM blocks
         WHERE type = 'd' AND box IN (${boxes})
         ORDER BY updated DESC LIMIT ${limit}`
    );
}

/* ---------- 面板对账与全量重建 ---------- */

/**
 * 面板打开时增量对账（DATA-CONTRACT §3）：
 * 重查两类 SQL → 批量读属性 → 与索引合并。不删除"SQL 没查到但索引有"的条目
 * （可能是分页截断），只有 rebuild 会真正清空。
 */
export async function reconcileIndex(plugin: Plugin, settings: GleanSettings): Promise<GleanIndex> {
    const index = await loadIndex(plugin);
    // 任一范围查询失败都不能将不完整结果伪装为“没有候选”。
    const [clipRows, anchorRows, taggedRows] = await Promise.all([
        listClipDocs(),
        listAnchorDocs(settings.anchorNotebooks),
        listTaggedDocs("剪藏"),
    ]);
    const ids = [...new Set([...clipRows.map((row) => row.id), ...anchorRows.map((row) => row.id), ...taggedRows.map((row) => row.id)])];
    const attrPairs = await batchGetBlockAttrs(ids);
    const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));
    for (const row of clipRows) {
        const ial = attrsById.get(row.id);
        if (!ial) continue;
        applyAttrsToIndex(index, rowToMeta(row), ial);
    }
    for (const row of [...anchorRows, ...taggedRows]) {
        if (index.clips[row.id]) continue;
        const ial = attrsById.get(row.id);
        if (!ial) continue;
        applyAttrsToIndex(index, rowToMeta(row), ial);
    }
    return saveIndex(plugin, index);
}

function rowToMeta(row: DocRow): DocMeta {
    return { id: row.id, title: row.content || "", hpath: row.hpath || "", box: row.box || "", updated: row.updated || "" };
}

/** 全量重建：清空索引 → 重扫全库。不动文档属性。 */
export async function rebuildIndex(plugin: Plugin, settings: GleanSettings): Promise<GleanIndex> {
    const index = emptyIndex();
    const [clipRows, anchorRows, taggedRows] = await Promise.all([
        listClipDocs(),
        listAnchorDocs(settings.anchorNotebooks),
        listTaggedDocs("剪藏"),
    ]);
    const ids = [...new Set([...clipRows.map((row) => row.id), ...anchorRows.map((row) => row.id), ...taggedRows.map((row) => row.id)])];
    const attrPairs = await batchGetBlockAttrs(ids);
    const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));
    for (const row of [...clipRows, ...anchorRows, ...taggedRows]) {
        const ial = attrsById.get(row.id);
        if (!ial) continue;
        applyAttrsToIndex(index, rowToMeta(row), ial);
    }
    return saveIndex(plugin, index);
}

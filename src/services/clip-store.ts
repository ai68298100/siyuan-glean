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
    exportMdContent,
    getBlockAttrs,
    querySql,
    setBlockAttrs,
    type DocRow,
    type Ial,
    type ExportMarkdownOptions,
} from "../api/client";
import { inspectCandidate } from "../domain/candidate-policy";
import {
    ATTR,
    documentTimeFromId,
    parseClipAttrs,
    captureDefaults,
    serializePatch,
    siteFromUrl,
    siyuanTimestamp,
    type ClipAttrs,
    type ClipPatch,
    type ClipStatus,
} from "../domain/schema";
import { inspectClipMarkdown } from "../domain/content";
import { normalizeUrl } from "../domain/url";
import { normalizeAuthor } from "../domain/author";
import { parseReadingPosition, serializeReadingPosition, type ReadingPosition } from "../domain/reading-position";
import {
    applyAttrsToIndex,
    emptyIndex,
    loadIndex,
    saveIndex,
    type CandidateEntry,
    type ClipIndexEntry,
    type GleanIndex,
} from "./index-store";
import type { GleanSettings } from "./settings";

export interface DocMeta {
    id: string;
    title: string;
    hpath: string;
    box: string;
    updated: string;
}

export interface ScanPreview {
    total: number;
    confirmed: number;
    candidates: number;
    candidatesMissingUrl: number;
    ordinary: number;
    examples: {
        confirmed: Array<Pick<ClipIndexEntry, "id" | "title" | "hpath" | "status" | "url">>;
        candidates: Array<Pick<CandidateEntry, "id" | "title" | "hpath" | "url" | "missing">>;
        ordinary: Array<Pick<DocMeta, "id" | "title" | "hpath">>;
    };
}

/** 读单篇属性（强类型视图） */
export async function readClip(docId: string): Promise<ClipAttrs> {
    const ial = await getBlockAttrs(docId);
    return parseClipAttrs(ial);
}

export async function readClipDocument(docId: string, exportOptions: ExportMarkdownOptions = {}): Promise<{ meta: DocMeta; attrs: ClipAttrs; markdown: string }> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("Invalid document ID");
    const [meta, attrs, exported] = await Promise.all([fetchDocMeta(docId), readClip(docId), exportMdContent(docId, exportOptions)]);
    if (!meta.box || !meta.hpath || typeof exported?.content !== "string") throw new Error("Document unavailable");
    return { meta, attrs, markdown: exported.content };
}

export interface ReadingClipContext {
    id: string;
    title: string;
    status: ClipStatus;
    contentType: ClipAttrs["contentType"];
    url: string;
    /** 载体诊断只读投影；未记录时保持 undefined，不猜测正文长度。 */
    words?: number;
    /** 伴生栏（阅读页签）用的只读投影；缺省时给中性默认。 */
    site?: string;
    author?: string;
    snapshot?: string;
    priority?: number;
    rating?: number;
}

/** 编辑器上下文只读当前根块属性；旧索引不能冒充正在阅读的状态。 */
export async function readClipContext(docId: string): Promise<ReadingClipContext | null> {
    const attrs = await readClip(docId);
    if (!attrs.status) return null;
    const meta = await fetchDocMeta(docId);
    return {
        id: docId,
        title: meta.title || meta.hpath.split("/").filter(Boolean).at(-1) || "",
        status: attrs.status,
        contentType: attrs.contentType,
        url: attrs.url ?? "",
        words: attrs.words,
        site: attrs.site ?? "",
        author: attrs.author ?? "",
        snapshot: attrs.snapshot ?? "",
        priority: attrs.priority ?? 3,
        rating: attrs.rating ?? 0,
    };
}

/** 批量读取原始 IAL，供迁移预检与导入去重使用；属性端点仍只经本服务进入。 */
export async function batchReadClipAttrs(ids: string[]) {
    const pairs: Awaited<ReturnType<typeof batchGetBlockAttrs>> = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
        pairs.push(...await batchGetBlockAttrs(ids.slice(offset, offset + 200)));
    }
    return pairs;
}

export interface WriteClipOptions {
    expectedAuthor?: string;
    expectedAttrs?: Record<string, string | null>;
    expectedLocation?: { box: string; hpath: string };
    /**
     * 手填字段保护：patch 里包含 url/status/priority/rating/author 且文档已有非空值时，
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

/** 与已有读库文章比较 URL；返回冲突文章的轻量元数据。 */
export async function findClipUrlConflict(url: string, exceptDocId?: string, plugin?: Plugin): Promise<DocMeta | null> {
    const key = normalizeUrl(url);
    if (!key) return null;
    const pageSize = 500;
    const seen = new Set<string>();
    const seenSql = new Set<string>();
    if (plugin) {
        const index = await loadIndex(plugin, { strict: true });
        const knownIds = [...new Set([...Object.keys(index.clips), ...Object.keys(index.candidates)])].filter((id) => id !== exceptDocId && /^\d{14}-[0-9a-z]{7}$/.test(id));
        for (let offset = 0; offset < knownIds.length; offset += 200) {
            const ids = knownIds.slice(offset, offset + 200);
            const attrs = await batchReadClipAttrs(ids);
            ids.forEach((id) => seen.add(id));
            for (const pair of attrs) {
                if (normalizeUrl(pair.attrs[ATTR.url] || "") !== key) continue;
                const meta = await fetchDocMeta(pair.id);
                if (!meta.box || !meta.hpath) throw new Error("URL 冲突文档元数据不可用");
                return meta;
            }
        }
    }
    let offset = 0;
    while (true) {
        const docs = await listClipDocs(pageSize, offset);
        if (docs.length === 0) return null;
        const ids = docs.map((doc) => doc.id).filter((id) => !seen.has(id));
        const freshSqlIds = docs.map((doc) => doc.id).filter((id) => !seenSql.has(id));
        if (docs.length === pageSize && freshSqlIds.length === 0) {
            throw new Error("URL 查重分页未前进，无法确认是否重复");
        }
        freshSqlIds.forEach((id) => seenSql.add(id));
        ids.forEach((id) => seen.add(id));
        const attrs = await batchReadClipAttrs(ids);
        for (const pair of attrs) {
            if (pair.id === exceptDocId) continue;
            if (normalizeUrl(pair.attrs[ATTR.url] || "") === key) {
                const row = docs.find((item) => item.id === pair.id);
                if (row) return rowToMeta(row);
            }
        }
        if (docs.length < pageSize) return null;
        offset += docs.length;
    }
}

export class AuthorEditError extends Error {
    readonly reason: "changed" | "invalid";
    constructor(reason: AuthorEditError["reason"]) {
        super(reason);
        this.reason = reason;
    }
}

export interface AuthorEditSnapshot { raw: string; author: string }

export async function readClipAuthor(docId: string): Promise<AuthorEditSnapshot> {
    const meta = await fetchDocMeta(docId);
    if (!meta.box || !meta.hpath) throw new AuthorEditError("changed");
    const ial = await getBlockAttrs(docId);
    const attrs = parseClipAttrs(ial);
    if (!attrs.status || attrs.internal) throw new AuthorEditError("changed");
    return { raw: ial[ATTR.author] ?? "", author: attrs.author ?? "" };
}

const explicitEdits = new WeakMap<Plugin, Map<string, Promise<void>>>();

function queueClipEdit<Result>(plugin: Plugin, docId: string, action: () => Promise<Result>): Promise<Result> {
    let queues = explicitEdits.get(plugin);
    if (!queues) { queues = new Map(); explicitEdits.set(plugin, queues); }
    const pending = queues.get(docId) ?? Promise.resolve();
    const result = pending.then(action);
    const settled = result.then(() => {}, () => {});
    queues.set(docId, settled);
    void settled.then(() => { if (queues.get(docId) === settled) queues.delete(docId); });
    return result;
}

export async function saveClipAuthor(plugin: Plugin, docId: string, expected: string, draft: string): Promise<AuthorEditSnapshot> {
    const author = normalizeAuthor(draft);
    if (author === null) throw new AuthorEditError("invalid");
    return queueClipEdit(plugin, docId, async () => {
        const before = await readClipAuthor(docId);
        if (before.raw !== expected) throw new AuthorEditError("changed");
        await writeClip(plugin, docId, { author }, { force: true, expectedAuthor: expected });
        const after = await readClipAuthor(docId);
        if (after.raw !== author) throw new AuthorEditError("changed");
        return after;
    });
}

export class ClipRestoreError extends Error {
    readonly reason: "changed" | "missing" | "internal" | "conflict";
    constructor(reason: ClipRestoreError["reason"]) { super(reason); this.reason = reason; }
}

export interface ClipAttributeSnapshot { meta: DocMeta; attrs: Ial }

export interface ReadingPositionSnapshot { raw: string | null; position: ReadingPosition | null; meta: DocMeta }

export async function readReadingPosition(docId: string): Promise<ReadingPositionSnapshot> {
    const snapshot = await readClipAttributeSnapshot(docId);
    const attrs = parseClipAttrs(snapshot.attrs);
    if (!attrs.status || attrs.internal) throw new ClipRestoreError("changed");
    const raw = snapshot.attrs[ATTR.readingPosition] ?? null;
    return { raw, position: parseReadingPosition(raw), meta: snapshot.meta };
}

export async function verifyReadingBlock(docId: string, blockId: string): Promise<void> {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docId) || !/^\d{14}-[a-z0-9]{7}$/.test(blockId)) throw new ClipRestoreError("missing");
    const rows = await querySql<{ id: string; root_id: string }>(`SELECT id, root_id FROM blocks WHERE id = '${blockId}' LIMIT 1`);
    if (rows.length !== 1 || rows[0].id !== blockId || rows[0].root_id !== docId) throw new ClipRestoreError("missing");
}

export async function saveReadingPosition(plugin: Plugin, docId: string, expected: ReadingPositionSnapshot, position: ReadingPosition): Promise<ReadingPositionSnapshot> {
    const serialized = serializeReadingPosition(position);
    const targetPosition = parseReadingPosition(serialized)!;
    if (expected.meta.id !== docId) throw new ClipRestoreError("changed");
    const location = { box: expected.meta.box, hpath: expected.meta.hpath };
    const raw = expected.raw;
    return queueClipEdit(plugin, docId, async () => {
        const current = await readClipAttributeSnapshot(docId);
        const attrs = parseClipAttrs(current.attrs);
        if (!attrs.status || attrs.internal || (current.attrs[ATTR.readingPosition] ?? null) !== raw) throw new ClipRestoreError("changed");
        await verifyReadingBlock(docId, targetPosition.blockId);
        let writeError: unknown;
        try {
            await writeClip(plugin, docId, { readingPosition: targetPosition }, { expectedAttrs: { [ATTR.readingPosition]: raw, [ATTR.status]: current.attrs[ATTR.status] }, expectedLocation: location });
        } catch (error) {
            if (error instanceof ClipRestoreError) throw error;
            writeError = error;
        }
        const after = await readReadingPosition(docId);
        if (after.raw !== serialized) {
            if (writeError) throw writeError;
            throw new ClipRestoreError("changed");
        }
        if (after.meta.box !== location.box || after.meta.hpath !== location.hpath) throw new ClipRestoreError("changed");
        await verifyReadingBlock(docId, targetPosition.blockId);
        return after;
    });
}

export async function readClipAttributeSnapshot(docId: string): Promise<ClipAttributeSnapshot> {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docId)) throw new ClipRestoreError("missing");
    const meta = await fetchDocMeta(docId);
    if (!meta.box || !meta.hpath) throw new ClipRestoreError("missing");
    return { meta, attrs: await getBlockAttrs(docId) };
}

export async function restoreClipFields(plugin: Plugin, docId: string, snapshot: ClipAttributeSnapshot, patch: ClipPatch, allowDuplicate = false): Promise<void> {
    await queueClipEdit(plugin, docId, async () => {
        const serialized = serializePatch(patch);
        const source = ATTR.url in serialized ? serialized[ATTR.url] || "" : snapshot.attrs[ATTR.url] || "";
        const restoresSource = ATTR.url in serialized || (Boolean(serialized[ATTR.status]) && !parseClipAttrs(snapshot.attrs).status);
        if (!allowDuplicate && restoresSource && normalizeUrl(source) && await findClipUrlConflict(source, docId, plugin)) throw new ClipRestoreError("conflict");
        const expectedAttrs = Object.fromEntries(Object.keys(serialized).map((key) => [key, snapshot.attrs[key] ?? null]));
        if (restoresSource) expectedAttrs[ATTR.url] = snapshot.attrs[ATTR.url] ?? null;
        let writeError: unknown;
        try {
            await writeClip(plugin, docId, patch, { force: true, expectedAttrs, expectedLocation: { box: snapshot.meta.box, hpath: snapshot.meta.hpath } });
        } catch (error) {
            if (error instanceof ClipRestoreError) throw error;
            writeError = error;
        }
        const current = await readClipAttributeSnapshot(docId);
        if (current.meta.box !== snapshot.meta.box || current.meta.hpath !== snapshot.meta.hpath || parseClipAttrs(current.attrs).internal) throw new ClipRestoreError("changed");
        if (restoresSource && !(ATTR.url in serialized) && (current.attrs[ATTR.url] ?? null) !== (snapshot.attrs[ATTR.url] ?? null)) throw new ClipRestoreError("changed");
        if (Object.entries(serialized).some(([key, value]) => (current.attrs[key] ?? null) !== value)) {
            if (writeError) throw writeError;
            throw new ClipRestoreError("changed");
        }
    });
}

const USER_GUARDED_KEYS = [ATTR.url, ATTR.status, ATTR.priority, ATTR.rating, ATTR.author] as const;

/** 写属性补丁（增量），成功后同步索引。返回实际跳过的键。 */
export async function writeClip(
    plugin: Plugin,
    docId: string,
    patch: ClipPatch,
    options: WriteClipOptions = {}
): Promise<WriteClipResult> {
    if (options.expectedLocation) {
        const meta = await fetchDocMeta(docId);
        if (meta.box !== options.expectedLocation.box || meta.hpath !== options.expectedLocation.hpath) throw new ClipRestoreError("changed");
    }
    const ial = await getBlockAttrs(docId);
    if (options.expectedAttrs) {
        if (parseClipAttrs(ial).internal) throw new ClipRestoreError("internal");
        if (Object.entries(options.expectedAttrs).some(([key, value]) => (ial[key] ?? null) !== value)) throw new ClipRestoreError("changed");
    }
    if (options.expectedAuthor !== undefined) {
        const attrs = parseClipAttrs(ial);
        if ((ial[ATTR.author] ?? "") !== options.expectedAuthor || !attrs.status || attrs.internal) throw new AuthorEditError("changed");
    }
    const serialized = serializePatch(patch);

    const skippedKeys: string[] = [];
    if (!options.force) {
        for (const key of USER_GUARDED_KEYS) {
            if (key === ATTR.status && options.forceStatus) continue;
            if (key in serialized && ial[key]) {
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
    options: {
        url?: string;
        site?: string;
        src?: ClipAttrs["src"];
        time?: string;
        timeSource?: ClipAttrs["timeSource"];
        status?: ClipStatus;
        /** 已在入口取得的 Markdown；本服务不额外调用导出端点。 */
        markdown?: string;
        contentType?: ClipAttrs["contentType"];
        /** 用户明确收录时解除此前的“不是文章”标记。 */
        clearExcluded?: boolean;
        /** 用户明确选择保留一篇同来源的第二份副本。 */
        allowDuplicate?: boolean;
        /** 导入时导出文件提供的可靠已读时间（Pocket time_read）；仅首次收录写入。 */
        doneTime?: string;
        expectedAttrs?: WriteClipOptions["expectedAttrs"];
        expectedLocation?: WriteClipOptions["expectedLocation"];
    } = {}
): Promise<{ captured: boolean; attrs: ClipAttrs; conflict?: DocMeta }> {
    const ial = await getBlockAttrs(docId);
    const current = parseClipAttrs(ial);
    if (current.status) {
        if (options.clearExcluded && current.excluded) {
            const restored = await writeClip(plugin, docId, { excluded: false });
            return { captured: false, attrs: restored.attrs };
        }
        return { captured: false, attrs: current };
    }
    const defaults = captureDefaults();
    const patch: Partial<ClipAttrs> = {};
    const metadata = inspectClipMarkdown(options.markdown ?? "", { url: ial[ATTR.url] || options.url, contentType: options.contentType });
    const effectiveUrl = ial[ATTR.url] || options.url || metadata.url;
    if (effectiveUrl && !options.allowDuplicate) {
        const conflict = await findClipUrlConflict(effectiveUrl, docId, plugin);
        if (conflict) return { captured: false, attrs: current, conflict };
    }
    // 显式收录可修复无效状态；其余已有属性均保留，尤其是来源 URL 和原时间。
    patch.status = options.status ?? defaults.status;
    if (!ial[ATTR.time]) {
        const documentTime = documentTimeFromId(docId);
        patch.time = options.time ?? documentTime ?? defaults.time;
        patch.timeSource = options.timeSource ?? (documentTime ? "document" : "capture");
    }
    if (!ial[ATTR.priority]) patch.priority = defaults.priority;
    if (!ial[ATTR.src]) patch.src = options.src ?? defaults.src;
    if (!ial[ATTR.url] && (options.url || metadata.url)) patch.url = options.url || metadata.url;
    const url = effectiveUrl;
    if (!ial[ATTR.site]) patch.site = options.site || metadata.site || (url ? siteFromUrl(url) : "") || undefined;
    if (!ial[ATTR.contentType]) patch.contentType = options.contentType ?? metadata.contentType;
    if (!ial[ATTR.words] && metadata.words > 0) patch.words = metadata.words;
    if (!ial[ATTR.minutes] && metadata.minutes > 0) patch.minutes = metadata.minutes;
    if (options.doneTime && !ial[ATTR.doneTime]) patch.doneTime = options.doneTime;
    if (options.clearExcluded && current.excluded) patch.excluded = false;
    const result = await writeClip(plugin, docId, patch, { forceStatus: true, expectedAttrs: options.expectedAttrs, expectedLocation: options.expectedLocation });
    return { captured: true, attrs: result.attrs };
}

/** 显式收录入口：先取得导出的 Markdown，再进入统一属性写入管线。 */
export async function captureDocument(
    plugin: Plugin,
    docId: string,
    options: Omit<Parameters<typeof captureClip>[2], "markdown"> = {},
): Promise<{ captured: boolean; attrs: ClipAttrs; conflict?: DocMeta }> {
    const markdown = (await exportMdContent(docId))?.content ?? "";
    return captureClip(plugin, docId, { ...options, clearExcluded: true, markdown });
}

/** 批量改状态（T-1103）。逐篇写，保证每篇的索引同步；返回成功篇数。 */
export async function batchSetStatus(
    plugin: Plugin,
    docIds: string[],
    status: ClipStatus
): Promise<number> {
    return (await batchSetStatusDetailed(plugin, docIds, status)).ok;
}

/** 批量状态动作的详细结果；UI 需要知道哪些文档确实写成功，才能触发外部协同。 */
export async function batchSetStatusDetailed(
    plugin: Plugin,
    docIds: string[],
    status: ClipStatus,
): Promise<{ ok: number; succeeded: string[] }> {
    const succeeded: string[] = [];
    for (const docId of docIds) {
        try {
            // 这是用户显式状态动作，不适用自动写入的手填字段保护。
            // 标记读完同时记录完成时间（D-0028）：归档/恢复不抹除，再次标记读完覆盖。
            const patch: Partial<ClipAttrs> = { status };
            if (status === "done") patch.doneTime = siyuanTimestamp();
            await writeClip(plugin, docId, patch, { forceStatus: true });
            succeeded.push(docId);
        } catch {
            // 单篇失败不阻断批量；UI 通过刷新反映真实状态
        }
    }
    return { ok: succeeded.length, succeeded };
}

export interface ClipBodyMeasurement {
    /** 按收录正文规则重算的字数（模板链接与元信息不计入）。 */
    words: number;
    minutes: number;
    /** 全文载体下正文为空（0 字）= 剪入失败/被清空的诊断结论。 */
    missing: boolean;
}

/**
 * 正文测量（T-1727）：仅由用户显式"检测正文"动作调用。
 * 导出当前 Markdown 后按统一规则重算字数与时长并写回属性；
 * 不修改用户正文，不触碰快照。返回测量结果供界面给出"正文为空"反馈。
 */
export async function measureClipBody(plugin: Plugin, docId: string): Promise<ClipBodyMeasurement> {
    const ial = await getBlockAttrs(docId);
    const attrs = parseClipAttrs(ial);
    const markdown = (await exportMdContent(docId))?.content ?? "";
    const metadata = inspectClipMarkdown(markdown, { url: attrs.url, contentType: attrs.contentType ?? "fulltext" });
    const measurement: ClipBodyMeasurement = {
        words: metadata.words,
        minutes: metadata.minutes,
        missing: metadata.words <= 0,
    };
    if (attrs.words !== measurement.words || attrs.minutes !== measurement.minutes) {
        await writeClip(plugin, docId, { words: measurement.words, minutes: measurement.minutes });
    }
    return measurement;
}

/* ---------- 查询 ---------- */

async function fetchDocMeta(docId: string): Promise<DocMeta> {
    const rows = await querySql<DocRow>(
        `SELECT id, content, hpath, box, updated FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
    );
    const row = rows[0];
    if (row) return { id: row.id, title: row.content || "", hpath: row.hpath || "", box: row.box || "", updated: row.updated || "" };
    return { id: docId, title: "", hpath: "", box: "", updated: "" };
}

function sqlQuote(value: string): string {
    return value.replace(/'/g, "''");
}

function positiveInt(value: number, fallback: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** 全库读库文章/半成品（状态或 URL 次锚点），按稳定顺序分页。 */
export async function listClipDocs(limit = 2000, offset = 0): Promise<DocRow[]> {
    limit = positiveInt(limit, 2000);
    offset = positiveInt(offset, 0);
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated, tag FROM blocks
         WHERE type = 'd' AND (ial LIKE '%${ATTR.status}%' OR ial LIKE '%${ATTR.url}%')
         ORDER BY updated DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
    );
}

/** 标签锚点（DATA-CONTRACT §2 补充）：任意笔记本里带指定标签的老文档也算候选。 */
export async function listTaggedDocs(tag: string, limit = 500, offset = 0): Promise<DocRow[]> {
    limit = positiveInt(limit, 500);
    offset = positiveInt(offset, 0);
    const safe = tag.replace(/'/g, "''");
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated, tag FROM blocks
         WHERE type = 'd' AND (tag LIKE '%${safe}%' OR ial LIKE '%"tags":"%${safe}%')
         ORDER BY updated DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
    );
}

/** 锚点笔记本内的文档（主锚点圈定，含未收录候选）。 */
export async function listAnchorDocs(notebookIds: string[], limit = 500, offset = 0): Promise<DocRow[]> {
    if (notebookIds.length === 0) return [];
    limit = positiveInt(limit, 500);
    offset = positiveInt(offset, 0);
    const boxes = notebookIds.map((id) => `'${sqlQuote(id)}'`).join(",");
    return querySql<DocRow>(
        `SELECT id, content, hpath, box, updated, tag FROM blocks
         WHERE type = 'd' AND box IN (${boxes})
         ORDER BY updated DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
    );
}

const SCAN_PAGE_SIZE = 500;

/**
 * 读取一类 SQL 范围的全部分页。分页查询必须有稳定排序；若内核返回重复满页，
 * 按失败上报，避免静默截断范围后清理旧候选。
 */
async function readAllPages(
    fetchPage: (limit: number, offset: number) => Promise<DocRow[]>,
    pageSize = SCAN_PAGE_SIZE,
): Promise<DocRow[]> {
    pageSize = Math.max(1, positiveInt(pageSize, SCAN_PAGE_SIZE));
    const rows: DocRow[] = [];
    const seen = new Set<string>();
    let offset = 0;
    while (true) {
        const page = await fetchPage(pageSize, offset);
        if (page.length === 0) break;
        let added = 0;
        for (const row of page) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                rows.push(row);
                added += 1;
            }
        }
        if (page.length < pageSize) break;
        if (added === 0) throw new Error("扫描分页未前进，无法安全对账");
        offset += page.length;
    }
    return rows;
}

export interface ScanDocScopes {
    /** 全库 status/url 次锚点（已收录文章与 URL-only 半成品）。 */
    clip: DocRow[];
    /** 设置的主锚点笔记本。 */
    anchor: DocRow[];
    /** 任意笔记本 #剪藏 标签。 */
    tagged: DocRow[];
    /** 三类范围按文档 ID 合并后的稳定列表。 */
    all: DocRow[];
}

/**
 * 迁移和索引对账共用的完整扫描。每个范围先读完分页，再按 ID 合并；调用方可根据
 * `clip/anchor/tagged` 判断来源证据。任意一页失败会直接抛出，由上层保留旧索引并提示。
 */
export async function scanDocScopes(settings: GleanSettings, pageSize = SCAN_PAGE_SIZE): Promise<ScanDocScopes> {
    const [clip, anchor, tagged] = await Promise.all([
        readAllPages((limit, offset) => listClipDocs(limit, offset), pageSize),
        readAllPages((limit, offset) => listAnchorDocs(settings.anchorNotebooks, limit, offset), pageSize),
        readAllPages((limit, offset) => listTaggedDocs("剪藏", limit, offset), pageSize),
    ]);
    const byId = new Map<string, DocRow>();
    for (const row of [...clip, ...anchor, ...tagged]) byId.set(row.id, row);
    const all = [...byId.values()].sort((a, b) => {
        const updated = String(b.updated || "").localeCompare(String(a.updated || ""));
        return updated || String(b.id).localeCompare(String(a.id));
    });
    return { clip, anchor, tagged, all };
}

/* ---------- 面板对账与全量重建 ---------- */

/**
 * 将一次完整范围扫描投影为索引。调用方必须先让 scanDocScopes() 成功读完三类范围，
 * 然后才传入这里；因此缺页、查询失败或属性读取失败都不会把旧索引误清空。
 */
async function indexFromScopes(scopes: ScanDocScopes): Promise<GleanIndex> {
    const index = emptyIndex();
    const ids = scopes.all.map((row) => row.id);
    const attrPairs = await batchGetClipAttrsForIndex(ids);
    const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));
    const projected = await mapWithConcurrency(scopes.all, async (row) => {
        const ial = attrsById.get(row.id);
        if (!ial) return null;
        const exactTags = row.tag || ial.tags || "";
        let probe = inspectCandidate({
            ial,
            title: row.content || "",
            hpath: row.hpath || "",
            tags: exactTags,
        });
        let markdown = "";
        // For an unconfirmed document with no URL or exact tag, the official
        // clipper template in the first lines is the only remaining evidence.
        if (!ial[ATTR.status] && !ial[ATTR.url] && !probe.url && !probe.internal && !probe.excluded) {
            try {
                markdown = (await exportMdContent(row.id))?.content ?? "";
            } catch (error) {
                throw new Error(`无法检查文档 ${row.id} 的剪藏来源: ${String(error)}`);
            }
            probe = inspectCandidate({
                ial,
                markdown,
                title: row.content || "",
                hpath: row.hpath || "",
                tags: exactTags,
            });
        }
        return { row, ial, probe };
    }, 4);
    for (const item of projected) {
        if (!item) continue;
        applyAttrsToIndex(index, rowToMeta(item.row), item.ial, item.probe);
    }
    return index;
}

async function mapWithConcurrency<Input, Output>(items: readonly Input[], worker: (item: Input, index: number) => Promise<Output>, concurrency: number): Promise<Output[]> {
    const results = new Array<Output>(items.length);
    let nextIndex = 0;
    async function consume(): Promise<void> {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => consume()));
    return results;
}

function buildScanPreview(scopes: ScanDocScopes, index: GleanIndex): ScanPreview {
    const confirmed = scopes.all.flatMap((row) => {
        const entry = index.clips[row.id];
        return entry
            ? [{ id: entry.id, title: entry.title, hpath: entry.hpath, status: entry.status, url: entry.url }]
            : [];
    });
    const candidates = scopes.all.flatMap((row) => {
        const entry = index.candidates[row.id];
        return entry
            ? [{ id: entry.id, title: entry.title, hpath: entry.hpath, url: entry.url, missing: entry.missing }]
            : [];
    });
    const ordinary = scopes.all
        .filter((row) => !index.clips[row.id] && !index.candidates[row.id])
        .map((row) => ({ id: row.id, title: row.content || "", hpath: row.hpath || "" }));
    const exampleLimit = 3;

    return {
        total: scopes.all.length,
        confirmed: confirmed.length,
        candidates: candidates.length,
        candidatesMissingUrl: candidates.filter((candidate) => candidate.missing.includes("url")).length,
        ordinary: ordinary.length,
        examples: {
            confirmed: confirmed.slice(0, exampleLimit),
            candidates: candidates.slice(0, exampleLimit),
            ordinary: ordinary.slice(0, exampleLimit),
        },
    };
}

/** 避免一次属性请求装进整个读库；一页失败会中止投影并保留旧索引。 */
async function batchGetClipAttrsForIndex(ids: string[]) {
    return batchReadClipAttrs(ids);
}

/**
 * 面板打开时完整对账。所有分页和属性读取成功后才保存新索引；新索引从空集合构造，
 * 因此已删除、已失去候选证据或移出扫描范围的幽灵候选会被清掉，而状态/URL 次锚点
 * 仍会保留移出主锚点笔记本的已收录文章。
 */
const reconcileFlights = new WeakMap<object, { key: string; promise: Promise<GleanIndex> }>();

export async function reconcileIndex(plugin: Plugin, settings: GleanSettings): Promise<GleanIndex> {
    const key = JSON.stringify(settings.anchorNotebooks);
    const running = reconcileFlights.get(plugin);
    if (running?.key === key) return running.promise;
    const promise = (async () => {
        const scopes = await scanDocScopes(settings);
        const index = await indexFromScopes(scopes);
        return saveIndex(plugin, index);
    })();
    reconcileFlights.set(plugin, { key, promise });
    try {
        return await promise;
    } finally {
        if (reconcileFlights.get(plugin)?.promise === promise) reconcileFlights.delete(plugin);
    }
}

/** 首启只读预览：完整扫描并更新派生索引，但不写任何文章属性。 */
export async function scanPreview(plugin: Plugin, settings: GleanSettings): Promise<ScanPreview> {
    const scopes = await scanDocScopes(settings);
    const index = await indexFromScopes(scopes);
    await saveIndex(plugin, index);
    return buildScanPreview(scopes, index);
}

function rowToMeta(row: DocRow): DocMeta {
    return { id: row.id, title: row.content || "", hpath: row.hpath || "", box: row.box || "", updated: row.updated || "" };
}

/** 全量重建：完整分页重扫三类范围并写入新索引。不动文档属性。 */
export async function rebuildIndex(plugin: Plugin, settings: GleanSettings): Promise<GleanIndex> {
    const scopes = await scanDocScopes(settings);
    const index = await indexFromScopes(scopes);
    return saveIndex(plugin, index);
}

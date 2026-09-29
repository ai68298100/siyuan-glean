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
    type ClipStatus,
} from "../domain/schema";
import { inspectClipMarkdown } from "../domain/content";
import { normalizeUrl } from "../domain/url";
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

/** 与已有读库文章比较 URL；返回冲突文章的轻量元数据。 */
export async function findClipUrlConflict(url: string, exceptDocId?: string): Promise<DocMeta | null> {
    const key = normalizeUrl(url);
    if (!key) return null;
    const pageSize = 500;
    const seen = new Set<string>();
    let offset = 0;
    while (true) {
        const docs = await listClipDocs(pageSize, offset);
        if (docs.length === 0) return null;
        const ids = docs.map((doc) => doc.id).filter((id) => !seen.has(id));
        if (docs.length === pageSize && ids.length === 0) {
            throw new Error("URL 查重分页未前进，无法确认是否重复");
        }
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
        const conflict = await findClipUrlConflict(effectiveUrl, docId);
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
    const result = await writeClip(plugin, docId, patch, { forceStatus: true });
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
        `SELECT id, content AS title, hpath, box, updated FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
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
    for (const row of scopes.all) {
        const ial = attrsById.get(row.id);
        if (!ial) continue;
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
        applyAttrsToIndex(index, rowToMeta(row), ial, probe);
    }
    return index;
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
export async function reconcileIndex(plugin: Plugin, settings: GleanSettings): Promise<GleanIndex> {
    const scopes = await scanDocScopes(settings);
    const index = await indexFromScopes(scopes);
    return saveIndex(plugin, index);
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

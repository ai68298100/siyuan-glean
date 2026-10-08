/**
 * 内核 HTTP 传输层：api/ 是唯一允许发内核请求的地方（AGENTS.md 铁律）。
 * 端点形状以 docs/DATA-CONTRACT.md §5 与 scripts/spike 实证为准。
 */
import * as siyuan from "siyuan";

export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

export const KERNEL_TIMEOUT_DEFAULT_MS = 60_000;
export const KERNEL_TIMEOUT_LONG_MS = 180_000;

function kernelPost<T>(
    route: string,
    body: Record<string, unknown> | FormData = {},
    options: { timeoutMs?: number } = {},
): Promise<T> {
    const fetchPost = (siyuan as unknown as { fetchPost?: (route: string, body: unknown, callback: (response: KernelResponse<T>) => void, failCallback?: (response: unknown) => void) => void }).fetchPost;
    if (typeof fetchPost === "function") {
        const timeoutMs = options.timeoutMs ?? KERNEL_TIMEOUT_DEFAULT_MS;
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`${route} 请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
            }, timeoutMs);
            try {
                fetchPost(route, body, (response) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (!response || typeof response.code !== "number") reject(new Error(`${route} 返回异常响应`));
                    else if (response.code !== 0) reject(new Error(`${route} code=${response.code} msg=${response.msg || ""}`));
                    else resolve(response.data as T);
                }, () => {
                    // 网络级失败立即暴露真实原因，不等超时兜底
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(new Error(`${route} 网络请求失败`));
                });
            } catch (error) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                }
            }
        });
    }
    const fetchSyncPost = (siyuan as unknown as { fetchSyncPost?: (route: string, body: unknown) => Promise<KernelResponse<T>> }).fetchSyncPost;
    if (typeof fetchSyncPost !== "function") return Promise.reject(new Error("思源内核请求接口不可用"));
    // 回退分支与 fetchPost 分支保持同一超时契约
    const timeoutMs = options.timeoutMs ?? KERNEL_TIMEOUT_DEFAULT_MS;
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${route} 请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`)), timeoutMs);
    });
    return Promise.race([
        Promise.resolve(fetchSyncPost(route, body)).then((response) => {
            if (!response || typeof response.code !== "number") {
                throw new Error(`${route} 返回异常响应`);
            }
            if (response.code !== 0) {
                throw new Error(`${route} code=${response.code} msg=${response.msg || ""}`);
            }
            return response.data as T;
        }),
        timeout,
    ]);
}

export { kernelPost };

/** 生成合法节点 ID（yyyyMMddHHmmss-xxxxxxx，同 Lute.NewNodeID 格式）。 */
export function newNodeId(now: Date = new Date()): string {
    const pad = (value: number, width: number) => String(value).padStart(width, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) rand += charset[Math.floor(Math.random() * charset.length)];
    return `${stamp}-${rand}`;
}

/* ---------- attr：文档属性（根块 IAL） ---------- */

export type Ial = Record<string, string>;

export async function getBlockAttrs(id: string): Promise<Ial> {
    return kernelPost<Ial>("/api/attr/getBlockAttrs", { id });
}

export async function setBlockAttrs(id: string, attrs: Record<string, string | null>): Promise<void> {
    await kernelPost("/api/attr/setBlockAttrs", { id, attrs });
}

export interface BlockAttrsPair {
    id: string;
    attrs: Ial;
}

/**
 * 批量读属性。内核响应是 `{[id]: attrs}` 映射（apicontract.BatchGetBlockAttrs，
 * kernel/api/attr.go:36），此处拍平成数组；请求里不存在的 id 不会出现在结果中。
 */
export async function batchGetBlockAttrs(ids: string[]): Promise<BlockAttrsPair[]> {
    if (ids.length === 0) return [];
    const data = await kernelPost<Record<string, Ial>>("/api/attr/batchGetBlockAttrs", { ids });
    const pairs: BlockAttrsPair[] = [];
    for (const [id, attrs] of Object.entries(data ?? {})) {
        pairs.push({ id, attrs: attrs ?? {} });
    }
    return pairs;
}

export async function batchSetBlockAttrs(
    reqs: { id: string; attrs: Record<string, string | null> }[]
): Promise<void> {
    if (reqs.length === 0) return;
    // 内核请求形状：{blockAttrs: [{id, attrs}]}（apicontract.BatchSetBlockAttrsRequest）
    await kernelPost("/api/attr/batchSetBlockAttrs", {
        blockAttrs: reqs.map((req) => ({ id: req.id, attrs: req.attrs })),
    });
}

/* ---------- SQL ---------- */

export interface DocRow {
    id: string;
    content: string;
    hpath: string;
    box: string;
    updated: string;
    /** 搜索结果中的块标签；资格仍由精确 token 校验，SQL LIKE 只圈定范围。 */
    tag?: string;
}

/** 跑一条只读 SQL；思源索引异步刷新，写后立刻查可能短暂滞后 */
export async function querySql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
    const data = await kernelPost<T[]>("/api/query/sql", { stmt });
    return Array.isArray(data) ? data : [];
}

/* ---------- notebook / filetree ---------- */

export interface NotebookMeta {
    id: string;
    name: string;
    closed?: boolean;
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
    const data = await kernelPost<{ notebooks: NotebookMeta[] }>("/api/notebook/lsNotebooks", {});
    return (data?.notebooks ?? []).filter((notebook) => !notebook.closed);
}

/** 导出文档为 markdown（迁移器读正文用；返回 content 已含正文 markdown） */
export interface ExportMarkdownOptions {
    yfm?: boolean;
    addTitle?: boolean;
    refMode?: 2;
}

export async function exportMdContent(id: string, options: ExportMarkdownOptions = {}): Promise<{ hPath: string; content: string }> {
    // 大文档导出可能超过默认 60s，走长超时（迁移器/收录主链路）
    return kernelPost<{ hPath: string; content: string }>("/api/export/exportMdContent", { id, ...options }, { timeoutMs: KERNEL_TIMEOUT_LONG_MS });
}

/** 创建文档（同路径会再建新文档，不幂等——调用方先查重，人脉 D-0007 同款结论）。返回文档 ID。 */
export async function createDocWithMd(notebookId: string, hPath: string, markdown: string, tags?: string): Promise<string> {
    return kernelPost<string>("/api/filetree/createDocWithMd", { notebook: notebookId, path: hPath, markdown, ...(tags ? { tags } : {}) });
}

/** 移动文档到目标笔记本/文档路径；生命周期服务只通过此 API 调用内核。 */
export async function moveDocs(fromPaths: string[], toNotebook: string, toPath: string): Promise<void> {
    if (fromPaths.length === 0) return;
    if (!fromPaths.every((path) => typeof path === "string" && path.length > 0)) throw new Error("Invalid move paths");
    await kernelPost("/api/filetree/moveDocs", { fromPaths, toNotebook, toPath });
}

/** 永久删除文档；调用方必须先完成路径与 ID 配对确认。 */
export async function removeDoc(notebookId: string, path: string): Promise<void> {
    if (!notebookId || !path) throw new Error("Invalid document removal target");
    await kernelPost("/api/filetree/removeDoc", { notebook: notebookId, path });
}

/* ---------- block 子块（高亮聚合） ---------- */

export interface BlockRow {
    id: string;
    content: string;
    markdown: string;
    type: string;
    root_id: string;
    box: string;
    ial?: string;
}

export interface HeadingRow {
    id: string;
    content: string;
    type: string;
    subtype?: string;
    root_id: string;
    sort: number;
}

export async function listHeadingBlocks(
    rootDocId: string,
    afterSort = -1,
    afterId = "",
    limit = 500,
): Promise<HeadingRow[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootDocId)) throw new Error("Invalid outline root ID");
    if (!Number.isSafeInteger(afterSort) || afterSort < -1) throw new Error("Invalid outline cursor");
    if (afterId && !/^\d{14}-[0-9a-z]{7}$/.test(afterId)) throw new Error("Invalid outline cursor ID");
    const pageSize = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
    return querySql<HeadingRow>(
        `SELECT id, content, type, subtype, root_id, sort FROM blocks WHERE root_id = '${rootDocId}' AND type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') AND (sort > ${afterSort} OR (sort = ${afterSort} AND id > '${afterId}')) ORDER BY sort ASC, id ASC LIMIT ${pageSize}`,
    );
}

export interface ChildBlockRow {
    id: string;
    type: string;
    subType?: string;
    content?: string;
}

export async function listChildBlocks(id: string): Promise<ChildBlockRow[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(id)) throw new Error("Invalid child block parent ID");
    const rows = await kernelPost<unknown>("/api/block/getChildBlocks", { id });
    if (!Array.isArray(rows) || rows.length > 50000) throw new Error("Invalid child block response");
    const ids = new Set<string>();
    return rows.map((raw) => {
        const row = raw as Partial<ChildBlockRow> | null;
        if (!row || typeof row.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(row.id)
            || ids.has(row.id) || typeof row.type !== "string" || !row.type
            || (row.subType !== undefined && typeof row.subType !== "string")
            || (row.content !== undefined && typeof row.content !== "string")) throw new Error("Invalid child block row");
        ids.add(row.id);
        return { id: row.id, type: row.type, subType: row.subType, content: row.content };
    });
}

function highlightSqlIds(ids: readonly string[]): string {
    if (ids.length > 200 || ids.some((id) => !/^\d{14}-[0-9a-z]{7}$/.test(id))) throw new Error("Invalid highlight IDs");
    return [...new Set(ids)].map((id) => `'${id}'`).join(",");
}

async function highlightQuery<T>(stmt: string): Promise<T[]> {
    const data = await kernelPost<T[]>("/api/query/sql", { stmt });
    if (!Array.isArray(data)) throw new Error("Invalid highlight query response");
    return data;
}

export async function listHighlightBlocks(rootDocIds: readonly string[], afterId = "", limit = 500): Promise<BlockRow[]> {
    const roots = highlightSqlIds(rootDocIds);
    if (!roots) return [];
    if (afterId && !/^\d{14}-[0-9a-z]{7}$/.test(afterId)) throw new Error("Invalid highlight cursor");
    const pageSize = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
    const marker = 'custom-clip-highlight="';
    const tail = `substr(ial, instr(ial, '${marker}') + ${marker.length})`;
    return highlightQuery<BlockRow>(
        `SELECT id, content, markdown, type, root_id, box, ial FROM blocks
         WHERE root_id IN (${roots}) AND type <> 'd'
         AND (type = 'b' OR (instr(ial, '${marker}') > 0 AND trim(substr(${tail}, 1, instr(${tail}, '"') - 1)) <> ''))
         ${afterId ? `AND id > '${afterId}'` : ""}
         ORDER BY id ASC LIMIT ${pageSize}`
    );
}

export async function getHighlightBlocks(ids: readonly string[]): Promise<BlockRow[]> {
    const blocks = highlightSqlIds(ids);
    return blocks ? highlightQuery<BlockRow>(`SELECT id, content, markdown, type, root_id, box, ial FROM blocks WHERE id IN (${blocks}) ORDER BY id ASC`) : [];
}

export async function listHighlightDocuments(ids: readonly string[]): Promise<DocRow[]> {
    const roots = highlightSqlIds(ids);
    return roots ? highlightQuery<DocRow>(`SELECT id, content, hpath, box, updated FROM blocks WHERE type = 'd' AND id IN (${roots}) ORDER BY id ASC`) : [];
}

export async function listQuoteBlocks(rootDocId: string, limit = 200): Promise<BlockRow[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootDocId)) return [];
    return listHighlightBlocks([rootDocId], "", limit);
}

/* ---------- 搜索 ---------- */

export interface SemanticSearchOptions {
    query: string;
    /** 块类型过滤，内核形状是 map[string]bool（如 {d: true}），不是数组 */
    types?: Record<string, boolean>;
    page?: number;
    pageSize?: number;
}

export interface SemanticSearchHit {
    id: string;
    content?: string;
}

/**
 * 语义搜索（v3.8.5 契约，spike 实证）：请求 `{query, types:{d:true}, page, pageSize}`，
 * 响应 `data.blocks`；请求无 boxes 参数（框定笔记本需客户端过滤或用 paths）。
 * 需用户在思源设置里启用嵌入模型；未启用/未配置时内核返回非 0 code，
 * 由调用方捕获后降级（面板隐藏语义功能），此处不吞错误。
 */
export async function semanticSearchBlock(options: SemanticSearchOptions): Promise<SemanticSearchHit[]> {
    const data = await kernelPost<{ blocks?: SemanticSearchHit[] }>("/api/search/semanticSearchBlock", {
        query: options.query,
        types: options.types ?? { d: true },
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 10,
    });
    return data?.blocks ?? [];
}

/** v3.8.5 /api/ai/embeddingStat 响应（spike 实证）；enabled=false 时语义功能全部降级隐藏 */
export interface EmbeddingStat {
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    ignoredByLen: number;
    ignoredByConfig: number;
    enabled: boolean;
}

export async function embeddingStat(): Promise<EmbeddingStat> {
    return kernelPost<EmbeddingStat>("/api/ai/embeddingStat", {});
}

interface InsertBlockTransaction {
    doOperations?: Array<{ id?: unknown }>;
}

/** 从 insertBlock 事务响应中按操作顺序提取节点 ID。 */
export function extractInsertBlockIds(data: unknown): string[] {
    const transactions = Array.isArray(data) ? data : data ? [data] : [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const transaction of transactions as InsertBlockTransaction[]) {
        for (const operation of transaction?.doOperations ?? []) {
            if (typeof operation?.id === "string" && operation.id && !seen.has(operation.id)) {
                seen.add(operation.id);
                ids.push(operation.id);
            }
        }
    }
    return ids;
}

async function insertDomBlockIds(body: Record<string, unknown>): Promise<string[]> {
    const data = await kernelPost<unknown>('/api/block/insertBlock', body);
    const ids = extractInsertBlockIds(data);
    if (ids.length === 0) throw new Error('insertBlock 未返回节点 ID');
    return ids;
}

/** 向父块插入 DOM 块，返回事务中所有新节点 ID（按 DOM 操作顺序）。 */
export async function insertBlockDomIds(parentBlockId: string, dom: string): Promise<string[]> {
    return insertDomBlockIds({
        dataType: 'dom',
        parentID: parentBlockId,
        data: dom,
    });
}

/** 向父块插入 DOM 块（返回事务里的首个节点 id；兼容既有调用方）。 */
export async function insertBlockDom(parentBlockId: string, dom: string): Promise<string> {
    return (await insertBlockDomIds(parentBlockId, dom))[0];
}

/** 在指定块之后插入同级 DOM 块（D-0030 摘录落点；与 insertBlockDom 同端点，previousID 参数变体）。 */
export async function insertBlockAfterIds(previousBlockId: string, dom: string): Promise<string[]> {
    return insertDomBlockIds({
        dataType: 'dom',
        previousID: previousBlockId,
        data: dom,
    });
}

/** 在指定块之后插入同级 DOM 块（兼容既有调用方）。 */
export async function insertBlockAfter(previousBlockId: string, dom: string): Promise<string> {
    return (await insertBlockAfterIds(previousBlockId, dom))[0];
}

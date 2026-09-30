/**
 * 内核 HTTP 传输层：api/ 是唯一允许发内核请求的地方（AGENTS.md 铁律）。
 * 端点形状以 docs/DATA-CONTRACT.md §5 与 scripts/spike 实证为准。
 *
 * T-1967 超时：默认 60s 兜底（本地内核 60s 无响应视为挂起），长操作调用点
 * （大库 SQL 分页/全文导出/批量属性）显式放宽；超时仅放弃等待，底层请求无法取消。
 */
import { fetchPost } from "siyuan";

export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

export const KERNEL_TIMEOUT_DEFAULT_MS = 60_000;
export const KERNEL_TIMEOUT_LONG_MS = 180_000;

function kernelPost<T>(
    route: string,
    body: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? KERNEL_TIMEOUT_DEFAULT_MS;
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`${route} 请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
        }, timeoutMs);
        fetchPost(route, body, (response: { code?: number; msg?: string; data?: T }) => {
            if (settled) return; // 超时后迟到的响应丢弃
            settled = true;
            clearTimeout(timer);
            if (!response || typeof response.code !== "number") {
                reject(new Error(`${route} 返回异常响应`));
            } else if (response.code !== 0) {
                reject(new Error(`${route} code=${response.code} msg=${response.msg || ""}`));
            } else {
                resolve(response.data as T);
            }
        });
    });
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
    const data = await kernelPost<Record<string, Ial>>("/api/attr/batchGetBlockAttrs", { ids }, { timeoutMs: KERNEL_TIMEOUT_LONG_MS });
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
    const data = await kernelPost<T[]>("/api/query/sql", { stmt }, { timeoutMs: KERNEL_TIMEOUT_LONG_MS });
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
export async function exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
    return kernelPost<{ hPath: string; content: string }>("/api/export/exportMdContent", { id }, { timeoutMs: KERNEL_TIMEOUT_LONG_MS });
}

/** 创建文档（同路径会再建新文档，不幂等——调用方先查重，人脉 D-0007 同款结论）。返回文档 ID。 */
export async function createDocWithMd(notebookId: string, hPath: string, markdown: string, tags?: string): Promise<string> {
    return kernelPost<string>("/api/filetree/createDocWithMd", { notebook: notebookId, path: hPath, markdown, ...(tags ? { tags } : {}) });
}

/**
 * 移动文档（T-1868 实证，DATA-CONTRACT §7.5）：toPath **必须是目标宿主文档完整 path（带 `.sy`）**，
 * 去掉 `.sy` 的目录形态报 block not found；fromPaths 各项同为 `/<id>.sy` 形态。
 * 移动保留根块 ID 与 IAL；重复移动幂等（code=0）。
 */
export async function moveDocs(fromPaths: string[], toNotebookId: string, toHostPath: string): Promise<void> {
    await kernelPost("/api/filetree/moveDocs", { fromPaths, toNotebook: toNotebookId, toPath: toHostPath });
}

/** 删除文档（T-1868 实证）：path 为 `/<id>.sy`；索引异步清空；删除后 getBlockAttrs 返回空对象不报错——判存在性只能靠 SQL。 */
export async function removeDoc(notebookId: string, docPath: string): Promise<void> {
    await kernelPost("/api/filetree/removeDoc", { notebook: notebookId, path: docPath });
}

/* ---------- block 子块（高亮聚合） ---------- */

export interface BlockRow {
    id: string;
    content: string;
    markdown: string;
    type: string;
    root_id: string;
    box: string;
    /** 块更新时间 YYYYMMDDHHmmss（T-1753 摘录时间展示用） */
    updated?: string;
    /** 块级 IAL JSON 形文本（T-1901 颜色投影用） */
    ial?: string;
}

/**
 * 当前文档的引述块（DATA-CONTRACT §4 形态②：普通引述块 type='b'）。
 * content 为纯文本、markdown 保留行内标记；root_id 圈定文档。
 */
export async function listQuoteBlocks(rootDocId: string, limit = 200): Promise<BlockRow[]> {
    if (!/^(\d{14}-[0-9a-z]{7})$/.test(rootDocId)) return [];
    const data = await kernelPost<BlockRow[]>("/api/query/sql", {
        // T-1901：ial 列（JSON 形文本）供高亮颜色投影
        stmt: `SELECT id, content, markdown, type, root_id, box, updated, ial FROM blocks
               WHERE root_id = '${rootDocId.replace(/'/g, "''")}' AND type = 'b' ORDER BY sort ASC LIMIT ${limit}`,
    });
    return Array.isArray(data) ? data : [];
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

/** 向父块插入 DOM 块（返回事务里首个节点 id；人脉 av 同款范式）。 */
export async function insertBlockDom(parentBlockId: string, dom: string): Promise<string> {
    const data = await kernelPost<Array<{ doOperations?: Array<{ id?: string }> }>>('/api/block/insertBlock', {
        dataType: 'dom',
        parentID: parentBlockId,
        data: dom,
    });
    const results = Array.isArray(data) ? data : data ? [data] : [];
    for (const result of results) {
        const id = result?.doOperations?.[0]?.id;
        if (id) return id;
    }
    throw new Error('insertBlock 未返回节点 ID');
}

/** 在指定块之后插入同级 DOM 块（D-0030 摘录落点；与 insertBlockDom 同端点，previousID 参数变体）。 */
export async function insertBlockAfter(previousBlockId: string, dom: string): Promise<string> {
    const data = await kernelPost<Array<{ doOperations?: Array<{ id?: string }> }>>('/api/block/insertBlock', {
        dataType: 'dom',
        previousID: previousBlockId,
        data: dom,
    });
    const results = Array.isArray(data) ? data : data ? [data] : [];
    for (const result of results) {
        const id = result?.doOperations?.[0]?.id;
        if (id) return id;
    }
    throw new Error('insertBlock 未返回节点 ID');
}

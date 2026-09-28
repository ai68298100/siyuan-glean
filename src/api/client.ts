/**
 * 内核 HTTP 传输层：api/ 是唯一允许发内核请求的地方（AGENTS.md 铁律）。
 * 端点形状以 docs/DATA-CONTRACT.md §5 与 scripts/spike 实证为准。
 */
import { fetchPost } from "siyuan";

export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

function kernelPost<T>(route: string, body: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        fetchPost(route, body, (response: { code?: number; msg?: string; data?: T }) => {
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
export async function exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
    return kernelPost<{ hPath: string; content: string }>("/api/export/exportMdContent", { id });
}

/** 创建文档（同路径会再建新文档，不幂等——调用方先查重，人脉 D-0007 同款结论）。返回文档 ID。 */
export async function createDocWithMd(notebookId: string, hPath: string, markdown: string): Promise<string> {
    return kernelPost<string>("/api/filetree/createDocWithMd", { notebook: notebookId, path: hPath, markdown });
}

/* ---------- block 子块（高亮聚合） ---------- */

export interface BlockRow {
    id: string;
    content: string;
    markdown: string;
    type: string;
    root_id: string;
    box: string;
}

/**
 * 当前文档的引述块（DATA-CONTRACT §4 形态②：普通引述块 type='b'）。
 * content 为纯文本、markdown 保留行内标记；root_id 圈定文档。
 */
export async function listQuoteBlocks(rootDocId: string, limit = 200): Promise<BlockRow[]> {
    if (!/^(\d{14}-[0-9a-z]{7})$/.test(rootDocId)) return [];
    const data = await kernelPost<BlockRow[]>("/api/query/sql", {
        stmt: `SELECT id, content, markdown, type, root_id, box FROM blocks
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

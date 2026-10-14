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

/**
 * 内核传输错误的统一分类。错误对象保留原始 Error 身份（兼容宿主调用方），
 * 同时附加这些字段，调用方可用 isKernelRequestError 做结构化判断。
 */
export type KernelErrorKind = "network" | "timeout" | "permission" | "protocol" | "kernel" | "aborted" | "superseded";

export class KernelRequestError extends Error {
    readonly kind: KernelErrorKind;
    readonly route: string;
    readonly code?: number;
    readonly retryable: boolean;

    constructor(route: string, kind: KernelErrorKind, message: string, code?: number, retryable = kind === "network" || kind === "timeout") {
        super(message);
        this.name = "KernelRequestError";
        this.kind = kind;
        this.route = route;
        this.code = code;
        this.retryable = retryable;
    }
}

export function isKernelRequestError(error: unknown): error is KernelRequestError {
    if (!error || typeof error !== "object") return false;
    const value = error as Partial<KernelRequestError>;
    return typeof value.kind === "string" && typeof value.route === "string" && typeof value.retryable === "boolean";
}

/** 兼容宿主原始 Error 的分类读取；未知异常按内核错误处理。 */
export function kernelErrorKind(error: unknown): KernelErrorKind {
    if (isKernelRequestError(error)) return error.kind;
    const kind = (error as { kind?: unknown } | null)?.kind;
    if (kind === "permission" || kind === "network" || kind === "timeout" || kind === "protocol" || kind === "kernel" || kind === "aborted" || kind === "superseded") return kind;
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (/timeout|超时/iu.test(message)) return "timeout";
    if (/network|offline|fetch|连接|网络/iu.test(message)) return "network";
    return "kernel";
}

export interface KernelRetryOptions {
    /** 总尝试次数（含第一次）；必须由调用方显式传入，最大 4 次。 */
    attempts?: number;
    /** 首次重试前等待毫秒数，默认 200。 */
    delayMs?: number;
    /** 指数退避倍数，默认 2。 */
    backoffFactor?: number;
    /** 单次等待上限，默认 2 秒。 */
    maxDelayMs?: number;
}

export interface KernelRequestOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    /** 显式请求键；只有传入该键时才合并相同 route 的并发请求。 */
    requestKey?: string;
    /** 显式最新请求键；同一键的旧响应会被丢弃并以 superseded 错误结束。 */
    latestKey?: string;
    /** 只有调用方确认本操作幂等/只读时设为 true，写操作必须保持 false。 */
    retryable?: boolean;
    /** 仅 retry + retryable:true 同时设置时重试。 */
    retry?: KernelRetryOptions;
}

const inflightRequests = new Map<string, Promise<unknown>>();
const latestGenerations = new Map<string, object>();

function decorateError(
    error: unknown,
    route: string,
    kind: KernelErrorKind,
    options: { code?: number; retryable?: boolean } = {},
): KernelRequestError {
    const message = error instanceof Error ? error.message : String(error ?? `${route} 请求失败`);
    const target = error instanceof Error ? error as KernelRequestError : new KernelRequestError(route, kind, message, options.code, options.retryable ?? (kind === "network" || kind === "timeout"));
    Object.defineProperties(target, {
        kind: { value: kind, enumerable: false, configurable: true },
        route: { value: route, enumerable: false, configurable: true },
        code: { value: options.code, enumerable: false, configurable: true },
        retryable: { value: options.retryable ?? (kind === "network" || kind === "timeout"), enumerable: false, configurable: true },
    });
    return target;
}

function permissionCode(code: number, message: string): boolean {
    return [401, 403, -401, -403].includes(code)
        || /(?:401|403|unauthori[sz]ed|forbidden|permission|权限|未登录|登录过期|订阅)/i.test(message);
}

function responseError<T>(route: string, response: KernelResponse<T>): KernelRequestError {
    const message = `${route} code=${response.code} msg=${response.msg || ""}`;
    if (permissionCode(response.code, response.msg || "")) {
        return decorateError(message, route, "permission", { code: response.code, retryable: false });
    }
    return decorateError(message, route, "kernel", { code: response.code, retryable: false });
}

function abortError(route: string): KernelRequestError {
    return decorateError(`${route} 请求已取消`, route, "aborted", { retryable: false });
}

function validateRetry(options: KernelRetryOptions | undefined): Required<KernelRetryOptions> | null {
    if (!options) return null;
    const attempts = Number.isSafeInteger(options.attempts) ? Math.min(4, Math.max(1, options.attempts!)) : 3;
    const delayMs = Number.isFinite(options.delayMs) ? Math.min(10_000, Math.max(0, options.delayMs!)) : 200;
    const backoffFactor = Number.isFinite(options.backoffFactor) ? Math.min(4, Math.max(1, options.backoffFactor!)) : 2;
    const maxDelayMs = Number.isFinite(options.maxDelayMs) ? Math.min(30_000, Math.max(0, options.maxDelayMs!)) : 2_000;
    return { attempts, delayMs, backoffFactor, maxDelayMs };
}

function waitBeforeRetry(route: string, delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
        if (signal?.aborted) return Promise.reject(abortError(route));
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(abortError(route));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

function requestKeyFor(route: string, key: string | undefined): string | null {
    const trimmed = key?.trim();
    return trimmed ? `${route}\u0000${trimmed}` : null;
}

/** 写成功后淘汰同资源的在途读取，避免之后的读者复用旧响应。 */
function invalidateReadFlights(route: string, matches: (requestKey: string) => boolean): void {
    const prefix = `${route}\u0000`;
    for (const key of inflightRequests.keys()) {
        if (!key.startsWith(prefix)) continue;
        if (!matches(key.slice(prefix.length))) continue;
        inflightRequests.delete(key);
        latestGenerations.delete(key);
    }
}

function invalidateBlockAttrReads(docId: string): void {
    invalidateReadFlights("/api/attr/getBlockAttrs", (key) => key === `block-attrs:${docId}`);
    invalidateReadFlights("/api/attr/batchGetBlockAttrs", (key) => key.startsWith("batch-block-attrs:") && key.slice("batch-block-attrs:".length).split(",").includes(docId));
    invalidateSqlReads();
}

function invalidateSqlReads(): void {
    invalidateReadFlights("/api/query/sql", () => true);
}

function invalidateAllBlockReads(): void {
    invalidateSqlReads();
    invalidateReadFlights("/api/attr/getBlockAttrs", () => true);
    invalidateReadFlights("/api/attr/batchGetBlockAttrs", () => true);
    invalidateReadFlights("/api/block/getChildBlocks", () => true);
}

function invalidateAvReads(avId: string): void {
    if (!avId) return;
    invalidateReadFlights("/api/av/renderAttributeView", (key) => key.startsWith(`view:${avId}:`));
    invalidateReadFlights("/api/av/getAttributeViewItemIDsByBoundIDs", (key) => key.startsWith(`bound-docs:${avId}:`));
}

function invalidateAfterSuccessfulKernelWrite(route: string, body: Record<string, unknown> | FormData): void {
    const payload = typeof FormData !== "undefined" && body instanceof FormData ? {} : body as Record<string, unknown>;
    switch (route) {
        case "/api/attr/setBlockAttrs": {
            if (typeof payload.id === "string") invalidateBlockAttrReads(payload.id);
            break;
        }
        case "/api/attr/batchSetBlockAttrs": {
            const rows = Array.isArray(payload.blockAttrs) ? payload.blockAttrs : [];
            for (const row of rows) {
                const id = (row as { id?: unknown } | null)?.id;
                if (typeof id === "string") invalidateBlockAttrReads(id);
            }
            break;
        }
        case "/api/filetree/createDocWithMd":
        case "/api/filetree/moveDocs":
            invalidateSqlReads();
            break;
        case "/api/filetree/removeDoc":
            invalidateAllBlockReads();
            break;
        case "/api/block/insertBlock": {
            invalidateSqlReads();
            const parentId = typeof payload.parentID === "string" ? payload.parentID : "";
            invalidateReadFlights("/api/block/getChildBlocks", (key) => !parentId || key === `child-blocks:${parentId}`);
            invalidateReadFlights("/api/export/exportMdContent", () => true);
            invalidateReadFlights("/api/export/exportHTML", () => true);
            break;
        }
        case "/api/av/addAttributeViewKey":
        case "/api/av/addAttributeViewBlocks":
        case "/api/av/setAttributeViewBlockAttr":
            invalidateAvReads(typeof payload.avID === "string" ? payload.avID : "");
            break;
        case "/api/av/renderAttributeView":
            if (payload.createIfNotExist === true) invalidateAvReads(typeof payload.id === "string" ? payload.id : "");
            break;
        case "/api/inbox/removeShorthands":
            invalidateReadFlights("/api/inbox/getShorthands", () => true);
            invalidateReadFlights("/api/inbox/getShorthand", () => true);
            break;
        case "/api/ai/editor/saveAction":
        case "/api/ai/editor/removeAction":
            invalidateReadFlights("/api/ai/editor/lsActions", () => true);
            break;
        case "/api/riff/createRiffDeck":
        case "/api/riff/addRiffCards":
            invalidateReadFlights("/api/riff/getRiffDecks", () => true);
            break;
        default:
            break;
    }
}

function supersededError(route: string): KernelRequestError {
    return decorateError(`${route} 请求已被更新的请求替代`, route, "superseded", { retryable: false });
}

async function kernelPostOnce<T>(route: string, body: Record<string, unknown> | FormData, options: KernelRequestOptions): Promise<T> {
    if (options.signal?.aborted) throw abortError(route);
    const fetchSyncPost = (siyuan as unknown as { fetchSyncPost?: (route: string, body: unknown) => Promise<KernelResponse<T>> }).fetchSyncPost;
    const fetchPost = (siyuan as unknown as { fetchPost?: (route: string, body: unknown, callback: (response: KernelResponse<T>) => void, failCallback?: (response: unknown) => void) => void }).fetchPost;
    const timeoutMs = options.timeoutMs ?? KERNEL_TIMEOUT_DEFAULT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");
    // SiYuan's promise API reports non-zero responses reliably; retain fetchPost only as a compatibility fallback.
    if (typeof fetchPost === "function" && typeof fetchSyncPost !== "function") {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                options.signal?.removeEventListener("abort", onAbort);
            };
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const onAbort = () => finish(() => reject(abortError(route)));
            timer = setTimeout(() => finish(() => reject(decorateError(`${route} 请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`, route, "timeout"))), timeoutMs);
            if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            try {
                fetchPost(route, body, (response) => finish(() => {
                    if (!response || typeof response.code !== "number" || !Number.isFinite(response.code)) reject(decorateError(`${route} 返回异常响应`, route, "protocol", { retryable: false }));
                    else if (response.code !== 0) reject(responseError(route, response));
                    else resolve(response.data as T);
                }), () => finish(() => reject(decorateError(`${route} 网络请求失败`, route, "network"))));
            } catch (error) {
                finish(() => reject(decorateError(error, route, "network")));
            }
        });
    }
    if (typeof fetchSyncPost !== "function") throw decorateError("思源内核请求接口不可用", route, "protocol", { retryable: false });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(decorateError(`${route} 请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`, route, "timeout")), timeoutMs);
    });
    const aborted = options.signal ? new Promise<never>((_, reject) => {
        abortListener = () => reject(abortError(route));
        if (options.signal!.aborted) abortListener();
        else options.signal!.addEventListener("abort", abortListener, { once: true });
    }) : null;
    try {
        const response = await Promise.race([Promise.resolve().then(() => fetchSyncPost(route, body)).catch((error) => { throw decorateError(error, route, "network"); }).then((value) => {
            if (!value || typeof value.code !== "number" || !Number.isFinite(value.code)) throw decorateError(`${route} 返回异常响应`, route, "protocol", { retryable: false });
            if (value.code !== 0) throw responseError(route, value);
            return value.data as T;
        }), timeout, aborted].filter(Boolean) as Promise<T>[]);
        return response;
    } finally {
        if (timer) clearTimeout(timer);
        if (abortListener) options.signal?.removeEventListener("abort", abortListener);
    }
}

function kernelPost<T>(
    route: string,
    body: Record<string, unknown> | FormData = {},
    options: KernelRequestOptions = {},
): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(abortError(route));
    const key = options.signal ? null : requestKeyFor(route, options.requestKey);
    const existing = key ? inflightRequests.get(key) as Promise<T> | undefined : undefined;
    if (existing) return existing;
    const retry = options.retryable === true ? validateRetry(options.retry) : null;
    const latestKey = requestKeyFor(route, options.latestKey);
    const latestGeneration = latestKey ? {} : null;
    if (latestKey && latestGeneration) latestGenerations.set(latestKey, latestGeneration);
    const isLatest = () => !latestKey || latestGenerations.get(latestKey) === latestGeneration;
    const execute = async (): Promise<T> => {
        let attempt = 0;
        let lastError: unknown;
        while (attempt < (retry?.attempts ?? 1)) {
            attempt += 1;
            if (!isLatest()) throw supersededError(route);
            try {
                const result = await kernelPostOnce(route, body, options);
                if (!isLatest()) throw supersededError(route);
                invalidateAfterSuccessfulKernelWrite(route, body);
                return result as T;
            } catch (error) {
                lastError = error;
                if (!isLatest()) throw supersededError(route);
                const typed = isKernelRequestError(error) ? error : decorateError(error, route, "network");
                if (!retry || attempt >= retry.attempts || !typed.retryable) throw typed;
                const delay = Math.min(retry.maxDelayMs, retry.delayMs * retry.backoffFactor ** (attempt - 1));
                await waitBeforeRetry(route, delay, options.signal);
            }
        }
        throw lastError;
    };
    if (!key) {
        const request = execute();
        if (latestKey) void request.then(() => undefined, () => undefined).finally(() => {
            if (latestGeneration && latestGenerations.get(latestKey) === latestGeneration) latestGenerations.delete(latestKey);
        });
        return request;
    }
    const request = execute();
    inflightRequests.set(key, request);
    void request.then(() => undefined, () => undefined).finally(() => {
        if (inflightRequests.get(key) === request) inflightRequests.delete(key);
        if (latestKey && latestGeneration && latestGenerations.get(latestKey) === latestGeneration) latestGenerations.delete(latestKey);
    });
    return request;
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
    return kernelPost<Ial>("/api/attr/getBlockAttrs", { id }, {
        requestKey: `block-attrs:${id}`,
        latestKey: `block-attrs:${id}`,
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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
    const requestIds = [...new Set(ids)].sort();
    const requestKey = `batch-block-attrs:${requestIds.join(",")}`;
    const data = await kernelPost<Record<string, Ial>>("/api/attr/batchGetBlockAttrs", { ids }, {
        requestKey,
        latestKey: requestKey,
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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
    const data = await kernelPost<T[]>("/api/query/sql", { stmt }, {
        requestKey: `sql:${stmt}`,
        latestKey: `sql:${stmt}`,
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
    return Array.isArray(data) ? data : [];
}

/* ---------- notebook / filetree ---------- */

export interface NotebookMeta {
    id: string;
    name: string;
    closed?: boolean;
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
    const data = await kernelPost<{ notebooks: NotebookMeta[] }>("/api/notebook/lsNotebooks", {}, {
        requestKey: "all",
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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
    const key = `markdown:${id}:${JSON.stringify(options)}`;
    return kernelPost<{ hPath: string; content: string }>("/api/export/exportMdContent", { id, ...options }, {
        timeoutMs: KERNEL_TIMEOUT_LONG_MS,
        requestKey: key,
        latestKey: key,
        retryable: true,
        retry: { attempts: 2, delayMs: 250, maxDelayMs: 500 },
    });
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
    const rows = await kernelPost<unknown>("/api/block/getChildBlocks", { id }, {
        requestKey: `child-blocks:${id}`,
        latestKey: `child-blocks:${id}`,
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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
    const data = await kernelPost<T[]>("/api/query/sql", { stmt }, {
        requestKey: `sql:${stmt}`,
        latestKey: `sql:${stmt}`,
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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
    const body = {
        query: options.query,
        types: options.types ?? { d: true },
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 10,
    };
    const requestKey = JSON.stringify(body);
    const data = await kernelPost<{ blocks?: SemanticSearchHit[] }>("/api/search/semanticSearchBlock", {
        ...body,
    }, {
        requestKey,
        latestKey: requestKey,
        retryable: true,
        retry: { attempts: 2, delayMs: 200, maxDelayMs: 400 },
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
    return kernelPost<EmbeddingStat>("/api/ai/embeddingStat", {}, {
        requestKey: "current",
        latestKey: "current",
        retryable: true,
        retry: { attempts: 2, delayMs: 150, maxDelayMs: 300 },
    });
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

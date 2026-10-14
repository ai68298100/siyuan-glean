/**
 * 收集箱 API（T-1500，契约内核源码核实 api/inbox.go + apicontract/inbox.go）：
 * - getShorthands {page} → 响应双层包裹：response.data = {code, msg, data: {pagination, shorthands[]}}
 *   （云收件箱特有形状，防御式剥层）
 * - removeShorthands {ids[]}；未登录/无订阅时 code!=0（调用方保留权限错误并提示重试）
 */
import { isKernelRequestError, kernelErrorKind, kernelPost } from "./client";

/** 收集箱查询失败的可读分类；`permission` 包含未登录/无订阅。 */
export type InboxErrorReason = "permission" | "network" | "timeout" | "invalid" | "unavailable";

export interface Shorthand {
    /** 云端对象 ID */
    oId: string;
    /** 正文 markdown */
    shorthandMd: string;
    shorthandDesc: string;
    shorthandTitle: string;
    /** 原始网页 URL（官方前端丢弃、本插件保留的字段） */
    shorthandURL: string;
    hCreated: string;
}

export interface ShorthandsPage {
    shorthands: Shorthand[];
    recordCount: number;
    /** 是否还有下一页 */
    hasMore: boolean;
}

export interface InboxAvailability {
    /** null=不可用；调用方应根据 error 保留原因并提供重试，而不是把失败当空列表。 */
    page: ShorthandsPage | null;
    error: InboxErrorReason | "";
}

interface RawShorthandsResponse {
    code?: number;
    msg?: string;
    data?: {
        pagination?: { paginationRecordCount?: number; paginationPageCount?: number };
        shorthands?: unknown;
    };
}

export async function getShorthands(page = 1): Promise<InboxAvailability> {
    try {
        const key = `page:${page}`;
        const outer = await kernelPost<RawShorthandsResponse>("/api/inbox/getShorthands", { page }, {
            requestKey: key,
            latestKey: key,
            retryable: true,
            retry: { attempts: 2, delayMs: 200, maxDelayMs: 400 },
        });
        if (!outer || typeof outer.code !== "number" || outer.code !== 0) {
            return { page: null, error: inboxErrorFromCode(outer?.code, outer?.msg) };
        }
        if (!Array.isArray(outer.data?.shorthands)) {
            return { page: null, error: "invalid" };
        }
        const shorthands: Shorthand[] = [];
        for (const raw of outer.data.shorthands) {
            const shorthand = parseShorthand(raw);
            if (!shorthand) return { page: null, error: "invalid" };
            shorthands.push(shorthand);
        }
        const pageCount = Number(outer.data.pagination?.paginationPageCount ?? 1);
        const recordCount = Number(outer.data.pagination?.paginationRecordCount ?? shorthands.length);
        if (!Number.isFinite(pageCount) || pageCount < 0 || !Number.isFinite(recordCount) || recordCount < 0) {
            return { page: null, error: "invalid" };
        }
        return { page: { shorthands, recordCount, hasMore: page < pageCount }, error: "" };
    } catch (error) {
        const kind = isKernelRequestError(error) ? error.kind : kernelErrorKind(error);
        if (kind === "permission") return { page: null, error: "permission" };
        if (kind === "timeout") return { page: null, error: "timeout" };
        if (kind === "network" || kind === "aborted") return { page: null, error: "network" };
        return { page: null, error: "unavailable" };
    }
}

function inboxErrorFromCode(code: number | undefined, message = ""): InboxErrorReason {
    if (code === 401 || code === 403 || code === -401 || code === -403 || /(?:401|403|unauthori[sz]ed|forbidden|permission|权限|未登录|登录过期|订阅)/iu.test(message)) return "permission";
    return "unavailable";
}

export async function removeShorthands(ids: string[]): Promise<void> {
    await kernelPost<void>("/api/inbox/removeShorthands", { ids });
}

/** 按 ID 取单条收集箱条目（迁移菜单通道）。 */
export async function getShorthand(id: string): Promise<Shorthand | null> {
    try {
        const shorthand = parseShorthand(await kernelPost<unknown>("/api/inbox/getShorthand", { id }, {
            requestKey: `id:${id}`,
            latestKey: `id:${id}`,
            retryable: true,
            retry: { attempts: 2, delayMs: 200, maxDelayMs: 400 },
        }), id);
        if (!shorthand) console.warn("[glean] 收集箱条目格式无效，跳过:", id);
        return shorthand;
    } catch (error) {
        console.warn("[glean] 收集箱条目读取失败，跳过:", id, error);
        // 网络、权限、超时必须交给调用方，不能伪装成条目不存在。
        throw error;
    }
}

function parseShorthand(value: unknown, fallbackId = ""): Shorthand | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const fields = ["shorthandMd", "shorthandDesc", "shorthandTitle", "shorthandURL", "hCreated"] as const;
    if (fields.some((field) => raw[field] != null && typeof raw[field] !== "string")) return null;
    if (!("oId" in raw) && !fields.some((field) => field in raw)) return null;
    const oId = raw.oId == null ? fallbackId : typeof raw.oId === "string" || (typeof raw.oId === "number" && Number.isFinite(raw.oId)) ? String(raw.oId) : "";
    if (!oId.trim()) return null;
    return {
        oId,
        shorthandMd: String(raw.shorthandMd ?? ""),
        shorthandDesc: String(raw.shorthandDesc ?? ""),
        shorthandTitle: String(raw.shorthandTitle ?? ""),
        shorthandURL: String(raw.shorthandURL ?? ""),
        hCreated: String(raw.hCreated ?? ""),
    };
}

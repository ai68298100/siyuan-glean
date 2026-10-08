/**
 * 收集箱 API（T-1500，契约内核源码核实 api/inbox.go + apicontract/inbox.go）：
 * - getShorthands {page} → 响应双层包裹：response.data = {code, msg, data: {pagination, shorthands[]}}
 *   （云收件箱特有形状，防御式剥层）
 * - removeShorthands {ids[]}；未登录/无订阅时 code!=0（调用方降级隐藏 UI）
 */
import { kernelPost } from "./client";

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
    /** null=不可用（未登录/无订阅/网络失败），调用方隐藏收集箱 UI */
    page: ShorthandsPage | null;
    error: string;
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
        const outer = await kernelPost<RawShorthandsResponse>("/api/inbox/getShorthands", { page });
        if (!outer || outer.code !== 0 || !Array.isArray(outer.data?.shorthands)) {
            return { page: null, error: "inbox unavailable" };
        }
        const shorthands: Shorthand[] = [];
        for (const raw of outer.data.shorthands) {
            const shorthand = parseShorthand(raw);
            if (!shorthand) return { page: null, error: "invalid inbox item" };
            shorthands.push(shorthand);
        }
        const pageCount = Number(outer.data.pagination?.paginationPageCount ?? 1);
        const recordCount = Number(outer.data.pagination?.paginationRecordCount ?? shorthands.length);
        if (!Number.isFinite(pageCount) || pageCount < 0 || !Number.isFinite(recordCount) || recordCount < 0) {
            return { page: null, error: "invalid inbox pagination" };
        }
        return { page: { shorthands, recordCount, hasMore: page < pageCount }, error: "" };
    } catch {
        return { page: null, error: "inbox unavailable" };
    }
}

export async function removeShorthands(ids: string[]): Promise<void> {
    await kernelPost<void>("/api/inbox/removeShorthands", { ids });
}

/** 按 ID 取单条收集箱条目（迁移菜单通道）。 */
export async function getShorthand(id: string): Promise<Shorthand | null> {
    try {
        return parseShorthand(await kernelPost<unknown>("/api/inbox/getShorthand", { id }), id);
    } catch (error) {
        // 静默返回 null 让调用方跳过，但留下日志避免"总数对不上"无从排查
        console.warn("[glean] 收集箱条目读取失败，跳过:", id, error);
        return null;
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

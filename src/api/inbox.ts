/**
 * 收集箱 API（T-1500，契约内核源码核实 api/inbox.go + apicontract/inbox.go）：
 * - getShorthands {page} → 响应双层包裹：response.data = {code, msg, data: {pagination, shorthands[]}}
 *   （云收件箱特有形状，防御式剥层）
 * - removeShorthands {ids[]}；未登录/无订阅时 code!=0（调用方降级隐藏 UI）
 */
import { fetchPost } from "siyuan";

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
        code?: number;
        msg?: string;
        data?: {
            pagination?: { paginationRecordCount?: number; paginationPageCount?: number };
            shorthands?: Array<Record<string, unknown>>;
        };
    };
}

export async function getShorthands(page = 1): Promise<InboxAvailability> {
    return new Promise((resolve) => {
        fetchPost("/api/inbox/getShorthands", { page }, (response: { code?: number; msg?: string; data?: unknown }) => {
            if (!response || typeof response.code !== "number" || response.code !== 0) {
                resolve({ page: null, error: response?.msg || "inbox unavailable" });
                return;
            }
            // 双层剥包
            const outer = response.data as RawShorthandsResponse | undefined;
            const inner = (outer && typeof outer === "object" && "data" in outer ? outer.data : undefined) as
                | { pagination?: { paginationRecordCount?: number; paginationPageCount?: number }; shorthands?: Array<Record<string, unknown>> }
                | undefined;
            const rawList = inner?.shorthands ?? [];
            const shorthands: Shorthand[] = rawList
                .filter((raw): raw is Record<string, string> => Boolean(raw && typeof raw === "object"))
                .map((raw) => ({
                    oId: String(raw.oId ?? ""),
                    shorthandMd: String(raw.shorthandMd ?? ""),
                    shorthandDesc: String(raw.shorthandDesc ?? ""),
                    shorthandTitle: String(raw.shorthandTitle ?? ""),
                    shorthandURL: String(raw.shorthandURL ?? ""),
                    hCreated: String(raw.hCreated ?? ""),
                }));
            const pageCount = Number(inner?.pagination?.paginationPageCount ?? 1);
            resolve({
                page: {
                    shorthands,
                    recordCount: Number(inner?.pagination?.paginationRecordCount ?? shorthands.length),
                    hasMore: page < pageCount,
                },
                error: "",
            });
        });
    });
}

export async function removeShorthands(ids: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        fetchPost("/api/inbox/removeShorthands", { ids }, (response: { code?: number; msg?: string }) => {
            if (response && typeof response.code === "number" && response.code !== 0) {
                reject(new Error(`removeShorthands code=${response.code} msg=${response.msg || ""}`));
            } else {
                resolve();
            }
        });
    });
}

/** 按 ID 取单条收集箱条目（迁移菜单通道）。 */
export async function getShorthand(id: string): Promise<Shorthand | null> {
    return new Promise((resolve) => {
        fetchPost('/api/inbox/getShorthand', { id }, (response: { code?: number; data?: unknown }) => {
            if (!response || typeof response.code !== 'number' || response.code !== 0) {
                resolve(null);
                return;
            }
            const raw = (response.data ?? {}) as Record<string, unknown>;
            resolve({
                oId: String(raw.oId ?? id),
                shorthandMd: String(raw.shorthandMd ?? ''),
                shorthandDesc: String(raw.shorthandDesc ?? ''),
                shorthandTitle: String(raw.shorthandTitle ?? ''),
                shorthandURL: String(raw.shorthandURL ?? ''),
                hCreated: String(raw.hCreated ?? ''),
            });
        });
    });
}

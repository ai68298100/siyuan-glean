/**
 * 剪藏属性 schema（DATA-CONTRACT §1 的唯一代码事实源）。
 * 纯函数层：不 import 思源 SDK / svelte / api；类型还原与序列化只在这里发生。
 * 铁律（D-0001）：属性一旦写入永不丢失；用户手填字段不得被 AI/迁移器覆盖。
 */

export const CLIP_STATUSES = ["inbox", "later", "reading", "done", "archived"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const CLIP_SOURCES = [
    "web-clipper",
    "inbox",
    "manual",
    "migration",
    "import-pocket",
    "import-omnivore",
    "import-wallabag",
] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

/** IAL 键名（custom-* 属性）。值在 IAL 里一律是字符串。 */
export const ATTR = {
    url: "custom-clip-url",
    site: "custom-clip-site",
    time: "custom-clip-time",
    status: "custom-clip-status",
    words: "custom-clip-words",
    minutes: "custom-clip-minutes",
    priority: "custom-clip-priority",
    rating: "custom-clip-rating",
    aiTags: "custom-clip-ai-tags",
    summary: "custom-clip-summary",
    lastSurfaced: "custom-clip-last-surfaced",
    /** 单文件 HTML 快照（assets 路径，T-1504） */
    snapshot: "custom-clip-snapshot",
    src: "custom-clip-src",
} as const;

export type AttrKey = (typeof ATTR)[keyof typeof ATTR];

/** 文章属性的强类型视图（IAL 解析产物）。undefined = 文档上没有该键。 */
export interface ClipAttrs {
    url?: string;
    site?: string;
    time?: string;
    status?: ClipStatus;
    words?: number;
    minutes?: number;
    priority?: number;
    rating?: number;
    aiTags: string[];
    summary?: string;
    lastSurfaced?: string;
    snapshot?: string;
    src?: ClipSource;
}

/** 待写回文档的属性补丁。值 = 字符串（IAL 形态）；null = 删除该键。 */
export type AttrPatch = Record<string, string | null>;

/** 面板/索引用的轻量投影 */
export interface ClipSummary {
    id: string;
    title: string;
    hpath: string;
    box: string;
    attrs: ClipAttrs;
}

/* ---------- 解析 ---------- */

const isDigits = (value: string): boolean => /^\d+$/.test(value);

function parseNumber(value: string | undefined): number | undefined {
    if (value === undefined || !isDigits(value)) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** IAL 是用户可手改的，解析时对范围型数字做防御性钳制 */
function parseClamped(value: string | undefined, min: number, max: number): number | undefined {
    const parsed = parseNumber(value);
    return parsed === undefined ? undefined : Math.min(max, Math.max(min, parsed));
}

function parseStatus(value: string | undefined): ClipStatus | undefined {
    return CLIP_STATUSES.find((status) => status === value);
}

function parseSource(value: string | undefined): ClipSource | undefined {
    return CLIP_SOURCES.find((source) => source === value);
}

function parseTags(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

/** 把根块 IAL（getBlockAttrs 的返回）解析成强类型属性视图。非法值一律丢弃，不抛错。 */
export function parseClipAttrs(ial: Record<string, string | undefined>): ClipAttrs {
    return {
        url: optionalString(ial[ATTR.url]),
        site: optionalString(ial[ATTR.site]),
        time: optionalString(ial[ATTR.time]),
        status: parseStatus(ial[ATTR.status]),
        words: parseNumber(ial[ATTR.words]),
        minutes: parseNumber(ial[ATTR.minutes]),
        priority: parseClamped(ial[ATTR.priority], 1, 5),
        rating: parseClamped(ial[ATTR.rating], 0, 5),
        aiTags: parseTags(ial[ATTR.aiTags]),
        summary: optionalString(ial[ATTR.summary]),
        lastSurfaced: optionalString(ial[ATTR.lastSurfaced]),
        snapshot: optionalString(ial[ATTR.snapshot]),
        src: parseSource(ial[ATTR.src]),
    };
}

function optionalString(value: string | undefined): string | undefined {
    return value && value.length > 0 ? value : undefined;
}

/** 是否已是"读库文章"：带状态或带来源 URL 即认（与迁移幂等跳过条件一致）。 */
export function isClipDoc(ial: Record<string, string | undefined>): boolean {
    return Boolean(ial[ATTR.status] || ial[ATTR.url]);
}

/* ---------- 序列化 ---------- */

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 属性补丁 → IAL 写入形态。
 * - number 字段做范围钳制（priority 1-5 / rating 0-5），undefined/null 的键不出现在结果里；
 * - 显式传 null 的键保留为 null（删除语义）；
 * - aiTags 数组序列化为逗号分割字符串。
 */
export function serializePatch(patch: Partial<ClipAttrs> & { aiTags?: string[] | null }): AttrPatch {
    const out: AttrPatch = {};
    const put = (key: AttrKey, value: string | null | undefined) => {
        if (value === undefined) return;
        out[key] = value;
    };
    if (patch.url !== undefined) put(ATTR.url, patch.url || null);
    if (patch.site !== undefined) put(ATTR.site, patch.site || null);
    if (patch.time !== undefined) put(ATTR.time, patch.time || null);
    if (patch.status !== undefined) put(ATTR.status, patch.status ?? null);
    if (patch.words !== undefined) put(ATTR.words, patch.words === null ? null : String(Math.max(0, Math.round(patch.words))));
    if (patch.minutes !== undefined) put(ATTR.minutes, patch.minutes === null ? null : String(Math.max(0, Math.round(patch.minutes))));
    if (patch.priority !== undefined) put(ATTR.priority, patch.priority === null ? null : String(clampInt(patch.priority, 1, 5)));
    if (patch.rating !== undefined) put(ATTR.rating, patch.rating === null ? null : String(clampInt(patch.rating, 0, 5)));
    if (patch.aiTags !== undefined) put(ATTR.aiTags, patch.aiTags === null ? null : patch.aiTags.join(","));
    if (patch.summary !== undefined) put(ATTR.summary, patch.summary || null);
    if (patch.lastSurfaced !== undefined) put(ATTR.lastSurfaced, patch.lastSurfaced || null);
    if (patch.snapshot !== undefined) put(ATTR.snapshot, patch.snapshot || null);
    if (patch.src !== undefined) put(ATTR.src, patch.src ?? null);
    return out;
}

/* ---------- 派生计算 ---------- */

/** 预计阅读分钟：400 字/分钟，四舍五入；至少 1 分钟（有正文时）。 */
export function estimateMinutes(words: number): number {
    if (words <= 0) return 0;
    return Math.max(1, Math.round(words / 400));
}

/** 中英混排字数：CJK 字符逐字计，拉丁词按词计。 */
export function countWords(text: string): number {
    if (!text) return 0;
    const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
    const latin = text.replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, " ").match(/[A-Za-z0-9'’]+/g)?.length ?? 0;
    return cjk + latin;
}

/** 从 URL 提取站点名（去 www，保主机名；失败返回空串）。 */
export function siteFromUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        return parsed.hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

/** 思源时间格式 YYYYMMDDHHmmss */
export function siyuanTimestamp(now: Date = new Date()): string {
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 重浮记录用日期 YYYYMMDD */
export function siyuanDate(now: Date = new Date()): string {
    return siyuanTimestamp(now).slice(0, 8);
}

/** 入库时间（YYYYMMDDHHmmss）距今天数；解析失败返回 null。 */
export function daysSince(time: string | undefined, now: Date = new Date()): number | null {
    if (!time || !/^\d{14}$/.test(time)) return null;
    const parsed = new Date(
        Number(time.slice(0, 4)),
        Number(time.slice(4, 6)) - 1,
        Number(time.slice(6, 8)),
        Number(time.slice(8, 10)),
        Number(time.slice(10, 12)),
        Number(time.slice(12, 14))
    );
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

/* ---------- 状态机 ---------- */

/** 允许的单步流转（批量操作可任意设置，这里约束的是"逐篇点击"的常规路径）。 */
const ALLOWED_TRANSITIONS: Record<ClipStatus, ClipStatus[]> = {
    inbox: ["later", "reading", "done", "archived"],
    later: ["reading", "done", "archived", "inbox"],
    reading: ["done", "later", "archived"],
    done: ["reading", "archived"],
    archived: ["later", "inbox", "reading"],
};

export function canTransition(from: ClipStatus, to: ClipStatus): boolean {
    return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/** 收录时补全的完整属性集（status 缺省 inbox，priority 缺省 3）。 */
export function captureDefaults(now: Date = new Date()): Partial<ClipAttrs> {
    return {
        status: "inbox",
        priority: 3,
        time: siyuanTimestamp(now),
        src: "manual",
    };
}

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

/** 正文载体：fulltext=本地有正文，link=仅来源链接，local=用户指定本地文档。 */
export const CLIP_CONTENT_TYPES = ["fulltext", "link", "local"] as const;
export type ClipContentType = (typeof CLIP_CONTENT_TYPES)[number];

/** custom-clip-time 的来源；legacy 表示历史值无法可靠追溯。 */
export const CLIP_TIME_SOURCES = ["source", "document", "capture", "legacy"] as const;
export type ClipTimeSource = (typeof CLIP_TIME_SOURCES)[number];

/** IAL 键名（custom-* 属性）。值在 IAL 里一律是字符串。 */
export const ATTR = {
    url: "custom-clip-url",
    site: "custom-clip-site",
    time: "custom-clip-time",
    status: "custom-clip-status",
    /** 最近一次显式标记读完的时刻；缺键 = 完成时间未知（D-0028）。 */
    doneTime: "custom-clip-done-time",
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
    contentType: "custom-clip-content-type",
    timeSource: "custom-clip-time-source",
    /** 用户确认“不是文章”后写入，避免候选扫描反复打扰。 */
    excluded: "custom-clip-excluded",
    /** 用户显式收藏标记（T-1755/T-1904）：独立布尔位，与 priority 语义分离。 */
    favorite: "custom-clip-favorite",
    /** 插件内部宿主文档标志；新建时写入，旧文档由候选规则回退推断。 */
    internal: "custom-clip-internal",
} as const;

export type AttrKey = (typeof ATTR)[keyof typeof ATTR];

/** 文章属性的强类型视图（IAL 解析产物）。undefined = 文档上没有该键。 */
export interface ClipAttrs {
    url?: string;
    site?: string;
    time?: string;
    status?: ClipStatus;
    doneTime?: string;
    words?: number;
    minutes?: number;
    priority?: number;
    rating?: number;
    aiTags: string[];
    summary?: string;
    lastSurfaced?: string;
    snapshot?: string;
    src?: ClipSource;
    contentType?: ClipContentType;
    timeSource?: ClipTimeSource;
    excluded?: boolean;
    favorite?: boolean;
    internal?: boolean;
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

function parseContentType(value: string | undefined): ClipContentType | undefined {
    return CLIP_CONTENT_TYPES.find((kind) => kind === value);
}

function parseTimeSource(value: string | undefined): ClipTimeSource | undefined {
    return CLIP_TIME_SOURCES.find((source) => source === value);
}

function parseFlag(value: string | undefined): boolean | undefined {
    return value?.toLowerCase() === "true" ? true : undefined;
}

function parseTags(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

/**
 * 解析思源根块的用户 tags IAL。
 *
 * `tags` 是思源/剪藏写入的用户标签位，不属于 custom-clip-* 属性，
 * 因此只能作为只读投影使用。思源版本和导入来源可能使用逗号、空格，
 * 或 `#标签#` 包裹，统一在域层拆成可比较的标签名。
 */
export function parseUserTags(value: string | undefined): string[] {
    if (!value) return [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const raw of value.split(/[,，\s]+/)) {
        const tag = raw.trim().replace(/^#+|#+$/g, "");
        if (!tag || seen.has(tag.toLowerCase())) continue;
        seen.add(tag.toLowerCase());
        tags.push(tag);
    }
    return tags;
}

/** 把根块 IAL（getBlockAttrs 的返回）解析成强类型属性视图。非法值一律丢弃，不抛错。 */
export function parseClipAttrs(ial: Record<string, string | undefined>): ClipAttrs {
    return {
        url: optionalString(ial[ATTR.url]),
        site: optionalString(ial[ATTR.site]),
        time: optionalString(ial[ATTR.time]),
        status: parseStatus(ial[ATTR.status]),
        doneTime: optionalString(ial[ATTR.doneTime]),
        words: parseNumber(ial[ATTR.words]),
        minutes: parseNumber(ial[ATTR.minutes]),
        priority: parseClamped(ial[ATTR.priority], 1, 5),
        rating: parseClamped(ial[ATTR.rating], 0, 5),
        aiTags: parseTags(ial[ATTR.aiTags]),
        summary: optionalString(ial[ATTR.summary]),
        lastSurfaced: optionalString(ial[ATTR.lastSurfaced]),
        snapshot: optionalString(ial[ATTR.snapshot]),
        src: parseSource(ial[ATTR.src]),
        contentType: parseContentType(ial[ATTR.contentType]),
        // 旧数据没有来源标记；保留原时间且如实呈现为 legacy。
        timeSource: parseTimeSource(ial[ATTR.timeSource]) ?? (ial[ATTR.time] ? "legacy" : undefined),
        excluded: parseFlag(ial[ATTR.excluded]),
        favorite: parseFlag(ial[ATTR.favorite]),
        internal: parseFlag(ial[ATTR.internal]),
    };
}

function optionalString(value: string | undefined): string | undefined {
    return value && value.length > 0 ? value : undefined;
}

/** 是否已有读库线索：状态属性或来源 URL 均算；URL-only 仍待用户确认收录。 */
export function isClipDoc(ial: Record<string, string | undefined>): boolean {
    return Boolean(ial[ATTR.status] || ial[ATTR.url]);
}

/**
 * 插件内部宿主判定（T-1987）：只有带 custom-clip-internal 标记的文档才可信复用。
 * 同名/同路径的用户文档一律视为用户文档，不得当作宿主绑定、写入或补挂内容。
 */
export function isMarkedInternalDoc(ial: Record<string, string | undefined>): boolean {
    return parseFlag(ial[ATTR.internal]) === true;
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
    if (patch.doneTime !== undefined) put(ATTR.doneTime, patch.doneTime || null);
    if (patch.words !== undefined) put(ATTR.words, patch.words === null ? null : String(Math.max(0, Math.round(patch.words))));
    if (patch.minutes !== undefined) put(ATTR.minutes, patch.minutes === null ? null : String(Math.max(0, Math.round(patch.minutes))));
    if (patch.priority !== undefined) put(ATTR.priority, patch.priority === null ? null : String(clampInt(patch.priority, 1, 5)));
    if (patch.rating !== undefined) put(ATTR.rating, patch.rating === null ? null : String(clampInt(patch.rating, 0, 5)));
    if (patch.aiTags !== undefined) put(ATTR.aiTags, patch.aiTags === null ? null : patch.aiTags.join(","));
    if (patch.summary !== undefined) put(ATTR.summary, patch.summary || null);
    if (patch.lastSurfaced !== undefined) put(ATTR.lastSurfaced, patch.lastSurfaced || null);
    if (patch.snapshot !== undefined) put(ATTR.snapshot, patch.snapshot || null);
    if (patch.src !== undefined) put(ATTR.src, patch.src ?? null);
    if (patch.contentType !== undefined) put(ATTR.contentType, patch.contentType ?? null);
    if (patch.timeSource !== undefined) put(ATTR.timeSource, patch.timeSource ?? null);
    if (patch.excluded !== undefined) put(ATTR.excluded, patch.excluded ? "true" : null);
    if (patch.favorite !== undefined) put(ATTR.favorite, patch.favorite ? "true" : null);
    if (patch.internal !== undefined) put(ATTR.internal, patch.internal ? "true" : null);
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

/** 从思源文档 ID 的前 14 位取创建时间；无效 ID 不臆造时间。 */
export function documentTimeFromId(docId: string): string | null {
    const stamp = String(docId ?? "").slice(0, 14);
    if (!/^\d{14}$/.test(stamp)) return null;
    const year = Number(stamp.slice(0, 4));
    const month = Number(stamp.slice(4, 6));
    const day = Number(stamp.slice(6, 8));
    const hour = Number(stamp.slice(8, 10));
    const minute = Number(stamp.slice(10, 12));
    const second = Number(stamp.slice(12, 14));
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
        date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
    return stamp;
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

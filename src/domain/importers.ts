/**
 * 外部服务迁移导入解析器（T-1501）：Pocket HTML/CSV、Omnivore JSON、wallabag JSON。
 * 纯函数层：字符串进出，零依赖；解析必须防御性（外部导出格式随版本漂移），坏行跳过不抛错。
 * 状态映射（平静原则）：unread→inbox / read→done / archive→archived；未知状态→inbox。
 */
import { normalizeUrl } from "./url.ts";

export type ImportFormat = "pocket-html" | "pocket-csv" | "omnivore-json" | "wallabag-json";

export interface ImportedItem {
    title: string;
    url: string;
    site: string;
    /** 原服务收藏时间（思源格式 YYYYMMDDHHmmss）；解析不出为空串 */
    time: string;
    /** 原服务标记已读时间（仅 Pocket time_read 提供）；空串 = 未知（D-0028） */
    doneTime: string;
    tags: string[];
    status: "inbox" | "done" | "archived";
}

export interface ParseResult {
    format: ImportFormat;
    items: ImportedItem[];
    /** 文件内重复/无效被丢弃的行数 */
    dropped: number;
}

/* ---------- 格式探测 ---------- */

export function detectFormat(raw: string): ImportFormat | null {
    const text = raw.trim();
    if (/^</i.test(text)) {
        if (/pocket/i.test(text.slice(0, 500)) || /time_added=/i.test(text)) return "pocket-html";
        if (/<html|<ul|<li/i.test(text.slice(0, 500))) return "pocket-html";
        return null;
    }
    if (text.startsWith("[") || text.startsWith("{")) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            return null;
        }
        if (Array.isArray(parsed)) {
            const first = parsed[0] as Record<string, unknown> | undefined;
            if (first && ("originalArticleUrl" in first || ("url" in first && "state" in first))) return "omnivore-json";
        }
        if (parsed && typeof parsed === "object") {
            const record = parsed as Record<string, unknown>;
            if (Array.isArray(record.entries)) {
                const first = record.entries[0] as Record<string, unknown> | undefined;
                if (first && ("url" in first || "is_archived" in first)) return "wallabag-json";
            }
        }
        return null;
    }
    // CSV：首行含 time_added 即 Pocket CSV
    const firstLine = text.split(/\r?\n/)[0]?.toLowerCase() ?? "";
    if (firstLine.includes("time_added") && firstLine.includes("url")) return "pocket-csv";
    return null;
}

/* ---------- 公共工具 ---------- */

function siteFromUrl(rawUrl: string): string {
    try {
        return new URL(rawUrl).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

/** unix 秒 / ISO 8601 → YYYYMMDDHHmmss；解析不出为空串 */
export function toSiyuanTime(value: unknown): string {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const num = typeof value === "number" ? value : /^\d{10}$/.test(value.trim()) ? Number(value) : Date.parse(value);
    if (typeof num !== "number" || !Number.isFinite(num)) return "";
    const date = new Date(num < 10_000_000_000 ? num * 1000 : num);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizeStatus(value: unknown): ImportedItem["status"] {
    const text = String(value ?? "").toLowerCase();
    if (text === "read" || text === "1") return "done";
    if (text === "archive" || text === "archived") return "archived";
    return "inbox";
}

function dedupe(items: ImportedItem[]): { items: ImportedItem[]; dropped: number } {
    const seen = new Set<string>();
    const kept: ImportedItem[] = [];
    let dropped = 0;
    for (const item of items) {
        const key = normalizeUrl(item.url);
        if (!key || seen.has(key)) {
            dropped += 1;
            continue;
        }
        seen.add(key);
        kept.push(item);
    }
    return { items: kept, dropped };
}

/* ---------- Pocket HTML ---------- */

export function parsePocketHtml(raw: string): ParseResult {
    const items: ImportedItem[] = [];
    // 属性顺序不固定的 <a> 锚点逐条解析，再分别取 href/time_added/tags/文本
    const fullRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = fullRe.exec(raw)) !== null) {
        const attrs = match[1];
        const href = /href="([^"]+)"/i.exec(attrs)?.[1] ?? "";
        const timeAdded = /time_added="([^"]*)"/i.exec(attrs)?.[1] ?? "";
        const timeRead = /time_read="([^"]*)"/i.exec(attrs)?.[1] ?? "";
        const tags = /tags="([^"]*)"/i.exec(attrs)?.[1] ?? "";
        const title = match[2].replace(/<[^>]+>/g, "").trim();
        if (!href) continue;
        items.push({
            title,
            url: href,
            site: siteFromUrl(href),
            time: toSiyuanTime(timeAdded),
            doneTime: toSiyuanTime(timeRead),
            tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            status: "inbox",
        });
    }
    const deduped = dedupe(items);
    return { format: "pocket-html", items: deduped.items, dropped: deduped.dropped };
}

/* ---------- Pocket CSV ---------- */

export function parsePocketCsv(raw: string): ParseResult {
    const rows = parseCsv(raw);
    if (rows.length === 0) return { format: "pocket-csv", items: [], dropped: 0 };
    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iTitle = idx("title");
    const iUrl = idx("url");
    const iTime = idx("time_added");
    const iRead = idx("time_read");
    const iStatus = idx("status");
    const iTags = idx("tags");
    const items: ImportedItem[] = [];
    for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        // 外部导出的行可能比表头短（缺列）；防御性取值，缺字段按空串处理。
        const cell = (index: number) => (index >= 0 ? row[index] ?? "" : "");
        const url = cell(iUrl).trim();
        if (!url) continue;
        items.push({
            title: cell(iTitle).trim(),
            url,
            site: siteFromUrl(url),
            time: toSiyuanTime(cell(iTime)),
            doneTime: toSiyuanTime(cell(iRead)),
            tags: cell(iTags)
                .split(",")
                .map((tag) => tag.trim().replace(/^#/, ""))
                .filter(Boolean),
            status: normalizeStatus(cell(iStatus)),
        });
    }
    const deduped = dedupe(items);
    return { format: "pocket-csv", items: deduped.items, dropped: deduped.dropped };
}

/** 最小 CSV 解析：支持双引号包裹与转义引号("")，不支持多行单元格。 */
export function parseCsv(raw: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (inQuotes) {
            if (ch === '"') {
                if (raw[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            row.push(cell);
            cell = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && raw[i + 1] === "\n") i += 1;
            row.push(cell);
            cell = "";
            if (row.length > 1 || row[0] !== "") rows.push(row);
            row = [];
        } else {
            cell += ch;
        }
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
}

/* ---------- Omnivore JSON ---------- */

interface OmnivorePage {
    title?: unknown;
    slug?: unknown;
    siteName?: unknown;
    originalArticleUrl?: unknown;
    url?: unknown;
    savedAt?: unknown;
    labels?: unknown;
    state?: unknown;
    isArchived?: unknown;
}

export function parseOmnivoreJson(raw: string): ParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { format: "omnivore-json", items: [], dropped: 0 };
    }
    if (!Array.isArray(parsed)) return { format: "omnivore-json", items: [], dropped: 0 };
    const items: ImportedItem[] = [];
    for (const page of parsed as OmnivorePage[]) {
        if (!page || typeof page !== "object") continue;
        const url = String(page.originalArticleUrl ?? page.url ?? "");
        if (!url) continue;
        const labels = Array.isArray(page.labels)
            ? (page.labels as Array<{ name?: unknown }>).map((label) => String(label?.name ?? "")).filter(Boolean)
            : [];
        const archived = page.isArchived === true;
        items.push({
            title: String(page.title ?? ""),
            url,
            site: String(page.siteName ?? "") || siteFromUrl(url),
            time: toSiyuanTime(page.savedAt),
            doneTime: "",
            tags: labels,
            status: archived ? "archived" : "inbox",
        });
    }
    const deduped = dedupe(items);
    return { format: "omnivore-json", items: deduped.items, dropped: deduped.dropped };
}

/* ---------- wallabag JSON ---------- */

interface WallabagEntry {
    title?: unknown;
    url?: unknown;
    domain_name?: unknown;
    created_at?: unknown;
    tags?: unknown;
    is_archived?: unknown;
    is_read?: unknown;
}

export function parseWallabagJson(raw: string): ParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { format: "wallabag-json", items: [], dropped: 0 };
    }
    const entries = Array.isArray(parsed)
        ? (parsed as WallabagEntry[])
        : Array.isArray((parsed as Record<string, unknown>)?.entries)
          ? ((parsed as Record<string, unknown>).entries as WallabagEntry[])
          : [];
    const items: ImportedItem[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const url = String(entry.url ?? "");
        if (!url) continue;
        const tags = Array.isArray(entry.tags)
            ? (entry.tags as Array<{ label?: unknown }>).map((tag) => String(tag?.label ?? "")).filter(Boolean)
            : [];
        const archived = entry.is_archived === 1 || entry.is_archived === true;
        const read = entry.is_read === 1 || entry.is_read === true;
        items.push({
            title: String(entry.title ?? ""),
            url,
            site: String(entry.domain_name ?? "") || siteFromUrl(url),
            time: toSiyuanTime(entry.created_at),
            doneTime: "",
            tags,
            status: archived ? "archived" : read ? "done" : "inbox",
        });
    }
    const deduped = dedupe(items);
    return { format: "wallabag-json", items: deduped.items, dropped: deduped.dropped };
}

/* ---------- 统一入口 ---------- */

export function parseImport(raw: string, format: ImportFormat | "auto"): ParseResult {
    const resolved = format === "auto" ? detectFormat(raw) : format;
    switch (resolved) {
        case "pocket-html": return parsePocketHtml(raw);
        case "pocket-csv": return parsePocketCsv(raw);
        case "omnivore-json": return parseOmnivoreJson(raw);
        case "wallabag-json": return parseWallabagJson(raw);
        default: return { format: "pocket-html", items: [], dropped: 0 };
    }
}

import type { LibraryFilter, LibrarySortDirection, LibrarySortKey } from "./library-view.ts";
import type { ClipStatus } from "./schema.ts";

export const READER_FONT_SIZES = ["small", "normal", "large"] as const;
export const READER_LINE_HEIGHTS = ["compact", "normal", "relaxed"] as const;
export const READER_WIDTHS = ["narrow", "normal", "wide"] as const;
export const READER_THEMES = ["follow", "paper", "eye"] as const;

export type ReaderAppearance = {
    fontSize: (typeof READER_FONT_SIZES)[number];
    lineHeight: (typeof READER_LINE_HEIGHTS)[number];
    width: (typeof READER_WIDTHS)[number];
    theme: (typeof READER_THEMES)[number];
};

export type SavedViewLayout = "list" | "kanban";
export type SavedViewFilter = Pick<LibraryFilter, "status" | "site" | "author" | "tag" | "aiTag" | "src" | "timeSource" | "contentType" | "keyword" | "sortBy" | "direction">;
export const GOVERNANCE_CUE_KEYS = ["quota", "stale", "candidates"] as const;
export type GovernanceCueKey = (typeof GOVERNANCE_CUE_KEYS)[number];
export type GovernanceMuted = Record<GovernanceCueKey, string>;

export interface SavedView {
    id: string;
    name: string;
    filter: SavedViewFilter;
    layout: SavedViewLayout;
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = {
    fontSize: "normal",
    lineHeight: "normal",
    width: "normal",
    theme: "follow",
};

export const EMPTY_GOVERNANCE_MUTED: GovernanceMuted = { quota: "", stale: "", candidates: "" };

export function localDateStamp(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isValidLocalDateStamp(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function normalizeGovernanceMuted(raw: unknown): GovernanceMuted {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const result = { ...EMPTY_GOVERNANCE_MUTED };
    for (const key of GOVERNANCE_CUE_KEYS) {
        const candidate = value[key];
        result[key] = typeof candidate === "string" && isValidLocalDateStamp(candidate) ? candidate : "";
    }
    return result;
}

export function governanceCueMuted(key: GovernanceCueKey, muted: GovernanceMuted, now = new Date()): boolean {
    return muted[key] === localDateStamp(now);
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
    return typeof value === "string" && values.includes(value);
}

function cleanText(value: unknown, maxLength = Number.MAX_SAFE_INTEGER): string {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalString(value: unknown): string | undefined {
    const result = cleanText(value);
    return result || undefined;
}

export function normalizeReaderAppearance(raw: unknown): ReaderAppearance {
    const value = raw && typeof raw === "object" ? raw as Partial<ReaderAppearance> : {};
    return {
        fontSize: isOneOf(READER_FONT_SIZES, value.fontSize) ? value.fontSize : DEFAULT_READER_APPEARANCE.fontSize,
        lineHeight: isOneOf(READER_LINE_HEIGHTS, value.lineHeight) ? value.lineHeight : DEFAULT_READER_APPEARANCE.lineHeight,
        width: isOneOf(READER_WIDTHS, value.width) ? value.width : DEFAULT_READER_APPEARANCE.width,
        theme: isOneOf(READER_THEMES, value.theme) ? value.theme : DEFAULT_READER_APPEARANCE.theme,
    };
}

function normalizeStatus(value: unknown): ClipStatus | "all" | undefined {
    return ["inbox", "later", "reading", "done", "archived", "all"].includes(String(value)) ? value as ClipStatus | "all" : undefined;
}

function normalizeFilter(raw: unknown): SavedViewFilter {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const filter: SavedViewFilter = {};
    const status = normalizeStatus(value.status);
    if (status) filter.status = status;
    for (const key of ["site", "author", "tag", "aiTag", "src", "timeSource", "contentType", "keyword"] as const) {
        const text = optionalString(value[key]);
        if (text) filter[key] = text;
    }
    if (isOneOf(["time", "updated", "words", "priority", "rating", "title"] as const, value.sortBy)) filter.sortBy = value.sortBy as LibrarySortKey;
    if (isOneOf(["asc", "desc"] as const, value.direction)) filter.direction = value.direction as LibrarySortDirection;
    return filter;
}

export function normalizeSavedViews(raw: unknown): SavedView[] {
    if (!Array.isArray(raw)) return [];
    const ids = new Set<string>();
    const names = new Set<string>();
    const result: SavedView[] = [];
    for (const candidate of raw) {
        if (!candidate || typeof candidate !== "object") continue;
        const value = candidate as Record<string, unknown>;
        const id = cleanText(value.id, 120);
        const name = cleanText(value.name, 40);
        const layout = value.layout === "kanban" ? "kanban" : value.layout === "list" ? "list" : "";
        const nameKey = name.toLocaleLowerCase();
        if (!id || !name || !layout || ids.has(id) || names.has(nameKey)) continue;
        ids.add(id);
        names.add(nameKey);
        result.push({ id, name, filter: normalizeFilter(value.filter), layout });
        if (result.length >= 20) break;
    }
    return result;
}

export function cloneSavedView(view: SavedView): SavedView {
    return { ...view, filter: { ...view.filter } };
}

export function createSavedView(
    name: string,
    filter: LibraryFilter,
    layout: SavedViewLayout,
    existing: readonly SavedView[],
    id: string,
): SavedView | null {
    const normalized = normalizeSavedViews([...existing, { id, name, filter, layout }]);
    const created = normalized.find((view) => view.id === id);
    return created ? cloneSavedView(created) : null;
}

export function applySavedView(views: readonly SavedView[], id: string): SavedView | null {
    const found = views.find((view) => view.id === id);
    return found ? cloneSavedView(found) : null;
}

export function setDefaultSavedView(views: readonly SavedView[], id: string): string {
    return views.some((view) => view.id === id) ? id : "";
}

export function deleteSavedView(views: readonly SavedView[], id: string, defaultSavedViewId = ""): { views: SavedView[]; defaultSavedViewId: string } {
    return { views: views.filter((view) => view.id !== id).map(cloneSavedView), defaultSavedViewId: defaultSavedViewId === id ? "" : defaultSavedViewId };
}

export function summarizeSavedViewFilter(filter: SavedViewFilter): SavedViewFilter {
    return { ...normalizeFilter(filter) };
}

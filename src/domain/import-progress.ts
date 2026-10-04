import type { ImportFormat } from "./importers.ts";

export const IMPORT_PROGRESS_FILE = "import-progress.json";
export const IMPORT_ROW_STATES = ["pending", "creating", "created", "applied", "duplicate", "failed", "unknown"] as const;
export type ImportRowState = (typeof IMPORT_ROW_STATES)[number];
export type ImportFailureReason = "" | "missing" | "changed" | "internal" | "conflict" | "read" | "capture" | "unknown";
export type ImportProgressReason = "invalid" | "busy" | "unfinished" | "changed" | "file" | "target" | "confirmation" | "read" | "save";

export class ImportProgressError extends Error {
    readonly reason: ImportProgressReason;
    constructor(reason: ImportProgressReason) { super(reason); this.reason = reason; }
}

export interface ImportProgressRow {
    key: string;
    hpath: string;
    state: ImportRowState;
    docId: string;
    reason: ImportFailureReason;
}

export interface ImportProgress {
    version: 1;
    taskId: string;
    fingerprint: string;
    format: ImportFormat;
    notebookId: string;
    folder: string;
    state: "running" | "paused" | "finished";
    createdAt: string;
    updatedAt: string;
    rows: ImportProgressRow[];
}

export function isImportId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/.test(value);
}

export function isImportFingerprint(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function normalizeImportFolder(value: string): string {
    if (typeof value !== "string" || value.length > 1024 || /[\p{Cc}\p{Cf}\u2028\u2029:<>|?*"~]/u.test(value)) throw new ImportProgressError("target");
    const parts = value.trim().replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.some((part) => !validPathPart(part))) throw new ImportProgressError("target");
    return `/${parts.join("/")}`;
}

function validPathPart(value: string): boolean {
    return Boolean(value) && value === value.trim() && value !== "." && value !== ".." && !/[\\/\p{Cc}\p{Cf}\u2028\u2029:<>|?*"~]/u.test(value);
}

export function isImportDocumentPath(value: unknown, folder: string): value is string {
    if (typeof value !== "string" || value.length > 1105 || !value.startsWith("/")) return false;
    const parts = value.slice(1).split("/");
    return parts.every(validPathPart) && value.slice(0, value.lastIndexOf("/")) === (folder === "/" ? "" : folder);
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireKeys(value: Record<string, unknown>, keys: string[]): void {
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new ImportProgressError("invalid");
}

function timestamp(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ImportProgressError("invalid");
    return value;
}

export function parseImportProgress(value: unknown): ImportProgress {
    if (!record(value)) throw new ImportProgressError("invalid");
    requireKeys(value, ["version", "taskId", "fingerprint", "format", "notebookId", "folder", "state", "createdAt", "updatedAt", "rows"]);
    if (value.version !== 1 || !isImportId(value.taskId) || !isImportId(value.notebookId) || !isImportFingerprint(value.fingerprint)) throw new ImportProgressError("invalid");
    if (typeof value.format !== "string" || typeof value.state !== "string" || !["pocket-html", "pocket-csv", "omnivore-json", "wallabag-json"].includes(value.format) || !["running", "paused", "finished"].includes(value.state)) throw new ImportProgressError("invalid");
    if (typeof value.folder !== "string" || normalizeImportFolder(value.folder) !== value.folder || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 50000) throw new ImportProgressError("invalid");
    const keys = new Set<string>();
    const docIds = new Set<string>();
    const folder = value.folder;
    const rows = value.rows.map((item): ImportProgressRow => {
        if (!record(item)) throw new ImportProgressError("invalid");
        requireKeys(item, ["key", "hpath", "state", "docId", "reason"]);
        if (!isImportFingerprint(item.key) || keys.has(item.key) || !isImportDocumentPath(item.hpath, folder)) throw new ImportProgressError("invalid");
        keys.add(item.key);
        if (typeof item.state !== "string" || typeof item.reason !== "string" || !IMPORT_ROW_STATES.includes(item.state as ImportRowState) || typeof item.docId !== "string" || !["", "missing", "changed", "internal", "conflict", "read", "capture", "unknown"].includes(item.reason)) throw new ImportProgressError("invalid");
        const needsId = ["created", "applied", "failed"].includes(String(item.state));
        if (needsId ? !isImportId(item.docId) : item.docId !== "") throw new ImportProgressError("invalid");
        if (item.docId && docIds.has(item.docId)) throw new ImportProgressError("invalid");
        if (item.docId) docIds.add(item.docId);
        if ((item.state === "unknown" && item.reason !== "unknown") || (item.state === "failed" && !item.reason) || (!["failed", "unknown"].includes(String(item.state)) && item.reason !== "")) throw new ImportProgressError("invalid");
        return { key: item.key, hpath: item.hpath, state: item.state as ImportRowState, docId: item.docId, reason: item.reason as ImportFailureReason };
    });
    if (value.state === "finished" && rows.some((row) => row.state !== "applied" && row.state !== "duplicate")) throw new ImportProgressError("invalid");
    const createdAt = timestamp(value.createdAt);
    const updatedAt = timestamp(value.updatedAt);
    if (updatedAt < createdAt) throw new ImportProgressError("invalid");
    return { version: 1, taskId: value.taskId, fingerprint: value.fingerprint, format: value.format as ImportFormat, notebookId: value.notebookId, folder, state: value.state as ImportProgress["state"], createdAt, updatedAt, rows };
}

export function recoverImportProgress(progress: ImportProgress): ImportProgress {
    const copy = parseImportProgress(progress);
    if (copy.state === "running") copy.state = "paused";
    for (const row of copy.rows) if (row.state === "creating") { row.state = "unknown"; row.reason = "unknown"; }
    if (copy.rows.every((row) => row.state === "applied" || row.state === "duplicate")) copy.state = "finished";
    return copy;
}

export function summarizeImportProgress(progress: ImportProgress): { applied: number; duplicate: number; failed: number; unknown: number; pending: number } {
    return {
        applied: progress.rows.filter((row) => row.state === "applied").length,
        duplicate: progress.rows.filter((row) => row.state === "duplicate").length,
        failed: progress.rows.filter((row) => row.state === "failed").length,
        unknown: progress.rows.filter((row) => row.state === "unknown" || row.state === "creating").length,
        pending: progress.rows.filter((row) => row.state === "pending" || row.state === "created").length,
    };
}

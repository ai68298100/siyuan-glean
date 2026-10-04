import { ATTR, parseClipAttrs, serializePatch, type ClipAttrs, type ClipPatch } from "./schema.ts";

export const BACKUP_FORMAT = "siyuan-glean-backup";
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_ATTRIBUTE_BYTES = 1024 * 1024;
const BLOCK_ID = /^\d{14}-[a-z0-9]{7}$/;

export interface BackupDocument {
    id: string;
    title: string;
    box: string;
    hpath: string;
    attrs: Record<string, string>;
}

export interface BackupPackage {
    format: typeof BACKUP_FORMAT;
    version: 1;
    createdAt: string;
    pluginVersion: string;
    documents: BackupDocument[];
    settings: Record<string, unknown>;
    uiPrefs: Record<string, unknown>;
    index: Record<string, unknown>;
}

export interface BackupFieldDiff {
    key: string;
    before: string | null;
    after: string | null;
    kind: "add" | "replace" | "delete";
    supported: boolean;
    selected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function byteSize(value: string): number { return new TextEncoder().encode(value).length; }

function requireText(value: unknown, maximum = 65536): string {
    if (typeof value !== "string" || byteSize(value) > maximum) throw new Error("Invalid backup text");
    return value;
}

function requireKeys(value: Record<string, unknown>, keys: string[]): void {
    if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) throw new Error("Invalid backup structure");
}

export function parseBackup(content: string): BackupPackage {
    if (byteSize(content) > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 20 MiB");
    const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (!isRecord(value)) throw new Error("Invalid backup structure");
    requireKeys(value, ["format", "version", "createdAt", "pluginVersion", "documents", "settings", "uiPrefs", "index"]);
    if (value.format !== BACKUP_FORMAT || value.version !== 1) throw new Error("Unsupported backup format or version");
    const createdAt = requireText(value.createdAt, 100);
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid backup date");
    if (!Array.isArray(value.documents) || value.documents.length > 50000) throw new Error("Invalid backup document count");
    if (!isRecord(value.settings) || !isRecord(value.uiPrefs) || !isRecord(value.index)) throw new Error("Invalid backup preferences");
    const ids = new Set<string>();
    const documents = value.documents.map((entry): BackupDocument => {
        if (!isRecord(entry)) throw new Error("Invalid backup document");
        requireKeys(entry, ["id", "title", "box", "hpath", "attrs"]);
        const id = requireText(entry.id, 30);
        const box = requireText(entry.box, 30);
        if (!BLOCK_ID.test(id) || !BLOCK_ID.test(box) || ids.has(id)) throw new Error("Invalid or duplicate backup ID");
        ids.add(id);
        const hpath = requireText(entry.hpath);
        if (!hpath.startsWith("/") || !isRecord(entry.attrs)) throw new Error("Invalid backup document attributes");
        const attrs: Record<string, string> = Object.fromEntries(Object.entries(entry.attrs).map(([key, raw]) => {
            if (!key.startsWith("custom-clip-") || key.length > 128 || /[\p{Cc}\p{Cf}]/u.test(key)) throw new Error("Invalid backup attribute key");
            return [key, requireText(raw, MAX_ATTRIBUTE_BYTES)];
        }));
        const parsed = parseClipAttrs(attrs);
        if (!parsed.status || parsed.internal) throw new Error("Backup document is not a library article");
        return { id, title: requireText(entry.title), box, hpath, attrs };
    });
    return { format: BACKUP_FORMAT, version: 1, createdAt, pluginVersion: requireText(value.pluginVersion, 100), documents, settings: value.settings, uiPrefs: value.uiPrefs, index: value.index };
}

export function backupFieldPatch(key: string, value: string | null): ClipPatch | null {
    const property = Object.entries(ATTR).find((entry) => entry[1] === key)?.[0] as keyof ClipAttrs | undefined;
    if (!property) return null;
    const parsed = value === null ? null : parseClipAttrs({ [key]: value })[property];
    if (parsed === undefined) return null;
    const patch = { [property]: parsed } as ClipPatch;
    try {
        return serializePatch(patch)[key] === value ? patch : null;
    } catch { return null; }
}

export function diffBackupAttrs(current: Record<string, string>, saved: Record<string, string>): BackupFieldDiff[] {
    const keys = [...new Set([...Object.values(ATTR), ...Object.keys(current).filter((key) => key.startsWith("custom-clip-")), ...Object.keys(saved)])].sort();
    return keys.flatMap((key) => {
        const before = current[key] ?? null;
        const after = saved[key] ?? null;
        if (before === after) return [];
        const kind = before === null ? "add" as const : after === null ? "delete" as const : "replace" as const;
        const supported = backupFieldPatch(key, after) !== null;
        return [{ key, before, after, kind, supported, selected: supported && kind === "add" }];
    });
}

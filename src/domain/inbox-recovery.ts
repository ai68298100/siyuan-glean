export const INBOX_RECOVERY_VERSION = 1 as const;
export const INBOX_RECOVERY_FILE = "inbox-recovery.json";
export const INBOX_RECOVERY_PHASES = ["creating", "capture-pending", "remove-pending", "unknown"] as const;
export type InboxRecoveryPhase = (typeof INBOX_RECOVERY_PHASES)[number];

export interface InboxRecovery {
    version: 1;
    taskId: string;
    phase: InboxRecoveryPhase;
    shorthandId: string;
    notebookId: string;
    folder: string;
    docId: string;
    allowDuplicate: boolean;
    createdAt: string;
    updatedAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, maximum: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value);
}

function validNodeId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value);
}

function validNotebookId(value: unknown): value is string {
    return boundedText(value, 256);
}

export function normalizeInboxFolder(value: string): string {
    if (typeof value !== "string" || value.length > 1024 || value.trim() !== value || /[\p{Cc}\p{Cf}\u2028\u2029\\:<>|?*"~]/u.test(value)) {
        throw new Error("Invalid inbox recovery folder");
    }
    const parts = value.split("/").filter(Boolean);
    if (!parts.length || parts.some((part) => !validFolderPart(part))) throw new Error("Invalid inbox recovery folder");
    return parts.join("/");
}

function validFolderPart(value: string): boolean {
    return Boolean(value) && value === value.trim() && value !== "." && value !== ".." && !/[\\/\p{Cc}\p{Cf}\u2028\u2029:<>|?*"~]/u.test(value);
}

function validFolder(value: unknown): value is string {
    return typeof value === "string" && normalizeInboxFolder(value) === value;
}

function timestamp(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error("Invalid inbox recovery timestamp");
    }
    return value;
}

function requireKeys(value: Record<string, unknown>): void {
    const keys = ["version", "taskId", "phase", "shorthandId", "notebookId", "folder", "docId", "allowDuplicate", "createdAt", "updatedAt"];
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Invalid inbox recovery");
}

export function parseInboxRecovery(value: unknown): InboxRecovery | null {
    if (value === null || value === undefined || value === "") return null;
    const input = typeof value === "string" ? JSON.parse(value) as unknown : value;
    if (!record(input)) throw new Error("Invalid inbox recovery");
    requireKeys(input);
    if (input.version !== INBOX_RECOVERY_VERSION || !/^inbox-[a-z0-9-]{1,80}$/.test(String(input.taskId)) || !boundedText(input.shorthandId, 512) || !validNotebookId(input.notebookId) || !validFolder(input.folder) || typeof input.allowDuplicate !== "boolean") throw new Error("Invalid inbox recovery identity");
    if (!INBOX_RECOVERY_PHASES.includes(input.phase as InboxRecoveryPhase)) throw new Error("Invalid inbox recovery phase");
    if (input.phase === "creating" || input.phase === "unknown" ? input.docId !== "" : !validNodeId(input.docId)) throw new Error("Invalid inbox recovery document");
    const createdAt = timestamp(input.createdAt);
    const updatedAt = timestamp(input.updatedAt);
    if (updatedAt < createdAt) throw new Error("Invalid inbox recovery order");
    return {
        version: 1,
        taskId: String(input.taskId),
        phase: input.phase as InboxRecoveryPhase,
        shorthandId: input.shorthandId,
        notebookId: input.notebookId as string,
        folder: input.folder,
        docId: input.docId as string,
        allowDuplicate: input.allowDuplicate,
        createdAt,
        updatedAt,
    };
}

export function createInboxRecovery(shorthandId: string, notebookId: string, folder: string, allowDuplicate: boolean, now = new Date()): InboxRecovery {
    const stamp = now.toISOString();
    const normalizedFolder = normalizeInboxFolder(folder);
    return parseInboxRecovery({
        version: 1,
        taskId: `inbox-${stamp.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 10)}`,
        phase: "creating",
        shorthandId,
        notebookId,
        folder: normalizedFolder,
        docId: "",
        allowDuplicate,
        createdAt: stamp,
        updatedAt: stamp,
    })!;
}

export function advanceInboxRecovery(recovery: InboxRecovery, phase: InboxRecoveryPhase, docId = recovery.docId, now = new Date()): InboxRecovery {
    const allowed = recovery.phase === "creating" ? ["capture-pending", "unknown"] : recovery.phase === "capture-pending" ? ["remove-pending"] : [];
    if (!allowed.includes(phase)) throw new Error("Inbox recovery cannot move backward");
    if (phase === "capture-pending" && !validNodeId(docId)) throw new Error("Inbox recovery requires document ID");
    if (phase === "remove-pending" && !validNodeId(docId)) throw new Error("Inbox recovery requires document ID");
    if (phase === "unknown" && docId !== "") throw new Error("Unknown inbox recovery cannot contain document ID");
    const updatedAt = new Date(Math.max(now.getTime(), Date.parse(recovery.updatedAt))).toISOString();
    return parseInboxRecovery({ ...recovery, phase, docId, updatedAt })!;
}

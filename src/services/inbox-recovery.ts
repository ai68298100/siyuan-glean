import type { Plugin } from "siyuan";
import { INBOX_RECOVERY_FILE, advanceInboxRecovery, parseInboxRecovery, type InboxRecovery } from "../domain/inbox-recovery";

export type InboxRecoveryReason = "readFailed" | "invalid" | "checkpointFailed" | "clearFailed" | "busy" | "createUnknown" | "captureFailed" | "removeFailed" | "conflict";

export class InboxRecoveryError extends Error {
    readonly reason: InboxRecoveryReason;
    readonly recovery?: InboxRecovery;
    readonly docId?: string;
    constructor(reason: InboxRecoveryReason, recovery?: InboxRecovery, docId?: string) {
        super(reason);
        this.reason = reason;
        this.recovery = recovery;
        this.docId = docId;
    }
}

function checkStorageResponse(response: unknown): void {
    if (response && typeof response === "object" && "code" in response && (response as { code: unknown }).code !== 0) throw new Error("inbox recovery storage rejected");
}

export async function loadInboxRecovery(plugin: Plugin): Promise<InboxRecovery | null> {
    let raw: unknown;
    try { raw = await plugin.loadData(INBOX_RECOVERY_FILE); } catch { throw new InboxRecoveryError("readFailed"); }
    try { return parseInboxRecovery(raw); } catch { throw new InboxRecoveryError("invalid"); }
}

export async function saveInboxRecovery(plugin: Plugin, recovery: InboxRecovery): Promise<InboxRecovery> {
    const copy = parseInboxRecovery(recovery);
    if (!copy) throw new InboxRecoveryError("invalid");
    try {
        checkStorageResponse(await plugin.saveData(INBOX_RECOVERY_FILE, copy));
        const readback = parseInboxRecovery(await plugin.loadData(INBOX_RECOVERY_FILE));
        if (JSON.stringify(readback) !== JSON.stringify(copy)) throw new Error("inbox recovery readback changed");
        return copy;
    } catch (error) {
        if (error instanceof InboxRecoveryError) throw error;
        throw new InboxRecoveryError("checkpointFailed", copy, copy.docId || undefined);
    }
}

export async function clearInboxRecovery(plugin: Plugin, expected: InboxRecovery, confirmed = false): Promise<void> {
    if (!confirmed) throw new InboxRecoveryError("clearFailed");
    try {
        const current = await loadInboxRecovery(plugin);
        if (!current || !sameRecovery(current, expected)) throw new Error("inbox recovery changed");
        checkStorageResponse(await plugin.removeData(INBOX_RECOVERY_FILE));
        if (parseInboxRecovery(await plugin.loadData(INBOX_RECOVERY_FILE)) !== null) throw new Error("inbox recovery remains");
    } catch (error) {
        if (error instanceof InboxRecoveryError) throw error;
        throw new InboxRecoveryError("clearFailed");
    }
}

function sameRecovery(left: InboxRecovery, right: InboxRecovery): boolean {
    return left.version === right.version
        && left.taskId === right.taskId
        && left.phase === right.phase
        && left.shorthandId === right.shorthandId
        && left.notebookId === right.notebookId
        && left.folder === right.folder
        && left.docId === right.docId
        && left.allowDuplicate === right.allowDuplicate
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt;
}

export async function markInboxUnknown(plugin: Plugin, recovery: InboxRecovery): Promise<InboxRecovery> {
    const unknown = advanceInboxRecovery(recovery, "unknown", "");
    return saveInboxRecovery(plugin, unknown);
}

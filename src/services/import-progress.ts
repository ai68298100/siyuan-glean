import type { Plugin } from "siyuan";
import { IMPORT_PROGRESS_FILE, ImportProgressError, parseImportProgress, recoverImportProgress, type ImportProgress } from "../domain/import-progress";

const activeImports = new WeakSet<object>();
const storageOperations = new WeakSet<object>();
const STORAGE_TIMEOUT_MS = 10000;

export function importRunning(plugin: Plugin): boolean { return activeImports.has(plugin); }

export async function withImportLock<Result>(plugin: Plugin, operation: () => Promise<Result>): Promise<Result> {
    if (activeImports.has(plugin) || storageOperations.has(plugin)) throw new ImportProgressError("busy");
    activeImports.add(plugin);
    try { return await operation(); } finally { activeImports.delete(plugin); }
}

export async function readImportProgress(plugin: Plugin): Promise<ImportProgress | null> {
    const raw = await storageOperation(plugin, "read", () => {
        return plugin.loadData(IMPORT_PROGRESS_FILE);
    });
    if (raw === "") throw new ImportProgressError("read");
    return raw === undefined || raw === null ? null : parseImportProgress(raw);
}

async function storageOperation<Result>(plugin: Plugin, reason: "read" | "save", operation: () => Promise<Result>): Promise<Result> {
    if (storageOperations.has(plugin)) throw new ImportProgressError("busy");
    storageOperations.add(plugin);
    const request = Promise.resolve().then(operation).finally(() => storageOperations.delete(plugin));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([request, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new ImportProgressError(reason)), STORAGE_TIMEOUT_MS);
        })]);
    } catch { throw new ImportProgressError(reason); }
    finally { clearTimeout(timer); }
}

function checkStorageResponse(response: unknown): void {
    if (response && typeof response === "object" && "code" in response && response.code !== 0) throw new ImportProgressError("save");
}

export async function loadImportProgress(plugin: Plugin): Promise<ImportProgress | null> {
    const progress = await readImportProgress(plugin);
    return progress && !importRunning(plugin) ? recoverImportProgress(progress) : progress;
}

export async function saveImportProgress(plugin: Plugin, next: ImportProgress, expected: ImportProgress | null): Promise<ImportProgress> {
    const copy = parseImportProgress(next);
    const current = await readImportProgress(plugin);
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new ImportProgressError("changed");
    checkStorageResponse(await storageOperation(plugin, "save", () => plugin.saveData(IMPORT_PROGRESS_FILE, copy)));
    if (JSON.stringify(await readImportProgress(plugin)) !== JSON.stringify(copy)) throw new ImportProgressError("save");
    return copy;
}

export async function discardImportProgress(plugin: Plugin, taskId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new ImportProgressError("confirmation");
    await withImportLock(plugin, async () => {
        let current: ImportProgress | null;
        try {
            current = await readImportProgress(plugin);
        } catch (error) {
            // 进度文件损坏时的强制逃生：传文件名作为 taskId 可按名直接删除，
            // 否则一条坏记录会把选新文件/恢复/丢弃全部锁死（T-3316）。
            // 二次校验：短暂等待后仍读取失败（损坏持续）才删；已恢复可读说明是瞬时故障，
            // 拒绝删除以保护健康的进行中进度（T-3317）
            if (taskId === IMPORT_PROGRESS_FILE) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                let stillBroken = false;
                try {
                    await readImportProgress(plugin);
                } catch {
                    stillBroken = true;
                }
                if (!stillBroken) throw new ImportProgressError("busy");
                checkStorageResponse(await storageOperation(plugin, "save", () => plugin.removeData(IMPORT_PROGRESS_FILE)));
                if (await readImportProgress(plugin)) throw new ImportProgressError("save");
                return;
            }
            throw error;
        }
        if (!current || current.taskId !== taskId) throw new ImportProgressError("changed");
        checkStorageResponse(await storageOperation(plugin, "save", () => plugin.removeData(IMPORT_PROGRESS_FILE)));
        if (await readImportProgress(plugin)) throw new ImportProgressError("save");
    });
}

export async function fingerprintImportSource(bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const input = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(0));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

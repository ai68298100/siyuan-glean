import type { Plugin } from "siyuan";
import { BACKUP_FORMAT, backupFieldPatch, diffBackupAttrs, parseBackup, type BackupDocument, type BackupFieldDiff, type BackupPackage } from "../domain/backup";
import { parseClipAttrs, type ClipPatch } from "../domain/schema";
import { batchReadClipAttrs, ClipRestoreError, readClipAttributeSnapshot, reconcileIndex, restoreClipFields, type ClipAttributeSnapshot } from "./clip-store";
import { loadSettings, normalizeSettings, saveSettings, settingsEqual, SettingsConflictError, type GleanSettings } from "./settings";
import { loadUiPrefs, normalizeUiPrefs, saveUiPrefs, UiPrefsConflictError, type UiPrefs } from "./prefs";

export type RestoreRowState = "ready" | "missing" | "internal" | "unavailable" | "applied" | "changed" | "unknown" | "skipped" | "conflict";

/** 预览阶段被用户主动取消：UI 据此静默处理（T-3315 共享常量，避免裸字符串三处耦合）。 */
export const BACKUP_PREVIEW_CANCELLED = "Backup preview cancelled";
export interface RestoreRow {
    document: BackupDocument;
    snapshot: ClipAttributeSnapshot | null;
    fields: BackupFieldDiff[];
    state: RestoreRowState;
    allowDuplicate: boolean;
}
export interface RestoreSession {
    backup: BackupPackage;
    rows: RestoreRow[];
    preferences: { beforeSettings: GleanSettings; afterSettings: GleanSettings; beforeUiPrefs: UiPrefs; afterUiPrefs: UiPrefs; settingsSupported: boolean };
    busy: boolean;
    used: boolean;
}
export interface RestoreReport { applied: number; processed: number; selected: number; stopped: boolean; indexFresh: boolean; settings: RestoreRowState; uiPrefs: RestoreRowState }

export async function exportLibraryBackup(plugin: Plugin, settings: GleanSettings): Promise<string> {
    const index = await reconcileIndex(plugin, settings);
    const entries = Object.values(index.clips).filter((entry) => !entry.internal);
    const pairs = await batchReadClipAttrs(entries.map((entry) => entry.id));
    const byId = new Map(pairs.map((pair) => [pair.id, pair.attrs]));
    const documents: BackupDocument[] = [];
    for (const entry of entries.sort((first, second) => first.id.localeCompare(second.id))) {
        const raw = byId.get(entry.id);
        if (!raw) throw new Error("Backup attribute read incomplete");
        const attrs = parseClipAttrs(raw);
        if (!attrs.status || attrs.internal) continue;
        documents.push({ id: entry.id, title: entry.title, box: entry.box, hpath: entry.hpath, attrs: Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith("custom-clip-"))) });
    }
    const manifest = (plugin as Plugin & { manifest?: { version?: unknown } }).manifest;
    const [savedSettings, uiPrefs] = await Promise.all([loadSettings(plugin, { strict: true }), loadUiPrefs(plugin, { strict: true })]);
    const backup: BackupPackage = {
        format: BACKUP_FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        pluginVersion: typeof manifest?.version === "string" ? manifest.version : "unknown",
        documents,
        settings: { ...savedSettings },
        uiPrefs: { ...uiPrefs },
        index: { ...index },
    };
    const content = JSON.stringify(backup, null, 2);
    parseBackup(content);
    return content;
}

export async function previewBackupRestore(plugin: Plugin, content: string, signal?: AbortSignal): Promise<RestoreSession> {
    const backup = parseBackup(content);
    const [beforeSettings, beforeUiPrefs] = await Promise.all([loadSettings(plugin, { strict: true }), loadUiPrefs(plugin, { strict: true })]);
    const afterSettings = normalizeSettings(backup.settings);
    afterSettings.snapshotOnCapture = false;
    afterSettings.ai = { ...afterSettings.ai, enrichMode: "off", dedupOnEnrich: false, relatedWhileReading: false, formattingEnabled: false, presetActions: false, authorSuggestionEnabled: false, questionCardEnabled: false, articleQuestionEnabled: false };
    afterSettings.integration = { ...afterSettings.integration, checkinEnabled: false, bridgeWriteEnabled: false };
    afterSettings.reader.defaultMode = "read";
    const rows: RestoreRow[] = [];
    for (let offset = 0; offset < backup.documents.length; offset += 20) {
        if (signal?.aborted) throw new Error(BACKUP_PREVIEW_CANCELLED);
        const batch = await Promise.all(backup.documents.slice(offset, offset + 20).map(async (document): Promise<RestoreRow> => {
            try {
                const snapshot = await readClipAttributeSnapshot(document.id);
                if (parseClipAttrs(snapshot.attrs).internal) return { document, snapshot, fields: [], state: "internal", allowDuplicate: false };
                return { document, snapshot, fields: diffBackupAttrs(snapshot.attrs, document.attrs), state: "ready", allowDuplicate: false };
            } catch (error) {
                return { document, snapshot: null, fields: [], state: error instanceof ClipRestoreError && error.reason === "missing" ? "missing" : "unavailable", allowDuplicate: false };
            }
        }));
        rows.push(...batch);
    }
    if (signal?.aborted) throw new Error(BACKUP_PREVIEW_CANCELLED);
    return { backup, rows, busy: false, used: false, preferences: { beforeSettings, afterSettings, beforeUiPrefs, afterUiPrefs: normalizeUiPrefs(backup.uiPrefs), settingsSupported: backup.settings.version === 1 } };
}

export async function applyBackupRestore(
    plugin: Plugin,
    session: RestoreSession,
    options: { confirmed: boolean; signal?: AbortSignal; onProgress?: (processed: number, selected: number) => void; restoreSettings?: boolean; restoreUiPrefs?: boolean; updateSettings?: (next: GleanSettings, expected: GleanSettings) => Promise<void> },
): Promise<RestoreReport> {
    if (!options.confirmed || session.busy || session.used) throw new Error("Restore requires a fresh confirmed preview");
    const plans = session.rows.filter((row) => row.state === "ready" && row.snapshot).map((row) => {
        const fields = row.fields.filter((field) => field.selected && field.supported).map((field) => ({ ...field }));
        const patch: ClipPatch = {};
        for (const field of fields) {
            const value = backupFieldPatch(field.key, field.after);
            if (!value) throw new Error("Unsupported restore field");
            Object.assign(patch, value);
        }
        return { row, patch, fields, id: row.document.id, snapshot: { meta: { ...row.snapshot!.meta }, attrs: { ...row.snapshot!.attrs } }, allowDuplicate: row.allowDuplicate === true };
    }).filter((plan) => plan.fields.length > 0);
    if (!plans.length && !options.restoreSettings && !options.restoreUiPrefs) throw new Error("No restore fields selected");
    if (options.restoreSettings && !session.preferences.settingsSupported) throw new Error("Unsupported settings version");
    session.busy = true;
    session.used = true;
    const report: RestoreReport = { applied: 0, processed: 0, selected: plans.length, stopped: false, indexFresh: false, settings: "skipped", uiPrefs: "skipped" };
    try {
        for (const plan of plans) {
            if (options.signal?.aborted) { report.stopped = true; break; }
            try {
                await restoreClipFields(plugin, plan.id, plan.snapshot, plan.patch, plan.allowDuplicate);
                plan.row.state = "applied";
                report.applied += 1;
            } catch (error) {
                plan.row.state = error instanceof ClipRestoreError ? error.reason : "unknown";
            }
            report.processed += 1;
            options.onProgress?.(report.processed, report.selected);
        }
        if (report.stopped) for (const plan of plans.slice(report.processed)) plan.row.state = "skipped";
        if (options.signal?.aborted) report.stopped = true;
        const preferences = session.preferences;
        if (!report.stopped && options.restoreSettings) {
            try {
                if (options.updateSettings) await options.updateSettings(preferences.afterSettings, preferences.beforeSettings);
                else await saveSettings(plugin, preferences.afterSettings, { expected: preferences.beforeSettings });
                if (!settingsEqual(await loadSettings(plugin, { strict: true }), preferences.afterSettings)) throw new Error("Settings readback changed");
                report.settings = "applied";
            } catch (error) { report.settings = error instanceof SettingsConflictError ? "changed" : "unknown"; }
        }
        if (options.signal?.aborted) report.stopped = true;
        if (!report.stopped && options.restoreUiPrefs) {
            try {
                await saveUiPrefs(plugin, preferences.afterUiPrefs, { expected: preferences.beforeUiPrefs });
                if (JSON.stringify(await loadUiPrefs(plugin, { strict: true })) !== JSON.stringify(preferences.afterUiPrefs)) throw new Error("Preferences readback changed");
                report.uiPrefs = "applied";
            } catch (error) { report.uiPrefs = error instanceof UiPrefsConflictError ? "changed" : "unknown"; }
        }
        try { await reconcileIndex(plugin, await loadSettings(plugin, { strict: true })); report.indexFresh = true; } catch { report.indexFresh = false; }
        return report;
    } finally { session.busy = false; }
}

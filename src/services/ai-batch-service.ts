import type { Plugin } from "siyuan";
import { aiBatchDocumentMatches, aiBatchHasUnresolved, aiBatchOutputChanged, inspectAiBatchDocument, parseAiBatchJournal, recoverAiBatchJournal, validateAiBatchIds, type AiBatchDocument, type AiBatchJournal, type AiBatchReason, type AiBatchRow } from "../domain/ai-batch.ts";
import { ATTR } from "../domain/schema.ts";
import { ClipRestoreError, readClipAttributeSnapshot } from "./clip-store";
import { activeAiSettings, enrichClip, usageToday } from "./enrich-service";
import type { GleanSettings } from "./settings";

export const AI_BATCH_FILE = "ai-batch.json";
export type AiBatchErrorReason = "busy" | "journalRead" | "journalInvalid" | "journalSave" | "oldTask" | "stale" | "confirmation" | "selection" | "unknownAuthorization" | "empty" | "settingsChanged" | "previewRead";
export class AiBatchError extends Error {
    readonly reason: AiBatchErrorReason;
    constructor(reason: AiBatchErrorReason) { super(reason); this.reason = reason; }
}

export interface AiBatchPreviewRow { docId: string; stage: AiBatchRow["stage"]; document: AiBatchDocument | null; reason: AiBatchReason }
export interface AiBatchPreview {
    mode: "new" | "resume";
    rows: AiBatchPreviewRow[];
    replacements: { summaries: number; aiTags: number };
    quota: { used: number; cap: number; remaining: number | null };
    channel: { kind: "siyuan" | "custom"; model: string };
    enabled: boolean;
}
export interface AiBatchState {
    journal: AiBatchJournal | null;
    busy: "" | "load" | "preview" | "run" | "discard";
    stopRequested: boolean;
    error: AiBatchErrorReason | null;
    journalSignature: string | null;
}
interface Coordinator extends AiBatchState { listeners: Set<(state: AiBatchState) => void>; preview: AiBatchPreview | null }
interface PreviewToken { plugin: Plugin; signature: string; journal: AiBatchJournal; settingsSignature: string; rows: AiBatchPreviewRow[]; used: boolean }
const coordinators = new WeakMap<Plugin, Coordinator>();
const previews = new WeakMap<AiBatchPreview, PreviewToken>();

function coordinator(plugin: Plugin): Coordinator {
    let current = coordinators.get(plugin);
    if (!current) {
        current = { journal: null, busy: "", stopRequested: false, error: null, journalSignature: null, listeners: new Set(), preview: null };
        coordinators.set(plugin, current);
    }
    return current;
}

function stateCopy(current: Coordinator): AiBatchState {
    return { journal: current.journal ? structuredClone(current.journal) : null, busy: current.busy, stopRequested: current.stopRequested, error: current.error, journalSignature: current.journalSignature };
}

function publish(current: Coordinator): void {
    for (const listener of current.listeners) {
        try { listener(stateCopy(current)); } catch { continue; }
    }
}

export function subscribeAiBatch(plugin: Plugin, listener: (state: AiBatchState) => void): () => void {
    const current = coordinator(plugin);
    current.listeners.add(listener);
    try { listener(stateCopy(current)); } catch { current.listeners.delete(listener); }
    return () => { current.listeners.delete(listener); };
}

export function stopAiBatchAfterCurrent(plugin: Plugin): void {
    const current = coordinator(plugin);
    if (current.busy !== "run") return;
    current.stopRequested = true;
    publish(current);
}

async function locked<Result>(plugin: Plugin, operation: AiBatchState["busy"], work: (current: Coordinator) => Promise<Result>): Promise<Result> {
    const current = coordinator(plugin);
    if (current.busy) throw new AiBatchError("busy");
    current.busy = operation;
    current.error = null;
    publish(current);
    try {
        return await work(current);
    } catch (error) {
        current.error = error instanceof AiBatchError ? error.reason : "previewRead";
        throw error;
    } finally {
        current.busy = "";
        publish(current);
    }
}

async function readJournal(plugin: Plugin, current: Coordinator): Promise<{ journal: AiBatchJournal | null; signature: string }> {
    let raw: unknown;
    try { raw = await plugin.loadData(AI_BATCH_FILE); } catch { current.journalSignature = null; throw new AiBatchError("journalRead"); }
    let journal: AiBatchJournal | null;
    try { journal = parseAiBatchJournal(raw); } catch {
        current.journalSignature = invalidJournalSignature(raw);
        throw new AiBatchError("journalInvalid");
    }
    current.journal = journal ? recoverAiBatchJournal(journal) : null;
    current.journalSignature = JSON.stringify(journal);
    publish(current);
    return { journal: current.journal, signature: current.journalSignature };
}

function invalidJournalSignature(raw: unknown): string | null {
    try { return `invalid:${JSON.stringify(raw)}`; } catch { return null; }
}

async function saveJournal(plugin: Plugin, current: Coordinator, journal: AiBatchJournal): Promise<void> {
    const validated = parseAiBatchJournal(journal);
    if (!validated) throw new AiBatchError("journalInvalid");
    try {
        const response: unknown = await plugin.saveData(AI_BATCH_FILE, validated);
        if (response && typeof response === "object" && "code" in response && (response as { code: unknown }).code !== 0) throw new Error("AI batch save rejected");
        const readback = parseAiBatchJournal(await plugin.loadData(AI_BATCH_FILE));
        if (JSON.stringify(readback) !== JSON.stringify(validated)) throw new Error("AI batch checkpoint readback changed");
    } catch {
        current.journal = recoverAiBatchJournal(journal);
        current.journalSignature = null;
        throw new AiBatchError("journalSave");
    }
    current.journal = validated;
    current.journalSignature = JSON.stringify(validated);
    publish(current);
}

export async function loadAiBatch(plugin: Plugin): Promise<AiBatchJournal | null> {
    return locked(plugin, "load", async (current) => (await readJournal(plugin, current)).journal);
}

function settingsSignature(settings: GleanSettings): string {
    const ai = settings.ai;
    return JSON.stringify([ai.enrichMode, ai.enrichDailyCap, ai.channel, ai.channel === "custom" ? [ai.customBaseUrl, ai.customModel, ai.customSecretName] : null, ai.dedupOnEnrich]);
}

async function readDocument(docId: string): Promise<AiBatchDocument> {
    return inspectAiBatchDocument(docId, await readClipAttributeSnapshot(docId));
}

async function readQuotaUsage(plugin: Plugin): Promise<number> {
    try {
        const used = await usageToday(plugin);
        if (!Number.isSafeInteger(used) || used < 0) throw new Error("Invalid AI usage");
        return used;
    } catch { throw new AiBatchError("previewRead"); }
}

async function buildPreview(plugin: Plugin, current: Coordinator, mode: AiBatchPreview["mode"], ids: string[], settings: GleanSettings, base: { journal: AiBatchJournal | null; signature: string }): Promise<AiBatchPreview> {
    current.preview = null;
    const configured = activeAiSettings(plugin, settings);
    const signature = settingsSignature(configured);
    const used = await readQuotaUsage(plugin);
    const rows: AiBatchPreviewRow[] = [];
    for (const docId of ids) {
        const stage = mode === "resume" ? base.journal?.rows.find((row) => row.docId === docId)?.stage ?? "pending" : "pending";
        try {
            const document = await readDocument(docId);
            rows.push({ docId, stage, document, reason: document.eligible ? "" : "ineligible" });
        } catch (error) {
            rows.push({ docId, stage, document: null, reason: error instanceof ClipRestoreError && error.reason === "missing" ? "missing" : "read" });
        }
    }
    if (settingsSignature(activeAiSettings(plugin, settings)) !== signature) throw new AiBatchError("settingsChanged");
    const eligible = rows.filter((row) => row.document?.eligible);
    if (eligible.length === 0) throw new AiBatchError("empty");
    const journal: AiBatchJournal = mode === "resume" && base.journal ? structuredClone(base.journal) : {
        version: 1,
        taskId: `batch-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        rows: ids.map((docId) => ({ docId, stage: "pending", attempt: 0, reason: "" })),
    };
    const preview: AiBatchPreview = {
        mode,
        rows,
        replacements: { summaries: eligible.filter((row) => row.document?.replacesSummary).length, aiTags: eligible.filter((row) => row.document?.replacesAiTags).length },
        quota: { used, cap: configured.ai.enrichDailyCap, remaining: configured.ai.enrichDailyCap > 0 ? Math.max(0, configured.ai.enrichDailyCap - used) : null },
        channel: { kind: configured.ai.channel, model: configured.ai.channel === "custom" ? configured.ai.customModel : "" },
        enabled: configured.ai.enrichMode !== "off",
    };
    previews.set(preview, { plugin, signature: base.signature, journal, settingsSignature: signature, rows: structuredClone(rows), used: false });
    current.preview = preview;
    return preview;
}

export async function previewNewAiBatch(plugin: Plugin, docIds: string[], settings: GleanSettings): Promise<AiBatchPreview> {
    let ids: string[];
    try { ids = validateAiBatchIds(docIds); } catch { throw new AiBatchError("selection"); }
    return locked(plugin, "preview", async (current) => {
        const base = await readJournal(plugin, current);
        if (aiBatchHasUnresolved(base.journal)) throw new AiBatchError("oldTask");
        return buildPreview(plugin, current, "new", ids, settings, base);
    });
}

export async function previewAiBatchResume(plugin: Plugin, docIds: string[], settings: GleanSettings, options: { reviewedUnknownIds?: string[]; authorizedUnknownIds?: string[] } = {}): Promise<AiBatchPreview> {
    let ids: string[];
    let reviewed: string[];
    let authorized: string[];
    try {
        ids = validateAiBatchIds(docIds);
        reviewed = validateAiBatchIds(options.reviewedUnknownIds ?? [], true);
        authorized = validateAiBatchIds(options.authorizedUnknownIds ?? [], true);
    } catch { throw new AiBatchError("selection"); }
    return locked(plugin, "preview", async (current) => {
        const base = await readJournal(plugin, current);
        if (!base.journal) throw new AiBatchError("stale");
        for (const docId of ids) {
            const row = base.journal.rows.find((item) => item.docId === docId);
            if (!row || !["pending", "failed", "unknown"].includes(row.stage)) throw new AiBatchError("selection");
            if (row.stage === "unknown" && (!reviewed.includes(docId) || !authorized.includes(docId))) throw new AiBatchError("unknownAuthorization");
        }
        return buildPreview(plugin, current, "resume", ids, settings, base);
    });
}

function replaceRow(journal: AiBatchJournal, docId: string, patch: Partial<AiBatchRow>): AiBatchJournal {
    return { ...journal, rows: journal.rows.map((row) => row.docId === docId ? { ...row, ...patch } : { ...row }) };
}

export async function runAiBatch(plugin: Plugin, preview: AiBatchPreview, settings: GleanSettings, options: { confirmed: boolean; signal?: AbortSignal }): Promise<void> {
    if (options.confirmed !== true) throw new AiBatchError("confirmation");
    const token = previews.get(preview);
    if (!token || token.plugin !== plugin || token.used || coordinator(plugin).preview !== preview) throw new AiBatchError("stale");
    return locked(plugin, "run", async (current) => {
        token.used = true;
        current.preview = null;
        current.stopRequested = false;
        const stop = () => stopAiBatchAfterCurrent(plugin);
        options.signal?.addEventListener("abort", stop, { once: true });
        const stopped = () => current.stopRequested || options.signal?.aborted === true;
        try {
            const base = await readJournal(plugin, current);
            if (base.signature !== token.signature) throw new AiBatchError("stale");
            if (settingsSignature(activeAiSettings(plugin, settings)) !== token.settingsSignature) throw new AiBatchError("settingsChanged");
            if (stopped()) return;
            let journal = structuredClone(token.journal);
            await saveJournal(plugin, current, journal);
            for (const row of token.rows) {
                if (stopped()) break;
                if (settingsSignature(activeAiSettings(plugin, settings)) !== token.settingsSignature) throw new AiBatchError("settingsChanged");
                const saved = journal.rows.find((item) => item.docId === row.docId);
                if (!saved || !["pending", "failed", "unknown"].includes(saved.stage)) throw new AiBatchError("stale");
                if (!row.document?.eligible) {
                    journal = replaceRow(journal, row.docId, { stage: "skipped", reason: row.reason || "ineligible" });
                    await saveJournal(plugin, current, journal);
                    continue;
                }
                let before: AiBatchDocument;
                try { before = await readDocument(row.docId); } catch (error) {
                    journal = replaceRow(journal, row.docId, { stage: "skipped", reason: error instanceof ClipRestoreError && error.reason === "missing" ? "missing" : "read" });
                    await saveJournal(plugin, current, journal);
                    continue;
                }
                if (stopped()) break;
                if (!aiBatchDocumentMatches(row.document, before)) {
                    journal = replaceRow(journal, row.docId, { stage: "skipped", reason: "changed" });
                    await saveJournal(plugin, current, journal);
                    continue;
                }
                const configured = activeAiSettings(plugin, settings);
                if (settingsSignature(configured) !== token.settingsSignature) throw new AiBatchError("settingsChanged");
                const used = await readQuotaUsage(plugin);
                if (stopped()) break;
                if (settingsSignature(activeAiSettings(plugin, settings)) !== token.settingsSignature) throw new AiBatchError("settingsChanged");
                if (configured.ai.enrichMode === "off" || (configured.ai.enrichDailyCap > 0 && used >= configured.ai.enrichDailyCap)) {
                    journal = replaceRow(journal, row.docId, { stage: "pending", reason: configured.ai.enrichMode === "off" ? "off" : "cap" });
                    await saveJournal(plugin, current, journal);
                    break;
                }
                journal = replaceRow(journal, row.docId, { stage: "running", reason: "", attempt: saved.attempt + 1 });
                await saveJournal(plugin, current, journal);
                if (stopped()) {
                    journal = replaceRow(journal, row.docId, { stage: saved.stage, reason: saved.reason, attempt: saved.attempt });
                    await saveJournal(plugin, current, journal);
                    break;
                }
                if (settingsSignature(activeAiSettings(plugin, settings)) !== token.settingsSignature) {
                    journal = replaceRow(journal, row.docId, { stage: saved.stage, reason: saved.reason, attempt: saved.attempt });
                    await saveJournal(plugin, current, journal);
                    throw new AiBatchError("settingsChanged");
                }
                let outcome: Awaited<ReturnType<typeof enrichClip>>;
                try { outcome = await enrichClip(plugin, row.docId, settings, { expectedAttrs: before.expectedAttrs, expectedLocation: before.expectedLocation }); } catch { outcome = { ok: false, duplicates: [], skipped: "error" }; }
                let after: AiBatchDocument | null = null;
                try { after = await readDocument(row.docId); } catch { after = null; }
                let stage: AiBatchRow["stage"] = "unknown";
                let reason: AiBatchReason = after ? "error" : "readback";
                if (after) {
                    const locationMatches = after.expectedLocation.box === before.expectedLocation.box && after.expectedLocation.hpath === before.expectedLocation.hpath;
                    const identityMatches = after.eligible && [ATTR.status, ATTR.url, ATTR.internal, ATTR.excluded].every((key) => before.expectedAttrs[key] === after.expectedAttrs[key]);
                    if (outcome.ok && locationMatches && identityMatches && after.summary && after.aiTagCount > 0) { stage = "succeeded"; reason = ""; }
                    else if (!outcome.ok && !aiBatchOutputChanged(before, after) && locationMatches && identityMatches) {
                        if (outcome.skipped === "off" || outcome.skipped === "cap") { stage = "pending"; reason = outcome.skipped; }
                        else if (outcome.skipped === "parse") { stage = "failed"; reason = "parse"; }
                    }
                }
                const next = replaceRow(journal, row.docId, { stage, reason });
                try { await saveJournal(plugin, current, next); } catch (error) {
                    current.journal = recoverAiBatchJournal(journal);
                    throw error;
                }
                journal = next;
                if (stage === "unknown" || stage === "pending") break;
            }
        } finally {
            options.signal?.removeEventListener("abort", stop);
        }
    });
}

export async function discardAiBatch(plugin: Plugin, options: { confirmed: boolean; expectedSignature: string }): Promise<void> {
    if (options.confirmed !== true) throw new AiBatchError("confirmation");
    return locked(plugin, "discard", async (current) => {
        let raw: unknown;
        try { raw = await plugin.loadData(AI_BATCH_FILE); } catch { throw new AiBatchError("journalRead"); }
        let signature: string | null;
        try { signature = JSON.stringify(parseAiBatchJournal(raw)); } catch { signature = invalidJournalSignature(raw); }
        if (!signature || signature !== options.expectedSignature) throw new AiBatchError("stale");
        try {
            const response: unknown = await plugin.saveData(AI_BATCH_FILE, null);
            if (response && typeof response === "object" && "code" in response && (response as { code: unknown }).code !== 0) throw new Error("AI batch discard rejected");
            if (parseAiBatchJournal(await plugin.loadData(AI_BATCH_FILE)) !== null) throw new Error("AI batch discard readback changed");
        } catch { current.journalSignature = null; throw new AiBatchError("journalSave"); }
        current.journal = null;
        current.journalSignature = "null";
        current.preview = null;
        current.stopRequested = false;
    });
}

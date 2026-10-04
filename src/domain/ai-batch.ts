import { ATTR, parseClipAttrs } from "./schema.ts";

export const AI_BATCH_VERSION = 1;
export const AI_BATCH_MAX_ROWS = 5000;
export const AI_BATCH_MAX_BYTES = 2 * 1024 * 1024;
export const AI_BATCH_STAGES = ["pending", "running", "succeeded", "failed", "unknown", "skipped"] as const;
export const AI_BATCH_REASONS = ["", "changed", "ineligible", "missing", "read", "off", "cap", "parse", "error", "readback", "interrupted"] as const;
export const AI_BATCH_EXPECTED_KEYS = [ATTR.summary, ATTR.aiTags, ATTR.status, ATTR.url, ATTR.internal, ATTR.excluded] as const;

export type AiBatchStage = typeof AI_BATCH_STAGES[number];
export type AiBatchReason = typeof AI_BATCH_REASONS[number];
export interface AiBatchRow { docId: string; stage: AiBatchStage; attempt: number; reason: AiBatchReason }
export interface AiBatchJournal { version: 1; taskId: string; createdAt: string; rows: AiBatchRow[] }
export interface AiBatchDocument {
    docId: string;
    title: string;
    expectedLocation: { box: string; hpath: string };
    expectedAttrs: Record<string, string | null>;
    summary: string;
    aiTagCount: number;
    replacesSummary: boolean;
    replacesAiTags: boolean;
    eligible: boolean;
}

export function validAiBatchDocId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateAiBatchIds(value: unknown, allowEmpty = false): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > AI_BATCH_MAX_ROWS || value.some((id) => !validAiBatchDocId(id)) || new Set(value).size !== value.length) {
        throw new Error("Invalid AI batch document IDs");
    }
    return [...value];
}

export function parseAiBatchJournal(value: unknown): AiBatchJournal | null {
    if (value === null || value === undefined || value === "") return null;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).length > AI_BATCH_MAX_BYTES) throw new Error("Invalid AI batch journal size");
    const input: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!record(input) || !exactKeys(input, ["version", "taskId", "createdAt", "rows"]) || input.version !== AI_BATCH_VERSION || typeof input.taskId !== "string" || !/^[a-z0-9-]{1,80}$/.test(input.taskId) || typeof input.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt) || !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt || !Array.isArray(input.rows)) {
        throw new Error("Invalid AI batch journal");
    }
    validateAiBatchIds(input.rows.map((row: unknown) => record(row) ? row.docId : null));
    const rows = input.rows.map((row: unknown): AiBatchRow => {
        if (!record(row) || !exactKeys(row, ["docId", "stage", "attempt", "reason"]) || !validAiBatchDocId(row.docId) || !AI_BATCH_STAGES.includes(row.stage as AiBatchStage) || !Number.isSafeInteger(row.attempt) || (row.attempt as number) < 0 || !AI_BATCH_REASONS.includes(row.reason as AiBatchReason)) {
            throw new Error("Invalid AI batch row");
        }
        const stage = row.stage as AiBatchStage;
        const reason = row.reason as AiBatchReason;
        if ((["running", "succeeded", "failed", "unknown"].includes(stage) && row.attempt === 0) || ((stage === "running" || stage === "succeeded") && reason !== "") || (stage === "failed" && reason !== "parse") || (stage === "unknown" && !["error", "readback", "interrupted"].includes(reason)) || (stage === "pending" && !["", "off", "cap"].includes(reason)) || (stage === "skipped" && !["changed", "ineligible", "missing", "read"].includes(reason))) {
            throw new Error("Invalid AI batch stage/reason");
        }
        return { docId: row.docId, stage, attempt: row.attempt as number, reason };
    });
    return { version: 1, taskId: input.taskId, createdAt: input.createdAt, rows };
}

export function recoverAiBatchJournal(journal: AiBatchJournal): AiBatchJournal {
    return { ...journal, rows: journal.rows.map((row) => row.stage === "running" ? { ...row, stage: "unknown", reason: "interrupted" } : { ...row }) };
}

export function aiBatchHasUnresolved(journal: AiBatchJournal | null): boolean {
    return Boolean(journal?.rows.some((row) => ["pending", "running", "failed", "unknown"].includes(row.stage)));
}

export function aiBatchCounts(journal: AiBatchJournal | null): Record<AiBatchStage, number> {
    const counts = { pending: 0, running: 0, succeeded: 0, failed: 0, unknown: 0, skipped: 0 };
    for (const row of journal?.rows ?? []) counts[row.stage] += 1;
    return counts;
}

export function inspectAiBatchDocument(docId: string, snapshot: { meta: { id: string; title: string; box: string; hpath: string }; attrs: Record<string, string> }): AiBatchDocument {
    if (!validAiBatchDocId(docId) || snapshot.meta.id !== docId || typeof snapshot.meta.title !== "string" || snapshot.meta.title.length > 4096 || typeof snapshot.meta.box !== "string" || !snapshot.meta.box || snapshot.meta.box.length > 256 || typeof snapshot.meta.hpath !== "string" || !snapshot.meta.hpath || snapshot.meta.hpath.length > 65536 || !record(snapshot.attrs) || Object.values(snapshot.attrs).some((value) => typeof value !== "string")) {
        throw new Error("Invalid AI batch preview document");
    }
    const expectedAttrs = Object.fromEntries(AI_BATCH_EXPECTED_KEYS.map((key) => [key, snapshot.attrs[key] ?? null]));
    if (Object.values(expectedAttrs).some((value) => value !== null && value.length > 1024 * 1024)) throw new Error("Invalid AI batch preview attribute size");
    const attrs = parseClipAttrs(snapshot.attrs);
    return {
        docId,
        title: snapshot.meta.title,
        expectedLocation: { box: snapshot.meta.box, hpath: snapshot.meta.hpath },
        expectedAttrs,
        summary: snapshot.attrs[ATTR.summary] ?? "",
        aiTagCount: attrs.aiTags.length,
        replacesSummary: Boolean(snapshot.attrs[ATTR.summary]),
        replacesAiTags: Boolean(snapshot.attrs[ATTR.aiTags]),
        eligible: Boolean(attrs.status && !attrs.internal && !attrs.excluded),
    };
}

export function aiBatchDocumentMatches(expected: AiBatchDocument, current: AiBatchDocument): boolean {
    return current.eligible && current.docId === expected.docId && current.expectedLocation.box === expected.expectedLocation.box && current.expectedLocation.hpath === expected.expectedLocation.hpath && AI_BATCH_EXPECTED_KEYS.every((key) => current.expectedAttrs[key] === expected.expectedAttrs[key]);
}

export function aiBatchOutputChanged(before: AiBatchDocument, after: AiBatchDocument): boolean {
    return [ATTR.summary, ATTR.aiTags].some((key) => before.expectedAttrs[key] !== after.expectedAttrs[key]);
}

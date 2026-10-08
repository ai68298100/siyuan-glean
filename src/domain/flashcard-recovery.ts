export const FLASHCARD_RECOVERY_VERSION = 1 as const;
export const FLASHCARD_RECOVERY_FILE = "flashcard-recovery.json";
export const FLASHCARD_RECOVERY_PHASES = ["insert-intent", "inserted", "registered"] as const;
export type FlashcardRecoveryPhase = (typeof FLASHCARD_RECOVERY_PHASES)[number];

export interface FlashcardRecovery {
    version: 1;
    taskId: string;
    phase: FlashcardRecoveryPhase;
    deckId: string;
    hostDocId: string;
    cardBlockId: string;
    createdAt: string;
    updatedAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireKeys(value: Record<string, unknown>): void {
    const keys = ["version", "taskId", "phase", "deckId", "hostDocId", "cardBlockId", "createdAt", "updatedAt"];
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Invalid flashcard recovery");
}

function timestamp(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Invalid flashcard recovery timestamp");
    return value;
}

function boundedText(value: unknown, maximum: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value);
}

function validNodeId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value);
}

export function parseFlashcardRecovery(value: unknown): FlashcardRecovery | null {
    if (value === null || value === undefined || value === "") return null;
    const input = typeof value === "string" ? JSON.parse(value) as unknown : value;
    if (!record(input)) throw new Error("Invalid flashcard recovery");
    requireKeys(input);
    if (input.version !== FLASHCARD_RECOVERY_VERSION || !boundedText(input.taskId, 96) || !/^flashcard-[a-z0-9-]{1,80}$/.test(input.taskId)) throw new Error("Invalid flashcard recovery identity");
    if (!FLASHCARD_RECOVERY_PHASES.includes(input.phase as FlashcardRecoveryPhase)) throw new Error("Invalid flashcard recovery phase");
    if (!boundedText(input.deckId, 256) || !validNodeId(input.hostDocId) || !validNodeId(input.cardBlockId)) throw new Error("Invalid flashcard recovery target");
    const createdAt = timestamp(input.createdAt);
    const updatedAt = timestamp(input.updatedAt);
    if (updatedAt < createdAt) throw new Error("Invalid flashcard recovery order");
    return {
        version: 1,
        taskId: input.taskId,
        phase: input.phase as FlashcardRecoveryPhase,
        deckId: input.deckId,
        hostDocId: input.hostDocId,
        cardBlockId: input.cardBlockId,
        createdAt,
        updatedAt,
    };
}

export function createFlashcardRecovery(deckId: string, hostDocId: string, cardBlockId: string, now = new Date()): FlashcardRecovery {
    const stamp = now.toISOString();
    const taskId = `flashcard-${stamp.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 10)}`;
    return parseFlashcardRecovery({
        version: 1,
        taskId,
        phase: "insert-intent",
        deckId,
        hostDocId,
        cardBlockId,
        createdAt: stamp,
        updatedAt: stamp,
    })!;
}

export function advanceFlashcardRecovery(recovery: FlashcardRecovery, phase: FlashcardRecoveryPhase, now = new Date()): FlashcardRecovery {
    if (phase === "insert-intent" && recovery.phase !== "insert-intent") throw new Error("Flashcard recovery cannot move backward");
    if (phase === "inserted" && recovery.phase === "registered") throw new Error("Flashcard recovery cannot move backward");
    const updatedAt = new Date(Math.max(now.getTime(), Date.parse(recovery.updatedAt))).toISOString();
    return parseFlashcardRecovery({ ...recovery, phase, updatedAt })!;
}


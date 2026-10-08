export interface ReadingPosition {
    version: 1;
    blockId: string;
    offset: number;
    at: string;
}

export function parseReadingPosition(raw: unknown): ReadingPosition | null {
    let value: unknown = raw;
    if (typeof raw === "string") {
        if (raw.length > 1024) return null;
        try { value = JSON.parse(raw); } catch { return null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Partial<ReadingPosition>;
    const keys = Object.keys(entry);
    if (keys.length !== 4 || keys.some((key) => !["version", "blockId", "offset", "at"].includes(key))) return null;
    if (entry.version !== 1 || typeof entry.blockId !== "string" || !/^\d{14}-[a-z0-9]{7}$/.test(entry.blockId)
        || typeof entry.offset !== "number" || !Number.isSafeInteger(entry.offset) || entry.offset < 0 || entry.offset > 10000
        || typeof entry.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.at)
        || !Number.isFinite(Date.parse(entry.at)) || new Date(entry.at).toISOString() !== entry.at) return null;
    return { version: 1, blockId: entry.blockId, offset: entry.offset, at: entry.at };
}

export function serializeReadingPosition(value: unknown): string {
    const parsed = parseReadingPosition(value);
    if (!parsed) throw new RangeError("Invalid reading position");
    return JSON.stringify(parsed);
}

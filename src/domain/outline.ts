export interface OutlineRow {
    id: string;
    root_id: string;
    type: string;
    subtype?: string;
    content: string;
    sort: number | string;
}

export interface OutlineItem {
    id: string;
    level: 1 | 2 | 3 | 4 | 5 | 6;
    title: string;
}

const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;

export function orderOutline(items: readonly OutlineItem[], ids: readonly string[]): OutlineItem[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    if (byId.size !== items.length || ids.length !== items.length || new Set(ids).size !== ids.length
        || ids.some((id) => !byId.has(id))) throw new Error("Outline order is incomplete or duplicated");
    return ids.map((id) => ({ ...byId.get(id)! }));
}

export function buildOutline(rows: readonly OutlineRow[], rootId: string): OutlineItem[] {
    if (!NODE_ID.test(rootId)) return [];
    const seen = new Set<string>();
    const result: OutlineItem[] = [];
    for (const row of rows) {
        const level = /^h([1-6])$/.exec(String(row.subtype ?? row.type))?.[1];
        if (!level || row.root_id !== rootId || !NODE_ID.test(row.id) || seen.has(row.id)) continue;
        seen.add(row.id);
        const title = String(row.content ?? "").trim();
        if (!title) continue;
        result.push({ id: row.id, level: Number(level) as OutlineItem["level"], title });
    }
    return result;
}

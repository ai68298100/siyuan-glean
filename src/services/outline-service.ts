import { listHeadingBlocks, listChildBlocks, type HeadingRow } from "../api/client";
import { buildOutline, orderOutline, type OutlineItem } from "../domain/outline";

const PAGE_SIZE = 500;
const CONTAINERS = new Set(["l", "i", "b", "s", "callout", "tabs", "tab", "mindmap", "mindmap_item"]);

export async function loadReadingOutline(rootId: string, isCurrent: () => boolean = () => true): Promise<OutlineItem[]> {
    const rows: HeadingRow[] = [];
    let afterSort = -1;
    let afterId = "";
    for (;;) {
        if (!isCurrent()) throw new Error("Outline load superseded");
        const page = await listHeadingBlocks(rootId, afterSort, afterId, PAGE_SIZE);
        if (!isCurrent()) throw new Error("Outline load superseded");
        if (!Array.isArray(page) || page.length > PAGE_SIZE || page.some((row) => !row || row.root_id !== rootId || row.type !== "h"
            || !/^\d{14}-[0-9a-z]{7}$/.test(row.id) || !/^h[1-6]$/.test(row.subtype ?? "")
            || !Number.isSafeInteger(row.sort) || row.sort < 0 || typeof row.content !== "string")) throw new Error("Invalid outline page");
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
        const last = page[page.length - 1];
        if (!last || last.sort < afterSort || (last.sort === afterSort && last.id <= afterId)) throw new Error("Outline cursor did not advance");
        afterSort = last.sort;
        afterId = last.id;
    }
    const items = buildOutline(rows, rootId);
    if (!rows.length) return [];
    const headings = new Map(rows.map((row) => [row.id, row]));
    if (headings.size !== rows.length) throw new Error("Duplicate outline heading");
    const displayIds = new Set(items.map((item) => item.id));
    const ordered: string[] = [];
    const seen = new Set<string>([rootId]);
    let requests = 0;
    async function visit(parentId: string, depth: number): Promise<void> {
        if (!isCurrent()) throw new Error("Outline load superseded");
        if (++requests > 1000 || depth > 128) throw new Error("Outline traversal exceeds budget");
        const children = await listChildBlocks(parentId);
        if (!isCurrent()) throw new Error("Outline load superseded");
        for (const child of children) {
            if (seen.has(child.id) || seen.size >= 50000) throw new Error("Outline tree is duplicated or exceeds budget");
            seen.add(child.id);
            if (child.type === "h") {
                const heading = headings.get(child.id);
                if (!heading || heading.subtype !== child.subType || heading.content.trim() !== (child.content ?? "").trim()) throw new Error("Outline source changed");
                if (displayIds.has(child.id)) ordered.push(child.id);
            } else if (CONTAINERS.has(child.type)) {
                await visit(child.id, depth + 1);
            }
        }
    }
    await visit(rootId, 0);
    return orderOutline(items, ordered);
}

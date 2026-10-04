import type { Plugin } from "siyuan";
import { createDocWithMd, getHighlightBlocks, listHighlightBlocks, listHighlightDocuments, newNodeId, type BlockRow } from "../api/client";
import {
    cleanHighlightText, highlightMarker, isHighlightId, renderHighlightsCsv, renderHighlightsMarkdown, selectHighlights,
    type HighlightExportLabels, type HighlightItem, type HighlightRoot,
} from "../domain/highlights";
import { CLIP_STATUSES, parseClipAttrs, parseUserTags } from "../domain/schema";
import { batchReadClipAttrs, readClip, reconcileIndex, writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

export type { HighlightItem, HighlightExportLabels } from "../domain/highlights";
export type HighlightExportReason = "changed" | "readFailed" | "empty" | "invalid";
export type HighlightSaveReason = HighlightExportReason | "busy" | "createUnknown" | "markFailed";

export class HighlightExportError extends Error {
    readonly reason: HighlightExportReason;
    constructor(reason: HighlightExportReason, cause?: unknown) {
        super(reason, { cause });
        this.reason = reason;
    }
}

export interface HighlightExportSession {
    items: HighlightItem[];
    labels: HighlightExportLabels;
    markdown: string;
    csv: string;
    box: string;
    hpath: string;
    createdDocId: string;
    state: "ready" | "created" | "saved" | "unknown";
    busy: boolean;
}

interface QualifiedRoot {
    root: HighlightRoot;
    qualified: boolean;
}

async function readRoots(ids: readonly string[], requireClipAttrs = true): Promise<Map<string, QualifiedRoot>> {
    if (ids.some((id) => !isHighlightId(id))) throw new HighlightExportError("invalid");
    const roots = new Map<string, QualifiedRoot>();
    for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        const [documents, pairs] = await Promise.all([listHighlightDocuments(batch), batchReadClipAttrs([...batch])]);
        const attributes = new Map(pairs.map((pair) => [pair.id, pair.attrs]));
        for (const id of batch) {
            const document = documents.find((row) => row.id === id);
            const ial = attributes.get(id);
            if (!document?.box || !document.hpath || (requireClipAttrs && !ial)) throw new HighlightExportError("readFailed");
            const attrs = parseClipAttrs(ial ?? {});
            roots.set(id, {
                root: { id, title: document.content || "", box: document.box, hpath: document.hpath, site: attrs.site ?? "", tags: parseUserTags(ial?.tags), aiTags: attrs.aiTags, url: attrs.url ?? "" },
                qualified: Boolean(attrs.status) && !attrs.internal,
            });
        }
    }
    return roots;
}

function toHighlight(row: BlockRow, root: HighlightRoot): HighlightItem | null {
    const highlight = highlightMarker(row.ial ?? "");
    if (row.type === "d" || (row.type !== "b" && !highlight.trim())) return null;
    if (!isHighlightId(row.id) || row.root_id !== root.id || row.box !== root.box || typeof row.content !== "string" || typeof row.markdown !== "string") throw new HighlightExportError("readFailed");
    const text = cleanHighlightText(row.content);
    if (!text) return null;
    return { ...root, tags: [...root.tags], aiTags: [...root.aiTags], id: row.id, rootId: root.id, text, markdown: row.markdown, source: { content: row.content, markdown: row.markdown, type: row.type, highlight } };
}

async function collectHighlights(roots: Map<string, QualifiedRoot>): Promise<HighlightItem[]> {
    const ids = [...roots.keys()].sort();
    const items: HighlightItem[] = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        const allowed = new Set(batch);
        let cursor = "";
        while (true) {
            const page = await listHighlightBlocks(batch, cursor, 500);
            if (page.length > 500) throw new HighlightExportError("readFailed");
            for (const row of page) {
                if (!isHighlightId(row.id) || row.id <= cursor || !allowed.has(row.root_id)) throw new HighlightExportError("readFailed");
                cursor = row.id;
                const item = toHighlight(row, roots.get(row.root_id)!.root);
                if (item) items.push(item);
            }
            if (page.length < 500) break;
        }
    }
    return items.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export async function highlightDocumentTitle(rootDocId: string): Promise<string> {
    if (!isHighlightId(rootDocId)) throw new HighlightExportError("invalid");
    const documents = await listHighlightDocuments([rootDocId]);
    if (!documents[0]) throw new HighlightExportError("readFailed");
    return documents[0].content || "";
}

export async function listDocHighlights(rootDocId: string): Promise<HighlightItem[]> {
    if (!isHighlightId(rootDocId)) throw new HighlightExportError("invalid");
    return collectHighlights(await readRoots([rootDocId], false));
}

export async function listLibraryHighlights(plugin: Plugin, settings: GleanSettings): Promise<HighlightItem[]> {
    const index = await reconcileIndex(plugin, settings);
    const ids = Object.values(index.clips).filter((entry) => CLIP_STATUSES.some((status) => status === entry.status)).map((entry) => entry.id);
    const roots = await readRoots([...new Set(ids)]);
    for (const [id, value] of roots) if (!value.qualified) roots.delete(id);
    return collectHighlights(roots);
}

function snapshot(item: HighlightItem): string {
    return JSON.stringify([item.id, item.rootId, item.text, item.markdown, item.title, item.box, item.hpath, item.site, item.tags, item.aiTags, item.url, item.source]);
}

export async function revalidateHighlights(items: readonly HighlightItem[]): Promise<void> {
    if (!items.length) throw new HighlightExportError("empty");
    if (items.some((item) => !isHighlightId(item.id) || !isHighlightId(item.rootId)) || new Set(items.map((item) => item.id)).size !== items.length) throw new HighlightExportError("invalid");
    try {
        const roots = await readRoots([...new Set(items.map((item) => item.rootId))]);
        for (const value of roots.values()) if (!value.qualified) throw new HighlightExportError("changed");
        for (let offset = 0; offset < items.length; offset += 200) {
            const batch = items.slice(offset, offset + 200);
            const rows = await getHighlightBlocks(batch.map((item) => item.id));
            if (rows.length !== batch.length || new Set(rows.map((row) => row.id)).size !== rows.length) throw new HighlightExportError("changed");
            for (const item of batch) {
                const row = rows.find((candidate) => candidate.id === item.id);
                if (!row || row.root_id !== item.rootId || row.box !== item.box) throw new HighlightExportError("changed");
                const fresh = toHighlight(row, roots.get(item.rootId)!.root);
                if (!fresh || snapshot(fresh) !== snapshot(item)) throw new HighlightExportError("changed");
            }
        }
    } catch (error) {
        if (error instanceof HighlightExportError) throw error;
        throw new HighlightExportError("readFailed", error);
    }
}

function exportSelection(items: readonly HighlightItem[], selectedIds: readonly string[]): HighlightItem[] {
    try {
        const selected = selectHighlights(items, selectedIds);
        if (!selected.length) throw new HighlightExportError("empty");
        return selected.map((item) => ({ ...item, tags: [...item.tags], aiTags: [...item.aiTags], source: { ...item.source } }));
    } catch (error) {
        if (error instanceof HighlightExportError) throw error;
        throw new HighlightExportError("invalid", error);
    }
}

export async function prepareHighlightExport(items: readonly HighlightItem[], selectedIds: readonly string[], labels: HighlightExportLabels): Promise<HighlightExportSession> {
    const selected = exportSelection(items, selectedIds);
    await revalidateHighlights(selected);
    const title = labels.title.replace(/[\\/\u0000-\u001f]/g, " ").trim().slice(0, 100);
    if (!title) throw new HighlightExportError("invalid");
    const parent = selected[0].hpath.slice(0, selected[0].hpath.lastIndexOf("/"));
    return { items: selected, labels: { ...labels }, markdown: renderHighlightsMarkdown(selected, labels), csv: renderHighlightsCsv(selected), box: selected[0].box, hpath: `${parent}/${title} ${newNodeId()}`, createdDocId: "", state: "ready", busy: false };
}

export async function exportHighlightsCsv(items: readonly HighlightItem[], selectedIds: readonly string[]): Promise<string> {
    const selected = exportSelection(items, selectedIds);
    await revalidateHighlights(selected);
    return renderHighlightsCsv(selected);
}

export async function copyHighlights(items: readonly HighlightItem[], selectedIds: readonly string[], labels: HighlightExportLabels, writeText: (text: string) => Promise<void>): Promise<void> {
    const selected = exportSelection(items, selectedIds);
    await revalidateHighlights(selected);
    await writeText(renderHighlightsMarkdown(selected, labels));
}

export async function saveHighlightDraft(plugin: Plugin, session: HighlightExportSession): Promise<{ ok: boolean; docId?: string; reason?: HighlightSaveReason }> {
    if (session.busy) return { ok: false, reason: "busy" };
    if (session.state === "saved") return { ok: true, docId: session.createdDocId };
    if (session.state === "unknown") return { ok: false, reason: "createUnknown" };
    session.busy = true;
    try {
        if (!session.createdDocId) {
            try {
                await revalidateHighlights(session.items);
                if (renderHighlightsMarkdown(session.items, session.labels) !== session.markdown || session.box !== session.items[0].box) return { ok: false, reason: "invalid" };
            } catch (error) {
                return { ok: false, reason: error instanceof HighlightExportError ? error.reason : "readFailed" };
            }
            try {
                const docId = await createDocWithMd(session.box, session.hpath, session.markdown);
                if (!isHighlightId(docId)) throw new Error("Invalid created document ID");
                session.createdDocId = docId;
                session.state = "created";
            } catch {
                session.state = "unknown";
                return { ok: false, reason: "createUnknown" };
            }
        }
        try {
            const documents = await listHighlightDocuments([session.createdDocId]);
            if (documents[0]?.box !== session.box || documents[0].hpath !== session.hpath) throw new Error("Created document identity changed");
            const attrs = await readClip(session.createdDocId);
            if (attrs.status || attrs.url?.trim()) throw new Error("Created document became an article");
            await writeClip(plugin, session.createdDocId, attrs.internal ? {} : { internal: true });
            session.state = "saved";
            return { ok: true, docId: session.createdDocId };
        } catch {
            return { ok: false, docId: session.createdDocId, reason: "markFailed" };
        }
    } finally {
        session.busy = false;
    }
}

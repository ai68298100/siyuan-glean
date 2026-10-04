import type { Plugin } from "siyuan";
import type { ClipStatus } from "../domain/schema.ts";
import { normalizeUrl } from "../domain/url.ts";
import { getHighlightBlocks } from "../api/client";
import { insertQuoteExcerpt } from "./excerpt-service";
import { batchSetStatus, captureDocument, findClipUrlConflict, readClip, writeClip } from "./clip-store";

export class PreviewActionError extends Error {
    readonly reason: "changed" | "invalidUrl" | "conflict" | "failed";
    readonly detail: string;
    constructor(reason: PreviewActionError["reason"], detail = "") {
        super(reason);
        this.reason = reason;
        this.detail = detail;
    }
}

async function requireCandidate(id: string) {
    const attrs = await readClip(id);
    if (attrs.status || attrs.internal || attrs.excluded) throw new PreviewActionError("changed");
    return attrs;
}

export async function setPreviewStatus(plugin: Plugin, id: string, status: ClipStatus): Promise<void> {
    const attrs = await readClip(id);
    if (!attrs.status || attrs.internal) throw new PreviewActionError("changed");
    if (await batchSetStatus(plugin, [id], status) !== 1) throw new PreviewActionError("failed");
}

export async function confirmPreviewCandidate(plugin: Plugin, id: string, candidateUrl: string, asLocal = false): Promise<void> {
    const attrs = await requireCandidate(id);
    const url = attrs.url || candidateUrl;
    if (asLocal ? Boolean(url) : !normalizeUrl(url)) throw new PreviewActionError(asLocal ? "changed" : "invalidUrl");
    const result = await captureDocument(plugin, id, asLocal ? { contentType: "local" } : { url });
    if (result.conflict) throw new PreviewActionError("conflict", result.conflict.title || result.conflict.hpath);
    if (!result.captured) throw new PreviewActionError("changed");
}

export async function excludePreviewCandidate(plugin: Plugin, id: string): Promise<void> {
    await requireCandidate(id);
    await writeClip(plugin, id, { excluded: true });
}

export async function savePreviewCandidateUrl(plugin: Plugin, id: string, expectedUrl: string, draft: string): Promise<void> {
    const url = draft.trim();
    if (!normalizeUrl(url)) throw new PreviewActionError("invalidUrl");
    const attrs = await requireCandidate(id);
    if ((attrs.url ?? "") !== expectedUrl) throw new PreviewActionError("changed");
    const conflict = await findClipUrlConflict(url, id, plugin);
    if (conflict) throw new PreviewActionError("conflict", conflict.title || conflict.hpath);
    const latest = await requireCandidate(id);
    if ((latest.url ?? "") !== expectedUrl) throw new PreviewActionError("changed");
    await writeClip(plugin, id, { url }, { force: true });
}

export async function quotePreviewExcerpt(docId: string, blockId: string, text: string): Promise<void> {
    const attrs = await readClip(docId);
    if (!attrs.status || attrs.internal) throw new PreviewActionError("changed");
    const blocks = await getHighlightBlocks([blockId]);
    if (blocks.length !== 1 || blocks[0].id !== blockId || blocks[0].root_id !== docId || blocks[0].type === "d") throw new PreviewActionError("changed");
    await insertQuoteExcerpt(blockId, text);
}

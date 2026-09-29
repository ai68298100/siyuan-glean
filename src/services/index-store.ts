/**
 * 派生索引 glean-index.json（DATA-CONTRACT §3）。
 * 真相永远是文档属性；这份只是性能缓存，可随时全量重建（"重建索引"命令）。
 * 写入纪律：只在本插件写属性成功后增量更新，或走 rebuild/reconcile 全量/对账重建。
 */
import type { Plugin } from "siyuan";
import { parseClipAttrs, type ClipStatus } from "../domain/schema";

const INDEX_FILE = "glean-index.json";
const INDEX_VERSION = 1;

export interface ClipIndexEntry {
    id: string;
    title: string;
    hpath: string;
    box: string;
    status: ClipStatus | "";
    url: string;
    site: string;
    time: string;
    words: number;
    minutes: number;
    priority: number;
    rating: number;
    surfaced: string;
    summary: string;
    /** 单文件快照 assets 路径 */
    snapshot: string;
    aiTags: string[];
    updated: string;
}

/** 未收录的锚点笔记本文档（"新剪藏"候选，尚无 clip 属性） */
export interface CandidateEntry {
    id: string;
    title: string;
    hpath: string;
    box: string;
    updated: string;
}

export interface GleanIndex {
    version: number;
    updatedAt: string;
    clips: Record<string, ClipIndexEntry>;
    candidates: Record<string, CandidateEntry>;
}

export function emptyIndex(): GleanIndex {
    return { version: INDEX_VERSION, updatedAt: "", clips: {}, candidates: {} };
}

export async function loadIndex(plugin: Plugin): Promise<GleanIndex> {
    try {
        const raw = await plugin.loadData(INDEX_FILE);
        if (!raw || typeof raw !== "object") return emptyIndex();
        const index = raw as Partial<GleanIndex>;
        return {
            version: INDEX_VERSION,
            updatedAt: typeof index.updatedAt === "string" ? index.updatedAt : "",
            clips: index.clips && typeof index.clips === "object" ? index.clips : {},
            candidates: index.candidates && typeof index.candidates === "object" ? index.candidates : {},
        };
    } catch {
        return emptyIndex();
    }
}

export async function saveIndex(plugin: Plugin, index: GleanIndex): Promise<GleanIndex> {
    index.version = INDEX_VERSION;
    index.updatedAt = new Date().toISOString();
    await plugin.saveData(INDEX_FILE, index);
    return index;
}

/** 用一篇文档的最新 IAL 更新索引条目（clip 与 candidate 二选一）。 */
export function applyAttrsToIndex(
    index: GleanIndex,
    doc: { id: string; title: string; hpath: string; box: string; updated: string },
    ial: Record<string, string>
): void {
    const attrs = parseClipAttrs(ial);
    const isClip = Boolean(attrs.status || attrs.url);
    if (isClip) {
        delete index.candidates[doc.id];
        index.clips[doc.id] = {
            id: doc.id,
            title: doc.title,
            hpath: doc.hpath,
            box: doc.box,
            status: attrs.status ?? "",
            url: attrs.url ?? "",
            site: attrs.site ?? "",
            time: attrs.time ?? "",
            words: attrs.words ?? 0,
            minutes: attrs.minutes ?? 0,
            priority: attrs.priority ?? 3,
            rating: attrs.rating ?? 0,
            surfaced: attrs.lastSurfaced ?? "",
            summary: attrs.summary ?? "",
            snapshot: attrs.snapshot ?? "",
            aiTags: attrs.aiTags,
            updated: doc.updated,
        };
    } else {
        delete index.clips[doc.id];
        index.candidates[doc.id] = {
            id: doc.id,
            title: doc.title,
            hpath: doc.hpath,
            box: doc.box,
            updated: doc.updated,
        };
    }
}

export function removeDocFromIndex(index: GleanIndex, docId: string): void {
    delete index.clips[docId];
    delete index.candidates[docId];
}

/**
 * 派生索引 glean-index.json（DATA-CONTRACT §3）。
 * 真相永远是文档属性；这份只是性能缓存，可随时全量重建（"重建索引"命令）。
 * 写入纪律：只在本插件写属性成功后增量更新，或走 rebuild/reconcile 全量/对账重建。
 */
import type { Plugin } from "siyuan";
import { inspectCandidate, type CandidateEvidence, type CandidateMissing, type CandidateProbe } from "../domain/candidate-policy.ts";
import { parseClipAttrs, type ClipStatus } from "../domain/schema.ts";

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
    contentType: string;
    timeSource: string;
    updated: string;
}

/** 未收录候选：无有效状态；可能已有来源 URL，显式收录时补齐缺失字段。 */
export interface CandidateEntry {
    id: string;
    title: string;
    hpath: string;
    box: string;
    updated: string;
    url: string;
    site: string;
    evidence: CandidateEvidence[];
    missing: CandidateMissing[];
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
        const rawCandidates = index.candidates && typeof index.candidates === "object" ? index.candidates : {};
        const candidates: Record<string, CandidateEntry> = {};
        for (const [id, value] of Object.entries(rawCandidates as Record<string, Partial<CandidateEntry>>)) {
            if (!value || typeof value !== "object") continue;
            candidates[id] = {
                id: typeof value.id === "string" ? value.id : id,
                title: typeof value.title === "string" ? value.title : "",
                hpath: typeof value.hpath === "string" ? value.hpath : "",
                box: typeof value.box === "string" ? value.box : "",
                updated: typeof value.updated === "string" ? value.updated : "",
                url: typeof value.url === "string" ? value.url : "",
                site: typeof value.site === "string" ? value.site : "",
                evidence: Array.isArray(value.evidence) ? value.evidence as CandidateEvidence[] : [],
                missing: Array.isArray(value.missing) ? value.missing as CandidateMissing[] : ["status"],
            };
        }
        return {
            version: INDEX_VERSION,
            updatedAt: typeof index.updatedAt === "string" ? index.updatedAt : "",
            clips: index.clips && typeof index.clips === "object" ? index.clips : {},
            candidates,
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
    ial: Record<string, string>,
    probe: CandidateProbe = inspectCandidate({ ial, title: doc.title, hpath: doc.hpath }),
): void {
    const attrs = parseClipAttrs(ial);
    const isClip = Boolean(attrs.status);
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
            contentType: attrs.contentType ?? "",
            timeSource: attrs.timeSource ?? "",
            updated: doc.updated,
        };
    } else {
        delete index.clips[doc.id];
        if (!probe.eligible) {
            delete index.candidates[doc.id];
            return;
        }
        index.candidates[doc.id] = {
            id: doc.id,
            title: doc.title,
            hpath: doc.hpath,
            box: doc.box,
            updated: doc.updated,
            url: probe.url,
            site: probe.site,
            evidence: probe.evidence,
            missing: probe.missing,
        };
    }
}

export function removeDocFromIndex(index: GleanIndex, docId: string): void {
    delete index.clips[docId];
    delete index.candidates[docId];
}

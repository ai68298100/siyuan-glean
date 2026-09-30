/**
 * 派生索引 glean-index.json（DATA-CONTRACT §3）。
 * 真相永远是文档属性；这份只是性能缓存，可随时全量重建（"重建索引"命令）。
 * 写入纪律：只在本插件写属性成功后增量更新，或走 rebuild/reconcile 全量/对账重建。
 */
import type { Plugin } from "siyuan";
import { CLIP_CONTENT_TYPES, CLIP_STATUSES, CLIP_TIME_SOURCES, type ClipStatus } from "../domain/schema.ts";
import {
    CANDIDATE_EVIDENCE,
    CANDIDATE_MISSING,
    inspectCandidate,
    type CandidateEvidence,
    type CandidateMissing,
    type CandidateProbe,
} from "../domain/candidate-policy.ts";
import { parseClipAttrs, parseUserTags } from "../domain/schema.ts";

const INDEX_FILE = "glean-index.json";
const INDEX_VERSION = 1;

const STATUS_SET = new Set<string>(CLIP_STATUSES);
const CONTENT_TYPE_SET = new Set<string>(CLIP_CONTENT_TYPES);
const TIME_SOURCE_SET = new Set<string>(CLIP_TIME_SOURCES);
const EVIDENCE_SET = new Set<string>(CANDIDATE_EVIDENCE);
const MISSING_SET = new Set<string>(CANDIDATE_MISSING);

function safeEnum(value: unknown, allowed: Set<string>): string {
    return typeof value === "string" && allowed.has(value) ? value : "";
}

function safeEnumList<T extends string>(value: unknown, allowed: Set<string>): T[] {
    return Array.isArray(value)
        ? (value.filter((item): item is T => typeof item === "string" && allowed.has(item)) as T[])
        : [];
}

export interface ClipIndexEntry {
    id: string;
    title: string;
    hpath: string;
    box: string;
    status: ClipStatus | "";
    url: string;
    site: string;
    /** 思源根块 IAL.tags 的只读投影；不是 custom-clip-* 属性。 */
    tags: string[];
    /** 收录入口（custom-clip-src），用于来源筛选。 */
    src: string;
    time: string;
    /** 最近一次显式完成的时刻；空串 = 完成时间未知（D-0028）。 */
    doneTime: string;
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
    /** 候选根块 IAL.tags 的只读投影。 */
    tags: string[];
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

/**
 * 索引写入互斥（T-1881）：load→改→save 的读改写段必须整体串行，否则两个并发写
 * （如多画布同时改不同文章的状态/评分）会互相覆盖增量。纯内存 promise 链，
 * 只约束本插件实例内的执行顺序；索引本身仍是可全量重建的派生缓存。
 */
let indexLock: Promise<unknown> = Promise.resolve();

export function withIndexLock<T>(task: () => Promise<T>): Promise<T> {
    const run = indexLock.then(task, task);
    indexLock = run.catch(() => undefined);
    return run;
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
                tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
                // T-1990：证据/缺失按枚举白名单过滤，磁盘上的脏值不得进入视图投影
                evidence: safeEnumList<CandidateEvidence>(value.evidence, EVIDENCE_SET),
                missing: safeEnumList<CandidateMissing>(value.missing, MISSING_SET),
            };
        }
        const rawClips = index.clips && typeof index.clips === "object" ? index.clips : {};
        const clips: Record<string, ClipIndexEntry> = {};
        for (const [id, value] of Object.entries(rawClips as Record<string, Partial<ClipIndexEntry>>)) {
            if (!value || typeof value !== "object") continue;
            // T-1990：status/contentType/timeSource 只接受合法枚举；脏条目直接丢弃，
            // 宁可等对账重建也不让非法值驱动状态点、载体徽章等动态 CSS/i18n。
            const status = safeEnum(value.status, STATUS_SET) as ClipStatus | "";
            if (value.status && !status) {
                console.warn(`[glean] 索引条目 ${id} 的状态值非法，已丢弃待重建`);
                continue;
            }
            clips[id] = {
                ...(value as ClipIndexEntry),
                id: typeof value.id === "string" ? value.id : id,
                title: typeof value.title === "string" ? value.title : "",
                hpath: typeof value.hpath === "string" ? value.hpath : "",
                box: typeof value.box === "string" ? value.box : "",
                status,
                url: typeof value.url === "string" ? value.url : "",
                site: typeof value.site === "string" ? value.site : "",
                tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
                src: typeof value.src === "string" ? value.src : "",
                time: typeof value.time === "string" ? value.time : "",
                doneTime: typeof value.doneTime === "string" ? value.doneTime : "",
                words: typeof value.words === "number" ? value.words : 0,
                minutes: typeof value.minutes === "number" ? value.minutes : 0,
                priority: typeof value.priority === "number" ? value.priority : 3,
                rating: typeof value.rating === "number" ? value.rating : 0,
                surfaced: typeof value.surfaced === "string" ? value.surfaced : "",
                summary: typeof value.summary === "string" ? value.summary : "",
                snapshot: typeof value.snapshot === "string" ? value.snapshot : "",
                aiTags: Array.isArray(value.aiTags) ? value.aiTags.filter((tag): tag is string => typeof tag === "string") : [],
                contentType: safeEnum(value.contentType, CONTENT_TYPE_SET),
                timeSource: safeEnum(value.timeSource, TIME_SOURCE_SET),
                updated: typeof value.updated === "string" ? value.updated : "",
            };
        }
        return {
            version: INDEX_VERSION,
            updatedAt: typeof index.updatedAt === "string" ? index.updatedAt : "",
            clips,
            candidates,
        };
    } catch (error) {
        // T-1990：坏文件原样保留，标记为损坏——增量写不落盘，等下一次对账/重建
        // 用完整扫描结果覆盖；文章事实在文档属性里，索引丢失只是缓存损失。
        indexCorrupted = true;
        console.warn("[glean] 派生索引文件损坏，已停用增量覆盖；打开面板对账或执行重建索引即可恢复:", error);
        return emptyIndex();
    }
}

/** T-1990：索引文件损坏后置位；全量对账/重建成功（合法覆盖）才解除。 */
let indexCorrupted = false;

export async function saveIndex(plugin: Plugin, index: GleanIndex): Promise<GleanIndex> {
    if (indexCorrupted) {
        // 损坏未消除前拒绝一切落盘，防止把可能完整的旧文件替换成增量/空索引；
        // 等待完整对账重建覆盖（confirmIndexRebuilt 解除）。
        console.warn("[glean] 索引损坏期间跳过落盘；等待完整对账重建");
        return index;
    }
    index.version = INDEX_VERSION;
    index.updatedAt = new Date().toISOString();
    await plugin.saveData(INDEX_FILE, index);
    return index;
}

/** 由 clip-store 的对账/重建在完整扫描成功后调用（T-1990）。 */
export function confirmIndexRebuilt(): void {
    indexCorrupted = false;
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
            tags: parseUserTags(ial.tags),
            src: attrs.src ?? "",
            time: attrs.time ?? "",
            doneTime: attrs.doneTime ?? "",
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
            tags: parseUserTags(ial.tags),
            evidence: probe.evidence,
            missing: probe.missing,
        };
    }
}

export function removeDocFromIndex(index: GleanIndex, docId: string): void {
    delete index.clips[docId];
    delete index.candidates[docId];
}

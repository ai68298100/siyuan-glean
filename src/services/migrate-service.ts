/**
 * 存量迁移器（T-1102）：把历史剪藏文章的来源 URL/入库时间等回填为文档属性。
 * 铁律：dry-run 报告优先；分批写入（≤50/批）可中断续跑；幂等（已有 custom-clip-url 的文档跳过）；
 * 用户手填字段永不覆盖（schema 层 USER_GUARDED + 这里跳过已收录文档双保险）。
 */
import type { Plugin } from "siyuan";
import { exportMdContent, newNodeId, type DocRow } from "../api/client";
import { inspectCandidate, hasValidClipStatus, type CandidateEvidence, type CandidateMissing } from "../domain/candidate-policy";
import { inspectClipMarkdown } from "../domain/content";
import { ATTR, documentTimeFromId, siteFromUrl, siyuanTimestamp, type ClipContentType, type ClipTimeSource } from "../domain/schema";
import { normalizeUrl } from "../domain/url";
import { batchReadClipAttrs, captureClip, findClipUrlConflict, listAnchorDocs, listDocsByIds, scanDocScopes, writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

export type MigrateRowState = "pending" | "ok" | "skipped" | "manual" | "error";

export interface MigrateRow {
    id: string;
    title: string;
    hpath: string;
    box: string;
    /** dry-run 发现的来源 URL（空串 = 正文里没找到，回填后归入手填类） */
    url: string;
    site: string;
    words: number;
    minutes: number;
    contentType?: ClipContentType;
    time?: string;
    timeSource?: ClipTimeSource;
    /** dry-run 发现的来源证据，供预览解释候选为何出现。 */
    evidence?: CandidateEvidence[];
    /** 需要用户补齐的属性，当前为 url/status 子集。 */
    missing?: CandidateMissing[];
    /** 预览阶段的用户决策；执行之前绝不写入文档。 */
    resolution?: "url" | "local" | "exclude";
    /** URL 冲突时，用户明确允许仍保留第二份。 */
    allowDuplicate?: boolean;
    /** 已有相同来源文章的文档 ID，供 UI 打开核对。 */
    conflictDocId?: string;
    state: MigrateRowState;
    detail?: string;
}

export interface MigrateProgress {
    version: 2;
    taskId: string;
    rows: MigrateProgressRow[];
    cursor: number;
    finished: boolean;
}

/** Persisted rows contain only stage and exact IDs; article facts are hydrated from SiYuan. */
export interface MigrateProgressRow {
    id: string;
    state: MigrateRowState;
    conflictDocId?: string;
}

const PROGRESS_FILE = "migrate-progress.json";
const progressLocks = new WeakMap<Plugin, Promise<void>>();
const runtimePlans = new WeakMap<Plugin, Map<string, Map<string, MigrateRow>>>();
const hydratedPlanDocs = new WeakMap<Plugin, Map<string, Set<string>>>();

/** 同一插件实例可能同时打开多个迁移弹窗；串行化检查点读改写，避免旧快照互相覆盖。 */
async function withProgressLock<T>(plugin: Plugin, operation: () => Promise<T>): Promise<T> {
    const previous = progressLocks.get(plugin) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    progressLocks.set(plugin, current);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (progressLocks.get(plugin) === current) progressLocks.delete(plugin);
    }
}

export type MigrateProgressErrorReason = "readFailed" | "invalid" | "exists" | "changed" | "busy";

export class MigrateProgressError extends Error {
    readonly reason: MigrateProgressErrorReason;

    constructor(reason: MigrateProgressErrorReason, message: string = reason) {
        super(message);
        this.name = "MigrateProgressError";
        this.reason = reason;
    }
}

const MIGRATE_ROW_STATES: readonly MigrateRowState[] = ["pending", "ok", "skipped", "manual", "error"];
const MIGRATE_CONTENT_TYPES: readonly ClipContentType[] = ["fulltext", "link", "local"];
const MIGRATE_TIME_SOURCES: readonly ClipTimeSource[] = ["source", "document", "capture", "legacy"];
const MIGRATE_EVIDENCE = ["url-attribute", "clip-tag", "clipper-template", "source-line"] as const;
const MIGRATE_MISSING = ["url", "status"] as const;
const SIYUAN_ID = /^\d{14}-[0-9a-z]{7}$/;
const SIYUAN_TIME = /^\d{14}$/;

function invalidProgress(): never {
    throw new MigrateProgressError("invalid", "迁移进度记录格式无效");
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(value: unknown, max: number): value is string {
    return typeof value === "string" && value.length <= max;
}

async function mapConcurrent<T, R>(items: T[], limit: number, project: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await project(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
    return results;
}

function validSiyuanTime(value: unknown): value is string {
    const stamp = String(value ?? "");
    if (!SIYUAN_TIME.test(stamp)) return false;
    const date = new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)), Number(stamp.slice(10, 12)), Number(stamp.slice(12, 14)));
    return date.getFullYear() === Number(stamp.slice(0, 4)) && date.getMonth() === Number(stamp.slice(4, 6)) - 1
        && date.getDate() === Number(stamp.slice(6, 8)) && date.getHours() === Number(stamp.slice(8, 10))
        && date.getMinutes() === Number(stamp.slice(10, 12)) && date.getSeconds() === Number(stamp.slice(12, 14));
}

function validIso(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function parseLegacyMigrateRow(value: unknown): MigrateRow {
    if (!record(value)) return invalidProgress();
    const optionalKeys = new Set(["contentType", "time", "timeSource", "evidence", "missing", "resolution", "allowDuplicate", "conflictDocId", "detail"]);
    const required = ["id", "title", "hpath", "box", "url", "site", "words", "minutes", "state"];
    if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optionalKeys.has(key))) return invalidProgress();
    const words = value.words;
    const minutes = value.minutes;
    if (typeof value.id !== "string" || !SIYUAN_ID.test(value.id) || !stringField(value.title, 200_000)
        || !stringField(value.hpath, 4_096) || !stringField(value.box, 128) || !stringField(value.url, 8_192)
        || (value.url !== "" && !normalizeUrl(value.url))
        || !stringField(value.site, 512) || typeof words !== "number" || !Number.isSafeInteger(words) || words < 0 || words > 10_000_000
        || typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1_000_000
        || typeof value.state !== "string" || !MIGRATE_ROW_STATES.includes(value.state as MigrateRowState)) return invalidProgress();
    if (value.contentType !== undefined && (typeof value.contentType !== "string" || !MIGRATE_CONTENT_TYPES.includes(value.contentType as ClipContentType))) return invalidProgress();
    if (value.time !== undefined && !validSiyuanTime(value.time)) return invalidProgress();
    if (value.timeSource !== undefined && (typeof value.timeSource !== "string" || !MIGRATE_TIME_SOURCES.includes(value.timeSource as ClipTimeSource))) return invalidProgress();
    if (value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.some((item) => !MIGRATE_EVIDENCE.includes(item)))) return invalidProgress();
    if (value.missing !== undefined && (!Array.isArray(value.missing) || value.missing.some((item) => !MIGRATE_MISSING.includes(item)))) return invalidProgress();
    if (value.resolution !== undefined && value.resolution !== "url" && value.resolution !== "local" && value.resolution !== "exclude") return invalidProgress();
    if (value.allowDuplicate !== undefined && typeof value.allowDuplicate !== "boolean") return invalidProgress();
    if (value.conflictDocId !== undefined && (typeof value.conflictDocId !== "string" || !SIYUAN_ID.test(value.conflictDocId))) return invalidProgress();
    if (value.detail !== undefined && !stringField(value.detail, 2_000)) return invalidProgress();
    return value as unknown as MigrateRow;
}

function validateUniqueRows(rows: MigrateProgressRow[]): void {
    const ids = new Set<string>();
    for (const row of rows) {
        if (ids.has(row.id)) invalidProgress();
        ids.add(row.id);
    }
}

function parseVersionOneProgress(value: Record<string, unknown>): MigrateProgress {
    if (Object.keys(value).some((key) => !["version", "rows", "cursor", "finished", "startedAt", "updatedAt"].includes(key))
        || !Array.isArray(value.rows) || value.rows.length > 50_000
        || typeof value.cursor !== "number" || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > value.rows.length
        || typeof value.finished !== "boolean" || !validIso(value.startedAt) || !validIso(value.updatedAt)
        || value.updatedAt < value.startedAt) return invalidProgress();
    if (value.rows.length > 0 && (value.finished !== (value.cursor === value.rows.length))) return invalidProgress();
    const legacyRows = value.rows.map(parseLegacyMigrateRow);
    const rows: MigrateProgressRow[] = legacyRows.map((row) => ({
        id: row.id,
        // V1 decisions were facts in the old checkpoint. Do not silently replay them after upgrade.
        state: row.resolution ? "manual" : row.state,
        ...(row.conflictDocId ? { conflictDocId: row.conflictDocId } : {}),
    }));
    validateUniqueRows(rows);
    return {
        version: 2,
        taskId: `migrate-${newNodeId()}`,
        rows,
        cursor: value.cursor,
        finished: value.finished,
    };
}

export function parseMigrateProgress(value: unknown): MigrateProgress {
    if (!record(value)) return invalidProgress();
    if (value.version === 1) return parseVersionOneProgress(value);
    const cursor = record(value) ? value.cursor : undefined;
    if (Object.keys(value).some((key) => !["version", "taskId", "rows", "cursor", "finished"].includes(key))
        || value.version !== 2 || typeof value.taskId !== "string" || !/^migrate-\d{14}-[0-9a-z]{7}$/.test(value.taskId)
        || !Array.isArray(value.rows) || value.rows.length > 50_000
        || typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > value.rows.length
        || typeof value.finished !== "boolean") return invalidProgress();
    if (value.rows.length > 0 && (value.finished !== (cursor === value.rows.length))) return invalidProgress();
    const rows: MigrateProgressRow[] = value.rows.map((input) => {
        if (!record(input) || Object.keys(input).some((key) => !["id", "state", "conflictDocId"].includes(key))
            || typeof input.id !== "string" || !SIYUAN_ID.test(input.id)
            || typeof input.state !== "string" || !MIGRATE_ROW_STATES.includes(input.state as MigrateRowState)
            || (input.conflictDocId !== undefined && (typeof input.conflictDocId !== "string" || !SIYUAN_ID.test(input.conflictDocId)))) return invalidProgress();
        return { id: input.id, state: input.state as MigrateRowState, ...(input.conflictDocId ? { conflictDocId: input.conflictDocId } : {}) };
    });
    validateUniqueRows(rows);
    if (rows.length === 0 && !value.finished) return invalidProgress();
    return { version: 2, taskId: value.taskId, rows, cursor: cursor as number, finished: value.finished };
}

async function loadMigrateProgressUnlocked(plugin: Plugin): Promise<MigrateProgress | null> {
    try {
        const raw = await plugin.loadData(PROGRESS_FILE);
        if (raw === undefined || raw === null) return null;
        const progress = parseMigrateProgress(raw);
        if (record(raw) && raw.version === 1) await saveProgress(plugin, progress);
        return progress;
    } catch (error) {
        if (error instanceof MigrateProgressError) throw error;
        throw new MigrateProgressError("readFailed", "迁移进度读取失败");
    }
}

export async function loadMigrateProgress(plugin: Plugin, expectedTaskId?: string): Promise<MigrateProgress | null> {
    return withProgressLock(plugin, async () => {
        const progress = await loadMigrateProgressUnlocked(plugin);
        assertExpectedTaskIfProvided(progress, expectedTaskId);
        return progress;
    });
}

/** 用检查点的确切 ID 重新读取当前标题、属性与来源；UI 永远不展示旧快照事实。 */
export async function hydrateMigrateProgress(plugin: Plugin, options: { refresh?: boolean; expectedTaskId?: string } = {}): Promise<{ progress: MigrateProgress; rows: MigrateRow[]; reconciled: boolean } | null> {
    return withProgressLock(plugin, async () => {
        const progress = await loadMigrateProgressUnlocked(plugin);
        assertExpectedTaskIfProvided(progress, options.expectedTaskId);
        if (!progress) return null;
        let hydratedTasks = hydratedPlanDocs.get(plugin);
        if (!hydratedTasks) { hydratedTasks = new Map(); hydratedPlanDocs.set(plugin, hydratedTasks); }
        let hydratedIds = hydratedTasks.get(progress.taskId);
        if (!hydratedIds || options.refresh) { hydratedIds = new Set(); hydratedTasks.set(progress.taskId, hydratedIds); }
        const docs = await listDocsByIds(progress.rows.map((row) => row.id));
        const docsById = new Map(docs.map((doc) => [doc.id, doc]));
        const attrPairs = await batchReadClipAttrs(progress.rows.map((row) => row.id));
        const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));
        let plans = runtimePlans.get(plugin);
        if (!plans) { plans = new Map(); runtimePlans.set(plugin, plans); }
        let taskPlans = plans.get(progress.taskId);
        if (!taskPlans) { taskPlans = new Map(); plans.set(progress.taskId, taskPlans); }
        const rows: MigrateRow[] = [];
        const probeTargets = progress.rows.flatMap((saved) => {
            const doc = docsById.get(saved.id);
            const ial = attrsById.get(saved.id);
            const plan = taskPlans.get(saved.id);
            if (!doc || !ial || ial[ATTR.url] || plan?.resolution || hydratedIds.has(saved.id) || saved.state === "ok" || saved.state === "skipped") return [];
            return [{ saved, doc, ial }];
        });
        const probedRows = await mapConcurrent(probeTargets, 8, ({ doc, ial }) => probeRow(doc, ial));
        const probeById = new Map(probeTargets.map(({ saved }, index) => [saved.id, probedRows[index]]));
        let checkpointChanged = false;
        let reconciled = false;
        for (const saved of progress.rows) {
            const doc = docsById.get(saved.id);
            const ial = attrsById.get(saved.id);
            if (!doc || !ial) {
                rows.push({ id: saved.id, title: doc?.content ?? "", hpath: doc?.hpath ?? "", box: doc?.box ?? "", url: "", site: "", words: 0, minutes: 0, state: "error", detail: !doc ? "document-missing" : "attributes-unavailable", conflictDocId: saved.conflictDocId });
                continue;
            }
            const plan = taskPlans.get(saved.id);
            // A user may resolve a row through another entry while migration is
            // paused. Repair the derived index first, then persist that fact so
            // a stale manual row cannot remain unresolved forever.
            const resolvedElsewhere = saved.state !== "ok" && saved.state !== "skipped" && (
                Boolean(ial[ATTR.url]) || ial[ATTR.excluded] === "true" ||
                (ial[ATTR.contentType] === "local" && hasValidClipStatus(ial))
            );
            if (resolvedElsewhere) {
                await writeClip(plugin, saved.id, {});
                saved.state = "skipped";
                delete saved.conflictDocId;
                taskPlans.delete(saved.id);
                checkpointChanged = true;
                reconciled = true;
            }
            // Reconcile a write whose response/checkpoint save was interrupted
            // against current document facts before presenting it as unresolved.
            if (ial[ATTR.url]) {
                rows.push({ id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: ial[ATTR.url], site: ial[ATTR.site] || siteFromUrl(ial[ATTR.url]), words: Number(ial[ATTR.words]) || 0, minutes: Number(ial[ATTR.minutes]) || 0, state: "skipped", detail: "already-clipped" });
                continue;
            }
            if (ial[ATTR.excluded] === "true") {
                rows.push({ id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: "", site: "", words: 0, minutes: 0, state: "skipped", detail: "user-excluded" });
                continue;
            }
            if (ial[ATTR.contentType] === "local" && hasValidClipStatus(ial)) {
                rows.push({ id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: "", site: "", words: Number(ial[ATTR.words]) || 0, minutes: Number(ial[ATTR.minutes]) || 0, contentType: "local", state: "skipped", detail: "already-clipped" });
                continue;
            }
            if (saved.state === "ok" || saved.state === "skipped") {
                rows.push({ id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: ial[ATTR.url] || "", site: ial[ATTR.site] || "", words: Number(ial[ATTR.words]) || 0, minutes: Number(ial[ATTR.minutes]) || 0, state: saved.state, detail: saved.state === "skipped" ? "already-clipped" : undefined, conflictDocId: saved.conflictDocId });
                continue;
            }
            // A plan exists only for this live plugin session. Never infer a lost manual choice from current content.
            if (plan?.resolution && saved.state === "manual") {
                if (ial[ATTR.url]) {
                    rows.push({ ...plan, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: ial[ATTR.url], site: ial[ATTR.site] || siteFromUrl(ial[ATTR.url]), state: "skipped", detail: "already-clipped", conflictDocId: undefined });
                } else {
                    rows.push({ ...plan, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", state: "manual", detail: saved.conflictDocId ? plan.detail : "planned-action-failed" });
                }
                continue;
            }
            if (plan && saved.state === "manual" && hydratedIds.has(saved.id)) {
                rows.push({ ...plan, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", state: "manual", detail: "reconfirm-decision" });
                continue;
            }
            if (plan && saved.state !== "manual" && hydratedIds.has(saved.id)) {
                rows.push({ ...plan, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", state: saved.state });
                continue;
            }
            const probed = probeById.get(saved.id) ?? null;
            if (!probed) {
                const row: MigrateRow = saved.state === "manual"
                    ? { id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: "", site: "", words: 0, minutes: 0, state: "manual", detail: "reconfirm-decision", missing: ["url"] }
                    : { id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", url: "", site: "", words: 0, minutes: 0, state: "skipped", detail: "no-longer-eligible", conflictDocId: saved.conflictDocId };
                rows.push(row);
                if (saved.state === "manual") {
                    taskPlans.set(saved.id, row);
                    hydratedIds.add(saved.id);
                }
                continue;
            }
            if (saved.state === "manual") {
                const row = { ...probed, state: "manual" as const, detail: "reconfirm-decision", conflictDocId: saved.conflictDocId };
                rows.push(row);
                taskPlans.set(saved.id, row);
                hydratedIds.add(saved.id);
            } else {
                rows.push({ ...probed, state: saved.state, conflictDocId: saved.conflictDocId });
                taskPlans.set(saved.id, { ...probed, state: saved.state });
                hydratedIds.add(saved.id);
            }
        }
        if (checkpointChanged) {
            try {
                await saveProgress(plugin, progress);
            } catch (error) {
                // The document facts and derived index have already been
                // reconciled. Keep the hydrated result visible and let the
                // next explicit refresh retry checkpoint persistence.
                console.warn("[glean] 迁移检查点修复保存失败，保留当前属性结果:", error);
            }
        }
        return { progress, rows, reconciled };
    });
}

async function saveProgress(plugin: Plugin, progress: MigrateProgress): Promise<void> {
    const compact = parseMigrateProgress(progress);
    await plugin.saveData(PROGRESS_FILE, compact);
}

function assertExpectedTask(progress: MigrateProgress | null, expectedTaskId: string): void {
    if (!expectedTaskId || !progress || progress.taskId !== expectedTaskId) {
        throw new MigrateProgressError("changed", "迁移任务已在其他窗口更改，请刷新后重试");
    }
}

function assertExpectedTaskIfProvided(progress: MigrateProgress | null, expectedTaskId?: string): void {
    if (expectedTaskId !== undefined) assertExpectedTask(progress, expectedTaskId);
}

export async function clearMigrateProgress(plugin: Plugin, expectedTaskId: string): Promise<void> {
    await withProgressLock(plugin, async () => {
        const progress = await loadMigrateProgressUnlocked(plugin);
        assertExpectedTask(progress, expectedTaskId);
        await plugin.removeData(PROGRESS_FILE);
    });
}

/** 只允许在二次确认后清理仍然损坏的检查点；读取异常或已恢复的记录都保留。 */
export async function clearInvalidMigrateProgress(plugin: Plugin): Promise<void> {
    await withProgressLock(plugin, async () => {
        try {
            const progress = await loadMigrateProgressUnlocked(plugin);
            if (progress === null) throw new MigrateProgressError("changed", "迁移进度已不存在");
            throw new MigrateProgressError("changed", "迁移进度现在可以正常读取，请先恢复或丢弃任务");
        } catch (error) {
            if (!(error instanceof MigrateProgressError) || error.reason !== "invalid") throw error;
        }
        await plugin.removeData(PROGRESS_FILE);
    });
}

/** 用户确认 dry-run 报告后才建立任务；扫描本身不写文档属性。 */
export async function startMigrateProgress(plugin: Plugin, rows: MigrateRow[]): Promise<MigrateProgress> {
    return withProgressLock(plugin, async () => {
        const existing = await loadMigrateProgressUnlocked(plugin);
        if (existing) throw new MigrateProgressError("exists", "已有迁移进度，需继续或明确丢弃后再开始");
        if (rows.length === 0) throw new Error("没有可迁移的条目");
        const progress: MigrateProgress = {
            version: 2,
            taskId: `migrate-${newNodeId()}`,
            rows: rows.map((row) => ({ id: row.id, state: row.resolution ? "manual" : row.state, ...(row.conflictDocId ? { conflictDocId: row.conflictDocId } : {}) })),
            cursor: 0,
            finished: false,
        };
        parseMigrateProgress(progress);
        await saveProgress(plugin, progress);
        runtimePlans.set(plugin, new Map([[progress.taskId, new Map(rows.map((row) => [row.id, { ...row }]))]]));
        hydratedPlanDocs.set(plugin, new Map([[progress.taskId, new Set(rows.map((row) => row.id))]]));
        return progress;
    });
}

/** 完成一次尝试后仅重排写入失败的行；扫描失败仍需重新扫描。 */
export async function retryMigrateErrors(plugin: Plugin, expectedTaskId: string): Promise<MigrateProgress> {
    return withProgressLock(plugin, async () => {
        const progress = await loadMigrateProgressUnlocked(plugin);
        assertExpectedTask(progress, expectedTaskId);
        if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
        const first = progress.rows.findIndex((row) => row.state === "error");
        if (first < 0) return progress;
        for (const row of progress.rows) {
            if (row.state === "error") {
                row.state = "pending";
            }
        }
        progress.cursor = first;
        progress.finished = false;
        await saveProgress(plugin, progress);
        return progress;
    });
}

/** 用户暂停后丢弃尚未执行的手工决定；重开后只保留重新确认所需的检查点阶段。 */
export async function dropInterruptedMigrateDecisions(plugin: Plugin, expectedTaskId: string): Promise<void> {
    await withProgressLock(plugin, async () => {
        assertExpectedTask(await loadMigrateProgressUnlocked(plugin), expectedTaskId);
        // This operation is intentionally memory-only: if saveData is failing,
        // the pause still must discard uncommitted choices before any retry.
        // Task-keyed maps ensure an old window can never clear a newer plan.
        const plansByTask = runtimePlans.get(plugin);
        if (!plansByTask) return;
        const plans = plansByTask.get(expectedTaskId);
        if (!plans) return;
        for (const [id, row] of plans) {
            if (row.resolution) plans.delete(id);
        }
    });
}

export type MigrateDecision =
    | { kind: "url"; url: string; allowDuplicate?: boolean }
    | { kind: "local" }
    | { kind: "exclude" };

/** dry-run 行裁决只更新内存中的执行计划，不碰文档属性或持久任务。 */
export function planMigrateRow(row: MigrateRow, decision: MigrateDecision): MigrateRow {
    if (decision.kind === "url") {
        const url = decision.url.trim();
        if (!normalizeUrl(url)) throw new Error("请输入有效的 http(s) 来源链接");
        return {
            ...row, url, site: siteFromUrl(url), state: "pending", resolution: "url",
            allowDuplicate: decision.allowDuplicate === true, conflictDocId: undefined,
            detail: undefined, missing: (row.missing ?? []).filter((item) => item !== "url"),
        };
    }
    return {
        ...row, state: "pending", resolution: decision.kind, allowDuplicate: false,
        conflictDocId: undefined, detail: undefined, missing: [],
    };
}

/** 手工裁决已保存的任务行。属性先写成功，随后同步持久任务；冲突保持待处理。 */
export async function resolveMigrateRow(
    plugin: Plugin,
    row: MigrateRow,
    decision: MigrateDecision,
    expectedTaskId: string,
): Promise<MigrateRow> {
    return withProgressLock(plugin, () => resolveMigrateRowUnlocked(plugin, row, decision, expectedTaskId));
}

async function resolveMigrateRowUnlocked(
    plugin: Plugin,
    row: MigrateRow,
    decision: MigrateDecision,
    expectedTaskId: string,
): Promise<MigrateRow> {
    const progress = await loadMigrateProgressUnlocked(plugin);
    assertExpectedTask(progress, expectedTaskId);
    if (!progress) throw new Error("请先确认迁移报告，再处理文档");
    const saved = progress.rows.find((item) => item.id === row.id);
    if (!saved) throw new Error("这篇文章不在当前迁移任务中，请重新扫描");
    const plan = runtimePlans.get(plugin)?.get(progress.taskId)?.get(saved.id);
    if (saved.state !== "manual" && saved.state !== "error" && !(saved.state === "pending" && plan?.resolution)) {
        throw new Error("这篇文章已被迁移任务处理，请刷新");
    }
    const [doc] = await listDocsByIds([saved.id]);
    if (!doc) throw new Error("文档已不存在，迁移任务保留；请重新核对或清理任务");
    const current = await batchReadClipAttrs([saved.id]);
    const ial = current[0]?.attrs;
    if (!ial) throw new Error("无法读取文档属性，请重试");
    row = { ...(plan ?? row), id: saved.id, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "", state: saved.state };
    if (decision.kind === "url") {
        const url = decision.url.trim();
        if (!normalizeUrl(url)) throw new Error("请输入有效的 http(s) 来源链接");
        if (ial[ATTR.url]) {
            // 用户在预览之后从其他入口补了来源，迁移器只修复索引，不覆盖手填值。
            await writeClip(plugin, row.id, {});
            const skipped = { ...row, state: "skipped" as const, detail: "already-clipped", conflictDocId: undefined };
            await persistResolvedRow(plugin, progress, skipped);
            return skipped;
        }
        const conflict = await findClipUrlConflict(url, row.id, plugin);
        if (conflict && !decision.allowDuplicate) {
            const unresolved: MigrateRow = {
                ...row, url, site: siteFromUrl(url), state: "manual", conflictDocId: conflict.id,
                detail: "duplicate-url", missing: (row.missing ?? []).filter((item) => item !== "url"),
            };
            await persistResolvedRow(plugin, progress, unresolved);
            return unresolved;
        }
        const markdown = (await exportMdContent(row.id))?.content ?? "";
        const metadata = inspectClipMarkdown(markdown, { url });
        if (!hasValidClipStatus(ial)) {
            const captured = await captureClip(plugin, row.id, {
                url,
                markdown,
                src: "migration",
                contentType: metadata.contentType,
                allowDuplicate: decision.allowDuplicate,
            });
            if (captured.conflict) {
                const unresolved: MigrateRow = {
                    ...row, url, site: siteFromUrl(url), state: "manual", conflictDocId: captured.conflict.id,
                    detail: "duplicate-url", missing: (row.missing ?? []).filter((item) => item !== "url"),
                };
                await persistResolvedRow(plugin, progress, unresolved);
                return unresolved;
            }
        } else {
            // 一次 patch 写全：分两次写时，第二次失败后重试会命中 already-clipped 分支导致元数据永久缺失
            await writeClip(plugin, row.id, {
                url,
                site: metadata.site || undefined,
                contentType: metadata.contentType,
                words: metadata.words > 0 ? metadata.words : undefined,
                minutes: metadata.minutes > 0 ? metadata.minutes : undefined,
            });
        }
        row = { ...row, url, site: metadata.site, state: "ok", resolution: undefined, conflictDocId: undefined, detail: undefined, missing: [] };
    } else if (decision.kind === "local") {
        if (ial[ATTR.url]) {
            await writeClip(plugin, row.id, {});
            const skipped = { ...row, state: "skipped" as const, detail: "already-clipped" };
            await persistResolvedRow(plugin, progress, skipped);
            return skipped;
        }
        const markdown = (await exportMdContent(row.id))?.content ?? "";
        if (!hasValidClipStatus(ial)) {
            await captureClip(plugin, row.id, { markdown, src: "migration", contentType: "local" });
        } else {
            await writeClip(plugin, row.id, { contentType: "local" });
        }
        row = { ...row, state: "ok", resolution: undefined, contentType: "local", detail: undefined, missing: [] };
    } else {
        await writeClip(plugin, row.id, { excluded: true });
        row = { ...row, state: "skipped", resolution: undefined, detail: "user-excluded", missing: [] };
    }
    await persistResolvedRow(plugin, progress, row);
    return row;
}

async function persistResolvedRow(plugin: Plugin, progress: MigrateProgress | null, row: MigrateRow): Promise<void> {
    if (progress) {
        const index = progress.rows.findIndex((item) => item.id === row.id);
        if (index >= 0) {
            progress.rows[index] = { id: row.id, state: row.state, ...(row.conflictDocId ? { conflictDocId: row.conflictDocId } : {}) };
            await saveProgress(plugin, progress);
            let plans = runtimePlans.get(plugin);
            if (!plans) { plans = new Map(); runtimePlans.set(plugin, plans); }
            let taskPlans = plans.get(progress.taskId);
            if (!taskPlans) { taskPlans = new Map(); plans.set(progress.taskId, taskPlans); }
            if (row.state === "ok" || row.state === "skipped") taskPlans.delete(row.id);
            else taskPlans.set(row.id, { ...row });
        }
    }
}

/**
 * dry-run：完整扫描状态/URL 次锚点、主锚点笔记本与跨笔记本 #剪藏 标签 →
 * 按文档 ID 去重 → 排除已收录 → 逐篇导出 markdown 提取 URL 候选 → 生成报告
 *（不写入任何属性）。测试替身若尚未提供 scanDocScopes，则退回旧的锚点查询。
 */
export async function buildDryRunReport(settings: GleanSettings): Promise<MigrateRow[]> {
    const scanned = typeof scanDocScopes === "function" ? await scanDocScopes(settings) : null;
    const rowsToProbe = scanned?.all ?? await listAnchorDocs(settings.anchorNotebooks, 5000);
    const attrPairs = await batchReadClipAttrs(rowsToProbe.map((row) => row.id));
    const attrsById = new Map(attrPairs.map((pair) => [pair.id, pair.attrs]));

    const projected = await mapConcurrent(rowsToProbe, 8, async (row): Promise<MigrateRow | null> => {
        const ial = attrsById.get(row.id) ?? {};
        // 迁移器只回填缺来源的历史文档；URL-only 半成品留在候选区，
        // 必须经过用户显式“加入读库”才补状态，避免预览执行时悄悄入队。
        // status-only 文档仍需导出正文寻找来源。
        if (ial[ATTR.url] || (ial[ATTR.contentType] === "local" && hasValidClipStatus(ial))) {
            return {
                id: row.id,
                title: row.content || "",
                hpath: row.hpath || "",
                box: row.box || "",
                url: "",
                site: "",
                words: 0,
                minutes: 0,
                contentType: undefined,
                state: "skipped",
                detail: "already-clipped",
                evidence: ["url-attribute"],
                missing: [],
            };
        }
        return probeRow(row, ial);
    });
    return projected.filter((row): row is MigrateRow => row !== null);
}

async function probeRow(
    row: DocRow,
    ial: Record<string, string | undefined> = {},
): Promise<MigrateRow | null> {
    const base: MigrateRow = {
        id: row.id,
        title: row.content || "",
        hpath: row.hpath || "",
        box: row.box || "",
        url: "",
        site: "",
        words: 0,
        minutes: 0,
        state: "pending",
    };
    try {
        const exported = await exportMdContent(row.id);
        const markdown = exported?.content ?? "";
        const candidate = inspectCandidate({
            ial,
            markdown,
            title: row.content || "",
            hpath: row.hpath || "",
            tags: row.tag || ial.tags || "",
        });
        // An anchor notebook is only a search boundary. Ordinary documents with no
        // source evidence are omitted so a scan cannot turn a whole notebook into
        // an apparent backlog. A status-only old clip remains visible as manual.
        if (!candidate.eligible && !hasValidClipStatus(ial)) return null;
        if (candidate.internal || candidate.excluded) return null;
        const metadata = inspectClipMarkdown(markdown, { url: candidate.url });
        const documentTime = documentTimeFromId(row.id);
        return {
            ...base,
            // Metadata's broad URL extraction must not turn an incidental inline
            // link into source evidence; candidate policy owns URL eligibility.
            url: candidate.url,
            site: candidate.site,
            words: metadata.words,
            minutes: metadata.minutes,
            contentType: candidate.url ? metadata.contentType : undefined,
            time: documentTime ?? undefined,
            timeSource: documentTime ? "document" : "capture",
            state: candidate.url ? "pending" : "manual",
            evidence: candidate.evidence,
            missing: candidate.missing,
            detail: candidate.evidence.length > 0 ? undefined : "missing-source-url",
        };
    } catch (error) {
        return { ...base, state: "error", detail: String(error).slice(0, 120) };
    }
}

export interface BackfillTick {
    processed: number;
    cursor: number;
    updatedRows: MigrateRow[];
    ok: number;
    skipped: number;
    manual: number;
    errors: number;
    finished: boolean;
}

/**
 * 分批回填：从 progress.cursor 继续，每批 settings.migrateBatchSize 篇；
 * 返回 tick 供 UI 展示进度；cursor 到尾或用户中断时返回。
 * 写入策略（时间戳幂等）：优先用文档 ID 时间，无法识别时取执行时刻；
 * status=inbox；src=migration。来源的可信程度另存 timeSource。
 */
export async function runBackfillBatch(
    plugin: Plugin,
    settings: GleanSettings,
    opts: { signal?: { aborted: boolean }; expectedTaskId: string }
): Promise<BackfillTick> {
    return withProgressLock(plugin, () => runBackfillBatchUnlocked(plugin, settings, opts));
}

async function runBackfillBatchUnlocked(
    plugin: Plugin,
    settings: GleanSettings,
    opts: { signal?: { aborted: boolean }; expectedTaskId: string }
): Promise<BackfillTick> {
    const progress = await loadMigrateProgressUnlocked(plugin);
    assertExpectedTask(progress, opts?.expectedTaskId ?? "");
    if (!progress) throw new Error("没有可续跑的迁移任务，请先执行 dry-run");
    if (progress.finished) {
        return tickOf(progress, progress.rows.length, true);
    }

    const batchSize = Math.min(Math.max(1, settings.migrateBatchSize), 50);
    const end = Math.min(progress.cursor + batchSize, progress.rows.length);
    const taskPlans = runtimePlans.get(plugin)?.get(progress.taskId);
    const batch = progress.rows.slice(progress.cursor, end);
    const workIds = batch.filter((row) => row.state === "pending" || (row.state === "manual" && taskPlans?.get(row.id)?.resolution)).map((row) => row.id);
    const [docs, attrs] = await Promise.all([listDocsByIds(workIds), batchReadClipAttrs(workIds)]);
    const docsById = new Map(docs.map((doc) => [doc.id, doc]));
    const attrsById = new Map(attrs.map((pair) => [pair.id, pair.attrs]));
    const stamped = siyuanTimestamp();
    const updatedRows: MigrateRow[] = [];

    for (let i = progress.cursor; i < end; i += 1) {
        if (opts.signal?.aborted) break;
        const saved = progress.rows[i];
        const plan = taskPlans?.get(saved.id);
        let result: MigrateRow = { id: saved.id, title: "", hpath: "", box: "", url: "", site: "", words: 0, minutes: 0, state: saved.state, conflictDocId: saved.conflictDocId };
        const shouldProcess = saved.state === "pending" || (saved.state === "manual" && plan?.resolution);
        if (shouldProcess) {
            const doc = docsById.get(saved.id);
            const ial = attrsById.get(saved.id);
            try {
                if (!doc) throw new Error("document-missing");
                if (!ial) throw new Error("attributes-unavailable");
                result = { ...result, title: doc.content || "", hpath: doc.hpath || "", box: doc.box || "" };
                if (ial[ATTR.url]) {
                    // Attribute write may have succeeded before an earlier checkpoint/index failure.
                    await writeClip(plugin, saved.id, {});
                    result = { ...result, url: ial[ATTR.url], state: "skipped", detail: "already-clipped", conflictDocId: undefined };
                } else if (plan?.resolution) {
                    if (plan.resolution === "exclude") {
                        await writeClip(plugin, saved.id, { excluded: true });
                        result = { ...result, state: "skipped", detail: "user-excluded", conflictDocId: undefined };
                    } else if (plan.resolution === "local") {
                        const markdown = (await exportMdContent(saved.id))?.content ?? "";
                        if (!hasValidClipStatus(ial)) await captureClip(plugin, saved.id, { markdown, src: "migration", contentType: "local" });
                        else await writeClip(plugin, saved.id, { contentType: "local" });
                        result = { ...result, contentType: "local", state: "ok", conflictDocId: undefined };
                    } else {
                        const url = plan.url.trim();
                        if (!normalizeUrl(url)) throw new Error("invalid-url");
                        const conflict = await findClipUrlConflict(url, saved.id, plugin);
                        if (conflict && !plan.allowDuplicate) {
                            result = { ...plan, ...result, url, site: siteFromUrl(url), state: "manual", detail: "duplicate-url", conflictDocId: conflict.id };
                        } else {
                            const markdown = (await exportMdContent(saved.id))?.content ?? "";
                            const metadata = inspectClipMarkdown(markdown, { url });
                            if (!hasValidClipStatus(ial)) await captureClip(plugin, saved.id, { url, markdown, src: "migration", contentType: metadata.contentType, allowDuplicate: plan.allowDuplicate });
                            else await writeClip(plugin, saved.id, { url, site: !ial[ATTR.site] ? metadata.site || undefined : undefined, contentType: !ial[ATTR.contentType] ? metadata.contentType : undefined, words: !ial[ATTR.words] && metadata.words > 0 ? metadata.words : undefined, minutes: !ial[ATTR.minutes] && metadata.minutes > 0 ? metadata.minutes : undefined });
                            result = { ...result, url, site: metadata.site, words: metadata.words, minutes: metadata.minutes, contentType: metadata.contentType, state: "ok", conflictDocId: undefined };
                        }
                    }
                } else {
                    const candidate = await probeRow(doc, ial);
                    if (!candidate) {
                        result = { ...result, state: "skipped", detail: "no-longer-eligible" };
                    } else if (candidate.state === "error") {
                        result = { ...candidate, state: "error" };
                    } else if (!candidate.url) {
                        result = { ...candidate, state: "manual" };
                    } else {
                        result = candidate;
                        const conflict = await findClipUrlConflict(candidate.url, saved.id, plugin);
                        if (conflict) {
                            result = { ...candidate, state: "manual", conflictDocId: conflict.id, detail: "duplicate-url" };
                        } else {
                            const patch: Parameters<typeof writeClip>[2] = { url: candidate.url, src: "migration" };
                            if (!ial[ATTR.site] && candidate.site) patch.site = candidate.site;
                            if (!ial[ATTR.time]) {
                                patch.time = candidate.time ?? documentTimeFromId(saved.id) ?? stamped;
                                patch.timeSource = candidate.timeSource ?? (documentTimeFromId(saved.id) ? "document" : "capture");
                            }
                            if (!ial[ATTR.words] && candidate.words > 0) patch.words = candidate.words;
                            if (!ial[ATTR.minutes] && candidate.minutes > 0) patch.minutes = candidate.minutes;
                            if (!ial[ATTR.contentType] && candidate.contentType) patch.contentType = candidate.contentType;
                            if (!ial[ATTR.status]) patch.status = "inbox";
                            const write = await writeClip(plugin, saved.id, patch);
                            result = { ...candidate, state: write.skippedKeys.includes(ATTR.url) ? "skipped" : "ok", detail: write.skippedKeys.includes(ATTR.url) ? "already-clipped" : undefined };
                        }
                    }
                }
            } catch (error) {
                // A lost manual choice must be confirmed again after reload; never persist its URL.
                // A failed manual plan remains actionable in this session; its
                // URL/local decision is never written into the checkpoint.
                result = { ...result, state: plan?.resolution ? "manual" : "error", detail: plan?.resolution ? "planned-action-failed" : String(error).slice(0, 120) };
                if (plan?.resolution) taskPlans?.set(saved.id, { ...plan, ...result, resolution: plan.resolution });
            }
        }
        progress.rows[i] = { id: saved.id, state: result.state, ...(result.conflictDocId ? { conflictDocId: result.conflictDocId } : {}) };
        if (shouldProcess) updatedRows.push(result);
        if (result.state === "ok" || result.state === "skipped") taskPlans?.delete(saved.id);
        else if (plan && result.state === "manual") taskPlans?.set(saved.id, { ...plan, ...result });
        progress.cursor = i + 1;
        progress.finished = progress.cursor >= progress.rows.length;
        await saveProgress(plugin, progress);
    }

    if (progress.cursor >= progress.rows.length && !progress.finished) {
        progress.finished = true;
        await saveProgress(plugin, progress);
    }
    return tickOf(progress, progress.cursor, progress.finished, updatedRows);
}

function tickOf(progress: MigrateProgress, processed: number, finished: boolean, updatedRows: MigrateRow[] = []): BackfillTick {
    let ok = 0;
    let skipped = 0;
    let manual = 0;
    let errors = 0;
    for (const row of progress.rows) {
        if (row.state === "ok") ok += 1;
        else if (row.state === "skipped") skipped += 1;
        else if (row.state === "manual") manual += 1;
        else if (row.state === "error") errors += 1;
    }
    return { processed, cursor: progress.cursor, updatedRows, ok, skipped, manual, errors, finished };
}

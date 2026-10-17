/**
 * 按当前可用时间与用户主题挑选文章的纯投影（T-3362）。
 *
 * 这是会话内选文，与每日拾遗的 lastSurfaced/随机稳定选择完全分开：
 * 只消费已有索引元数据，不写文章属性、saveData 或任何持久化状态。
 */

export const CONTEXT_BUDGETS = [5, 15, 30] as const;
export type ContextBudget = (typeof CONTEXT_BUDGETS)[number];

export interface ContextSelectionItem {
    kind?: "clip" | "candidate";
    id: string;
    title: string;
    status?: "inbox" | "later" | "reading" | "done" | "archived" | string;
    contentType?: "fulltext" | "link" | "local" | string;
    minutes?: number;
    priority?: number;
    /** 由调用方按当前时间计算；缺失时只作为 0 参与并列排序。 */
    waitingDays?: number;
    /** 根块用户标签；AI 标签不会参与主题门槛。 */
    tags?: string[];
    aiTags?: string[];
    url?: string;
    internal?: boolean;
    excluded?: boolean;
}

export interface ContextSelectionOptions {
    budget: ContextBudget;
    tag?: string;
    includeDone?: boolean;
    /** 显式放宽时允许未知时长进入候选，但候选会带 unknownMinutes 理由。 */
    includeUnknownMinutes?: boolean;
    limit?: number;
}

export type ContextReasonKind = "budget" | "tag" | "priority" | "waiting" | "unknownMinutes" | "linkOnly";

export interface ContextReason {
    kind: ContextReasonKind;
    value?: number | string;
}

export interface ContextSelectionCandidate {
    item: ContextSelectionItem;
    reasons: ContextReason[];
    /** link 载体只能打开来源，不能承诺离线读完。 */
    offlineReadable: boolean;
}

export interface ContextSelectionDiagnostics {
    total: number;
    eligible: number;
    selected: number;
    unknownMinutes: number;
    overBudget: number;
    tagMiss: number;
    statusMiss: number;
    excluded: number;
    linkOnly: number;
}

export interface ContextSelectionResult {
    budget: ContextBudget;
    tag: string;
    candidates: ContextSelectionCandidate[];
    diagnostics: ContextSelectionDiagnostics;
}

function normalized(value: string | undefined): string {
    return String(value ?? "").trim().toLocaleLowerCase();
}

function hasExactTag(tags: readonly string[] | undefined, expected: string): boolean {
    const wanted = normalized(expected);
    return !wanted || (tags ?? []).some((tag) => normalized(tag) === wanted);
}

function finitePositiveInteger(value: number | undefined): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function finiteNonNegative(value: number | undefined): number {
    return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}

function priorityOf(item: ContextSelectionItem): number {
    return Number.isFinite(item.priority) ? Number(item.priority) : 3;
}

function compareText(left: string, right: string): number {
    const a = normalized(left);
    const b = normalized(right);
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareCandidates(left: ContextSelectionCandidate, right: ContextSelectionCandidate): number {
    const priority = priorityOf(right.item) - priorityOf(left.item);
    if (priority !== 0) return priority;
    const waiting = finiteNonNegative(right.item.waitingDays) - finiteNonNegative(left.item.waitingDays);
    if (waiting !== 0) return waiting;
    const leftMinutes = finitePositiveInteger(left.item.minutes) ? left.item.minutes : Number.MAX_SAFE_INTEGER;
    const rightMinutes = finitePositiveInteger(right.item.minutes) ? right.item.minutes : Number.MAX_SAFE_INTEGER;
    if (leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
    return compareText(left.item.id, right.item.id);
}

function emptyDiagnostics(total: number): ContextSelectionDiagnostics {
    return { total, eligible: 0, selected: 0, unknownMinutes: 0, overBudget: 0, tagMiss: 0, statusMiss: 0, excluded: 0, linkOnly: 0 };
}

/**
 * 返回最多 limit 篇符合当前预算和用户标签的文章。
 * 未知分钟默认只进入 diagnostics；只有显式 includeUnknownMinutes 才会入选，
 * 避免把缺失数据伪装成“预算内”。
 */
export function selectReadingContext(
    items: readonly ContextSelectionItem[],
    options: ContextSelectionOptions,
): ContextSelectionResult {
    const budget = options.budget;
    if (!CONTEXT_BUDGETS.includes(budget)) throw new RangeError("Unsupported context budget");
    const tag = String(options.tag ?? "").trim();
    const limit = Number.isSafeInteger(options.limit) ? Math.min(10, Math.max(1, Number(options.limit))) : 3;
    const diagnostics = emptyDiagnostics(items.length);
    const candidates: ContextSelectionCandidate[] = [];

    for (const item of items) {
        if (item.kind === "candidate" || item.internal === true || item.excluded === true) {
            diagnostics.excluded += 1;
            continue;
        }
        const status = normalized(item.status);
        const statusAllowed = status === "inbox" || status === "later" || (options.includeDone === true && status === "done");
        if (!statusAllowed) {
            diagnostics.statusMiss += 1;
            continue;
        }
        if (!hasExactTag(item.tags, tag)) {
            diagnostics.tagMiss += 1;
            continue;
        }
        const minutes = item.minutes;
        const minutesKnown = finitePositiveInteger(minutes);
        if (!minutesKnown) {
            diagnostics.unknownMinutes += 1;
            if (!options.includeUnknownMinutes) continue;
        } else if (minutes > budget) {
            diagnostics.overBudget += 1;
            continue;
        }
        diagnostics.eligible += 1;
        const reasons: ContextReason[] = [
            { kind: "budget", value: minutesKnown ? minutes : "unknown" },
        ];
        if (tag) reasons.push({ kind: "tag", value: tag });
        if (!minutesKnown) reasons.push({ kind: "unknownMinutes" });
        if (priorityOf(item) !== 3) reasons.push({ kind: "priority", value: priorityOf(item) });
        if (finiteNonNegative(item.waitingDays) > 0) reasons.push({ kind: "waiting", value: finiteNonNegative(item.waitingDays) });
        const linkOnly = normalized(item.contentType) === "link";
        if (linkOnly) {
            diagnostics.linkOnly += 1;
            reasons.push({ kind: "linkOnly" });
        }
        candidates.push({ item: { ...item, tags: [...(item.tags ?? [])], aiTags: [...(item.aiTags ?? [])] }, reasons, offlineReadable: !linkOnly });
    }

    candidates.sort(compareCandidates);
    const selected = candidates.slice(0, limit);
    diagnostics.selected = selected.length;
    return { budget, tag, candidates: selected, diagnostics };
}

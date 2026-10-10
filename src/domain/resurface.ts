/**
 * 每日重浮算法（T-1400，插件灵魂，纯函数可单测）。
 * 设计约束（规划书 §5-M4/§9-8 + 平静原则）：
 * - 确定性：同一天、同一属性状态 → 同一份"今日拾遗"（跨重启稳定，不靠 saveData）；
 * - 幂等：以 custom-clip-last-surfaced（YYYYMMDD）为准，当天已 surfaced 的不再出现；
 * - 多样性：与近 7 天已重浮文章的标签重叠要降权（语义距离的本地近似，不依赖嵌入）；
 * - 平静：无欠账概念，挑不满 N 篇是正常结果；用户不行动的文章明天自然回池。
 *
 * lastSurfaced 写入时机（services 层职责）：用户对重浮卡做出行动（读了/改天/归档）时写；
 * 未行动的文章不写——明天自然回池，保证"重浮≠催促"。
 */

export interface SurfaceItem {
    id: string;
    title: string;
    status: string;
    priority: number;
    time: string;
    aiTags: string[];
    lastSurfaced: string;
    /** 用户明确钉住今日的日期；只有等于 todayStamp(now) 时生效。 */
    pinned?: string;
    /** AI 一句话摘要（重浮卡展示）；无则空串 */
    summary: string;
    /** 阅读载体与来源 URL；仅用于导航提示，不参与重浮评分。 */
    contentType?: string;
    url?: string;
    /** 站点名，仅用于"为什么出现"说明，不参与评分。 */
    site?: string;
}

export interface SurfacePick {
    item: SurfaceItem;
    score: number;
}

/** "为什么出现"的结构化理由（T-1717）；UI 负责转 i18n，域层不做文案。 */
export type SurfaceReasonKind = "stale" | "priority" | "site" | "freshTopic";

export interface SurfaceReason {
    kind: SurfaceReasonKind;
    days?: number;
    priority?: number;
    site?: string;
}

const DAY_MS = 86_400_000;

/** 入库天数（time=YYYYMMDDHHmmss）；非法（含 13 月等日历非法日期）返回 0。 */
export function ageDays(time: string, now: Date = new Date()): number {
    if (!/^\d{14}$/.test(time)) return 0;
    const parsed = new Date(
        Number(time.slice(0, 4)),
        Number(time.slice(4, 6)) - 1,
        Number(time.slice(6, 8)),
        12
    );
    // Date 会把 20240231 归一化为 3 月：与输入往返不一致即日历非法
    if (parsed.getFullYear() !== Number(time.slice(0, 4)) || parsed.getMonth() !== Number(time.slice(4, 6)) - 1 || parsed.getDate() !== Number(time.slice(6, 8))) return 0;
    return Math.max(0, Math.round((now.getTime() - parsed.getTime()) / DAY_MS));
}

export function todayStamp(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** 确定性散列（FNV-1a）：同一 id+日期恒定，用于同分tiebreak。 */
export function stableHash(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * 重浮评分 = 吃灰天数（每 7 天 +1，封顶 10）+ 手动优先级加权（priority-3 × 0.8）
 *   − 与近 7 天已重浮文章的标签重叠惩罚（每重叠一个标签 −1.5，封顶 −4）。
 */
export function surfaceScore(item: SurfaceItem, recentTagSets: Set<string>[], now: Date = new Date()): number {
    const stale = ageDays(item.time, now);
    let score = Math.min(10, stale / 7) + ((item.priority || 3) - 3) * 0.8;
    const tags = new Set((item.aiTags || []).map((tag) => tag.toLowerCase()));
    if (tags.size > 0 && recentTagSets.length > 0) {
        let overlap = 0;
        for (const tag of tags) {
            for (const recent of recentTagSets) {
                if (recent.has(tag)) {
                    overlap += 1;
                    break;
                }
            }
        }
        score -= Math.min(4, overlap * 1.5);
    }
    return score;
}

export interface PickOptions {
    count: number;
    /** 重浮池包含已读（设置项） */
    includeDone?: boolean;
    now?: Date;
}

/**
 * 挑选"今日拾遗"：
 * 1. 池 = inbox/later（可选含 done）；
 * 2. 排除当天已 surfaced（lastSurfaced == 今天）；
 * 3. 当天 pinned 文章优先，再按 surfaceScore 降序、stableHash(id+今天) 升序做确定性排序；
 * 4. 贪心取前 N，批内标签重叠者降 2 分后再比（同批不做同主题）。
 */
export function pickDaily(pool: SurfaceItem[], recentTagSets: Set<string>[], options: PickOptions): SurfacePick[] {
    const now = options.now ?? new Date();
    const today = todayStamp(now);
    const eligible = pool.filter((item) => {
        // T-1797：钉住当日是用户强意图，覆盖"改天"（lastSurfaced）过滤
        if (item.pinned === todayStamp(now).slice(0, 8)) return true;
        if (item.lastSurfaced === today) return false;
        if (item.status === "inbox" || item.status === "later") return true;
        return Boolean(options.includeDone && item.status === "done");
    });

    // T-1797：钉住当日（pinned === 今天）的条目置顶优先入选（占每日名额），
    // 不参与多样性降权；隔日 pinned 不再匹配自然回池（平静原则不变）。
    const pinnedToday = eligible.filter((item) => item.pinned === today.slice(0, 8));
    const unpinned = eligible.filter((item) => item.pinned !== today.slice(0, 8));

    const seeded = unpinned
        .map((item) => ({
            item,
            score: surfaceScore(item, recentTagSets, now),
            tiebreak: stableHash(item.id + today),
        }))
        .sort((a, b) => Number(b.item.pinned === today) - Number(a.item.pinned === today) || b.score - a.score || a.tiebreak - b.tiebreak);

    const picked: SurfacePick[] = [];
    const pickedTagSets: Set<string>[] = [];
    const used = new Set<string>();
    for (const pinned of pinnedToday) {
        if (picked.length >= options.count) break;
        picked.push({ item: pinned, score: surfaceScore(pinned, recentTagSets, now) });
        pickedTagSets.push(new Set((pinned.aiTags || []).map((tag) => tag.toLowerCase())));
        used.add(pinned.id);
    }
    for (const candidate of seeded) {
        if (picked.length >= options.count) break;
        if (used.has(candidate.item.id)) continue;
        const tags = new Set((candidate.item.aiTags || []).map((tag) => tag.toLowerCase()));
        let adjusted = candidate.score;
        for (const pickedTags of pickedTagSets) {
            let overlap = 0;
            for (const tag of tags) if (pickedTags.has(tag)) overlap += 1;
            adjusted -= overlap * 2;
        }
        // 只淘汰"因标签重叠被降分后明显低于在选批"的候选；
        // 分数天然偏低但无重叠的候选按序正常入选，不设额外门槛
        const demoted = adjusted < candidate.score;
        if (picked.length > 0 && demoted && adjusted < picked[picked.length - 1].score - 2) {
            continue;
        }
        picked.push({ item: candidate.item, score: adjusted });
        pickedTagSets.push(tags);
        used.add(candidate.item.id);
    }
    return picked;
}

/** 从有效的重浮池中均匀抽取一篇；排除集合由会话调用方维护，不写文章状态。 */
export function pickRandomSurfaceReplacement(
    pool: SurfaceItem[],
    excludedIds: Iterable<string>,
    includeDone: boolean,
    random: () => number = Math.random,
): SurfacePick | null {
    const excluded = new Set(excludedIds);
    const eligible = pool.filter((item) =>
        !excluded.has(item.id) &&
        (item.status === "inbox" || item.status === "later" || (includeDone && item.status === "done"))
    );
    if (eligible.length === 0) return null;
    const raw = random();
    const value = Number.isFinite(raw) ? Math.min(1 - Number.EPSILON, Math.max(0, raw)) : 0;
    const item = eligible[Math.floor(value * eligible.length)];
    return { item, score: surfaceScore(item, []) };
}

/** 近 7 天被重浮过的文章（供多样性惩罚）。 */
export function recentlySurfaced(items: SurfaceItem[], now: Date = new Date()): SurfaceItem[] {
    const today = todayStamp(now);
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    return items.filter((item) => {
        if (!/^\d{8}$/.test(item.lastSurfaced) || item.lastSurfaced === today) return false;
        const t = new Date(
            Number(item.lastSurfaced.slice(0, 4)),
            Number(item.lastSurfaced.slice(4, 6)) - 1,
            Number(item.lastSurfaced.slice(6, 8)),
            12
        ).getTime();
        return todayMs - t < 7 * DAY_MS;
    });
}

export function tagSetsOf(items: SurfaceItem[]): Set<string>[] {
    return items.map((item) => new Set((item.aiTags || []).map((tag) => tag.toLowerCase())));
}

/** 超龄归档候选（T-1401）：inbox/later 且吃灰 ≥ staleDays。 */
export function staleCandidates(items: SurfaceItem[], staleDaysLimit: number, now: Date = new Date()): SurfaceItem[] {
    return items.filter(
        (item) =>
            (item.status === "inbox" || item.status === "later") && ageDays(item.time, now) >= staleDaysLimit
    );
}

/**
 * 解释一篇为何出现在今日拾遗（T-1717）。只列事实，不用欠账口吻（平静原则）：
 * 吃灰天数 ≥7 才列出（刚收录不算等待）；优先级 ≥4 说明是用户自己标的重要；
 * 站点来源照实展示；与近 7 天已重浮文章无标签重叠时说明主题新鲜。
 */
export function surfaceReasons(
    item: SurfaceItem,
    recentTagSets: Set<string>[],
    now: Date = new Date()
): SurfaceReason[] {
    const reasons: SurfaceReason[] = [];
    const days = ageDays(item.time, now);
    if (days >= 7) reasons.push({ kind: "stale", days });
    if ((item.priority || 3) >= 4) reasons.push({ kind: "priority", priority: item.priority || 3 });
    const site = String(item.site ?? "").trim();
    if (site) reasons.push({ kind: "site", site });
    const tags = new Set((item.aiTags || []).map((tag) => tag.toLowerCase()));
    if (recentTagSets.length > 0 && tags.size > 0) {
        let overlap = false;
        for (const tag of tags) {
            for (const recent of recentTagSets) {
                if (recent.has(tag)) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) break;
        }
        if (!overlap) reasons.push({ kind: "freshTopic" });
    }
    return reasons;
}

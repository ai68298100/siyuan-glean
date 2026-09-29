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
    /** AI 一句话摘要（重浮卡展示）；无则空串 */
    summary: string;
    /** 阅读载体与来源 URL；仅用于导航提示，不参与重浮评分。 */
    contentType?: string;
    url?: string;
}

export interface SurfacePick {
    item: SurfaceItem;
    score: number;
}

const DAY_MS = 86_400_000;

/** 入库天数（time=YYYYMMDDHHmmss）；非法返回 0。 */
export function ageDays(time: string, now: Date = new Date()): number {
    if (!/^\d{14}$/.test(time)) return 0;
    const t = new Date(
        Number(time.slice(0, 4)),
        Number(time.slice(4, 6)) - 1,
        Number(time.slice(6, 8)),
        12
    ).getTime();
    return Math.max(0, Math.round((now.getTime() - t) / DAY_MS));
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
 * 3. 按 surfaceScore 降序、stableHash(id+今天) 升序做确定性排序；
 * 4. 贪心取前 N，批内标签重叠者降 2 分后再比（同批不做同主题）。
 */
export function pickDaily(pool: SurfaceItem[], recentTagSets: Set<string>[], options: PickOptions): SurfacePick[] {
    const now = options.now ?? new Date();
    const today = todayStamp(now);
    const eligible = pool.filter((item) => {
        if (item.lastSurfaced === today) return false;
        if (item.status === "inbox" || item.status === "later") return true;
        return Boolean(options.includeDone && item.status === "done");
    });

    const seeded = eligible
        .map((item) => ({
            item,
            score: surfaceScore(item, recentTagSets, now),
            tiebreak: stableHash(item.id + today),
        }))
        .sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);

    const picked: SurfacePick[] = [];
    const pickedTagSets: Set<string>[] = [];
    const used = new Set<string>();
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
        // 与已选批重叠严重的靠后：重新按调整分与已选比较
        if (picked.length > 0 && adjusted < picked[picked.length - 1].score - 2) {
            continue;
        }
        picked.push({ item: candidate.item, score: adjusted });
        pickedTagSets.push(tags);
        used.add(candidate.item.id);
    }
    return picked;
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

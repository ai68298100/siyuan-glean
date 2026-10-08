/**
 * 会话阅读队列重排（T-1903，D-0034）：纯函数。
 * 顺序只存在于 ui-prefs 的 sessionOrder（docId 列表 + 洗牌种子），不写 priority 或任何文章属性；
 * 筛选只是投影——order 是全库 ID 序，筛选结果按 order 内的相对次序展示，不在 order 中的按原序追加尾部。
 */

/** 把会话顺序应用到一个投影：order 中的条目按 order 相对次序在前，其余保持原序追加。 */
export function applySessionOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
    if (order.length === 0) return items;
    const rank = new Map<string, number>();
    order.forEach((id, index) => {
        if (!rank.has(id)) rank.set(id, index);
    });
    return [...items].sort((a, b) => {
        const ra = rank.get(a.id);
        const rb = rank.get(b.id);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return 0;
    });
}

/** 会话置顶：目标移到 order 首位（不在 order 中则插到首位）。返回新 order。 */
export function pinToSessionTop(order: string[], id: string): string[] {
    return [id, ...order.filter((existing) => existing !== id)];
}

/** 会话上移/下移：delta=-1 上移、+1 下移；越界或不在 order 中时原样返回（先置顶/洗牌入列）。 */
export function moveWithinSession(order: string[], id: string, delta: -1 | 1): string[] {
    const index = order.indexOf(id);
    if (index < 0) return order;
    const target = index + delta;
    if (target < 0 || target >= order.length) return order;
    const next = [...order];
    next[index] = next[target];
    next[target] = id;
    return next;
}

/** mulberry32：种子可复现的伪随机（洗牌可重现、换种子即重洗）。 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 洗牌：按种子对 id 列表做 Fisher–Yates，同种子同结果（重启后可复现）。 */
export function shuffleIds(ids: string[], seed: number): string[] {
    const random = mulberry32(seed);
    const next = [...ids];
    for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
}

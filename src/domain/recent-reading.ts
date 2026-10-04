/** 会话内最近阅读列表；只保存文档 ID 和显示标题，不进入文章属性或 saveData。 */
export interface RecentReadingEntry {
    id: string;
    title: string;
}

export const RECENT_READING_LIMIT = 8;

function clean(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * 把一次打开动作放到列表首位，同一文档只保留一项。
 * 返回新数组，调用方可安全保留自己的会话快照。
 */
export function addRecentReading(
    entries: readonly RecentReadingEntry[],
    entry: Partial<RecentReadingEntry> & Pick<RecentReadingEntry, "id">,
    limit = RECENT_READING_LIMIT,
): RecentReadingEntry[] {
    const id = clean(entry.id);
    if (!id) return entries.slice(0, Math.max(0, limit)).map((item) => ({ id: item.id, title: item.title }));
    const previous = entries.find((item) => clean(item.id) === id);
    const title = clean(entry.title) || clean(previous?.title);
    const next = [{ id, title }, ...entries.filter((item) => clean(item.id) !== id)]
        .slice(0, Math.max(0, limit));
    return next.map((item) => ({ id: clean(item.id), title: clean(item.title) }));
}

/** 读取旧会话快照时去重、清洗并限制数量。 */
export function normalizeRecentReading(entries: readonly RecentReadingEntry[], limit = RECENT_READING_LIMIT): RecentReadingEntry[] {
    const max = Math.max(0, limit);
    if (max === 0) return [];
    const result: RecentReadingEntry[] = [];
    for (const item of entries) {
        const id = clean(item.id);
        if (!id || result.some((current) => current.id === id)) continue;
        result.push({ id, title: clean(item.title) });
        if (result.length >= max) break;
    }
    return result;
}

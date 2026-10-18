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

export interface ActiveRecentReadingItem {
    id: string;
    title: string;
    status?: string;
    contentType?: string;
    minutes?: number;
    hasBookmark: boolean;
}

export interface RecentReadingClipSource {
    title?: string;
    status?: string;
    contentType?: string;
    minutes?: number;
    readingPosition?: unknown;
}

/**
 * 从会话内最近阅读条目中，结合当前读库已收录索引，投影出可用于快速继续阅读的有效条目列表。
 * - 仅投影存在于 clipsMap 且已收录的文章（排除已删除/非读库条目）；
 * - 优先从索引补齐缺失标题；
 * - 识别是否存在版本 1 显式书签（readingPosition）；
 * - 保持最近打开的时间次序（首项为最新打开的一篇）。
 */
export function projectActiveRecentReadings(
    entries: readonly RecentReadingEntry[],
    clipsMap: Record<string, RecentReadingClipSource> | null | undefined,
    limit = 3,
): ActiveRecentReadingItem[] {
    if (!clipsMap || typeof clipsMap !== "object") return [];
    const max = Math.max(0, limit);
    if (max === 0) return [];

    const result: ActiveRecentReadingItem[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        const id = clean(entry.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const clip = clipsMap[id];
        // 仅收录存在于读库中的有效条目
        if (!clip) continue;

        const title = clean(entry.title) || clean(clip.title) || id;
        const hasBookmark = Boolean(
            clip.readingPosition &&
            (typeof clip.readingPosition === "string" ? clip.readingPosition.trim().length > 0 : typeof clip.readingPosition === "object")
        );

        result.push({
            id,
            title,
            status: typeof clip.status === "string" ? clip.status : undefined,
            contentType: typeof clip.contentType === "string" ? clip.contentType : undefined,
            minutes: typeof clip.minutes === "number" && Number.isFinite(clip.minutes) ? clip.minutes : undefined,
            hasBookmark,
        });

        if (result.length >= max) break;
    }

    return result;
}

/**
 * 决定“继续阅读”命令的目标文档 ID（T-1800 / T-3379）：
 * 1. 优先在会话历史 entries 中寻找：
 *    - 若传入了当前正打开的文档 ID（currentDocId），且首项即为当前文档，则轮换到第二项（实现两篇间的往返穿梭）；
 *    - 否则返回第一项。
 * 2. 若会话历史没有条目，尝试回退使用 fallbackDocId；
 * 3. 都没有时返回空串。
 */
export function pickContinueReadingDocId(
    entries: readonly RecentReadingEntry[],
    currentDocId?: string,
    fallbackDocId?: string
): string {
    const cur = (currentDocId || "").trim();
    const validEntries = entries.map((e) => (e.id || "").trim()).filter(Boolean);

    if (validEntries.length > 0) {
        if (cur && validEntries[0] === cur && validEntries.length > 1) {
            return validEntries[1];
        }
        return validEntries[0];
    }

    return (fallbackDocId || "").trim();
}

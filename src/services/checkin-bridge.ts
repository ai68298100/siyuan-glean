/**
 * 小驴打卡桥（T-1505）：window.siyuanCheckin v5 消费端。
 * 准入纪律（打卡契约五项）：探测→whenReady→能力协商→写入（用户显式开启才调用）→失败隔离不抛裸异常。
 * externalRef 幂等：glean:<docId>:<localDate>（domain/checkin.ts）。
 */
import { readingEventNote, readingEventRef } from "../domain/checkin";

/** window.siyuanCheckin v5 的最小消费切片（防御式 any 进、规范对象出）。 */
interface CheckinApi {
    protocol?: string;
    isReady?: () => boolean;
    whenReady?: () => Promise<void> | void;
    hasCapability?: (name: string) => boolean;
    queryItems?: (options?: { kinds?: string[]; limit?: number }) => Promise<Array<{ id: string; name: string; kind?: string; archived?: boolean }>> | Array<{ id: string; name: string; kind?: string; archived?: boolean }>;
    recordEvent?: (input: {
        itemId: string;
        value?: number;
        source: "api";
        externalRef?: string;
        note?: string;
        occurredAt?: string;
    }) => Promise<unknown> | unknown;
}

function api(): CheckinApi | null {
    const candidate = (window as unknown as { siyuanCheckin?: CheckinApi }).siyuanCheckin;
    if (!candidate || candidate.protocol !== "siyuan-checkin") return null;
    return candidate;
}

async function readyApi(capability: string): Promise<CheckinApi | null> {
    const checkin = api();
    if (!checkin) return null;
    try {
        if (checkin.whenReady) await checkin.whenReady();
    } catch {
        return null;
    }
    if (!checkin.hasCapability?.(capability)) return null;
    return checkin;
}

export interface CheckinItemOption {
    id: string;
    name: string;
    kind: string;
}

/** 列出可作"阅读"打卡目标的项目（duration/binary/quantity；排除归档由宿主默认处理）。 */
export async function listCheckinItems(): Promise<CheckinItemOption[]> {
    const checkin = await readyApi("items.query");
    if (!checkin?.queryItems) return [];
    try {
        const items = await checkin.queryItems({ limit: 200 });
        return (items ?? [])
            .filter((item) => Boolean(item?.id))
            .map((item) => ({ id: item.id, name: item.name, kind: item.kind ?? "" }));
    } catch {
        return [];
    }
}

export type ReadingRecordResult = "recorded" | "duplicate" | "blocked" | "rejected" | "discarded" | "unavailable";

/**
 * 记录"读完一篇"事件（fire-and-forget 友好）。
 * 失败一律返回 "unavailable"/"rejected" 并 console 留痕，绝不抛裸异常进入宿主。
 */
export async function recordReadingDone(
    itemId: string,
    docId: string,
    docTitle: string
): Promise<ReadingRecordResult> {
    const checkin = await readyApi("events.record");
    if (!checkin?.recordEvent) {
        console.warn("[glean-checkin] events.record 不可用，跳过打卡记录");
        return "unavailable";
    }
    const externalRef = readingEventRef(docId);
    try {
        const result = await checkin.recordEvent({
            itemId,
            source: "api",
            externalRef,
            note: readingEventNote(docTitle),
        });
        if (result && typeof result === "object" && "kind" in (result as Record<string, unknown>)) {
            return (result as { kind: ReadingRecordResult }).kind;
        }
        // recordEvent 单条兼容语义：事件副本=recorded、重复=已有副本、undefined=未写入
        return result ? "recorded" : "rejected";
    } catch (error) {
        console.warn(`[glean-checkin] recordEvent 失败（保留 externalRef 待重试: ${externalRef}）`, error);
        return "unavailable";
    }
}


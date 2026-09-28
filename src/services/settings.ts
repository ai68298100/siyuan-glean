/**
 * 插件设置（saveData "settings.json"）。normalize 兜底：缺键补默认、类型漂移拉回。
 * 这份只是偏好；文章数据永远在文档属性上（D-0001），删了设置也不伤库。
 */
import type { Plugin } from "siyuan";
import { DEFAULT_MIGRATE_BATCH_SIZE, MAX_MIGRATE_BATCH_SIZE } from "../domain/migrate-consts";

export interface GleanSettings {
    version: 1;
    /** 读库笔记本（主锚点），notebook id 列表 */
    anchorNotebooks: string[];
    ai: {
        /** 收录时自动摘要+AI标签（M3 生效） */
        enrichOnCapture: boolean;
        /** 阅读时推荐相关旧文（M3 生效） */
        relatedWhileReading: boolean;
        /** 预置 AI 动作（总结/要点/反方观点）（M3 生效） */
        presetActions: boolean;
    };
    resurface: {
        /** 每日重浮篇数（M4 生效） */
        dailyCount: number;
        /** 重浮池包含已读高亮 */
        includeDoneHighlights: boolean;
    };
    /** 新剪藏区提醒上限 */
    inboxQuota: number;
    /** 超龄归档候选天数（M4 生效） */
    staleDays: number;
    /** 迁移器每批写入条数（≤50） */
    migrateBatchSize: number;
}

export const DEFAULT_SETTINGS: GleanSettings = {
    version: 1,
    anchorNotebooks: [],
    ai: { enrichOnCapture: true, relatedWhileReading: true, presetActions: true },
    resurface: { dailyCount: 3, includeDoneHighlights: false },
    inboxQuota: 50,
    staleDays: 90,
    migrateBatchSize: DEFAULT_MIGRATE_BATCH_SIZE,
};

const SETTINGS_FILE = "settings.json";

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeSettings(raw: unknown): GleanSettings {
    const input = (raw ?? {}) as Partial<GleanSettings>;
    const ai = (input.ai ?? {}) as Partial<GleanSettings["ai"]>;
    const resurface = (input.resurface ?? {}) as Partial<GleanSettings["resurface"]>;
    return {
        version: 1,
        anchorNotebooks: Array.isArray(input.anchorNotebooks)
            ? input.anchorNotebooks.filter((id): id is string => typeof id === "string" && id.length > 0)
            : [],
        ai: {
            enrichOnCapture: ai.enrichOnCapture ?? DEFAULT_SETTINGS.ai.enrichOnCapture,
            relatedWhileReading: ai.relatedWhileReading ?? DEFAULT_SETTINGS.ai.relatedWhileReading,
            presetActions: ai.presetActions ?? DEFAULT_SETTINGS.ai.presetActions,
        },
        resurface: {
            dailyCount: clampInt(resurface.dailyCount, 1, 10, DEFAULT_SETTINGS.resurface.dailyCount),
            includeDoneHighlights: resurface.includeDoneHighlights ?? DEFAULT_SETTINGS.resurface.includeDoneHighlights,
        },
        inboxQuota: clampInt(input.inboxQuota, 5, 1000, DEFAULT_SETTINGS.inboxQuota),
        staleDays: clampInt(input.staleDays, 7, 3650, DEFAULT_SETTINGS.staleDays),
        migrateBatchSize: clampInt(input.migrateBatchSize, 1, MAX_MIGRATE_BATCH_SIZE, DEFAULT_MIGRATE_BATCH_SIZE),
    };
}

export async function loadSettings(plugin: Plugin): Promise<GleanSettings> {
    try {
        const raw = await plugin.loadData(SETTINGS_FILE);
        return normalizeSettings(raw);
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export async function saveSettings(plugin: Plugin, settings: GleanSettings): Promise<GleanSettings> {
    const normalized = normalizeSettings(settings);
    await plugin.saveData(SETTINGS_FILE, normalized);
    return normalized;
}

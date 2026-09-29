/**
 * 插件设置（saveData "settings.json"）。normalize 兜底：缺键补默认、类型漂移拉回。
 * 这份只是偏好；文章数据永远在文档属性上（D-0001），删了设置也不伤库。
 */
import type { Plugin } from "siyuan";
import { DEFAULT_MIGRATE_BATCH_SIZE, MAX_MIGRATE_BATCH_SIZE } from "../domain/migrate-consts.ts";

export interface GleanSettings {
    version: 1;
    /** 读库笔记本（主锚点），notebook id 列表 */
    anchorNotebooks: string[];
    ai: {
        /** 富化触发模式：off=关闭 / manual=仅手动(✨) / auto=收录时自动。token 消耗的主开关。 */
        enrichMode: "off" | "manual" | "auto";
        /** 每日富化次数上限（自动+手动合计），0=不限；超限静默跳过并提示 */
        enrichDailyCap: number;
        /** 富化时做语义查重（走嵌入模型，不耗 LLM token） */
        dedupOnEnrich: boolean;
        /** 阅读时推荐相关旧文（走嵌入模型，不耗 LLM token） */
        relatedWhileReading: boolean;
        /** 预置 AI 动作（总结/要点/反方观点，不自动消耗 token） */
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
    ai: {
        enrichMode: "manual",
        enrichDailyCap: 20,
        dedupOnEnrich: true,
        relatedWhileReading: true,
        presetActions: true,
    },
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

function normalizeEnrichMode(value: unknown, legacyOnCapture: unknown): "off" | "manual" | "auto" {
    if (value === "off" || value === "manual" || value === "auto") return value;
    if (typeof legacyOnCapture === "boolean") return legacyOnCapture ? "auto" : "manual";
    return DEFAULT_SETTINGS.ai.enrichMode;
}

export function normalizeSettings(raw: unknown): GleanSettings {
    const input = (raw ?? {}) as Partial<GleanSettings> & { ai?: Partial<GleanSettings["ai"]> & { enrichOnCapture?: unknown } };
    const ai = (input.ai ?? {}) as Partial<GleanSettings["ai"]> & { enrichOnCapture?: unknown };
    const resurface = (input.resurface ?? {}) as Partial<GleanSettings["resurface"]>;
    return {
        version: 1,
        anchorNotebooks: Array.isArray(input.anchorNotebooks)
            ? input.anchorNotebooks.filter((id): id is string => typeof id === "string" && id.length > 0)
            : [],
        ai: {
            // 兼容旧版布尔 enrichOnCapture：true→auto，false→manual
            enrichMode: normalizeEnrichMode(ai.enrichMode, ai.enrichOnCapture),
            enrichDailyCap: clampInt(ai.enrichDailyCap, 0, 500, DEFAULT_SETTINGS.ai.enrichDailyCap),
            dedupOnEnrich: ai.dedupOnEnrich ?? DEFAULT_SETTINGS.ai.dedupOnEnrich,
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

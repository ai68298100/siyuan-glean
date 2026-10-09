/**
 * UI 偏好（saveData "ui-prefs.json"）：跨重启记住面板状态。
 * 只存"界面偏好"，绝不存文章数据（数据主权铁律，D-0001）。
 * 保存为增量合并（patch 语义），避免多入口互相覆盖。
 */
import type { Plugin } from "siyuan";
import { normalizePreviewRatio } from "../domain/workbench-preview.ts";
import { normalizeRailGroups, type RailGroups } from "../domain/library-rail.ts";
import {
    DEFAULT_READER_APPEARANCE,
    EMPTY_GOVERNANCE_MUTED,
    normalizeGovernanceMuted,
    normalizeReaderAppearance,
    normalizeSavedViews,
    type ReaderAppearance,
    type SavedView,
    type GovernanceMuted,
} from "../domain/ui-prefs.ts";

export type OnboardingStep = 1 | 2 | 3 | 4;

export interface UiPrefs {
    /** 上次停留的面板视图 */
    lastView: string;
    /** 首启引导已完成/已跳过 */
    onboardingDone: boolean;
    /** 首启引导关闭后下次恢复的步骤 */
    onboardingStep: OnboardingStep;
    /** 是否由用户中断，允许下一次布局就绪时恢复 */
    onboardingInterrupted: boolean;
    /** 设置页新手提示已由用户关闭 */
    onboardingHintDismissed: boolean;
    readerAppearance: ReaderAppearance;
    readerSidebarCollapsed: boolean;
    workbenchPreviewEnabled: boolean;
    workbenchPreviewRatio: number;
    libraryRailGroups: RailGroups;
    savedViews: SavedView[];
    defaultSavedViewId: string;
    governanceMuted: GovernanceMuted;
}

const PREFS_FILE = "ui-prefs.json";

const DEFAULTS: UiPrefs = {
    lastView: "",
    onboardingDone: false,
    onboardingStep: 1,
    onboardingInterrupted: false,
    onboardingHintDismissed: false,
    readerAppearance: { ...DEFAULT_READER_APPEARANCE },
    readerSidebarCollapsed: false,
    workbenchPreviewEnabled: true,
    workbenchPreviewRatio: normalizePreviewRatio(undefined),
    libraryRailGroups: normalizeRailGroups(undefined),
    savedViews: [],
    defaultSavedViewId: "",
    governanceMuted: { ...EMPTY_GOVERNANCE_MUTED },
};

const saveQueues = new WeakMap<object, Promise<unknown>>();

function normalizeOnboardingStep(value: unknown): OnboardingStep {
    return value === 2 || value === 3 || value === 4 ? value : 1;
}

export function normalizeUiPrefs(raw: unknown): UiPrefs {
    const partial = raw && typeof raw === "object" ? raw as Partial<UiPrefs> : {};
    const onboardingDone = partial.onboardingDone === true;
    const onboardingHintDismissed = onboardingDone || partial.onboardingHintDismissed === true;
    const savedViews = normalizeSavedViews(partial.savedViews);
    const requestedDefault = typeof partial.defaultSavedViewId === "string" ? partial.defaultSavedViewId : "";
    return {
        lastView: typeof partial.lastView === "string" ? partial.lastView : "",
        onboardingDone,
        onboardingStep: onboardingDone ? 1 : normalizeOnboardingStep(partial.onboardingStep),
        onboardingInterrupted: !onboardingDone && partial.onboardingInterrupted === true,
        onboardingHintDismissed,
        readerAppearance: normalizeReaderAppearance(partial.readerAppearance),
        readerSidebarCollapsed: partial.readerSidebarCollapsed === true,
        workbenchPreviewEnabled: typeof partial.workbenchPreviewEnabled === "boolean" ? partial.workbenchPreviewEnabled : true,
        workbenchPreviewRatio: normalizePreviewRatio(partial.workbenchPreviewRatio),
        libraryRailGroups: normalizeRailGroups(partial.libraryRailGroups),
        savedViews,
        defaultSavedViewId: savedViews.some((view) => view.id === requestedDefault) ? requestedDefault : "",
        governanceMuted: normalizeGovernanceMuted(partial.governanceMuted),
    };
}

function clonePrefs(prefs: UiPrefs): UiPrefs {
    return {
        ...prefs,
        readerAppearance: { ...prefs.readerAppearance },
        libraryRailGroups: normalizeRailGroups(prefs.libraryRailGroups),
        savedViews: prefs.savedViews.map((view) => ({ ...view, filter: { ...view.filter } })),
        governanceMuted: { ...prefs.governanceMuted },
    };
}

type UiPrefsPatch = Omit<Partial<UiPrefs>, "libraryRailGroups"> & { libraryRailGroups?: Partial<RailGroups> };

function clonePatch(patch: UiPrefsPatch): UiPrefsPatch {
    return {
        ...patch,
        ...(patch.readerAppearance ? { readerAppearance: { ...patch.readerAppearance } } : {}),
        ...(patch.libraryRailGroups ? { libraryRailGroups: Object.fromEntries(Object.entries(patch.libraryRailGroups).map(([name, group]) => [name, { ...group }])) } : {}),
        ...(patch.savedViews ? { savedViews: patch.savedViews.map((view) => ({ ...view, filter: { ...view.filter } })) } : {}),
        ...(patch.governanceMuted ? { governanceMuted: { ...patch.governanceMuted } } : {}),
    };
}

export async function loadUiPrefs(plugin: Plugin, options: { strict?: boolean } = {}): Promise<UiPrefs> {
    try {
        const raw = await plugin.loadData(PREFS_FILE);
        return normalizeUiPrefs(raw);
    } catch (error) { if (options.strict) throw error; }
    return clonePrefs(DEFAULTS);
}

/** 增量保存：每个插件实例串行读取-合并-写回，失败不会污染后续保存。 */
export class UiPrefsConflictError extends Error {
    constructor() { super("Preferences changed"); }
}

export async function saveUiPrefs(plugin: Plugin, patch: UiPrefsPatch, options: { expected?: UiPrefs } = {}): Promise<UiPrefs> {
    const safePatch = clonePatch(patch);
    const expected = options.expected ? clonePrefs(normalizeUiPrefs(options.expected)) : undefined;
    const previous = saveQueues.get(plugin as object) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
        const raw = await plugin.loadData(PREFS_FILE);
        const current = normalizeUiPrefs(raw);
        if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new UiPrefsConflictError();
        const merged = normalizeUiPrefs({
            ...current, ...safePatch,
            libraryRailGroups: { ...current.libraryRailGroups, ...safePatch.libraryRailGroups },
        });
        if (merged.onboardingDone) {
            merged.onboardingStep = 1;
            merged.onboardingInterrupted = false;
            merged.onboardingHintDismissed = true;
        }
        const result = clonePrefs(merged);
        await plugin.saveData(PREFS_FILE, result);
        return result;
    });
    saveQueues.set(plugin as object, operation);
    void operation.then(() => undefined, () => undefined).then(() => {
        if (saveQueues.get(plugin as object) === operation) saveQueues.delete(plugin as object);
    });
    return operation;
}

/**
 * 工作台视图字段的**精确写**API（T-3318）：DockPanel 挂载两个实例（dock + 工作台 tab），
 * 内存快照互不同步，任何“整体写回”都会造成跨实例丢视图或已删视图复活。
 * 因此视图相关的持久化只提供四种精确操作，全部在串行队列内读最新文件后定点修改；
 * 读取失败拒绝写回，防止空快照覆盖用户数据。UI 侧本地状态只用于渲染，不作为写回来源。
 */

/** 只更新 lastView（高频、无冲突面）。 */
export async function saveLastViewPref(plugin: Plugin, lastView: string): Promise<UiPrefs> {
    return queueViewPrefOp(plugin, (current) => ({ ...current, lastView }));
}

/** 新建/更新单个保存视图（幂等：同 id 覆盖）。 */
export async function upsertSavedViewPref(plugin: Plugin, view: UiPrefs["savedViews"][number]): Promise<UiPrefs> {
    return queueViewPrefOp(plugin, (current) => {
        const rest = current.savedViews.filter((item) => item.id !== view.id);
        return { ...current, savedViews: [...rest, view] };
    });
}

/** 删除单个保存视图；若默认视图指向它则一并清空。 */
export async function deleteSavedViewPref(plugin: Plugin, id: string): Promise<UiPrefs> {
    return queueViewPrefOp(plugin, (current) => ({
        ...current,
        savedViews: current.savedViews.filter((item) => item.id !== id),
        defaultSavedViewId: current.defaultSavedViewId === id ? "" : current.defaultSavedViewId,
    }));
}

/** 只更新默认视图。 */
export async function setDefaultSavedViewPref(plugin: Plugin, id: string): Promise<UiPrefs> {
    return queueViewPrefOp(plugin, (current) => ({ ...current, defaultSavedViewId: id }));
}

function queueViewPrefOp(
    plugin: Plugin,
    mutate: (current: UiPrefs) => UiPrefs,
): Promise<UiPrefs> {
    const previous = saveQueues.get(plugin as object) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
        let current: UiPrefs;
        try {
            current = normalizeUiPrefs(await plugin.loadData(PREFS_FILE));
        } catch {
            // 读失败（含文件损坏）：拒绝写回，避免空快照覆盖
            throw new UiPrefsConflictError();
        }
        const merged = normalizeUiPrefs(mutate(current));
        if (merged.onboardingDone) {
            merged.onboardingStep = 1;
            merged.onboardingInterrupted = false;
            merged.onboardingHintDismissed = true;
        }
        const result = clonePrefs(merged);
        await plugin.saveData(PREFS_FILE, result);
        return result;
    });
    saveQueues.set(plugin as object, operation);
    void operation.then(() => undefined, () => undefined).then(() => {
        if (saveQueues.get(plugin as object) === operation) saveQueues.delete(plugin as object);
    });
    return operation;
}

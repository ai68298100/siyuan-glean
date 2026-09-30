/**
 * UI 偏好（saveData "ui-prefs.json"）：跨重启记住面板状态。
 * 只存"界面偏好"，绝不存文章数据（数据主权铁律，D-0001）。
 * 保存为增量合并（patch 语义），避免多入口互相覆盖。
 */
import type { Plugin } from "siyuan";

export interface UiPrefs {
    /** 上次停留的面板视图 */
    lastView: string;
    /** 首启引导已完成/已跳过 */
    onboardingDone: boolean;
}

const PREFS_FILE = "ui-prefs.json";

const DEFAULTS: UiPrefs = { lastView: "", onboardingDone: false };

/** 偏好写队列（T-1955）：load→merge→save 的读改写必须串行，防止多入口并发保存互相覆盖。 */
let prefsQueue: Promise<unknown> = Promise.resolve();

function withPrefsLock<T>(task: () => Promise<T>): Promise<T> {
    const run = prefsQueue.then(task, task);
    prefsQueue = run.catch(() => undefined);
    return run;
}

export async function loadUiPrefs(plugin: Plugin): Promise<UiPrefs> {
    return withPrefsLock(async () => {
        try {
            const raw = await plugin.loadData(PREFS_FILE);
            if (raw && typeof raw === "object") {
                const partial = raw as Partial<UiPrefs>;
                return {
                    lastView: typeof partial.lastView === "string" ? partial.lastView : "",
                    onboardingDone: partial.onboardingDone === true,
                };
            }
        } catch { /* 忽略 */ }
        return { ...DEFAULTS };
    });
}

/** 增量保存：读取现有 → 合并 → 写回（patch 语义），全程在写队列内执行。 */
export async function saveUiPrefs(plugin: Plugin, patch: Partial<UiPrefs>): Promise<UiPrefs> {
    return withPrefsLock(async () => {
        const current = await loadUiPrefsUnlocked(plugin);
        const merged: UiPrefs = { ...current, ...patch };
        await plugin.saveData(PREFS_FILE, merged);
        return merged;
    });
}

/** 队列内复用：不加锁的读取（调用方已在 withPrefsLock 内）。 */
async function loadUiPrefsUnlocked(plugin: Plugin): Promise<UiPrefs> {
    try {
        const raw = await plugin.loadData(PREFS_FILE);
        if (raw && typeof raw === "object") {
            const partial = raw as Partial<UiPrefs>;
            return {
                lastView: typeof partial.lastView === "string" ? partial.lastView : "",
                onboardingDone: partial.onboardingDone === true,
            };
        }
    } catch { /* 忽略 */ }
    return { ...DEFAULTS };
}

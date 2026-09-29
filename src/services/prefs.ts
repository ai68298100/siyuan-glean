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

export async function loadUiPrefs(plugin: Plugin): Promise<UiPrefs> {
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

/** 增量保存：读取现有 → 合并 → 写回（patch 语义），多入口互不覆盖。 */
export async function saveUiPrefs(plugin: Plugin, patch: Partial<UiPrefs>): Promise<UiPrefs> {
    const current = await loadUiPrefs(plugin);
    const merged: UiPrefs = { ...current, ...patch };
    await plugin.saveData(PREFS_FILE, merged);
    return merged;
}

/**
 * UI 偏好（saveData "ui-prefs.json"）：跨重启记住面板状态。
 * 只存"界面偏好"，绝不存文章数据（数据主权铁律，D-0001）。
 */
import type { Plugin } from "siyuan";

export interface UiPrefs {
    /** 上次停留的面板视图 */
    lastView: string;
}

const PREFS_FILE = "ui-prefs.json";

export async function loadUiPrefs(plugin: Plugin): Promise<UiPrefs> {
    try {
        const raw = await plugin.loadData(PREFS_FILE);
        if (raw && typeof raw === "object" && typeof (raw as UiPrefs).lastView === "string") {
            return raw as UiPrefs;
        }
    } catch { /* 忽略 */ }
    return { lastView: "" };
}

export async function saveUiPrefs(plugin: Plugin, prefs: UiPrefs): Promise<void> {
    await plugin.saveData(PREFS_FILE, prefs);
}

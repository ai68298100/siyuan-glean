/**
 * 备份/恢复服务（T-1780，契约 DATA-CONTRACT §0.1）：
 * 导出 = 读全部已收录文档属性（经 clip-store 批读）+ 插件 saveData 快照 → 包 JSON 字符串（由 UI 触发下载）。
 * 恢复 = 预览（文档存在性检查）→ 用户确认 → 包内 attrs 经 restoreClipAttrs 覆盖写回
 *       → 设置/偏好覆盖（返回恢复后的设置供壳层同步）→ 全量对账重建索引。缺失文档跳过不报错。
 * 包不携带密钥：自定义通道只导出 customSecretName 名字，密钥本体留在思源密钥库。
 */
import type { Plugin } from "siyuan";
import { querySql } from "../api/client";
import {
    BACKUP_APP,
    BACKUP_VERSION,
    backupFileName,
    parseBackup,
    pickClipAttrs,
    previewBackup,
    type BackupPackage,
    type BackupPreview,
} from "../domain/backup";
import { batchReadClipAttrs, listClipDocs, rebuildIndex, restoreClipAttrs } from "./clip-store";
import { loadSettings, saveSettings, type GleanSettings } from "./settings";

export { backupFileName };

export async function buildBackupPackage(plugin: Plugin, settings: GleanSettings): Promise<BackupPackage> {
    const docs = await listClipDocs();
    const pairs = await batchReadClipAttrs(docs.map((doc) => doc.id));
    const clips = pairs.map((pair) => ({ id: pair.id, attrs: pickClipAttrs(pair.attrs) }));
    return {
        version: BACKUP_VERSION,
        app: BACKUP_APP,
        exportedAt: new Date().toISOString(),
        settings,
        index: await plugin.loadData("glean-index.json") ?? null,
        uiPrefs: await plugin.loadData("ui-prefs.json") ?? null,
        clips,
    };
}

export function backupPackageJson(pkg: BackupPackage): string {
    return JSON.stringify(pkg, null, 2);
}

/** 恢复预览：解析校验 + 检查包内文档是否仍存在（存在才可覆盖写回）。 */
export async function previewRestore(raw: string): Promise<{ pkg: BackupPackage; preview: BackupPreview }> {
    const parsed = parseBackup(raw);
    if (!parsed.ok) {
        const reasons: Record<string, string> = {
            "not-json": "文件不是合法 JSON",
            "not-object": "备份包结构不符",
            "bad-version": "备份包版本不受支持",
            "bad-app": "这不是小驴拾遗的备份包",
            "bad-clips": "备份包文章列表损坏",
        };
        throw new Error(reasons[parsed.reason] ?? "备份包无法解析");
    }
    const missingIds = new Set<string>();
    for (let offset = 0; offset < parsed.data.clips.length; offset += 200) {
        const batch = parsed.data.clips.slice(offset, offset + 200);
        const rows = await querySql<{ id: string }>(
            `SELECT id FROM blocks WHERE type = 'd' AND id IN (${batch.map((clip) => `'${clip.id.replace(/'/g, "''")}'`).join(",")})`
        );
        const found = new Set(rows.map((row) => row.id));
        for (const clip of batch) {
            if (!found.has(clip.id)) missingIds.add(clip.id);
        }
    }
    return { pkg: parsed.data, preview: previewBackup(parsed.data, missingIds) };
}

export interface RestoreSummary {
    restored: number;
    /** 文档已删除或写入失败的篇数 */
    skipped: number;
    settingsRestored: boolean;
    prefsRestored: boolean;
}

/**
 * 执行恢复（用户在预览后显式确认）。
 * 返回 summary.settings 语义：包内设置已落盘；调用方须同步壳层缓存
 * （facade.updateSettings(pkg.settings) 合并语义下等价全量覆盖）并刷新界面。
 */
export async function restoreBackup(plugin: Plugin, pkg: BackupPackage): Promise<RestoreSummary> {
    const summary: RestoreSummary = {
        restored: 0,
        skipped: 0,
        settingsRestored: false,
        prefsRestored: false,
    };
    for (const clip of pkg.clips) {
        try {
            const written = await restoreClipAttrs(plugin, clip.id, clip.attrs);
            if (written > 0) summary.restored += 1;
            else summary.skipped += 1;
        } catch {
            summary.skipped += 1;
        }
    }
    if (pkg.settings && typeof pkg.settings === "object") {
        await saveSettings(plugin, pkg.settings as GleanSettings);
        summary.settingsRestored = true;
    }
    if (pkg.uiPrefs && typeof pkg.uiPrefs === "object") {
        const prefs = pkg.uiPrefs as { lastView?: unknown; onboardingDone?: unknown };
        const { saveUiPrefs } = await import("./prefs");
        await saveUiPrefs(plugin, {
            lastView: typeof prefs.lastView === "string" ? prefs.lastView : undefined,
            onboardingDone: prefs.onboardingDone === true ? true : undefined,
        });
        summary.prefsRestored = true;
    }
    // 索引是可重建缓存：恢复后按（包内或当前的）设置全量对账，使其与写回后的属性一致
    const settings = await loadSettings(plugin);
    await rebuildIndex(plugin, settings);
    return summary;
}

/**
 * 备份包域层（T-1780，纯函数）：包类型、构造与解析校验。
 * 契约见 DATA-CONTRACT §0.1：包是数据主权的自查证明，不是第二事实源；
 * attrs 只含 custom-clip-* 键；非法键丢弃、非法枚举在恢复时经 parseClipAttrs 归一。
 */

export const BACKUP_VERSION = 1;
export const BACKUP_APP = "siyuan-glean";

export interface BackupClip {
    /** 思源文档 ID（恢复目标） */
    id: string;
    /** 根块 IAL 里的 custom-clip-* 子集 */
    attrs: Record<string, string>;
}

export interface BackupPackage {
    version: number;
    app: string;
    exportedAt: string;
    settings: unknown;
    index: unknown;
    uiPrefs: unknown;
    clips: BackupClip[];
}

export function backupFileName(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `glean-backup-${stamp}.json`;
}

/** 只保留 custom-clip-* 键（T-1988 同款防越界思路：包不携带无关 IAL）。 */
export function pickClipAttrs(ial: Record<string, string | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(ial)) {
        if (key.startsWith("custom-clip-") && typeof value === "string") out[key] = value;
    }
    return out;
}

export type BackupParseResult =
    | { ok: true; data: BackupPackage }
    | { ok: false; reason: "not-json" | "not-object" | "bad-version" | "bad-app" | "bad-clips" };

/** 解析并校验备份包：版本/应用不符拒绝，clips 结构非法拒绝（整体拒绝，不部分导入）。 */
export function parseBackup(raw: string): BackupParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw ?? ""));
    } catch {
        return { ok: false, reason: "not-json" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "not-object" };
    const pkg = parsed as Partial<BackupPackage>;
    if (pkg.version !== BACKUP_VERSION) return { ok: false, reason: "bad-version" };
    if (pkg.app !== BACKUP_APP) return { ok: false, reason: "bad-app" };
    if (!Array.isArray(pkg.clips)) return { ok: false, reason: "bad-clips" };
    const clips: BackupClip[] = [];
    for (const entry of pkg.clips) {
        if (!entry || typeof entry !== "object") continue;
        const clip = entry as Partial<BackupClip>;
        if (typeof clip.id !== "string" || clip.id.length === 0) continue;
        if (!clip.attrs || typeof clip.attrs !== "object") continue;
        // 非法键丢弃（只认 custom-clip-*），值一律取字符串形态
        const attrs = pickClipAttrs(clip.attrs as Record<string, string | undefined>);
        clips.push({ id: clip.id, attrs });
    }
    return {
        ok: true,
        data: {
            version: BACKUP_VERSION,
            app: BACKUP_APP,
            exportedAt: typeof pkg.exportedAt === "string" ? pkg.exportedAt : "",
            settings: pkg.settings ?? null,
            index: pkg.index ?? null,
            uiPrefs: pkg.uiPrefs ?? null,
            clips,
        },
    };
}

export interface BackupPreview {
    totalClips: number;
    /** 文档仍存在、确认后将被包内值覆盖的篇数 */
    restorable: number;
    /** 文档已删除，无法恢复的篇数 */
    missing: number;
    /** 附带恢复：设置/索引/偏好是否随包恢复 */
    restoresSettings: boolean;
    restoresIndex: boolean;
    restoresPrefs: boolean;
}

/** 恢复预览（纯投影）：missingIds 由调用方以文档存在性检查填入。 */
export function previewBackup(pkg: BackupPackage, missingIds: Set<string>): BackupPreview {
    const missing = pkg.clips.filter((clip) => missingIds.has(clip.id)).length;
    return {
        totalClips: pkg.clips.length,
        restorable: pkg.clips.length - missing,
        missing,
        restoresSettings: pkg.settings !== null,
        restoresIndex: pkg.index !== null,
        restoresPrefs: pkg.uiPrefs !== null,
    };
}

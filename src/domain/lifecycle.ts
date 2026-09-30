/**
 * 归档生命周期纯函数（T-1869/1870/1871，契约 D-0032 / DATA-CONTRACT §7）。
 * 只做路径与判定计算，不做任何 IO；内核移动/删除语义见 api/client 与 lifecycle-service。
 */

/** 宿主文档标题（作者需求原文：在当前文章所在文件夹下创建）。 */
export const ARCHIVE_HOST_TITLE = "【归档】";
export const RECYCLE_HOST_TITLE = "【回收】";

export type HostKind = "archive" | "recycle";

export function hostTitleOf(kind: HostKind): string {
    return kind === "archive" ? ARCHIVE_HOST_TITLE : RECYCLE_HOST_TITLE;
}

/** hpath 的父目录（"/a/b/文章" → "/a/b"；根级文档 → ""；反斜杠归一）。 */
export function parentFolderOf(hpath: string): string {
    const parts = hpath.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();
    return parts.length > 0 ? `/${parts.join("/")}` : "";
}

/**
 * 宿主在当前文件夹下的完整 hpath：根级文章 → "/【归档】"；
 * 子文件夹文章 → "/a/b/【归档】"（§7.1：同笔记本同目录创建）。
 * 嵌宿主边界：已在【归档】下的文章其【回收】宿主为宿主内同级（"/a/【归档】/【回收】"）——
 * 严格按"当前文章所在文件夹下创建"，不追忆原路径（§7.4 无隐式状态）。
 */
export function hostHpathOf(hpath: string, kind: HostKind): string {
    const parent = parentFolderOf(hpath);
    const title = hostTitleOf(kind);
    return parent ? `${parent}/${title}` : `/${title}`;
}

/** 文章是否已在目标宿主下（移动幂等 no-op 判据；任一路径段等于宿主标题）。 */
export function isUnderHost(hpath: string, kind: HostKind): boolean {
    const title = hostTitleOf(kind);
    return hpath.split("/").filter(Boolean).includes(title);
}

/** 文章自身就是宿主（或与宿主同名）：不允许把自己移进自己。 */
export function isHostItself(hpath: string, title: string): boolean {
    const parts = hpath.split("/").filter(Boolean);
    if (parts.length === 0) return false;
    const last = parts[parts.length - 1];
    return last === title && (title === ARCHIVE_HOST_TITLE || title === RECYCLE_HOST_TITLE);
}

/** 彻底删除确认信息（§7.3：标题/笔记本/路径/来源，缺一不弹确认）。 */
export interface PurgeInfo {
    id: string;
    title: string;
    box: string;
    hpath: string;
    url: string;
}

export function buildPurgeInfo(entry: { id: string; title: string; box: string; hpath: string; url?: string }): PurgeInfo {
    return {
        id: entry.id,
        title: entry.title || "未命名文档",
        box: entry.box,
        hpath: entry.hpath,
        url: entry.url ?? "",
    };
}

/** 彻底删除可执行判定：标题/笔记本/路径齐备（§7.3 确认框必须列出的最小集合）。 */
export function canPurge(info: PurgeInfo): boolean {
    return Boolean(info.id && info.box && info.hpath);
}

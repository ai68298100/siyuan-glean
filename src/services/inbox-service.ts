/**
 * 收集箱服务（T-1500）：云端收集箱条目 → 思源文档 + 读库属性。
 * 云剪藏自带完整 markdown（shorthandMd）——迁入比导入器更完整：正文直接落地。
 * 迁入 = 建文档 → captureClip（URL/站点/时间/src=inbox）→ removeShorthands（云端删除）。
 * 失败语义：查列表失败（未登录/无订阅）→ available:false（UI 隐藏）；单条迁入失败不删云端（可重试）。
 * T-1841 半成功账本：文档已建但收录未完成/冲突时记入 inbox-orphans.json，重试补收录后移出。
 */
import type { Plugin } from "siyuan";
import { getShorthands, removeShorthands, type Shorthand, type ShorthandsPage } from "../api/inbox";
import { createDocWithMd } from "../api/client";
import { siteFromUrl } from "../domain/schema";
import { captureClip, findClipUrlConflict, type DocMeta } from "./clip-store";

const ORPHANS_FILE = "inbox-orphans.json";

export interface InboxOrphan {
    docId: string;
    notebookId: string;
    /** 云端条目 ID；重试成功后尝试补删（失败不阻塞，条目仍在收集箱） */
    cloudId: string;
    url: string;
    title: string;
    desc: string;
    markdown: string;
    contentType: "fulltext" | "link";
    /** 云端创建时间（思源形态），空串=未知 */
    time: string;
}

export async function loadInboxOrphans(plugin: Plugin): Promise<InboxOrphan[]> {
    try {
        const raw = await plugin.loadData(ORPHANS_FILE);
        if (!Array.isArray(raw)) return [];
        return raw.filter((entry) => entry && typeof entry === "object" && typeof (entry as InboxOrphan).docId === "string");
    } catch {
        return [];
    }
}

export async function saveInboxOrphans(plugin: Plugin, orphans: InboxOrphan[]): Promise<void> {
    await plugin.saveData(ORPHANS_FILE, orphans);
}

/** 重试补收录：成功后移出账本并尝试补删云端条目（删除失败不影响结算）。 */
export async function retryInboxOrphans(
    plugin: Plugin,
    options: { onProgress?: (done: number, total: number) => void } = {}
): Promise<{ restored: number; remaining: number }> {
    const orphans = await loadInboxOrphans(plugin);
    const remaining: InboxOrphan[] = [];
    let restored = 0;
    for (let index = 0; index < orphans.length; index += 1) {
        const orphan = orphans[index];
        try {
            const captured = await captureClip(plugin, orphan.docId, {
                url: orphan.url || undefined,
                site: orphan.url ? siteFromUrl(orphan.url) : undefined,
                src: "inbox",
                time: orphan.time || undefined,
                timeSource: orphan.time ? "source" : "capture",
                markdown: orphan.markdown,
                contentType: orphan.contentType,
            });
            if (captured.conflict) {
                // 同 URL 已有收录：孤儿副本保留在笔记中由用户处置，账本条目使命完成（不无限重试）
            } else if (captured.captured || captured.attrs.status) {
                restored += 1;
                if (orphan.cloudId) {
                    try {
                        await removeShorthands([orphan.cloudId]);
                    } catch { /* 云端补删失败：条目仍在收集箱，URL 去重会拦截重复迁入 */ }
                }
            } else {
                remaining.push(orphan);
            }
        } catch {
            remaining.push(orphan);
        }
        options.onProgress?.(index + 1, orphans.length);
    }
    await saveInboxOrphans(plugin, remaining);
    return { restored, remaining: remaining.length };
}

/** 收集箱可用性探测：available=false 时 UI 整块隐藏。 */
export interface InboxStatus {
    available: boolean;
    page: ShorthandsPage | null;
}

export async function checkInbox(): Promise<InboxStatus> {
    const result = await getShorthands(1);
    if (!result.page) return { available: false, page: null };
    return { available: true, page: result.page };
}

/** hCreated（"2026-09-29 10:00" 等）→ 思源时间；解析不出为空串。 */
function cloudTimeToSiyuan(hCreated: string): string {
    if (!hCreated) return "";
    const parsed = Date.parse(hCreated.replace(" ", "T"));
    if (Number.isNaN(parsed)) return "";
    const date = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export interface MigrateResult {
    docId: string;
    /** 云端删除是否成功（失败不阻塞，条目下次还会出现） */
    cloudRemoved: boolean;
    /** 本地已有相同来源时不创建第二份，也不删除云端条目。 */
    duplicate?: boolean;
    existing?: DocMeta;
}

/** 迁入单条收集箱条目。 */
export async function migrateShorthand(
    plugin: Plugin,
    shorthand: Shorthand,
    options: { notebookId: string; folder?: string; allowDuplicate?: boolean }
): Promise<MigrateResult> {
    const folder = options.folder?.trim() || "收集箱";
    const title = shorthand.shorthandTitle || shorthand.shorthandURL || "未命名收集";
    if (shorthand.shorthandURL && !options.allowDuplicate) {
        const existing = await findClipUrlConflict(shorthand.shorthandURL);
        if (existing) return { docId: existing.id, cloudRemoved: false, duplicate: true, existing };
    }
    const markdownParts: string[] = [`# ${title}`];
    if (shorthand.shorthandURL) markdownParts.push(`- [${shorthand.shorthandURL}](${shorthand.shorthandURL})`);
    if (shorthand.shorthandDesc) markdownParts.push(`> ${shorthand.shorthandDesc}`);
    markdownParts.push("");
    if (shorthand.shorthandMd) markdownParts.push(shorthand.shorthandMd);

    const docId = await createDocWithMd(options.notebookId, `/${folder}/${sanitizeTitle(title)}`, markdownParts.join("\n"));
    if (!docId) throw new Error("创建文档失败");

    const cloudTime = cloudTimeToSiyuan(shorthand.hCreated);
    const orphanBase = {
        docId,
        notebookId: options.notebookId,
        cloudId: shorthand.oId ?? "",
        url: shorthand.shorthandURL ?? "",
        title,
        desc: shorthand.shorthandDesc ?? "",
        markdown: markdownParts.join("\n"),
        contentType: (shorthand.shorthandMd?.trim() ? "fulltext" : "link") as "fulltext" | "link",
        time: cloudTime,
    };
    try {
        const captured = await captureClip(plugin, docId, {
            url: shorthand.shorthandURL || undefined,
            site: shorthand.shorthandURL ? siteFromUrl(shorthand.shorthandURL) : undefined,
            src: "inbox",
            time: cloudTime || undefined,
            timeSource: cloudTime ? "source" : "capture",
            markdown: markdownParts.join("\n"),
            contentType: shorthand.shorthandMd?.trim() ? "fulltext" : "link",
            allowDuplicate: options.allowDuplicate,
        });
        if (captured.conflict) {
            // The URL may have appeared between the preflight and write. Keep the
            // cloud item so the user can choose the existing document or retry.
            // T-1841：本批新建的文档成了无属性孤儿——入账本待重试，不静默丢弃。
            const previous = await loadInboxOrphans(plugin);
            await saveInboxOrphans(plugin, [...previous, orphanBase]);
            return { docId: captured.conflict.id, cloudRemoved: false, duplicate: true, existing: captured.conflict };
        }
    } catch (error) {
        // T-1841：收录失败（网络等）——文档已建，入账本供重试补收录；原始错误继续上抛供 UI 提示。
        const previous = await loadInboxOrphans(plugin);
        await saveInboxOrphans(plugin, [...previous, orphanBase]);
        throw error;
    }
    let cloudRemoved = false;
    if (shorthand.oId) {
        try {
            await removeShorthands([shorthand.oId]);
            cloudRemoved = true;
        } catch {
            // 云端删除失败：条目保留在收集箱，本地文档已建（重复迁入由 URL 去重提示）
        }
    }
    return { docId, cloudRemoved };
}

function sanitizeTitle(title: string): string {
    const cleaned = title.replace(/[/\\:<>|?*"~]/g, " ").replace(/\s+/g, " ").trim();
    return (cleaned || "未命名").slice(0, 80);
}

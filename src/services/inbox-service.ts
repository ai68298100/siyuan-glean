/**
 * 收集箱服务（T-1500）：云端收集箱条目 → 思源文档 + 读库属性。
 * 云剪藏自带完整 markdown（shorthandMd）——迁入比导入器更完整：正文直接落地。
 * 迁入 = 建文档 → captureClip（URL/站点/时间/src=inbox）→ removeShorthands（云端删除）。
 * 失败语义：查列表失败（未登录/无订阅）→ available:false（UI 隐藏）；单条迁入失败不删云端（可重试）。
 */
import type { Plugin } from "siyuan";
import { getShorthands, removeShorthands, type Shorthand, type ShorthandsPage } from "../api/inbox";
import { createDocWithMd } from "../api/client";
import { ATTR, parseClipAttrs, siteFromUrl } from "../domain/schema";
import { normalizeUrl } from "../domain/url";
import { advanceInboxRecovery, createInboxRecovery, normalizeInboxFolder, type InboxRecovery } from "../domain/inbox-recovery";
import { captureClip, findClipUrlConflict, readClipAttributeSnapshot, type DocMeta, writeClip } from "./clip-store";
import { InboxRecoveryError, loadInboxRecovery, markInboxUnknown, saveInboxRecovery, clearInboxRecovery } from "./inbox-recovery";
export { InboxRecoveryError } from "./inbox-recovery";

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
    recovery?: InboxRecovery;
}

// 同一个插件实例可能同时收到双击、快捷键和面板重试。检查点是单槽位存储，
// 并发迁入会互相覆盖阶段，因此在服务边界串行化整条迁入事务。
const activeRecoveryOperations = new WeakSet<object>();

/** 迁入单条收集箱条目。 */
export async function migrateShorthand(
    plugin: Plugin,
    shorthand: Shorthand,
    options: { notebookId: string; folder?: string; allowDuplicate?: boolean }
): Promise<MigrateResult> {
    if (activeRecoveryOperations.has(plugin)) throw new InboxRecoveryError("busy");
    activeRecoveryOperations.add(plugin);
    try {
        return await migrateShorthandUnlocked(plugin, shorthand, options);
    } finally {
        activeRecoveryOperations.delete(plugin);
    }
}

async function migrateShorthandUnlocked(
    plugin: Plugin,
    shorthand: Shorthand,
    options: { notebookId: string; folder?: string; allowDuplicate?: boolean }
): Promise<MigrateResult> {
    const folder = normalizeInboxFolder(options.folder?.trim() || "收集箱");
    const title = shorthand.shorthandTitle || shorthand.shorthandURL || "未命名收集";
    const markdownTitle = sanitizeMarkdownHeading(title);
    let recovery: InboxRecovery | undefined = (await loadInboxRecovery(plugin)) ?? undefined;
    if (recovery && (recovery.shorthandId !== shorthand.oId || recovery.notebookId !== options.notebookId || recovery.folder !== folder || recovery.allowDuplicate !== Boolean(options.allowDuplicate))) {
        throw new InboxRecoveryError("busy", recovery, recovery.docId || undefined);
    }
    if (recovery?.phase === "unknown") throw new InboxRecoveryError("createUnknown", recovery);
    if (recovery?.phase === "creating") {
        recovery = await markInboxUnknown(plugin, recovery);
        throw new InboxRecoveryError("createUnknown", recovery);
    }
    if (shorthand.shorthandURL && !options.allowDuplicate) {
        const existing = await findClipUrlConflict(shorthand.shorthandURL, undefined, plugin);
        if (existing) return { docId: existing.id, cloudRemoved: false, duplicate: true, existing };
    }
    const markdownParts: string[] = [`# ${markdownTitle}`];
    const sourceUrl = safeMarkdownUrl(shorthand.shorthandURL);
    if (sourceUrl) markdownParts.push(`- [${escapeMarkdownText(sourceUrl)}](<${sourceUrl}>)`);
    if (shorthand.shorthandDesc) markdownParts.push(quoteMarkdownDescription(shorthand.shorthandDesc));
    markdownParts.push("");
    if (shorthand.shorthandMd) markdownParts.push(shorthand.shorthandMd);

    let docId = recovery?.docId || "";
    if (!docId) {
        recovery = createInboxRecovery(shorthand.oId, options.notebookId, folder, Boolean(options.allowDuplicate));
        try {
            await saveInboxRecovery(plugin, recovery);
            docId = await createDocWithMd(options.notebookId, `/${folder}/${sanitizeTitle(title)}`, markdownParts.join("\n"));
            if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("invalid document ID");
        } catch (error) {
            try { recovery = await markInboxUnknown(plugin, recovery); } catch { /* 保留未知创建结果，禁止自动重建 */ }
            if (error instanceof InboxRecoveryError) throw error;
            throw new InboxRecoveryError("createUnknown", recovery);
        }
        recovery = await saveInboxRecovery(plugin, advanceInboxRecovery(recovery, "capture-pending", docId));
    }

    let captured;
    try {
        captured = await captureInboxDocument(plugin, shorthand, docId, options.allowDuplicate, markdownParts.join("\n"), options.notebookId, folder);
    } catch (error) {
        if (error instanceof InboxRecoveryError) throw error;
        throw new InboxRecoveryError("captureFailed", recovery, docId);
    }
    if (captured.conflict) {
        // The URL may have appeared between the preflight and write. Keep the
        // cloud item so the user can choose the existing document or retry.
        return { docId: captured.conflict.id, cloudRemoved: false, duplicate: true, existing: captured.conflict, recovery };
    }
    if (!captured.captured) throw new Error("收集箱文档未完成收录");
    if (!recovery) throw new InboxRecoveryError("checkpointFailed", undefined, docId);
    recovery = await saveInboxRecovery(plugin, advanceInboxRecovery(recovery, "remove-pending", docId));
    let cloudRemoved = false;
    if (shorthand.oId) {
        try {
            await removeShorthands([shorthand.oId]);
            cloudRemoved = true;
            try { await clearInboxRecovery(plugin, recovery, true); } catch { /* 云端已删除，保留结果，不再自动重建 */ }
            recovery = undefined;
        } catch (error) {
            // 云端删除失败：条目保留在收集箱，本地文档已建（重复迁入由 URL 去重提示）
            if (error instanceof InboxRecoveryError) throw error;
        }
    }
    if (cloudRemoved && recovery) {
        try { await clearInboxRecovery(plugin, recovery, true); } catch { /* 清理失败仅保留已完成结果 */ }
        recovery = undefined;
    }
    return { docId, cloudRemoved, recovery };
}

async function captureInboxDocument(plugin: Plugin, shorthand: Shorthand, docId: string, allowDuplicate: boolean | undefined, markdown: string, notebookId: string, folder: string) {
    const snapshot = await readClipAttributeSnapshot(docId);
    if (snapshot.meta.box !== notebookId || snapshot.meta.hpath !== `/${folder}/${sanitizeTitle(shorthand.shorthandTitle || shorthand.shorthandURL || "未命名收集")}`) {
        throw new InboxRecoveryError("conflict", undefined, docId);
    }
    const current = parseClipAttrs(snapshot.attrs);
    if (current.status) {
        const expectedUrl = shorthand.shorthandURL ? normalizeUrl(shorthand.shorthandURL) : "";
        if (current.internal || current.src !== "inbox" || (expectedUrl && normalizeUrl(current.url || "") !== expectedUrl)) {
            throw new InboxRecoveryError("conflict", undefined, docId);
        }
        const attrs = await writeClip(plugin, docId, {}, {
            expectedLocation: { box: snapshot.meta.box, hpath: snapshot.meta.hpath },
            expectedAttrs: {
                [ATTR.status]: snapshot.attrs[ATTR.status] ?? null,
                [ATTR.url]: snapshot.attrs[ATTR.url] ?? null,
                [ATTR.src]: snapshot.attrs[ATTR.src] ?? null,
            },
        });
        return { captured: true, attrs: attrs.attrs };
    }
    const cloudTime = cloudTimeToSiyuan(shorthand.hCreated);
    return captureClip(plugin, docId, {
        url: shorthand.shorthandURL || undefined,
        site: shorthand.shorthandURL ? siteFromUrl(shorthand.shorthandURL) : undefined,
        src: "inbox",
        time: cloudTime || undefined,
        timeSource: cloudTime ? "source" : "capture",
        markdown,
        contentType: shorthand.shorthandMd?.trim() ? "fulltext" : "link",
        allowDuplicate,
        expectedLocation: { box: snapshot.meta.box, hpath: snapshot.meta.hpath },
    });
}

function sanitizeTitle(title: string): string {
    const cleaned = title.replace(/[/\\:<>|?*"~\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
    return (cleaned || "未命名").slice(0, 80);
}

function sanitizeMarkdownHeading(title: string): string {
    const cleaned = title
        .replace(/\r\n?|[\u2028\u2029]/g, " ")
        .replace(/[\p{Cc}\p{Cf}]/gu, " ")
        .replace(/[<>]/g, (char) => char === "<" ? "&lt;" : "&gt;")
        .replace(/\s+/g, " ")
        .trim();
    return escapeMarkdownText(cleaned || "未命名收集");
}

function quoteMarkdownDescription(description: string): string {
    return description
        .replace(/\r\n?|[\u2028\u2029]/g, "\n")
        .replace(/[\p{Cc}\p{Cf}]/gu, (char) => char === "\n" ? "\n" : " ")
        .replace(/[<>]/g, (char) => char === "<" ? "&lt;" : "&gt;")
        .split("\n")
        .map((line) => `> ${escapeMarkdownText(line)}`)
        .join("\n");
}

function escapeMarkdownText(value: string): string {
    return value.replace(/([\\`*_{}\[\]()#+\-.!>|~])/g, "\\$1");
}

function safeMarkdownUrl(value: string): string {
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    } catch {
        return "";
    }
}

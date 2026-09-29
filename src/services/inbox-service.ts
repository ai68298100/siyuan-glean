/**
 * 收集箱服务（T-1500）：云端收集箱条目 → 思源文档 + 读库属性。
 * 云剪藏自带完整 markdown（shorthandMd）——迁入比导入器更完整：正文直接落地。
 * 迁入 = 建文档 → captureClip（URL/站点/时间/src=inbox）→ removeShorthands（云端删除）。
 * 失败语义：查列表失败（未登录/无订阅）→ available:false（UI 隐藏）；单条迁入失败不删云端（可重试）。
 */
import type { Plugin } from "siyuan";
import { getShorthands, removeShorthands, type Shorthand, type ShorthandsPage } from "../api/inbox";
import { createDocWithMd } from "../api/client";
import { siteFromUrl, siyuanTimestamp } from "../domain/schema";
import { captureClip } from "./clip-store";

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
}

/** 迁入单条收集箱条目。 */
export async function migrateShorthand(
    plugin: Plugin,
    shorthand: Shorthand,
    options: { notebookId: string; folder?: string }
): Promise<MigrateResult> {
    const folder = options.folder?.trim() || "收集箱";
    const title = shorthand.shorthandTitle || shorthand.shorthandURL || "未命名收集";
    const markdownParts: string[] = [`# ${title}`];
    if (shorthand.shorthandURL) markdownParts.push(`- [${shorthand.shorthandURL}](${shorthand.shorthandURL})`);
    if (shorthand.shorthandDesc) markdownParts.push(`> ${shorthand.shorthandDesc}`);
    markdownParts.push("");
    if (shorthand.shorthandMd) markdownParts.push(shorthand.shorthandMd);

    const docId = await createDocWithMd(options.notebookId, `/${folder}/${sanitizeTitle(title)}`, markdownParts.join("\n"));
    if (!docId) throw new Error("创建文档失败");

    await captureClip(plugin, docId, {
        url: shorthand.shorthandURL || undefined,
        site: shorthand.shorthandURL ? siteFromUrl(shorthand.shorthandURL) : undefined,
        src: "inbox",
    });
    // 原收藏时间（captureClip 缺省 now，这里覆盖为云端时间）
    const cloudTime = cloudTimeToSiyuan(shorthand.hCreated);
    if (cloudTime) {
        const { writeClip } = await import("./clip-store");
        await writeClip(plugin, docId, { time: cloudTime }, { force: true });
    }
    void siyuanTimestamp;

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

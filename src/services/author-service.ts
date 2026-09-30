/**
 * 来源作者回填服务（T-1813）：扫描缺作者的读库文章 → AI 逐条推断 → 用户逐条确认写入。
 * 写入走 writeClip（author 用户可改可覆盖类）；AI 推断走租约队列与额度（T-1883）。
 */
import type { Plugin } from "siyuan";
import { exportMdContent } from "../api/client";
import { buildAuthorPrompt, parseAuthorResponse } from "../domain/enrich";
import { stripMarkdown } from "../domain/migrate";
import { aiQuotaAvailable, callLLM, logAiEvent, runAiTask } from "./enrich-service";
import { loadIndex, type ClipIndexEntry } from "./index-store";
import { writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

/** 缺作者的读库文章（按更新时间倒序，最多 100 篇提示量）。 */
export async function listMissingAuthors(plugin: Plugin): Promise<ClipIndexEntry[]> {
    const index = await loadIndex(plugin);
    return Object.values(index.clips)
        .filter((clip) => !clip.author)
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .slice(0, 100);
}

export interface AuthorInference {
    ok: boolean;
    /** 推断出的作者名；null = AI 无法判断 */
    author: string | null;
    skipped?: "off" | "cap" | "error";
}

/** 单篇 AI 推断作者（租约队列/额度共享/失败静默）；不写任何属性——确认由用户完成。 */
export function inferAuthor(
    plugin: Plugin,
    docId: string,
    title: string,
    settings: GleanSettings
): Promise<AuthorInference> {
    if (settings.ai.enrichMode === "off") {
        return Promise.resolve({ ok: false, author: null, skipped: "off" });
    }
    return runAiTask(async () => {
        if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, author: null, skipped: "cap" };
        try {
            const exported = await exportMdContent(docId);
            const plain = stripMarkdown(exported?.content ?? "");
            const llm = await callLLM(plugin, settings, buildAuthorPrompt(title, plain));
            if (!llm.ok) {
                await logAiEvent(plugin, docId, "author-infer", llm.reason || "调用失败");
                return { ok: false, author: null, skipped: "error" };
            }
            const author = parseAuthorResponse(String(llm.text ?? ""));
            return { ok: true, author };
        } catch (error) {
            await logAiEvent(plugin, docId, "author-infer", String((error as Error)?.message ?? error));
            return { ok: false, author: null, skipped: "error" };
        }
    });
}

/** 用户确认后写入作者名（空串清除）；返回是否写成功。 */
export async function applyAuthor(plugin: Plugin, docId: string, author: string): Promise<boolean> {
    try {
        await writeClip(plugin, docId, { author: author.trim() ? author.trim() : undefined });
        return true;
    } catch {
        return false;
    }
}

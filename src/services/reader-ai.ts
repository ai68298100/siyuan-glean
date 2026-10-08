/**
 * 阅读页签 AI 伴读（T-1730e，D-0030 落点 T-1726）：总结（全文）、翻译（选区）。
 * 显式动作；结果临时显示不落属性，仅用户显式"保存为 AI 摘要"写 custom-clip-summary；
 * 额度与富化共享（aiQuotaAvailable/recordAiUsage），关闭模式与失败静默降级。
 */
import type { Plugin } from "siyuan";
import { exportMdContent, querySql } from "../api/client";
import { stripMarkdown } from "../domain/migrate";
import { ARTICLE_QUESTION_CONTEXT_MAX_LENGTH, buildArticleQuestionPrompt, buildSummarizePrompt, buildTranslatePrompt, clampArticleQuestion, parseArticleQuestionResponse, type ArticleQuestionResult } from "../domain/reader";
import { parseClipAttrs } from "../domain/schema";
import { activeAiSettings, aiQuotaAvailable, callLLM, enqueueEnrich, logAiEvent, recordAiUsage } from "./enrich-service";
import { readClipAttributeSnapshot, writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

export interface ReaderAiOutcome {
    ok: boolean;
    text?: string;
    skipped?: "off" | "cap" | "error";
}

export interface ArticleQuestionOutcome {
    ok: boolean;
    result?: ArticleQuestionResult;
    truncated?: boolean;
    skipped?: "off" | "cap" | "error" | "changed" | "invalid";
}

const NODE_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

/** AI 伴读总开关与富化模式一致（D-0013）：off 即整段禁用。 */
export function readerAiEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off";
}

export async function readerSummarize(plugin: Plugin, docId: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    return readerCall(plugin, docId, settings, "reader-summarize", async () => {
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
        const plain = stripMarkdown(markdown).trim();
        return plain ? buildSummarizePrompt(title, plain) : "";
    });
}

export async function readerTranslate(plugin: Plugin, docId: string, text: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    return readerCall(plugin, docId, settings, "reader-translate", () => text.trim() ? buildTranslatePrompt(text) : "");
}

export function articleQuestionEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off" && settings.ai.articleQuestionEnabled === true;
}

export async function readerArticleQuestion(
    plugin: Plugin,
    docId: string,
    question: string,
    settings: GleanSettings,
    selectionText = "",
    selectionBlockId = "",
): Promise<ArticleQuestionOutcome> {
    const requestedQuestion = clampArticleQuestion(question);
    if (!requestedQuestion) return { ok: false, skipped: "invalid" };
    const hasSelection = Boolean(selectionText || selectionBlockId);
    if (hasSelection && (!selectionText.trim() || Array.from(selectionText).length > ARTICLE_QUESTION_CONTEXT_MAX_LENGTH || !NODE_ID_PATTERN.test(selectionBlockId))) return { ok: false, skipped: "invalid" };
    if (!articleQuestionEnabled(activeAiSettings(plugin, settings))) return { ok: false, skipped: "off" };
    return enqueueEnrich(async () => {
        let before: Awaited<ReturnType<typeof readClipAttributeSnapshot>>;
        try { before = await readClipAttributeSnapshot(docId); } catch { return { ok: false, skipped: "error" as const }; }
        const beforeAttrs = before.attrs;
        const beforeLocation = { box: before.meta.box, hpath: before.meta.hpath };
        const parsedAttrs = parseClipAttrs(beforeAttrs);
        if (!parsedAttrs.status || parsedAttrs.internal || parsedAttrs.excluded) return { ok: false, skipped: "invalid" as const };
        let currentSettings = activeAiSettings(plugin, settings);
        if (!articleQuestionEnabled(currentSettings)) return { ok: false, skipped: "off" as const };
        try {
            if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, skipped: "cap" as const };
            let context = "";
            if (hasSelection) {
                const exported = await exportMdContent(docId);
                const documentText = stripMarkdown(exported?.content ?? "").replace(/\s+/g, " ").trim();
                const selectedText = selectionText.replace(/\s+/g, " ").trim();
                if (!documentText.includes(selectedText) || !(await selectionBlockBelongsToDoc(selectionBlockId, docId))) return { ok: false, skipped: "invalid" as const };
                context = selectionText.trim();
            } else {
                const exported = await exportMdContent(docId);
                context = stripMarkdown(exported?.content ?? "").trim();
            }
            if (!context) return { ok: false, skipped: "invalid" as const };
            // 与选区校验同用码点口径，避免 emoji 选区"未超限却提示已截断"
            const truncated = Array.from(context).length > ARTICLE_QUESTION_CONTEXT_MAX_LENGTH;
            const prompt = buildArticleQuestionPrompt(before.meta.title, context, requestedQuestion, truncated);
            currentSettings = activeAiSettings(plugin, settings);
            if (!articleQuestionEnabled(currentSettings) || !(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, skipped: articleQuestionEnabled(currentSettings) ? "cap" as const : "off" as const };
            const llm = await callLLM(plugin, currentSettings, prompt);
            if (!llm.ok) return { ok: false, skipped: "error" as const };
            await recordAiUsage(plugin);
            if (hasSelection && !(await selectionBlockBelongsToDoc(selectionBlockId, docId))) return { ok: false, skipped: "changed" as const };
            const after = await readClipAttributeSnapshot(docId);
            const same = after.meta.box === beforeLocation.box && after.meta.hpath === beforeLocation.hpath
                && Object.keys(beforeAttrs).every((key) => after.attrs[key] === beforeAttrs[key])
                && Object.keys(after.attrs).every((key) => after.attrs[key] === beforeAttrs[key]);
            if (!same) return { ok: false, skipped: "changed" as const };
            currentSettings = activeAiSettings(plugin, settings);
            if (!articleQuestionEnabled(currentSettings)) return { ok: false, skipped: "off" as const };
            const result = parseArticleQuestionResponse(typeof llm.text === "string" ? llm.text : "", [...context].slice(0, ARTICLE_QUESTION_CONTEXT_MAX_LENGTH).join(""));
            if (!result) return { ok: false, skipped: "error" as const };
            return { ok: true, result, truncated };
        } catch {
            await logAiEvent(plugin, docId, "article-question", "本文问答不可用，已跳过");
            return { ok: false, skipped: "error" as const };
        }
    });
}

async function selectionBlockBelongsToDoc(blockId: string, docId: string): Promise<boolean> {
    if (!NODE_ID_PATTERN.test(blockId) || !NODE_ID_PATTERN.test(docId)) return false;
    const rows = await querySql<{ id: string; root_id: string }>(`SELECT id, root_id FROM blocks WHERE id = '${blockId}' LIMIT 1`);
    return rows.length === 1 && rows[0].id === blockId && rows[0].root_id === docId;
}

async function readerCall(
    plugin: Plugin,
    docId: string,
    settings: GleanSettings,
    stage: string,
    getPrompt: () => string | Promise<string>
): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(activeAiSettings(plugin, settings))) return { ok: false, skipped: "off" };
    return enqueueEnrich(async () => {
        let currentSettings = activeAiSettings(plugin, settings);
        if (!readerAiEnabled(currentSettings)) return { ok: false, skipped: "off" };
        try {
            if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, skipped: "cap" };
            const prompt = await getPrompt();
            if (!prompt) {
                await logAiEvent(plugin, docId, stage, "输入文本为空，已跳过");
                return { ok: false, skipped: "error" };
            }
            currentSettings = activeAiSettings(plugin, settings);
            if (!readerAiEnabled(currentSettings)) return { ok: false, skipped: "off" };
            if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, skipped: "cap" };
            currentSettings = activeAiSettings(plugin, settings);
            if (!readerAiEnabled(currentSettings)) return { ok: false, skipped: "off" };
            const llm = await callLLM(plugin, currentSettings, prompt);
            if (!llm.ok) {
                await logAiEvent(plugin, docId, stage, "模型调用失败，已跳过");
                return { ok: false, skipped: "error" };
            }
            await recordAiUsage(plugin);
            if (!readerAiEnabled(activeAiSettings(plugin, settings))) return { ok: false, skipped: "off" };
            const text = typeof llm.text === "string" ? llm.text.trim() : "";
            if (!text) {
                await logAiEvent(plugin, docId, stage, "模型响应为空，已跳过");
                return { ok: false, skipped: "error" };
            }
            return { ok: true, text };
        } catch {
            await logAiEvent(plugin, docId, stage, "阅读 AI 不可用，已跳过");
            return { ok: false, skipped: "error" };
        }
    });
}

/** 用户显式保存总结为 AI 摘要（既有 custom-clip-summary 属性；summary 非手填保护字段）。 */
export async function saveReaderSummary(plugin: Plugin, docId: string, text: string): Promise<void> {
    await writeClip(plugin, docId, { summary: text });
}

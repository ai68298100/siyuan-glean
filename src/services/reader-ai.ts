/**
 * 阅读页签 AI 伴读（T-1730e，D-0030 落点 T-1726）：总结（全文）、翻译（选区）。
 * 显式动作；结果临时显示不落属性，仅用户显式"保存为 AI 摘要"写 custom-clip-summary；
 * 额度与富化共享（aiQuotaAvailable/recordAiUsage），关闭模式与失败静默降级。
 * 额度原子性（T-1883）：检查→调用→计数全程包进 AI 串行租约队列（runAiTask）。
 */
import type { Plugin } from "siyuan";
import { exportMdContent } from "../api/client";
import { stripMarkdown } from "../domain/migrate";
import {
    buildAskPrompt,
    buildSummarizePrompt,
    buildTranslatePrompt,
    clampAskQuestion,
} from "../domain/reader";
import { buildDailyDigestPrompt, buildQuestionCardPrompt } from "../domain/enrich";
import { aiQuotaAvailable, callLLM, logAiEvent, recordAiUsage, runAiTask } from "./enrich-service";
import { writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

export interface ReaderAiOutcome {
    ok: boolean;
    text?: string;
    skipped?: "off" | "cap" | "error";
}

/** AI 伴读总开关与富化模式一致（D-0013）：off 即整段禁用。 */
export function readerAiEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off";
}

export function readerSummarize(plugin: Plugin, docId: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    return runAiTask(() => readerSummarizeInner(plugin, docId, settings));
}

async function readerSummarizeInner(plugin: Plugin, docId: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
    try {
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
        const llm = await callLLM(plugin, settings, buildSummarizePrompt(title, stripMarkdown(markdown)));
        if (!llm.ok) {
            await logAiEvent(plugin, docId, "reader-summarize", llm.reason || "调用失败");
            return { ok: false, skipped: "error" };
        }
        await recordAiUsage(plugin);
        return { ok: true, text: String(llm.text ?? "").trim() };
    } catch (error) {
        await logAiEvent(plugin, docId, "reader-summarize", String((error as Error)?.message ?? error));
        return { ok: false, skipped: "error" };
    }
}

export function readerTranslate(plugin: Plugin, docId: string, text: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    return runAiTask(() => readerTranslateInner(plugin, docId, text, settings));
}

async function readerTranslateInner(plugin: Plugin, docId: string, text: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
    try {
        const llm = await callLLM(plugin, settings, buildTranslatePrompt(text));
        if (!llm.ok) {
            await logAiEvent(plugin, docId, "reader-translate", llm.reason || "调用失败");
            return { ok: false, skipped: "error" };
        }
        await recordAiUsage(plugin);
        return { ok: true, text: String(llm.text ?? "").trim() };
    } catch (error) {
        await logAiEvent(plugin, docId, "reader-translate", String((error as Error)?.message ?? error));
        return { ok: false, skipped: "error" };
    }
}

/** 用户显式保存总结为 AI 摘要（既有 custom-clip-summary 属性；summary 非手填保护字段）。 */
export async function saveReaderSummary(plugin: Plugin, docId: string, text: string): Promise<void> {
    await writeClip(plugin, docId, { summary: text });
}

/**
 * "问这篇文章"（T-1760）：限定上下文=本文全文的单轮动作，不做追问、不做聊天窗
 * （铁律 8/D-0030）。额度与富化/伴读共享（T-1883 租约），失败静默降级。
 */
export function readerAsk(plugin: Plugin, docId: string, question: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    const normalized = clampAskQuestion(question);
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    if (!normalized) return Promise.resolve({ ok: false, skipped: "error" });
    return runAiTask(() => readerAskInner(plugin, docId, normalized, settings));
}

async function readerAskInner(plugin: Plugin, docId: string, question: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
    try {
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
        const llm = await callLLM(plugin, settings, buildAskPrompt(title, stripMarkdown(markdown), question));
        if (!llm.ok) {
            await logAiEvent(plugin, docId, "reader-ask", llm.reason || "调用失败");
            return { ok: false, skipped: "error" };
        }
        await recordAiUsage(plugin);
        return { ok: true, text: String(llm.text ?? "").trim() };
    } catch (error) {
        await logAiEvent(plugin, docId, "reader-ask", String((error as Error)?.message ?? error));
        return { ok: false, skipped: "error" };
    }
}

/**
 * 全文翻译（T-1745 双语对照）：与选区翻译（readerTranslate）不同——上下文=本文全文，
 * 结果供伴生栏"对照阅读"块展示。租约队列、额度共享、失败静默，与伴读动作同纪律。
 */
export function readerTranslateFull(
    plugin: Plugin,
    docId: string,
    settings: GleanSettings
): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    return runAiTask(() => readerTranslateFullInner(plugin, docId, settings));
}

async function readerTranslateFullInner(
    plugin: Plugin,
    docId: string,
    settings: GleanSettings
): Promise<ReaderAiOutcome> {
    if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
    try {
        const exported = await exportMdContent(docId);
        const markdown = exported?.content ?? "";
        const llm = await callLLM(plugin, settings, buildTranslatePrompt(stripMarkdown(markdown).slice(0, 8000)));
        if (!llm.ok) {
            await logAiEvent(plugin, docId, "reader-translate-full", llm.reason || "调用失败");
            return { ok: false, skipped: "error" };
        }
        await recordAiUsage(plugin);
        return { ok: true, text: String(llm.text ?? "").trim() };
    } catch (error) {
        await logAiEvent(plugin, docId, "reader-translate-full", String((error as Error)?.message ?? error));
        return { ok: false, skipped: "error" };
    }
}

/**
 * AI 问句制卡（T-1751）：基于摘录生成回忆问句卡面。
 * 只生成建议——用户在确认输入框可改后调用 makeQuoteCard 入卡（写入由用户触发）。
 */
export function inferQuestionCard(
    plugin: Plugin,
    quote: string,
    settings: GleanSettings
): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    return runAiTask(async () => {
        if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
        try {
            const llm = await callLLM(plugin, settings, buildQuestionCardPrompt(quote));
            if (!llm.ok) {
                await logAiEvent(plugin, quote.slice(0, 20), "question-card", llm.reason || "调用失败");
                return { ok: false, skipped: "error" };
            }
            await recordAiUsage(plugin);
            return { ok: true, text: String(llm.text ?? "").trim() };
        } catch (error) {
            await logAiEvent(plugin, quote.slice(0, 20), "question-card", String((error as Error)?.message ?? error));
            return { ok: false, skipped: "error" };
        }
    });
}

/**
 * AI 每日简报（T-1764）：基于今日拾遗前 3 篇的标题/来源/摘要生成串联速览。
 * 租约队列/额度共享/失败静默；结果为会话状态，仅复制不落属性。
 */
export interface DigestInputItem {
    title: string;
    site: string;
    summary: string;
}

export function dailyDigest(
    plugin: Plugin,
    items: DigestInputItem[],
    settings: GleanSettings
): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return Promise.resolve({ ok: false, skipped: "off" });
    if (items.length === 0) return Promise.resolve({ ok: false, skipped: "error" });
    return runAiTask(async () => {
        if (!(await aiQuotaAvailable(plugin, settings))) return { ok: false, skipped: "cap" };
        try {
            const llm = await callLLM(plugin, settings, buildDailyDigestPrompt(items.slice(0, 3)));
            if (!llm.ok) {
                await logAiEvent(plugin, "daily-digest", "daily-digest", llm.reason || "调用失败");
                return { ok: false, skipped: "error" };
            }
            await recordAiUsage(plugin);
            return { ok: true, text: String(llm.text ?? "").trim() };
        } catch (error) {
            await logAiEvent(plugin, "daily-digest", "daily-digest", String((error as Error)?.message ?? error));
            return { ok: false, skipped: "error" };
        }
    });
}

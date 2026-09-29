/**
 * 阅读页签 AI 伴读（T-1730e，D-0030 落点 T-1726）：总结（全文）、翻译（选区）。
 * 显式动作；结果临时显示不落属性，仅用户显式"保存为 AI 摘要"写 custom-clip-summary；
 * 额度与富化共享（aiQuotaAvailable/recordAiUsage），关闭模式与失败静默降级。
 */
import type { Plugin } from "siyuan";
import { exportMdContent } from "../api/client";
import { stripMarkdown } from "../domain/migrate";
import { buildSummarizePrompt, buildTranslatePrompt } from "../domain/reader";
import { aiQuotaAvailable, callLLM, logAiEvent, recordAiUsage } from "./enrich-service";
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

export async function readerSummarize(plugin: Plugin, docId: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return { ok: false, skipped: "off" };
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

export async function readerTranslate(plugin: Plugin, docId: string, text: string, settings: GleanSettings): Promise<ReaderAiOutcome> {
    if (!readerAiEnabled(settings)) return { ok: false, skipped: "off" };
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

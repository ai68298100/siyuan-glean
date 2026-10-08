import type { Plugin } from "siyuan";
import { createDocWithMd, newNodeId } from "../api/client";
import {
    analyzeFormatting,
    buildFormattingPrompt,
    escapeFormattingLabel,
    formattingSourceLink,
    parseFormattingPlan,
    renderFormatting,
    type FormattingAnalysis,
    type FormattingPlan,
} from "../domain/formatting";
import { readClipDocument, writeClip } from "./clip-store";
import { activeAiSettings, aiQuotaAvailable, callLLM, enqueueEnrich, logAiEvent, recordAiUsage } from "./enrich-service";
import type { GleanSettings } from "./settings";

interface FormattingSource {
    id: string;
    title: string;
    box: string;
    hpath: string;
    url: string;
    markdown: string;
}

export interface FormattingSession {
    source: FormattingSource;
    analysis: FormattingAnalysis;
    plan: FormattingPlan;
    createdDocId: string;
    state: "ready" | "created" | "saved" | "unknown";
    busy: boolean;
}

export interface FormattingDraftLabels {
    suffix: string;
    original: string;
    source: string;
}

export type FormattingAiReason = "off" | "cap" | "tooLong" | "invalid" | "error" | "busy";
export type FormattingSaveReason = "changed" | "readFailed" | "markFailed" | "createUnknown" | "empty" | "busy" | "invalid";

async function readSource(docId: string): Promise<FormattingSource> {
    const { meta, attrs, markdown } = await readClipDocument(docId, { yfm: false, addTitle: false, refMode: 2 });
    if (!attrs.status || attrs.internal) throw new Error("Not a reading library article");
    return { id: docId, title: meta.title, box: meta.box, hpath: meta.hpath, url: attrs.url ?? "", markdown };
}

export async function loadFormattingSession(docId: string): Promise<FormattingSession> {
    const source = await readSource(docId);
    return { source, analysis: analyzeFormatting(source.markdown), plan: { headings: [], cleanup: [] }, createdDocId: "", state: "ready", busy: false };
}

export function formattingAiEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off" && settings.ai.formattingEnabled === true;
}

export async function planAiFormatting(plugin: Plugin, session: FormattingSession, settings: GleanSettings): Promise<{ ok: boolean; reason?: FormattingAiReason }> {
    if (!formattingAiEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" };
    if (session.busy || session.state !== "ready") return { ok: false, reason: "busy" };
    const prompt = buildFormattingPrompt(session.analysis);
    if (!prompt) return { ok: false, reason: "tooLong" };
    session.busy = true;
    try {
        return await enqueueEnrich(async () => {
            let currentSettings = activeAiSettings(plugin, settings);
            if (!formattingAiEnabled(currentSettings)) return { ok: false, reason: "off" as const };
            if (!(await aiQuotaAvailable(plugin, currentSettings))) return { ok: false, reason: "cap" };
            currentSettings = activeAiSettings(plugin, settings);
            if (!formattingAiEnabled(currentSettings)) return { ok: false, reason: "off" as const };
            const outcome = await callLLM(plugin, currentSettings, prompt);
            if (!outcome.ok) {
                await logAiEvent(plugin, session.source.id, "formatting-call", "Model call failed");
                return { ok: false, reason: "error" };
            }
            await recordAiUsage(plugin);
            if (!formattingAiEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" as const };
            const plan = parseFormattingPlan(String(outcome.text ?? ""), session.analysis);
            if (!plan) {
                await logAiEvent(plugin, session.source.id, "formatting-plan", "Invalid structure plan");
                return { ok: false, reason: "invalid" };
            }
            session.plan = plan;
            return { ok: true };
        });
    } catch {
        await logAiEvent(plugin, session.source.id, "formatting-call", "Formatting unavailable");
        return { ok: false, reason: "error" };
    } finally {
        session.busy = false;
    }
}

function draftMarkdown(session: FormattingSession, markdown: string, labels: FormattingDraftLabels): string {
    const source = session.source;
    const title = `${source.title} · ${labels.suffix}`;
    const url = formattingSourceLink(source.url);
    return [
        `# ${escapeFormattingLabel(title)}`,
        `${escapeFormattingLabel(labels.original)}: [${escapeFormattingLabel(source.title || source.id)}](siyuan://blocks/${source.id})`,
        ...(url ? [`${escapeFormattingLabel(labels.source)}: [${escapeFormattingLabel(new URL(url).host)}](<${url}>)`] : []),
        "---",
        markdown,
    ].join("\n\n");
}

export async function saveFormattingDraft(plugin: Plugin, session: FormattingSession, selectedIds: readonly string[], labels: FormattingDraftLabels): Promise<{ ok: boolean; docId?: string; reason?: FormattingSaveReason }> {
    if (session.busy) return { ok: false, reason: "busy" };
    if (session.state === "saved") return { ok: true, docId: session.createdDocId };
    if (session.state === "unknown") return { ok: false, reason: "createUnknown" };
    session.busy = true;
    try {
        if (!session.createdDocId) {
            let markdown: string;
            try {
                markdown = renderFormatting(session.analysis, session.plan, selectedIds);
            } catch {
                return { ok: false, reason: "invalid" };
            }
            if (!markdown.trim()) return { ok: false, reason: "empty" };
            let current: FormattingSource;
            try {
                current = await readSource(session.source.id);
            } catch {
                return { ok: false, reason: "readFailed" };
            }
            if (Object.keys(session.source).some((key) => current[key as keyof FormattingSource] !== session.source[key as keyof FormattingSource])) return { ok: false, reason: "changed" };
            const title = `${session.source.title || session.source.id} · ${labels.suffix}`.replace(/[\\/\u0000-\u001f]/g, " ").slice(0, 100);
            const parent = session.source.hpath.slice(0, session.source.hpath.lastIndexOf("/"));
            try {
                const docId = await createDocWithMd(session.source.box, `${parent}/${title} ${newNodeId()}`, draftMarkdown(session, markdown, labels));
                if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("Invalid created document ID");
                session.createdDocId = docId;
                session.state = "created";
            } catch {
                session.state = "unknown";
                return { ok: false, reason: "createUnknown" };
            }
        }
        try {
            await writeClip(plugin, session.createdDocId, { internal: true });
            session.state = "saved";
            return { ok: true, docId: session.createdDocId };
        } catch {
            return { ok: false, docId: session.createdDocId, reason: "markFailed" };
        }
    } finally {
        session.busy = false;
    }
}

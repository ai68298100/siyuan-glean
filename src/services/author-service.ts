import type { Plugin } from "siyuan";
import { exportMdContent } from "../api/client";
import { authorSuggestionText, buildAuthorSuggestionPrompt, parseAuthorSuggestion, type AuthorSuggestion } from "../domain/author";
import { AuthorEditError, readClipAuthor } from "./clip-store";
import { activeAiSettings, aiQuotaAvailable, callLLM, enqueueEnrich, logAiEvent, recordAiUsage } from "./enrich-service";
import type { GleanSettings } from "./settings";

export type AuthorSuggestionReason = "off" | "cap" | "empty" | "invalid" | "changed" | "cancelled" | "error";
export type AuthorSuggestionOutcome = { ok: true; suggestion: AuthorSuggestion } | { ok: false; reason: AuthorSuggestionReason };

export function authorSuggestionEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off" && settings.ai.authorSuggestionEnabled === true;
}

export async function suggestClipAuthor(
    plugin: Plugin,
    docId: string,
    settings: GleanSettings | (() => GleanSettings),
    options: { expectedAuthor: string; isCurrent?: () => boolean },
): Promise<AuthorSuggestionOutcome> {
    const currentSettings = () => activeAiSettings(plugin, typeof settings === "function" ? settings() : settings);
    const stopped = (): AuthorSuggestionOutcome | null => {
        if (options.isCurrent && !options.isCurrent()) return { ok: false, reason: "cancelled" };
        return authorSuggestionEnabled(currentSettings()) ? null : { ok: false, reason: "off" };
    };
    const initial = stopped();
    if (initial) return initial;
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) return { ok: false, reason: "changed" };
    return enqueueEnrich(async () => {
        const queued = stopped();
        if (queued) return queued;
        try {
            const quotaAvailable = await aiQuotaAvailable(plugin, currentSettings());
            const afterQuota = stopped();
            if (afterQuota) return afterQuota;
            if (!quotaAvailable) return { ok: false, reason: "cap" };
            const before = await readClipAuthor(docId);
            const beforeRead = stopped();
            if (beforeRead) return beforeRead;
            if (before.raw !== options.expectedAuthor) return { ok: false, reason: "changed" };
            const exported = await exportMdContent(docId, { yfm: false, addTitle: false, refMode: 2 });
            const afterRead = stopped();
            if (afterRead) return afterRead;
            if (typeof exported?.content !== "string") return { ok: false, reason: "error" };
            const text = authorSuggestionText(exported.content);
            const prompt = buildAuthorSuggestionPrompt(text);
            if (!prompt) return { ok: false, reason: "empty" };
            if ((await readClipAuthor(docId)).raw !== options.expectedAuthor) return { ok: false, reason: "changed" };
            const finalQuotaAvailable = await aiQuotaAvailable(plugin, currentSettings());
            const beforeCall = stopped();
            if (beforeCall) return beforeCall;
            if (!finalQuotaAvailable) return { ok: false, reason: "cap" };
            const outcome = await callLLM(plugin, currentSettings(), prompt);
            if (!outcome.ok) {
                await logAiEvent(plugin, docId, "author-suggestion-call", "Author suggestion model unavailable");
                return { ok: false, reason: "error" };
            }
            await recordAiUsage(plugin);
            const afterCall = stopped();
            if (afterCall) return afterCall;
            const suggestion = parseAuthorSuggestion(outcome.text, text);
            if (!suggestion) {
                await logAiEvent(plugin, docId, "author-suggestion-evidence", "No valid verbatim author evidence");
                return { ok: false, reason: "invalid" };
            }
            if ((await readClipAuthor(docId)).raw !== options.expectedAuthor) return { ok: false, reason: "changed" };
            const beforeVerify = stopped();
            if (beforeVerify) return beforeVerify;
            const currentExport = await exportMdContent(docId, { yfm: false, addTitle: false, refMode: 2 });
            const afterVerify = stopped();
            if (afterVerify) return afterVerify;
            if (typeof currentExport?.content !== "string") return { ok: false, reason: "error" };
            if (authorSuggestionText(currentExport.content) !== text) return { ok: false, reason: "changed" };
            if ((await readClipAuthor(docId)).raw !== options.expectedAuthor) return { ok: false, reason: "changed" };
            return stopped() ?? { ok: true, suggestion };
        } catch (error) {
            if (error instanceof AuthorEditError) return { ok: false, reason: "changed" };
            await logAiEvent(plugin, docId, "author-suggestion-call", "Author suggestion unavailable");
            return { ok: false, reason: "error" };
        }
    });
}

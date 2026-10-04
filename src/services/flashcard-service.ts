/**
 * 摘录制卡服务（T-3243，D-0090）：引文/选中文本 → 可编辑草稿 → 明确确认 → 列表项闪卡。
 * 牌组与宿主文档按名找回；已有用户宿主不改 internal，登记失败只重试确切卡块 ID。
 * 初始卡面本地构造；默认关闭的 AI 问答仅生成草稿，共享队列、额度与当前通道。
 */
import type { Plugin } from "siyuan";
import { insertBlockDomIds, createDocWithMd, newNodeId, querySql } from "../api/client";
import { addRiffCards, createRiffDeck, getRiffDecks } from "../api/riff";
import {
    buildFlashcardDom, buildQuoteCard, buildQuestionCardPrompt, parseQuestionCard, validateFlashcard,
    type FlashcardContent, type FlashcardSource, type FlashcardValidation,
} from "../domain/flashcard";
import { writeClip } from "./clip-store";
import { activeAiSettings, aiQuotaAvailable, callLLM, enqueueEnrich, logAiEvent, recordAiUsage } from "./enrich-service";
import type { GleanSettings } from "./settings";

const DECK_NAME = "拾遗卡片";
const DECK_DOC_TITLE = "拾遗卡片";
const NODE_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const deckSetups = new WeakMap<Plugin, Promise<unknown>>();

export interface FlashcardSession {
    source: Readonly<FlashcardSource>;
    draft: FlashcardContent;
    state: "ready" | "inserted" | "saved" | "unknown";
    deckId: string;
    hostDocId: string;
    cardBlockId: string;
    busy: boolean;
    cancelled: boolean;
}

export type FlashcardSaveReason = FlashcardValidation | "busy" | "cancelled" | "sourceChanged" | "readFailed" | "setupFailed" | "registerFailed" | "insertUnknown";
export interface FlashcardSaveOutcome {
    ok: boolean;
    reason?: FlashcardSaveReason;
    cardBlockId?: string;
    hostDocId?: string;
}

export type QuestionCardReason = "off" | "cap" | "invalid" | "error" | "busy" | "cancelled" | "sourceChanged" | "readFailed";

export function createFlashcardSession(source: FlashcardSource): FlashcardSession {
    return {
        source: Object.freeze({ ...source }),
        draft: buildQuoteCard(source.title, source.quote),
        state: "ready", deckId: "", hostDocId: "", cardBlockId: "", busy: false, cancelled: false,
    };
}

export function cancelFlashcardSession(session: FlashcardSession): void {
    session.cancelled = true;
}

export function questionCardEnabled(settings: GleanSettings): boolean {
    return settings.ai.enrichMode !== "off" && settings.ai.questionCardEnabled === true;
}

async function verifySource(source: FlashcardSource): Promise<"sourceChanged" | "readFailed" | null> {
    if ((source.docId && !NODE_ID_PATTERN.test(source.docId)) || (source.blockId && (!NODE_ID_PATTERN.test(source.blockId) || !source.docId))) return "sourceChanged";
    if (!source.docId) return null;
    try {
        const documents = await querySql<{ id: string; type: string }>(`SELECT id, type FROM blocks WHERE id='${source.docId}' LIMIT 1`);
        if (documents[0]?.id !== source.docId || documents[0]?.type !== "d") return "sourceChanged";
        if (source.blockId) {
            const blocks = await querySql<{ id: string; root_id: string }>(`SELECT id, root_id FROM blocks WHERE id='${source.blockId}' LIMIT 1`);
            if (blocks[0]?.id !== source.blockId || blocks[0]?.root_id !== source.docId) return "sourceChanged";
        }
        return null;
    } catch {
        return "readFailed";
    }
}

export interface DeckContext {
    deckId: string;
    hostDocId: string;
}

/** 找回/创建"拾遗卡片"牌组与宿主文档（幂等）。 */
export async function ensureFlashcardDeck(settings: GleanSettings, plugin: Plugin): Promise<DeckContext> {
    const previous = deckSetups.get(plugin) ?? Promise.resolve();
    const pending = previous.then(() => prepareFlashcardDeck(settings, plugin), () => prepareFlashcardDeck(settings, plugin));
    deckSetups.set(plugin, pending);
    try {
        return await pending;
    } finally {
        if (deckSetups.get(plugin) === pending) deckSetups.delete(plugin);
    }
}

async function prepareFlashcardDeck(settings: GleanSettings, plugin: Plugin): Promise<DeckContext> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");

    const decks = await getRiffDecks();
    let deck = decks.find((item) => item.name === DECK_NAME);
    if (!deck) deck = await createRiffDeck(DECK_NAME);
    if (!deck || typeof deck.id !== "string" || !deck.id.trim()) throw new Error("牌组 ID 无效");

    const existing = await querySql<{ id: string }>(`SELECT id FROM blocks WHERE type='d' AND box='${notebookId.replace(/'/g, "'" + "'")}' AND content='${DECK_DOC_TITLE}' LIMIT 1`);
    let hostDocId = existing[0]?.id ?? "";
    if (!hostDocId) {
        hostDocId = await createDocWithMd(notebookId, `/${DECK_DOC_TITLE}`, `# ${DECK_DOC_TITLE}\n\n`);
        if (!NODE_ID_PATTERN.test(hostDocId)) throw new Error("创建拾遗卡片宿主文档失败");
        // 宿主只是插件容器，不应进入“待确认候选”；属性写入统一经 clip-store。
        await writeClip(plugin, hostDocId, { internal: true });
    }
    if (!NODE_ID_PATTERN.test(hostDocId)) throw new Error("宿主文档 ID 无效");
    return { deckId: deck.id, hostDocId };
}

export async function draftQuestionCard(
    plugin: Plugin,
    session: FlashcardSession,
    settings: GleanSettings,
): Promise<{ ok: boolean; reason?: QuestionCardReason }> {
    if (!questionCardEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" };
    if (session.cancelled) return { ok: false, reason: "cancelled" };
    if (session.busy || session.state !== "ready") return { ok: false, reason: "busy" };
    const prompt = buildQuestionCardPrompt(session.source);
    if (!prompt) return { ok: false, reason: "invalid" };
    session.busy = true;
    try {
        return await enqueueEnrich(async () => {
            if (session.cancelled) return { ok: false, reason: "cancelled" as const };
            if (!questionCardEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" as const };
            const sourceIssue = await verifySource(session.source);
            if (sourceIssue) return { ok: false, reason: sourceIssue };
            if (!questionCardEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" as const };
            if (!(await aiQuotaAvailable(plugin, activeAiSettings(plugin, settings)))) return { ok: false, reason: "cap" as const };
            if (session.cancelled) return { ok: false, reason: "cancelled" as const };
            const currentSettings = activeAiSettings(plugin, settings);
            if (!questionCardEnabled(currentSettings)) return { ok: false, reason: "off" as const };
            const outcome = await callLLM(plugin, currentSettings, prompt);
            if (!outcome.ok) return { ok: false, reason: "error" as const };
            await recordAiUsage(plugin);
            if (session.cancelled) return { ok: false, reason: "cancelled" as const };
            if (!questionCardEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" as const };
            const finalSourceIssue = await verifySource(session.source);
            if (finalSourceIssue) return { ok: false, reason: finalSourceIssue };
            if (session.cancelled) return { ok: false, reason: "cancelled" as const };
            if (!questionCardEnabled(activeAiSettings(plugin, settings))) return { ok: false, reason: "off" as const };
            const draft = parseQuestionCard(outcome.text);
            if (!draft) return { ok: false, reason: "invalid" as const };
            const sourceTitle = session.source.title.trim();
            const sourceLink = session.source.docId ? `siyuan://blocks/${session.source.docId}` : "";
            draft.back = [draft.back, sourceTitle ? `《${sourceTitle}》` : "", sourceLink].filter(Boolean).join("\n\n");
            if (validateFlashcard(draft)) return { ok: false, reason: "invalid" as const };
            session.draft = draft;
            return { ok: true };
        });
    } catch {
        await logAiEvent(plugin, session.source.docId ?? "", "question-card", "Question card unavailable");
        return { ok: false, reason: "error" };
    } finally {
        session.busy = false;
    }
}

export async function confirmFlashcard(
    plugin: Plugin,
    session: FlashcardSession,
    settings: GleanSettings,
    content: FlashcardContent,
): Promise<FlashcardSaveOutcome> {
    if (session.busy) return { ok: false, reason: "busy" };
    if (session.state === "saved") return { ok: true, cardBlockId: session.cardBlockId, hostDocId: session.hostDocId };
    if (session.state === "unknown") return { ok: false, reason: "insertUnknown", hostDocId: session.hostDocId };
    if (session.cancelled) return { ok: false, reason: "cancelled" };
    const issue = validateFlashcard(content);
    if (session.state === "ready" && issue) return { ok: false, reason: issue };
    session.busy = true;
    try {
        if (session.state === "ready") {
            const draft = { front: content.front.trim(), back: content.back.trim() };
            const sourceIssue = await verifySource(session.source);
            if (sourceIssue) return { ok: false, reason: sourceIssue };
            if (session.cancelled) return { ok: false, reason: "cancelled" };
            try {
                const context = await ensureFlashcardDeck(settings, plugin);
                session.deckId = context.deckId;
                session.hostDocId = context.hostDocId;
            } catch {
                return { ok: false, reason: "setupFailed" };
            }
            if (session.cancelled) return { ok: false, reason: "cancelled" };
            const finalSourceIssue = await verifySource(session.source);
            if (finalSourceIssue) return { ok: false, reason: finalSourceIssue };
            if (session.cancelled) return { ok: false, reason: "cancelled" };
            const requestedId = newNodeId();
            try {
                await insertBlockDomIds(session.hostDocId, buildFlashcardDom(draft.front, draft.back, requestedId));
                session.cardBlockId = requestedId;
                session.draft = draft;
                session.state = "inserted";
            } catch {
                session.state = "unknown";
                return { ok: false, reason: "insertUnknown", hostDocId: session.hostDocId };
            }
        }
        try {
            await addRiffCards(session.deckId, [session.cardBlockId]);
            session.state = "saved";
            return { ok: true, cardBlockId: session.cardBlockId, hostDocId: session.hostDocId };
        } catch {
            return { ok: false, reason: "registerFailed", cardBlockId: session.cardBlockId, hostDocId: session.hostDocId };
        }
    } finally {
        session.busy = false;
    }
}

/** 制作一张回顾卡：正面=引文提示句，背面=完整引文+来源。返回卡片块 ID。 */
export async function makeQuoteCard(
    settings: GleanSettings,
    docTitle: string,
    quote: string,
    plugin: Plugin,
): Promise<{ cardBlockId: string }> {
    const session = createFlashcardSession({ title: docTitle, quote });
    const outcome = await confirmFlashcard(plugin, session, settings, session.draft);
    if (!outcome.ok || !outcome.cardBlockId) throw new Error(outcome.reason ?? "制卡失败");
    return { cardBlockId: outcome.cardBlockId };
}

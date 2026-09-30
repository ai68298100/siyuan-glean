/**
 * 摘录制卡服务（T-1502）：引文/选中文本 → 列表项闪卡 → "拾遗卡片"牌组。
 * 牌组与宿主文档幂等续建（复用 library-db 的续建范式）。
 * v1 不消耗 token（卡面文案本地构造）；AI 问句化留待后续（动作钩子已留，D-0007）。
 */
import type { Plugin } from "siyuan";
import { getBlockAttrs, insertBlockDom, createDocWithMd, querySql } from "../api/client";
import { addRiffCards, createRiffDeck, getRiffDecks } from "../api/riff";
import { buildFlashcardDom, buildQuoteCard } from "../domain/flashcard";
import { isMarkedInternalDoc } from "../domain/schema";
import { writeClip } from "./clip-store";
import type { GleanSettings } from "./settings";

const DECK_NAME = "拾遗卡片";
const DECK_DOC_TITLE = "拾遗卡片";

export interface DeckContext {
    deckId: string;
    hostDocId: string;
}

/** 找回/创建"拾遗卡片"牌组与宿主文档（幂等）。 */
export async function ensureFlashcardDeck(settings: GleanSettings, plugin: Plugin): Promise<DeckContext> {
    const notebookId = settings.anchorNotebooks[0];
    if (!notebookId) throw new Error("请先设置读库笔记本");

    const decks = await getRiffDecks();
    let deck = decks.find((item) => item.name === DECK_NAME);
    if (!deck) deck = await createRiffDeck(DECK_NAME);

    // T-1987：同名候选逐个验证 internal 标记，绝不把用户同名文档当宿主写入。
    // 旧版无标记宿主不做结构迁移（按文档查 riff 卡的端点未实证，先 spike 再补），
    // 无标记时另建宿主：旧卡按块注册在牌组里仍可复习，功能无损失。
    const safeNotebook = notebookId.replace(/'/g, "'" + "'");
    const safeTitle = DECK_DOC_TITLE.replace(/'/g, "'" + "'");
    const candidates = await querySql<{ id: string }>(`SELECT id FROM blocks WHERE type='d' AND box='${safeNotebook}' AND content='${safeTitle}'`);
    let hostDocId = "";
    for (const candidate of candidates) {
        const ial = await getBlockAttrs(candidate.id);
        if (isMarkedInternalDoc(ial)) {
            hostDocId = candidate.id;
            break;
        }
    }
    if (!hostDocId) {
        hostDocId = await createDocWithMd(notebookId, `/${DECK_DOC_TITLE}`, `# ${DECK_DOC_TITLE}\n\n`);
        if (!hostDocId) throw new Error("创建拾遗卡片宿主文档失败");
        // 宿主只是插件容器，不应进入“待确认候选”；属性写入统一经 clip-store。
        await writeClip(plugin, hostDocId, { internal: true });
    }
    return { deckId: deck.id, hostDocId };
}

/** 制作一张回顾卡：正面=引文提示句，背面=完整引文+来源。返回卡片块 ID。 */
export async function makeQuoteCard(
    settings: GleanSettings,
    docTitle: string,
    quote: string,
    plugin: Plugin,
    /** T-1751：AI 问句卡面覆盖默认 front 模板。 */
    frontOverride?: string
): Promise<{ cardBlockId: string }> {
    const { deckId, hostDocId } = await ensureFlashcardDeck(settings, plugin);
    const content = buildQuoteCard(docTitle, quote, frontOverride);
    const dom = buildFlashcardDom(content.front, content.back);
    await insertBlockDom(hostDocId, dom);
    // 列表项 id 经 SQL 找回（最新插入的一枚）
    let cardBlockId = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const itemRows = await querySql<{ id: string }>(`SELECT id FROM blocks WHERE root_id='${hostDocId.replace(/'/g, "'" + "'")}' AND type='i' ORDER BY sort DESC LIMIT 1`);
        cardBlockId = itemRows[0]?.id ?? "";
        if (cardBlockId) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!cardBlockId) throw new Error("卡片块未在索引中出现");
    await addRiffCards(deckId, [cardBlockId]);
    return { cardBlockId };
}

/**
 * 摘录制卡域层（T-1502，纯函数）：列表项闪卡 DOM 构造 + 正背面文案。
 * 范式（spike ⑧ 实证）：列表项内容=正面，嵌套子列表=背面；卡片注册在列表项块上。
 * DOM 不携带 data-node-id（内核 Lute 解析时自动分配，人脉 AV 插入同款先例）。
 * v1 不消耗 token：正面=引文提示句，背面=完整原文+来源。
 */

export interface FlashcardContent {
    front: string;
    back: string;
}

/** 由引文与来源构造卡面文案。front 截 60 字；back 含完整引文与来源。 */
export function buildQuoteCard(docTitle: string, quote: string): FlashcardContent {
    const trimmed = quote.trim().replace(/\s+/g, " ");
    const excerpt = trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
    const source = docTitle ? `《${docTitle}》` : "来源文章";
    return {
        front: `「${excerpt}」——还记得它出自哪篇文章、讲什么吗？`,
        back: `${source}\n${trimmed}`,
    };
}

/** 转义 DOM 文本（防引文里的尖括号/引号破坏结构）。 */
export function escapeDomText(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 构造列表项制卡 DOM（列表项=正面，嵌套子列表=背面）。 */
export function buildFlashcardDom(front: string, back: string): string {
    const esc = escapeDomText;
    return (
        `<div data-type="NodeList" data-subtype="u">`
        + `<div data-type="NodeListItem" data-subtype="bullet">`
        + `<div data-type="NodeParagraph" class="p">${esc(front)}</div>`
        + `<div data-type="NodeList" data-subtype="u">`
        + `<div data-type="NodeListItem" data-subtype="bullet">`
        + `<div data-type="NodeParagraph" class="p">${esc(back).replace(/\n/g, "<br/>")}</div>`
        + `</div></div></div></div>`
    );
}

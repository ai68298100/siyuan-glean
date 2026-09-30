/**
 * 阅读页签伴生栏的纯函数（T-1730d/T-1730e，D-0030）。
 * 摘录=引述块 DOM；AI 伴读的 prompt 构造。字符串进出，零依赖，可单测。
 */

export const EXCERPT_MAX_LENGTH = 4000;

/** 选区文本规范化：压缩空白并截断；空串表示无可摘录内容。 */
export function clampExcerpt(text: string): string {
    return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX_LENGTH);
}

/** 多行选区 → 引述块内的段落序列；空行跳过。 */
function quoteParagraphs(text: string): string[] {
    return String(text ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * 引述块 DOM（块插入端点的 dom 载荷；内核自动分配节点 ID，
 * 范式与 buildFlashcardDom 同源——spike ⑧ 实证的裸 div + data-type 结构）。
 */
export function buildQuoteBlockDom(text: string, escape: (value: string) => string): string {
    const paragraphs = quoteParagraphs(text);
    if (paragraphs.length === 0) return "";
    const inner = paragraphs
        .map((line) => `<div data-type="NodeParagraph" class="p">${escape(line)}</div>`)
        .join("");
    return `<div data-type="NodeBlockquote" class="bq">${inner}</div>`;
}

/** 全文总结 prompt：只输出总结正文，不带寒暄与前缀。 */
export function buildSummarizePrompt(title: string, plain: string): string {
    const heading = title.trim() ? `《${title.trim()}》` : "这篇文章";
    return [
        `请用不超过 120 字总结${heading}的核心观点，直接输出总结正文，不要前缀和客套。`,
        "文章内容：",
        String(plain ?? "").slice(0, 8000),
    ].join("\n");
}

/** 选区翻译 prompt：中文↔英文互译，只输出译文。 */
export function buildTranslatePrompt(text: string): string {
    return [
        "请翻译以下文字：中文译成英文，其他语言译成中文。只输出译文，不要解释。",
        "文字：",
        String(text ?? "").slice(0, EXCERPT_MAX_LENGTH),
    ].join("\n");
}

/** 单字问题长度上限（T-1760：单轮动作，问题本身不该是一篇文章） */
export const ASK_QUESTION_MAX_LENGTH = 500;

/**
 * "问这篇文章" prompt（T-1760）：限定上下文=本文全文，单轮、无追问、不做聊天窗。
 * 只回答与文章相关的问题，拒绝展开成通用对话。
 */
export function buildAskPrompt(title: string, plain: string, question: string): string {
    const heading = title.trim() ? `《${title.trim()}》` : "这篇文章";
    const trimmed = String(question ?? "").replace(/\s+/g, " ").trim().slice(0, ASK_QUESTION_MAX_LENGTH);
    return [
        `请仅依据${heading}的内容回答问题。与文章无关的问题请直接说明只能回答文章相关内容。直接输出答案，不要前缀和客套。`,
        "文章内容：",
        String(plain ?? "").slice(0, 8000),
        "问题：" + (trimmed || "这篇文章讲了什么？"),
    ].join("\n");
}

/** 问句规范化：压缩空白并截断；空串表示没有有效问题。 */
export function clampAskQuestion(question: string): string {
    return String(question ?? "").replace(/\s+/g, " ").trim().slice(0, ASK_QUESTION_MAX_LENGTH);
}

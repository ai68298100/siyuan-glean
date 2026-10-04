/**
 * 阅读页签伴生栏的纯函数（T-1730d/T-1730e，D-0030）。
 * 摘录=引述块 DOM；AI 伴读的 prompt 构造。字符串进出，零依赖，可单测。
 */

export const EXCERPT_MAX_LENGTH = 4000;
export const ARTICLE_QUESTION_MAX_LENGTH = 1000;
export const ARTICLE_QUESTION_CONTEXT_MAX_LENGTH = 16000;

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

export interface ArticleQuestionResult {
    answer: string;
    evidence: string[];
    insufficient: boolean;
}

export function clampArticleQuestion(value: string): string {
    return String(value ?? "").trim().slice(0, ARTICLE_QUESTION_MAX_LENGTH);
}

export function buildArticleQuestionPrompt(title: string, context: string, question: string, truncated: boolean): string {
    const heading = title.trim() ? `《${title.trim()}》` : "本文";
    return [
        `请只根据${heading}提供的上下文回答问题，不要使用外部知识。`,
        "必须只输出 JSON：{\"answer\":\"...\",\"evidence\":[\"逐字引文\"],\"insufficient\":true或false}。",
        "若上下文不足，answer 简短说明依据不足，evidence 为空数组，insufficient=true。否则至少给出一条能在上下文中逐字核对的引文。不要编造引文。",
        truncated ? "上下文已截断；不要声称看到了未提供的全文。" : "上下文未截断。",
        `问题：${clampArticleQuestion(question)}`,
        "上下文：",
        String(context ?? "").slice(0, ARTICLE_QUESTION_CONTEXT_MAX_LENGTH),
    ].join("\n");
}

function parseJsonObject(text: string): unknown {
    const trimmed = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(trimmed); } catch { return null; }
}

export function parseArticleQuestionResponse(text: string, context: string): ArticleQuestionResult | null {
    const value = parseJsonObject(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (typeof input.answer !== "string" || input.answer.trim().length === 0 || input.answer.length > 8000 || typeof input.insufficient !== "boolean" || !Array.isArray(input.evidence) || input.evidence.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 1000)) return null;
    const evidence = input.evidence.map((item) => (item as string).trim());
    if (input.insufficient) return evidence.length === 0 ? { answer: input.answer.trim(), evidence: [], insufficient: true } : null;
    if (evidence.length === 0 || evidence.some((item) => !context.includes(item))) return null;
    return { answer: input.answer.trim(), evidence, insufficient: false };
}

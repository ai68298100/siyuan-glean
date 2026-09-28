/**
 * AI 富化域层（T-1300）：prompt 构造与响应解析（纯函数，可单测）。
 * 协议：要求模型返回 JSON {"summary": "...", "tags": ["a","b"]}；
 * 解析必须鲁棒（模型可能带 markdown 代码栏/前后杂文/字数越界），解析失败返回 null 由上层静默降级。
 */

/** 喂给模型的正文上限（字符）；超长截断保头部（新闻/博客主旨在前部）。 */
export const ENRICH_CONTENT_LIMIT = 6000;

/** 标签数上限与单标签长度上限（写入 ai-tags 前的最终约束）。 */
export const ENRICH_MAX_TAGS = 6;
export const ENRICH_TAG_MAX_LEN = 16;

export function buildEnrichPrompt(title: string, plainText: string): string {
    const clipped = plainText.slice(0, ENRICH_CONTENT_LIMIT);
    return [
        "你是一个阅读库管理助手。请阅读下面的文章，输出严格的 JSON（不要 markdown 代码栏，不要解释）：",
        '{"summary": "一句话中文摘要（不超过 60 字，概括核心观点）", "tags": ["标签"]}',
        "要求：",
        `1. tags 为 2-${ENRICH_MAX_TAGS} 个中文或英文主题标签，每个不超过 ${ENRICH_TAG_MAX_LEN} 字，小写优先，不要重复文章标题里已有的词`,
        `2. summary 必须是单行纯文本。`,
        "",
        `文章标题：${title || "（无标题）"}`,
        "",
        "文章正文：",
        clipped,
    ].join("\n");
}

export interface EnrichResult {
    summary: string;
    tags: string[];
}

/** 从模型回复里提取 JSON 并规范化；任何一步失败返回 null（静默降级）。 */
export function parseEnrichResponse(raw: string): EnrichResult | null {
    if (!raw) return null;
    const jsonText = extractJson(raw);
    if (!jsonText) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? record.summary.replace(/\s+/g, " ").trim() : "";
    const rawTags = Array.isArray(record.tags) ? record.tags : [];
    const tags = normalizeTags(rawTags);
    if (!summary || tags.length === 0) return null;
    if (summary.length > 120) return { summary: summary.slice(0, 117) + "…", tags };
    return { summary, tags };
}

/** 提取首个平衡的 JSON 对象文本；容忍 ```json 代码栏与前后杂文。 */
export function extractJson(raw: string): string | null {
    const cleaned = raw.replace(/```(?:json)?/gi, "```");
    const start = cleaned.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
        const ch = cleaned[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return cleaned.slice(start, i + 1);
        }
    }
    return null;
}

function normalizeTags(values: unknown[]): string[] {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const value of values) {
        if (typeof value !== "string") continue;
        const tag = value.trim().replace(/^#/, "").slice(0, ENRICH_TAG_MAX_LEN);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
        if (tags.length >= ENRICH_MAX_TAGS) break;
    }
    return tags;
}

/** 语义查重的相似判定：标题字符 bigram 重叠 ≥60% 视为高度相似（对中英文都有效）。 */
export function isLikelyDuplicate(currentTitle: string, candidateTitle: string): boolean {
    const a = bigramsOf(currentTitle);
    const b = bigramsOf(candidateTitle);
    if (a.size === 0 || b.size === 0) return false;
    let overlap = 0;
    for (const gram of a) if (b.has(gram)) overlap += 1;
    return overlap / Math.min(a.size, b.size) >= 0.6;
}

function bigramsOf(title: string): Set<string> {
    const normalized = (title || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    const grams = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i += 1) {
        grams.add(normalized.slice(i, i + 2));
    }
    return grams;
}

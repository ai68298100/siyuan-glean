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

/* ---------- AI 标签规范化（T-1761） ---------- */

export interface AiTagMergeSuggestion {
    /** 组内全部变体（含保留目标），归一化后互相相似 */
    variants: string[];
    /** 用户确认后保留的写法（默认组内最长/最先出现） */
    keep: string;
}

/** 归一化：小写 + 去空白，比较用。 */
function normalizeTag(tag: string): string {
    return String(tag ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 找出互相相似的 AI 标签组（T-1761）：归一化相等，或一方包含另一方且短方 ≥2 字符
 * （如 机器学习/ML 这类变体靠包含关系提示；无包含关系的同义词不猜，宁缺勿滥）。
 * 返回组列表（每组 ≥2 个变体）；keep 默认取出现最早（输入顺序）的最长变体。
 */
export function findSimilarTagGroups(tags: string[]): AiTagMergeSuggestion[] {
    const seen = new Map<string, string[]>();
    const order: string[] = [];
    for (const tag of tags) {
        const key = normalizeTag(tag);
        if (!key) continue;
        if (!seen.has(key)) {
            seen.set(key, []);
            order.push(key);
        }
        const bucket = seen.get(key)!;
        if (!bucket.includes(tag)) bucket.push(tag);
    }
    const keys = [...seen.keys()];
    const assigned = new Set<string>();
    const groups: AiTagMergeSuggestion[] = [];
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (assigned.has(key)) continue;
        const group = [key];
        for (let j = i + 1; j < keys.length; j += 1) {
            const other = keys[j];
            if (assigned.has(other)) continue;
            const [shorter, longer] = key.length <= other.length ? [key, other] : [other, key];
            if (shorter.length >= 2 && longer.includes(shorter)) {
                group.push(other);
            }
        }
        if (group.length >= 2) {
            for (const key of group) assigned.add(key);
            const variants = [...new Set(group.flatMap((k) => seen.get(k) ?? []))];
            // 保留目标：最长变体（信息量最大），同长取先出现
            const keep = variants.reduce((best, cur) => (cur.length > best.length ? cur : best), variants[0]);
            groups.push({ variants, keep });
        }
    }
    return groups;
}

/* ---------- 来源作者推断（T-1813） ---------- */

export const AUTHOR_MAX_LEN = 40;

/**
 * 作者推断 prompt（T-1813）：从文章标题/正文找公众号/作者名线索
 * （如"点击上方蓝字关注 XX"、文末署名）。只输出名字本身，无法判断输出"未知"。
 */
export function buildAuthorPrompt(title: string, plain: string): string {
    return [
        "请从以下文章内容中推断来源作者名（公众号名/作者名/专栏名）。",
        "线索常见于：正文开头的「点击上方蓝字关注 XX」、文末署名、转载声明。",
        "只输出作者名本身，不要任何解释；确实无法判断时只输出：未知",
        `文章标题：${String(title ?? "").trim()}`,
        "文章内容：",
        String(plain ?? "").slice(0, 6000),
    ].join("\n");
}

/** 解析作者推断响应：去掉引号/前缀修饰，超出上限截断；"未知"或空返回 null。 */
export function parseAuthorResponse(raw: string): string | null {
    let text = String(raw ?? "").trim();
    // 常见包裹清理：引号、书名号、"作者："/"公众号："前缀
    text = text.replace(/^(作者|公众号|专栏)[:：]\s*/i, "").replace(/^["'“”「『]|["'“”」』]$/g, "").trim();
    if (!text || text === "未知" || text.length > AUTHOR_MAX_LEN) return null;
    // 单行白名单化：拒绝多行/明显非名字内容
    if (/[\r\n]/.test(text)) return null;
    return text;
}

/**
 * 迁移启发式（DATA-CONTRACT §2）：从剪藏文档正文提取来源 URL。
 * 规划书铁律：正文启发式只用于迁移器回填时提取 URL，绝不作为剪藏唯一判定。
 *
 * 官方剪藏扩展默认模板的正文第二行是 `- [url](urlDecoded)` 链接行；
 * 不同模板/手工导入的形态各异，这里做多策略匹配并给每个候选打分。
 */

export interface UrlCandidate {
    url: string;
    /** 0-100：来源越靠前/形态越像剪藏模板，分越高 */
    score: number;
    reason: string;
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function normalizeUrl(value: string): string {
    // 去掉尾随标点（markdown 行尾句号等），不做其他改写
    return value.replace(/[),.;!?'"\]]+$/, "");
}

/**
 * 从 markdown 文本提取来源 URL 候选列表（按得分降序）。
 * 只看前 30 行——剪藏模板的链接行总在开头。
 */
export function extractUrlCandidates(markdown: string): UrlCandidate[] {
    const candidates: UrlCandidate[] = [];
    const seen = new Set<string>();
    const lines = markdown.split(/\r?\n/).slice(0, 30);

    lines.forEach((line, lineIndex) => {
        // 策略一：裸 URL 行（collect 收集箱/部分工具直接贴 URL）
        const bare = line.trim();
        if (isHttpUrl(bare) && !bare.includes(" ")) {
            push({ url: normalizeUrl(bare), score: 80 - lineIndex, reason: "bare-url-line" });
        }
        // 策略二：markdown 链接，链接文本本身也是 URL 或与 href 同源（官方剪藏模板形态）
        for (const match of line.matchAll(MARKDOWN_LINK)) {
            const text = match[1].trim();
            const href = normalizeUrl(match[2].trim());
            if (!isHttpUrl(href)) continue;
            const looksLikeClipper = isHttpUrl(text) || text === href || text.replace(/\/$/, "") === href.replace(/\/$/, "");
            push({
                url: href,
                score: (looksLikeClipper ? 90 : 50) - lineIndex,
                reason: looksLikeClipper ? "clipper-template-link" : "markdown-link",
            });
        }
    });

    function push(candidate: UrlCandidate) {
        const key = candidate.url.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(candidate);
    }

    return candidates.sort((a, b) => b.score - a.score);
}

/** 取最优候选；无候选返回 null。 */
export function bestUrlCandidate(markdown: string): UrlCandidate | null {
    return extractUrlCandidates(markdown)[0] ?? null;
}

/** 粗略剥 markdown 标记，供字数统计用（不追求渲染级精度）。 */
export function stripMarkdown(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[*_~>]+/g, "")
        .replace(/^\s*[-+]\s+/gm, "")
        .replace(/\{[^}]*\}/g, " ")
        ;
}

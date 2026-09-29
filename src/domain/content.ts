/**
 * 收录正文元数据（S2/T-1707）。纯函数层只接收导出的 Markdown，供迁移、
 * 收集箱和显式收录入口共用；它不会读写文档，也不会把查重规范化后的 URL
 * 反写回用户正文。
 */
import { stripMarkdown } from "./migrate.ts";
import { inspectCandidate } from "./candidate-policy.ts";
import { countWords, estimateMinutes, siteFromUrl, type ClipContentType } from "./schema.ts";

export interface ClipMarkdownMetadata {
    /** 正文中找到的来源 URL；未找到时为空。 */
    url: string;
    site: string;
    words: number;
    minutes: number;
    contentType: ClipContentType;
}

export interface InspectMarkdownOptions {
    /** 入口已知的来源 URL；仅用于元数据，不改变正文。 */
    url?: string;
    /** 用户/入口已明确类型时优先使用。 */
    contentType?: ClipContentType;
}

/**
 * 去掉剪藏模板的标题、来源链接和元信息后再计数。
 * 这样 `- [URL](URL)`、来源站点和导入提示不会被误报为可读正文。
 */
function articleBody(markdown: string): string {
    const withoutFrontmatter = String(markdown ?? "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const lines = withoutFrontmatter.split(/\r?\n/);
    let titleRemoved = false;
    const body: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^#{1,6}\s+/.test(trimmed) && (!titleRemoved || body.every((item) => !item.trim()))) {
            titleRemoved = true;
            continue;
        }
        // Official clipper/source line and a plain URL line.
        if (/^(?:[-*+]\s*)?\[[^\]]*\]\(https?:\/\/[^)\s]+(?:\s+"[^"]*")?\)\s*$/i.test(trimmed)) continue;
        if (/^https?:\/\/\S+$/i.test(trimmed)) continue;
        // Common generated metadata lines; they are not article content.
        if (/^(?:[-*+]\s*)?(?:来源|收藏于|已读于|标签|由迁移导入器带入)\s*[：:]/.test(trimmed)) continue;
        if (/^>\s*由迁移导入器带入/.test(trimmed)) continue;
        body.push(line);
    }
    return stripMarkdown(body.join("\n")).replace(/\s+/g, " ").trim();
}

/** 统一计算 URL、站点、正文长度、预计时长和阅读载体类型。 */
export function inspectClipMarkdown(markdown: string, options: InspectMarkdownOptions = {}): ClipMarkdownMetadata {
    // 与候选资格规则共用精确模板判定；普通正文内联链接不是来源。
    const url = String(options.url ?? inspectCandidate({ markdown }).url).trim();
    const body = articleBody(markdown);
    const rawWords = countWords(body);
    const contentType = options.contentType ?? (url ? (rawWords > 0 ? "fulltext" : "link") : "local");
    const words = contentType === "link" ? 0 : rawWords;
    return {
        url,
        site: url ? siteFromUrl(url) : "",
        words,
        minutes: estimateMinutes(words),
        contentType,
    };
}

export { articleBody };

export type FulltextBodyState = "ok" | "missing" | "unmeasured" | "na";

/**
 * 全文载体的正文诊断（T-1727）。只基于已记录的测量值判断：
 * words > 0 = 正常；words = 0 = 已测量为空（剪入失败或正文被清空）；
 * 缺测量键 = 未检测。绝不猜测：非全文载体返回 na。
 */
export function fulltextBodyState(contentType: string | undefined, words: number | undefined): FulltextBodyState {
    if (contentType !== "fulltext") return "na";
    if (words === undefined) return "unmeasured";
    return words > 0 ? "ok" : "missing";
}


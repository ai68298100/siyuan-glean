/**
 * 候选资格规则（S2 / T-1706）。
 *
 * 扫描范围只说明“去哪里找”，不能把范围内的每篇文档当成文章。
 * 只有可解释的来源证据才会生成待确认候选；用户明确标记为误报的文档
 * （custom-clip-excluded=true）和插件自己生成的宿主文档永远不会进入候选。
 * 这里保持为纯函数，服务层负责把 SQL/导出结果传入，UI 只消费结果。
 */

import { ATTR, CLIP_STATUSES, siteFromUrl } from "./schema.ts";
import { normalizeUrl } from "./url.ts";

export const CANDIDATE_EVIDENCE = [
    "url-attribute",
    "clip-tag",
    "clipper-template",
    "source-line",
] as const;

export type CandidateEvidence = (typeof CANDIDATE_EVIDENCE)[number];

export const CANDIDATE_MISSING = ["url", "status"] as const;
export type CandidateMissing = (typeof CANDIDATE_MISSING)[number];

export interface CandidateDocMeta {
    title?: string;
    hpath?: string;
}

export interface CandidateProbeInput {
    /** 根块 IAL（原始字符串形态）；只读，不在域层写回。 */
    ial?: Record<string, string | undefined>;
    /** SQL 模糊匹配的提示，不能单独作为精确标签证据。 */
    tagged?: boolean;
    /** SQL 的 tag 字段；与 IAL.tags 均须精确 token 化。 */
    tags?: string | string[];
    /** 导出的 markdown；只用于识别高置信度的独立 URL 行。 */
    markdown?: string;
    title?: string;
    hpath?: string;
}

export interface CandidateProbe {
    eligible: boolean;
    /** 属性 URL 优先；没有时使用模板/独立来源行提取出的 URL。 */
    url: string;
    /** URL 主机名（不含 www.）；无法解析时为空。 */
    site: string;
    evidence: CandidateEvidence[];
    missing: CandidateMissing[];
    /** 供 UI/迁移器解释为什么不展示。 */
    excluded: boolean;
    internal: boolean;
}

const VALID_STATUSES = new Set<string>(CLIP_STATUSES);

function isHttpUrl(value: string): boolean {
    return !/\s/.test(value.trim()) && Boolean(normalizeUrl(value));
}

/** 去掉 markdown 链接行末的常见标点，但不改变 URL 的路径/查询语义。 */
function trimUrl(value: string): string {
    return value.trim().replace(/[),.;!?'"\]]+$/, "");
}

function comparableUrl(value: string): string {
    return normalizeUrl(value);
}

function hasExactClipTag(...sources: Array<string | string[] | undefined>): boolean {
    for (const source of sources) {
        const items = Array.isArray(source) ? source : String(source ?? "").split(/[,，\s]+/);
        for (const item of items) {
            if (item.trim().replace(/^#+|#+$/g, "") === "剪藏") return true;
        }
    }
    return false;
}

/**
 * 官方剪藏模板的高置信度链接形态：前 10 行中的独立 markdown 列表链接，
 * 链接文本和 href 都是同一个 http(s) URL。普通正文里的 `[文字](URL)` 不匹配。
 */
function templateUrl(markdown: string | undefined): { url: string; evidence: CandidateEvidence } | null {
    if (!markdown) return null;
    // 思源导出会在正文前加 YAML frontmatter；它不是剪藏正文行，不应挤掉
    // 官方模板链接的前十行资格窗口。
    const body = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const lines = body.split(/\r?\n/).slice(0, 10);
    const markdownLink = /^\s*[-*+]\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\s*$/i;
    const bareUrl = /^\s*(https?:\/\/\S+)\s*$/i;
    for (const line of lines) {
        const match = markdownLink.exec(line);
        if (match) {
            const text = trimUrl(match[1]);
            const href = trimUrl(match[2]);
            if (isHttpUrl(text) && isHttpUrl(href) && comparableUrl(text) === comparableUrl(href)) {
                return { url: href, evidence: "clipper-template" };
            }
        }
        const bare = bareUrl.exec(line);
        if (bare && isHttpUrl(trimUrl(bare[1]))) {
            return { url: trimUrl(bare[1]), evidence: "source-line" };
        }
    }
    return null;
}

/** 插件生成的宿主文档识别。规则刻意收窄，避免误伤用户普通文章。 */
export function isInternalDocument(meta: CandidateDocMeta): boolean {
    const title = (meta.title ?? "").trim();
    const hpath = (meta.hpath ?? "").replace(/\\/g, "/");
    const pathParts = hpath.split("/").filter(Boolean);
    // 统计周报固定写入 /读库周报/<日期>；数据库、闪卡宿主固定为根路径。
    if (pathParts.includes("读库周报")) return true;
    if (title === "读库数据库" && (pathParts.length === 0 || pathParts.at(-1) === title)) return true;
    if (title === "拾遗卡片" && (pathParts.length === 0 || pathParts.at(-1) === title)) return true;
    // 允许插件后续增加同类宿主时沿用稳定目录前缀，不把正文标题关键词当作排除条件。
    if (pathParts.includes("拾遗卡片")) return true;
    return false;
}

/**
 * 计算一篇无有效状态文档的候选资格。`tagged` 由 SQL 标签范围提供，
 * `markdown` 由迁移预览按需提供；两者均不修改文档。
 */
export function inspectCandidate(input: CandidateProbeInput): CandidateProbe {
    const ial = input.ial ?? {};
    const rawUrl = String(ial[ATTR.url] ?? "").trim();
    const attrUrl = isHttpUrl(rawUrl) ? rawUrl : "";
    const fromMarkdown = templateUrl(input.markdown);
    const url = attrUrl || fromMarkdown?.url || "";
    const evidence: CandidateEvidence[] = [];
    if (attrUrl) evidence.push("url-attribute");
    if (hasExactClipTag(ial.tags, input.tags)) evidence.push("clip-tag");
    if (fromMarkdown) evidence.push(fromMarkdown.evidence);

    const excluded = String(ial[ATTR.excluded] ?? "").toLowerCase() === "true";
    const internal = String(ial[ATTR.internal] ?? "").toLowerCase() === "true"
        || isInternalDocument({ title: input.title, hpath: input.hpath });
    const status = String(ial[ATTR.status] ?? "").trim();
    const hasValidStatus = VALID_STATUSES.has(status);
    const missing: CandidateMissing[] = [];
    if (!url) missing.push("url");
    if (!hasValidStatus) missing.push("status");
    const eligible = !excluded && !internal && evidence.length > 0 && !hasValidStatus;
    return {
        eligible,
        url,
        site: siteFromUrl(url),
        evidence,
        missing,
        excluded,
        internal,
    };
}

/** 只判断属性是否已有有效读库状态；非法状态仍视为未收录候选。 */
export function hasValidClipStatus(ial: Record<string, string | undefined>): boolean {
    return VALID_STATUSES.has(String(ial[ATTR.status] ?? "").trim());
}


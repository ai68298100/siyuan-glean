/**
 * 微信公众号文章专属领域逻辑（纯函数层）
 *
 * 核心能力：
 * 1. 微信公众号 URL 判定；
 * 2. 从剪藏正文/元信息中精准提取具体公众号名称（author）；
 * 3. 识别微信防盗链图片域名（如 mmbiz.qpic.cn）；
 * 4. 清洗微信公众号剪藏特有的模板与尾部噪点（合集、蓝字关注、点赞在看套话）。
 */
import { normalizeAuthor } from "./author.ts";

const WECHAT_HOSTS = new Set([
    "mp.weixin.qq.com",
    "weixin.qq.com",
]);

/**
 * 判断是否为微信公众号文章 URL
 */
export function isWechatUrl(rawUrl: string | undefined): boolean {
    if (!rawUrl) return false;
    try {
        const parsed = new URL(rawUrl.trim());
        const host = parsed.hostname.toLowerCase();
        return WECHAT_HOSTS.has(host) || host.endsWith(".weixin.qq.com");
    } catch {
        return false;
    }
}

/**
 * 判断图片 URL 是否为微信防盗链图片服务（如 mmbiz.qpic.cn）
 */
export function isWechatImage(rawUrl: string | undefined): boolean {
    if (!rawUrl) return false;
    try {
        const parsed = new URL(rawUrl.trim());
        const host = parsed.hostname.toLowerCase();
        return host === "mmbiz.qpic.cn" || host.endsWith(".qpic.cn");
    } catch {
        return false;
    }
}

const GENERIC_AUTHOR_BLACKLIST = new Set([
    "微信",
    "微信公众号",
    "公众号",
    "阅读原文",
    "预览时标签不可点",
    "原创",
    "作者",
    "来源",
    "编辑",
    "分享",
    "关注",
]);

function cleanExtractedName(raw: string): string | null {
    let name = raw
        .replace(/<[^>]+>/g, " ")
        .replace(/[*_`~[\]]/g, "")
        .replace(/[\r\n\t]+/g, " ")
        .trim();

    // 去除常见的来源/作者前缀
    name = name.replace(/^(?:公众号|微信公众号|作者|来源|发布者|出品)[：:\s]+/i, "").trim();
    // 去除可能跟随的日期或后缀，例如 "2024-05-01" 或 "发表于..."
    name = name.replace(/\s+(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}.*|发表于.*|发布于.*|\d{1,2}月\d{1,2}日.*)$/, "").trim();

    if (!name) return null;
    if (GENERIC_AUTHOR_BLACKLIST.has(name)) return null;

    return normalizeAuthor(name);
}

/**
 * 从微信剪藏 Markdown/HTML 中提取具体公众号名称
 *
 * 识别策略：
 * 1. HTML 元数据与 DOM 标志（js_name / profile_nickname / og:site_name）；
 * 2. 开头前 30 行中的结构化字段（如 "公众号：xxx"、"**公众号**：xxx"）；
 * 3. 微信文章原创标头（如 "原创 差评"、"原创 晚点LatePost"）；
 * 4. 剪藏模板链接形式（如 "[差评](https://mp.weixin.qq.com/...)"）。
 */
export function extractWechatAuthor(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    // 策略 1：HTML 专属标签与元数据
    // 1.1 js_name 链接（微信文章标题下方的公众号链接通常形如 <a ... id="js_name">公众号名称</a>）
    const jsNameMatch = /<a[^>]+id=["']js_name["'][^>]*>([\s\S]*?)<\/a>/i.exec(markdown);
    if (jsNameMatch) {
        const cleaned = cleanExtractedName(jsNameMatch[1]);
        if (cleaned) return cleaned;
    }

    // 1.2 profile_nickname 样式
    const nicknameMatch = /<strong[^>]+class=["'][^"']*profile_nickname[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i.exec(markdown)
        || /<span[^>]+class=["'][^"']*(?:profile_meta_value|account_nickname)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(markdown);
    if (nicknameMatch) {
        const cleaned = cleanExtractedName(nicknameMatch[1]);
        if (cleaned) return cleaned;
    }

    // 1.3 meta 标签
    const metaMatch = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(markdown)
        || /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(markdown);
    if (metaMatch) {
        const cleaned = cleanExtractedName(metaMatch[1]);
        if (cleaned) return cleaned;
    }

    // 只检查前 35 行
    const lines = markdown.split(/\r?\n/).slice(0, 35);

    // 策略 2：前 35 行中明确的 "公众号：xxx" / "**公众号：** xxx"
    const explicitPattern = /^(?:[-*+]\s*)?(?:\*\*)?(?:公众号|微信公众号)(?:\*\*)?[：:\s]+(?:\*\*)?([^\r\n*_[\]()]+)(?:\*\*)?$/i;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = explicitPattern.exec(trimmed);
        if (m) {
            const cleaned = cleanExtractedName(m[1]);
            if (cleaned) return cleaned;
        }
    }

    // 策略 3：微信特有原创行（如 "原创 差评 2024-05-01" 或 "原创 机器之心" 或 "> 原创 晚点LatePost"）
    const originalPattern = /^(?:>\s*)?(?:[-*+]\s*)?原创\s+([^\s\d\r\n\(\)（）<>[\]*]+)/;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = originalPattern.exec(trimmed);
        if (m) {
            const cleaned = cleanExtractedName(m[1]);
            if (cleaned) return cleaned;
        }
    }

    // 策略 4：剪藏模板链接形式（例如 "- [差评](https://mp.weixin.qq.com/...)" 或 "- [差评 · 微信公众号](https://mp.weixin.qq.com/...)"）
    const linkPattern = /^(?:[-*+]\s*)?\[([^\]]+)\]\(https?:\/\/mp\.weixin\.qq\.com\/[^\)]+\)/i;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = linkPattern.exec(trimmed);
        if (m) {
            let label = m[1].replace(/[·•-]\s*微信公众号.*$/i, "").trim();
            const cleaned = cleanExtractedName(label);
            if (cleaned) return cleaned;
        }
    }

    // 策略 5：宽松的 "作者：xxx"（仅在前 15 行内有效）
    const authorPattern = /^(?:[-*+]\s*)?(?:\*\*)?(?:作者|来源)(?:\*\*)?[：:\s]+(?:\*\*)?([^\r\n*_[\]()]+)(?:\*\*)?$/i;
    for (const line of lines.slice(0, 15)) {
        const trimmed = line.trim();
        const m = authorPattern.exec(trimmed);
        if (m) {
            const cleaned = cleanExtractedName(m[1]);
            if (cleaned) return cleaned;
        }
    }

    return null;
}

const GENERIC_SERIES_BLACKLIST = new Set([
    "合集",
    "话题",
    "专栏",
    "标签",
    "文章合集",
    "更多合集",
    "全部合集",
]);

function cleanSeriesName(raw: string): string | null {
    let name = raw
        .replace(/<[^>]+>/g, " ")
        .replace(/[#＃*_`~[\]()（）]/g, "")
        .replace(/[\r\n\t]+/g, " ")
        .trim();

    // 去除后缀，如 " 12个"、" · 12篇"、" 12"
    name = name.replace(/[·•-]?\s*(?:\d+[个篇条部期]?|合集|专栏)$/, "").trim();
    name = name.replace(/[·•-]$/, "").trim();

    if (!name || name.length < 2 || name.length > 60) return null;
    if (GENERIC_SERIES_BLACKLIST.has(name)) return null;
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) return null;

    return name;
}

/**
 * 从微信剪藏中提取文章所属的合集/话题/专栏名称（Series / Collection）。
 * 例如 "收录于合集 #大模型前沿深度实践 12个" -> "大模型前沿深度实践"
 */
export function extractWechatSeries(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    // 1. HTML 节点匹配
    const tagMatch = /<a[^>]+class=["'][^"']*(?:article_tag_item|album__content_item)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(markdown)
        || /<div[^>]+class=["'][^"']*album__content_item[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(markdown)
        || /<span[^>]+class=["'][^"']*album__read_item[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(markdown);
    if (tagMatch) {
        const cleaned = cleanSeriesName(tagMatch[1]);
        if (cleaned) return cleaned;
    }

    // 2. 正文前 40 行文本匹配
    const lines = markdown.split(/\r?\n/).slice(0, 40);
    const seriesLinePattern = /^(?:[-*+]\s*)?收录于[合话专][集题栏]\s*[#＃]?([^\s#＃\n\r]+)(?:\s+\d+[个篇条部期]?)?/i;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = seriesLinePattern.exec(trimmed);
        if (m) {
            const cleaned = cleanSeriesName(m[1]);
            if (cleaned) return cleaned;
        }
    }

    // 3. 兜底匹配带话题标签的行，如 "#人工智能前沿观察 · 合集"
    const topicPattern = /^(?:[-*+]\s*)?[#＃]([^\s#＃\n\r]+)\s*(?:合集|专栏|专题)/i;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = topicPattern.exec(trimmed);
        if (m) {
            const cleaned = cleanSeriesName(m[1]);
            if (cleaned) return cleaned;
        }
    }

    return null;
}


const WECHAT_NOISE_LINE_PATTERNS: readonly RegExp[] = [
    /^(?:[-*+]\s*)?收录于[合话专][集题栏]\s*#?[^#\n]+#?/i,
    /^(?:[-*+]\s*)?点击上方.*关注.*/i,
    /^(?:[-*+]\s*)?长按二维码.*关注.*/i,
    /^(?:[-*+]\s*)?微信扫一扫.*关注.*/i,
    /^(?:[-*+]\s*)?预览时标签不可点/i,
    /^(?:[-*+]\s*)?喜欢本文.*(?:点赞|在看|转发)/i,
    /^(?:[-*+]\s*)?文章已于.*修改/i,
    /^(?:[-*+]\s*)?本文首发于.*公众号/i,
    /^(?:[-*+]\s*)?后台回复.*?(?:领取|获取|加群|资料).*/i,
    /^(?:[-*+]\s*)?(?:商务合作|投稿联系|入群交流|添加小助手).*/i,
    /^(?:[-*+]\s*)?转载请联系.*?授权.*/i,
    /^(?:[-*+]\s*)?点击(?:下方)?[“"【]?阅读原文[”"】]?.*/i,
    /^(?:[-*+]\s*)?(?:排版设计|排版|美编)\s*[：:]\s*.+/i,
    /^(?:[-*+]\s*)?(?:秀米XIUMI|135编辑器|新媒体管家|壹伴).*/i,
    /^(?:[-*+]\s*)?(?:赞赏作者|喜欢作者|长按赞赏|赞赏支持).*/i,
    /^(?:[-*+]\s*)?阅读原文\s*$/i,
    /^(?:[-*+]\s*)?\[阅读原文\]\(.*\)\s*$/i,
    /^(?:[-*+]\s*)?(?:往期推荐|延伸阅读|推荐阅读|往期精彩|精彩回顾)\s*[:：]?\s*$/i,
    /^(?:[-*+]\s*)?图片来自网络[，,。]?\s*(?:如有侵权.*)?$/i,
];

/**
 * 清洗微信公众号剪藏中的模板噪点行
 */
export function cleanWechatNoise(markdown: string): string {
    if (!markdown) return "";
    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const isNoise = WECHAT_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
        if (!isNoise) {
            result.push(line);
        }
    }
    return result.join("\n");
}

function parseDateTimeParts(raw: string): string | null {
    const cleaned = raw.replace(/[年月日]/g, "-").replace(/\s+/g, " ").trim();
    const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[-/.\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(cleaned);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] ? Number(match[4]) : 0;
    const minute = match[5] ? Number(match[5]) : 0;
    const second = match[6] ? Number(match[6]) : 0;

    if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

    const date = new Date(year, month - 1, day, hour, minute, second);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
    ) {
        return null;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(minute)}${pad(second)}`;
}

/**
 * 从微信剪藏正文/元信息中提取文章发布真实时间
 * 返回符合思源规范的 14 位本地时间字符串 YYYYMMDDHHmmss，失败返回 null。
 */
export function extractWechatTime(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    // 1. HTML 节点 publish_time
    const publishTimeNode = /<em[^>]+id=["']publish_time["'][^>]*>([\s\S]*?)<\/em>/i.exec(markdown);
    if (publishTimeNode) {
        const parsed = parseDateTimeParts(publishTimeNode[1]);
        if (parsed) return parsed;
    }

    // 2. JS 变量 createDate 或 publish_time
    const jsVar = /(?:createDate|publish_time|ct)\s*=\s*['"]([^'"]+)['"]/i.exec(markdown);
    if (jsVar) {
        const parsed = parseDateTimeParts(jsVar[1]);
        if (parsed) return parsed;
    }

    // 3. 前 35 行文本中的时间特征
    const lines = markdown.split(/\r?\n/).slice(0, 35);
    const linePattern = /(?:发布于|发表于|原创\s+[^\n\r]+?)\s+(\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)/;
    const explicitPattern = /^(?:[-*+]\s*)?(?:发布时间|发布于|发表时间|收藏于)[：:\s]+(\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)/;

    for (const line of lines) {
        const trimmed = line.trim();
        const m1 = linePattern.exec(trimmed);
        if (m1) {
            const parsed = parseDateTimeParts(m1[1]);
            if (parsed) return parsed;
        }
        const m2 = explicitPattern.exec(trimmed);
        if (m2) {
            const parsed = parseDateTimeParts(m2[1]);
            if (parsed) return parsed;
        }
    }

    return null;
}

/**
 * 修复微信剪藏正文中由于懒加载导致图片空白的问题：
 * 微信文章通常将真实图片保存在 data-src 属性中，而 src 仅为 1x1 占位透明图。
 * 本函数自动将 data-src 提为真实图片地址，并转换为标准 Markdown 图片。
 */
export function repairWechatImages(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    return markdown.replace(/<img\b([^>]*)>/gi, (fullTag, attrs) => {
        const dataSrcMatch = /\bdata-src=["'](https?:\/\/[^"']+)["']/i.exec(attrs);
        if (!dataSrcMatch) return fullTag;

        const realUrl = dataSrcMatch[1];
        const altMatch = /\balt=["']([^"']*)["']/i.exec(attrs);
        const altText = altMatch ? altMatch[1] : "图片";

        const srcMatch = /(?<![\w-])src=["']([^"']*)["']/i.exec(attrs);
        const currentSrc = srcMatch ? srcMatch[1] : "";

        if (!currentSrc || currentSrc.startsWith("data:") || currentSrc.includes("blank.gif")) {
            return `![${altText}](${realUrl})`;
        }

        return fullTag;
    });
}

/**
 * 从微信文章元信息中提取官方封面图 URL
 */
export function extractWechatCover(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    const metaOg = /<meta[^>]+property=["']og:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i.exec(markdown);
    if (metaOg) return metaOg[1];

    const metaTwitter = /<meta[^>]+name=["'](?:twitter:image|image)["'][^>]+content=["'](https?:\/\/[^"']+)["']/i.exec(markdown);
    if (metaTwitter) return metaTwitter[1];

    const jsCover = /(?:msg_cdn_url|cover)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i.exec(markdown);
    if (jsCover) return jsCover[1];

    return null;
}

/**
 * 从微信文章元信息中提取作者官方填写的简介或引言（作为免调用 AI 的高置信度摘要）
 */
export function extractWechatDescription(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    const metaOg = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i.exec(markdown);
    if (metaOg && metaOg[1].trim()) {
        const text = metaOg[1].replace(/[\r\n\t]+/g, " ").trim();
        if (text && text.length > 2 && text.length <= 300) return text;
    }

    const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(markdown);
    if (metaDesc && metaDesc[1].trim()) {
        const text = metaDesc[1].replace(/[\r\n\t]+/g, " ").trim();
        if (text && text.length > 2 && text.length <= 300) return text;
    }

    const jsDesc = /msg_desc\s*=\s*(?:htmlDecode\()?\s*['"]([^'"]+)['"]/i.exec(markdown);
    if (jsDesc && jsDesc[1].trim()) {
        const text = jsDesc[1].replace(/[\r\n\t]+/g, " ").trim();
        if (text && text.length > 2 && text.length <= 300) return text;
    }

    return null;
}

/**
 * 清洗微信公众号文章链接，剥离所有追踪、环境和会话参数，生成规范的永久短链
 */
export function cleanWechatArticleUrl(rawUrl: string): string {
    if (!rawUrl) return "";
    try {
        const parsed = new URL(rawUrl.trim());
        if (!isWechatUrl(rawUrl)) return rawUrl;

        // /s/xxxx 永久短链形式
        if (parsed.pathname.startsWith("/s/")) {
            return `https://mp.weixin.qq.com${parsed.pathname}`;
        }

        // /s? 形式（旧版动态参数）
        if (parsed.pathname === "/s") {
            const biz = parsed.searchParams.get("__biz");
            const mid = parsed.searchParams.get("mid");
            const idx = parsed.searchParams.get("idx");
            const sn = parsed.searchParams.get("sn");
            if (biz && mid && idx && sn) {
                return `https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=${idx}&sn=${sn}#rd`;
            }
        }

        return rawUrl;
    } catch {
        return rawUrl;
    }
}

/**
 * 转换微信公众号文章为微信读书网页阅读链接
 */
export function wechatArticleToWereadUrl(rawUrl: string): string | null {
    if (!rawUrl || !isWechatUrl(rawUrl)) return null;
    const clean = cleanWechatArticleUrl(rawUrl);
    if (!clean) return null;
    return `https://weread.qq.com/web/reader/${encodeURIComponent(clean)}`;
}

function decodeHtmlEntities(raw: string): string {
    return raw
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

/**
 * 修复微信剪藏中的数学公式：
 * 微信通常将 LaTeX 公式转为包含 data-formula="..." 属性的 <img>、<span> 或 <svg>。
 * 识别 data-formula 属性并还原为标准 Markdown LaTeX 公式（$行内$ 或 $$块级$$）。
 */
export function repairWechatMath(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    // 1. 处理 self-closing <img> 标签中的公式
    let res = markdown.replace(/<img\b([^>]*\bdata-formula=["']([^"']+)["'][^>]*)>(?:\s*<\/img>)?/gi, (match, attrs, formula) => {
        const decoded = decodeHtmlEntities(formula).trim();
        if (!decoded) return match;
        const isBlock = /data-formula-type=["']block["']/i.test(attrs) || /\b(?:block-equation|equation-block)\b/i.test(attrs);
        return isBlock ? `\n\n$$\n${decoded}\n$$\n\n` : `$${decoded}$`;
    });

    // 2. 处理成对的 <span> 或 <svg> 容器标签中的公式
    res = res.replace(/<(span|svg)\b([^>]*\bdata-formula=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/\1>/gi, (match, _tag, attrs, formula) => {
        const decoded = decodeHtmlEntities(formula).trim();
        if (!decoded) return match;
        const isBlock = /data-formula-type=["']block["']/i.test(attrs) || /\b(?:block-equation|equation-block)\b/i.test(attrs);
        return isBlock ? `\n\n$$\n${decoded}\n$$\n\n` : `$${decoded}$`;
    });

    return res;
}

/**
 * 修复微信剪藏中的代码块排版：
 * 微信编辑器常用带有行号 span 或 table 结构的 <pre class="js_dark_code"> 渲染代码，
 * 容易导致行号混入与断行异常。提取语言标记、剔除行号并将代码提取为标准 Markdown 代码块。
 */
export function repairWechatCode(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    return markdown.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (match, attrs, inner) => {
        const isCode = /\b(?:js_dark_code|code-snippet|highlight)\b/i.test(attrs) || /<code\b/i.test(inner);
        if (!isCode) return match;

        const langMatch = /\bdata-lang=["']([^"']+)["']/i.exec(attrs) || /\blanguage-([a-zA-Z0-9_+#-]+)\b/i.exec(attrs) || /\blanguage-([a-zA-Z0-9_+#-]+)\b/i.exec(inner);
        const lang = langMatch ? langMatch[1].toLowerCase() : "";

        // 移除行号标签（例如 code-snippet__line-index / gutter）
        let cleanInner = inner.replace(/<(?:span|li|td)[^>]*\bclass=["'][^"']*(?:line-index|gutter|line-number|linenumber)[^"']*["'][^>]*>[\s\S]*?<\/(?:span|li|td)>/gi, "");

        const codeTagMatch = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(cleanInner);
        if (codeTagMatch) {
            cleanInner = codeTagMatch[1];
        }

        cleanInner = cleanInner
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(?:p|div|li|tr)>/gi, "\n")
            .replace(/<[^>]+>/g, "");

        const decodedCode = decodeHtmlEntities(cleanInner).replace(/\r\n/g, "\n").trim();
        if (!decodedCode) return match;

        return `\n\n\`\`\`${lang}\n${decodedCode}\n\`\`\`\n\n`;
    });
}

/**
 * 修复微信语音条组件（<mpvoice>）：
 * 微信播客或原声朗读在剪藏时多为 <mpvoice> 标签，常丢失播放信息。
 * 转换为结构化 Markdown 音频引述块，保留音频标题与时长线索。
 */
export function repairWechatVoice(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    return markdown.replace(/<mpvoice\b([^>]*)>(?:[\s\S]*?<\/mpvoice>)?/gi, (_match, attrs) => {
        const nameMatch = /\b(?:name|title)=["']([^"']+)["']/i.exec(attrs);
        const name = nameMatch ? decodeHtmlEntities(nameMatch[1]).trim() : "微信原声音频";

        const lenMatch = /\bplay_length=["'](\d+)["']/i.exec(attrs);
        const seconds = lenMatch ? Number(lenMatch[1]) : 0;
        const timeStr = seconds > 0
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : "";

        return `\n\n> 🎙️ **音频**：${name}${timeStr ? ` (${timeStr})` : ""}\n> *（微信内嵌音频组件，可在原文链接中收听完整原声）*\n\n`;
    });
}

/**
 * 抢救微信公众号中通过 CSS background-image 呈现的关键插图与全景长图：
 * 微信复杂排版常将整张信息长图或摄影图放在 <section style="background-image: url(...)"> 中，
 * 普通剪藏转换为 Markdown 时 background-image 往往完全丢失。
 * 本函数提取背景图 URL 并还原为标准 Markdown 插图。
 */
export function repairWechatBackgroundImages(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    const bgPattern = /<(?:section|div)\b([^>]*style=["'][^"']*background-image:\s*url\((?:&quot;|['"])?(https?:\/\/[^"')&]+)(?:&quot;|['"])?\)[^"']*["'][^>]*)>([\s\S]*?)<\/(?:section|div)>/gi;

    return markdown.replace(bgPattern, (fullMatch, _attrs, imgUrl, inner) => {
        if (inner.includes(imgUrl)) return fullMatch;
        const cleanInner = inner.trim();
        return `\n\n![插图](${imgUrl})\n\n${cleanInner ? `${cleanInner}\n\n` : ""}`;
    });
}

/**
 * 修复微信公众号文章中内嵌的腾讯视频与视频号组件：
 * 将微信 <iframe class="video_iframe" ... vid="..."> 或 <mpvideo> 标签
 * 转换为结构化 Markdown 视频引述播放卡片。
 */
export function repairWechatVideos(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";

    let result = markdown.replace(/<iframe\b([^>]*\b(?:video_iframe|v\.qq\.com)[^>]*)>[\s\S]*?<\/iframe>/gi, (_match, attrs) => {
        const vidMatch = /[?&]vid=([a-zA-Z0-9]+)/i.exec(attrs) || /\bvid=["']([a-zA-Z0-9]+)["']/i.exec(attrs);
        if (!vidMatch) return _match;
        const vid = vidMatch[1];
        return `\n\n> 🎬 **内嵌视频**：[在腾讯视频中播放](https://v.qq.com/x/page/${vid}.html)\n\n`;
    });

    result = result.replace(/<mpvideo\b([^>]*)>(?:[\s\S]*?<\/mpvideo>)?/gi, (_match, attrs) => {
        const titleMatch = /\b(?:title|name)=["']([^"']+)["']/i.exec(attrs);
        const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : "微信视频号动态";
        const srcMatch = /\bdata-src=["'](https?:\/\/[^"']+)["']/i.exec(attrs) || /\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(attrs);
        const url = srcMatch ? srcMatch[1] : "";
        return `\n\n> 🎬 **微信视频**：${title}${url ? ` ([观看视频](${url}))` : ""}\n\n`;
    });

    return result;
}

/**
 * 微信文章正文深度清洗与提纯一键入口：
 * 串联执行图片懒加载修复、CSS 背景插图抢救、内嵌视频转换、LaTeX 数学公式还原、代码块提取与语音条组件转换。
 */
export function repairWechatContent(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return "";
    let result = repairWechatImages(markdown);
    result = repairWechatBackgroundImages(result);
    result = repairWechatVideos(result);
    result = repairWechatMath(result);
    result = repairWechatCode(result);
    result = repairWechatVoice(result);
    return result;
}

/**
 * 从微信文章元信息中提取公众号官方头像 URL
 */
export function extractWechatAvatar(markdown: string): string | null {
    if (!markdown || typeof markdown !== "string") return null;

    const roundHeadMatch = /round_head_img\s*=\s*['"](https?:\/\/[^'"]+)['"]/i.exec(markdown);
    if (roundHeadMatch) return roundHeadMatch[1];

    const appHeadMatch = /(?:app_head_img|app_logo)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i.exec(markdown);
    if (appHeadMatch) return appHeadMatch[1];

    const avatarTagMatch = /<(?:img|span)[^>]*\bclass=["'][^"']*(?:profile_avatar|radius_avatar)[^"']*["'][^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i.exec(markdown);
    if (avatarTagMatch) return avatarTagMatch[1];

    return null;
}

/**
 * 从微信文章元信息或链接中提取公众号唯一业务 ID（__biz）
 */
export function extractWechatBiz(markdownOrUrl: string): string | null {
    if (!markdownOrUrl || typeof markdownOrUrl !== "string") return null;

    const urlBizMatch = /[?&]__biz=([a-zA-Z0-9+=/]+)/.exec(markdownOrUrl);
    if (urlBizMatch) return urlBizMatch[1];

    const jsBizMatch = /__biz\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/.exec(markdownOrUrl);
    if (jsBizMatch) return jsBizMatch[1];

    const appuinMatch = /appuin\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/.exec(markdownOrUrl);
    if (appuinMatch) return appuinMatch[1];

    return null;
}



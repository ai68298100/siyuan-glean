/**
 * URL 的唯一比较键（S2/T-1707）。
 *
 * 这是查重用的规范化，不是用户可见 URL 的格式化：调用方仍应把原始
 * URL 写入 custom-clip-url。只接受 http(s)，去掉 hash、默认端口和非根
 * 路径末尾的斜杠；query 的顺序和值保持不变，避免改变来源语义。
 */
export function normalizeUrl(raw: string): string {
    const value = String(raw ?? "").trim();
    if (!value) return "";
    try {
        const parsed = new URL(value);
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== "http:" && protocol !== "https:") return "";
        parsed.protocol = protocol;
        parsed.hostname = parsed.hostname.toLowerCase();
        if ((protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443")) {
            parsed.port = "";
        }
        parsed.hash = "";
        if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
        return parsed.toString();
    } catch {
        return "";
    }
}

const TRACKING_QUERY_PARAMS = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "dclid", "msclkid", "_hsenc", "_hsmi", "mkt_tok",
    "chksm", "mpshare", "scene", "subscene", "clicktime", "enterid", "ascene", "devicetype", "version", "nettype", "lang", "pass_ticket", "wx_header",
    "spm_id_from", "from_source", "from", "vd_source", "share_source", "share_medium"
]);

/**
 * 提取 URL 的权威内容比较键（T-1799 / T-3372）：
 * 1. 基础规范化（协议/域名小写、去掉默认端口、去尾斜杠、去 hash）；
 * 2. 剥离无损分享/推广跟踪参数（如 utm_*、chksm、spm_id_from 等）；
 * 3. 对剩余的合法业务参数按字母排序，生成稳定的内容指纹。
 */
export function canonicalUrlKey(raw: string): string {
    const value = String(raw ?? "").trim();
    if (!value) return "";
    try {
        const parsed = new URL(value);
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== "http:" && protocol !== "https:") return "";
        parsed.protocol = protocol;
        parsed.hostname = parsed.hostname.toLowerCase();
        if ((protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443")) {
            parsed.port = "";
        }
        parsed.hash = "";
        while (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        const entries = [...parsed.searchParams.entries()]
            .filter(([k]) => !TRACKING_QUERY_PARAMS.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_"));
        entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        parsed.search = "";
        for (const [k, v] of entries) {
            parsed.searchParams.append(k, v);
        }
        return parsed.toString();
    } catch {
        return "";
    }
}

export function isSimilarUrl(urlA: string, urlB: string): boolean {
    const keyA = canonicalUrlKey(urlA);
    const keyB = canonicalUrlKey(urlB);
    return Boolean(keyA && keyB && keyA === keyB);
}

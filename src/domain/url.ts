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


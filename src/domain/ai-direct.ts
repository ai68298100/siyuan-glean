/**
 * 自定义 AI 通道域层（T-1300c/方案 B，纯函数）：OpenAI 兼容 chat/completions 的
 * URL 拼接、载荷构造与响应解析。防御式：任何异常形状返回 null 由上层静默降级。
 */

export interface CustomAiConfig {
    baseUrl: string;
    model: string;
    /** 密钥从思源密钥库按名读取（plugin.getSecret），不落插件存储 */
    secretName: string;
}

/** 拼接 chat/completions 端点：容忍尾斜杠与 /v1 后缀缺失提示。 */
export function joinApiUrl(baseUrl: string): string {
    const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    if (/\/chat\/completions$/.test(trimmed)) return trimmed;
    return trimmed + "/chat/completions";
}

export function buildChatPayload(model: string, msg: string): Record<string, unknown> {
    return {
        model: (model || "").trim(),
        messages: [{ role: "user", content: msg }],
        temperature: 0.3,
        stream: false,
    };
}

/** 解析 OpenAI 兼容响应 → 文本；形状不符返回 null。 */
export function parseChatCompletion(json: unknown): string | null {
    if (!json || typeof json !== "object") return null;
    const choices = (json as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const message = (choices[0] as { message?: { content?: unknown } }).message;
    const content = message?.content;
    if (typeof content !== "string" || content.length === 0) return null;
    return content;
}

/** 通道可用性预检（纯判断）：浏览器前端直连会撞 CORS，需降级。 */
export function isDirectChannelAllowed(frontend: string): boolean {
    // mobile/desktop-window/desktop 为 Electron 容器（无 CORS 限制）；browser-* 直连受限
    return !frontend.startsWith("browser");
}

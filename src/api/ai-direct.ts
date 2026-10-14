/**
 * 拾遗专用 AI 通道（方案 B / T-1300c，D-0015）：直连用户配置的 OpenAI 兼容 API。
 * 密钥纪律：apiKey 不落插件存储——按 settings.ai.customSecretName 从思源「密钥和变量」库
 * 经 plugin.getSecret() 运行时读取（内核加密存储）。
 * 降级语义：browser-* 前端直连受 CORS 限制 → 明确错误（上层静默降级并提示）；
 * 密钥为空 → "no-key"；HTTP 非 200 → "http <status>: <msg>"。所有失败不抛裸异常给 UI。
 */
import { getFrontend } from "siyuan";
import { buildChatPayload, joinApiUrl, isDirectChannelAllowed, parseChatCompletion } from "../domain/ai-direct";
import type { GleanSettings } from "../services/settings";

export interface DirectCallResult {
    ok: boolean;
    text?: string;
    reason?: string;
    /** 可读 reason 之外的稳定分类，供 UI 区分配置、权限、网络和响应格式错误。 */
    kind?: "config" | "permission" | "network" | "timeout" | "protocol" | "remote" | "browser";
    status?: number;
}

export interface DirectCallOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    requestKey?: string;
}

const directFlights = new Map<string, Promise<DirectCallResult>>();
const pluginIdentities = new WeakMap<object, number>();
let nextPluginIdentity = 1;

function pluginIdentity(plugin: object): number {
    let identity = pluginIdentities.get(plugin);
    if (identity === undefined) {
        identity = nextPluginIdentity++;
        pluginIdentities.set(plugin, identity);
    }
    return identity;
}

async function fingerprintSecret(secret: string): Promise<string | null> {
    try {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) return null;
        const digest = await subtle.digest("SHA-256", new TextEncoder().encode(secret));
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
        return null;
    }
}

function directTimeoutMs(options: DirectCallOptions): number {
    return Number.isFinite(options.timeoutMs) ? Math.min(180_000, Math.max(1_000, options.timeoutMs!)) : 60_000;
}

async function readSecret(plugin: { getSecret?: (name: string) => string }, secretName: string): Promise<string> {
    try {
        return plugin?.getSecret?.(secretName) ?? "";
    } catch {
        return "";
    }
}

/** 直连调用 OpenAI 兼容 chat/completions。 */
export async function chatCompletionDirect(
    plugin: { getSecret?: (name: string) => string },
    settings: GleanSettings,
    msg: string,
    options: DirectCallOptions = {},
): Promise<DirectCallResult> {
    const { customBaseUrl, customModel, customSecretName } = settings.ai;
    const url = joinApiUrl(customBaseUrl);
    if (!url) return { ok: false, reason: "no-base-url", kind: "config" };
    if (!customModel.trim()) return { ok: false, reason: "no-model", kind: "config" };
    const frontend = getFrontend();
    if (!isDirectChannelAllowed(frontend)) {
        return { ok: false, reason: "browser-cors", kind: "browser" };
    }
    const apiKey = await readSecret(plugin, customSecretName);
    if (!apiKey) return { ok: false, reason: "no-key", kind: "config" };

    // Signal-bound calls have independent cancellation ownership and cannot share a flight.
    // Scope the remaining coalescing key to both plugin and credential without retaining the raw secret.
    const secretFingerprint = options.signal ? null : await fingerprintSecret(apiKey);
    const requestKey = secretFingerprint
        ? JSON.stringify([pluginIdentity(plugin), secretFingerprint, url, customModel.trim(), msg, directTimeoutMs(options), options.requestKey?.trim() ?? ""])
        : null;
    const running = requestKey ? directFlights.get(requestKey) : undefined;
    if (running) return running;
    const request = directChatOnce(url, customModel, msg, apiKey, options);
    if (!requestKey) return request;
    directFlights.set(requestKey, request);
    void request.then(() => undefined, () => undefined).finally(() => {
        if (directFlights.get(requestKey) === request) directFlights.delete(requestKey);
    });
    return request;
}

async function directChatOnce(url: string, model: string, msg: string, apiKey: string, options: DirectCallOptions): Promise<DirectCallResult> {
    const timeoutMs = directTimeoutMs(options);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => controller.abort();
    try {
        if (options.signal?.aborted) return { ok: false, reason: "aborted", kind: "network" };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(buildChatPayload(model, msg)),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 160);
            const kind = response.status === 401 || response.status === 403 ? "permission" : "remote";
            return { ok: false, reason: `http ${response.status}: ${detail}`, kind, status: response.status };
        }
        const parsed = parseChatCompletion(await response.json());
        if (parsed === null) return { ok: false, reason: "parse", kind: "protocol" };
        return { ok: true, text: parsed };
    } catch (error) {
        if (options.signal?.aborted) return { ok: false, reason: "aborted", kind: "network" };
        if (controller.signal.aborted) return { ok: false, reason: "timeout", kind: "timeout" };
        const message = String((error as Error)?.message ?? error).slice(0, 160);
        const kind = (error as { name?: string })?.name === "TimeoutError" || /timeout|timed out|超时/iu.test(message)
            ? "timeout"
            : "network";
        return { ok: false, reason: message, kind };
    } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
    }
}

/** 连接测试（设置页"测试"按钮）：发一句 ping，返回人类可读结果。 */
export async function testDirectChannel(
    plugin: { getSecret?: (name: string) => string },
    settings: GleanSettings
): Promise<{ ok: boolean; message: string }> {
    const result = await chatCompletionDirect(plugin, settings, '请只回复两个字："正常"');
    if (result.ok) return { ok: true, message: result.text!.slice(0, 40) };
    const reasons: Record<string, string> = {
        "no-base-url": "未填写 API 地址",
        "no-model": "未填写模型名",
        "no-key": `密钥库中未找到「${settings.ai.customSecretName}」，请在思源 设置→密钥和变量 里创建`,
        "browser-cors": "浏览器挂载端直连受限（CORS），请在桌面端使用",
        parse: "响应格式不符合 OpenAI 兼容规范",
    };
    if (result.kind === "permission") return { ok: false, message: "API 返回未授权（401/403），请检查密钥和服务权限" };
    if (result.kind === "timeout") return { ok: false, message: "AI 服务响应超时，请检查网络或稍后重试" };
    if (result.kind === "network") return { ok: false, message: "无法连接 AI 服务，请检查地址、网络和 HTTPS 设置" };
    if (result.kind === "remote") return { ok: false, message: `AI 服务返回 HTTP ${result.status ?? "错误"}，请查看服务端状态后重试` };
    return { ok: false, message: reasons[result.reason ?? ""] ?? result.reason ?? "未知错误" };
}

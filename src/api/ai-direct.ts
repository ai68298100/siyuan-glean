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
    msg: string
): Promise<DirectCallResult> {
    const { customBaseUrl, customModel, customSecretName } = settings.ai;
    const url = joinApiUrl(customBaseUrl);
    if (!url) return { ok: false, reason: "no-base-url" };
    if (!customModel.trim()) return { ok: false, reason: "no-model" };
    const frontend = getFrontend();
    if (!isDirectChannelAllowed(frontend)) {
        return { ok: false, reason: "browser-cors" };
    }
    const apiKey = await readSecret(plugin, customSecretName);
    if (!apiKey) return { ok: false, reason: "no-key" };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(buildChatPayload(customModel, msg)),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 160);
            return { ok: false, reason: `http ${response.status}: ${detail}` };
        }
        const parsed = parseChatCompletion(await response.json());
        if (parsed === null) return { ok: false, reason: "parse" };
        return { ok: true, text: parsed };
    } catch (error) {
        return { ok: false, reason: String((error as Error)?.message ?? error).slice(0, 160) };
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
    return { ok: false, message: reasons[result.reason ?? ""] ?? result.reason ?? "未知错误" };
}

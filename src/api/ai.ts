/**
 * AI 端点层（T-1300/T-1302，v3.8.5 契约已在内核源码核实）：
 * - chatGPT 请求是 **{msg: string}** 单字符串（apicontract.AIMessageRequest），响应 data 为字符串
 * - editor 动作三件：lsActions（NoBody→{id,name,action}[]）/ saveAction {id?,name,action} / removeAction {id}
 * 无模型配置时内核返回非 0 code——调用方必须静默降级（D-0004），此处不吞错误。
 */
import { kernelPost } from "./client";

/** 调用用户已配置的模型。msg 为完整 prompt；失败抛错由上层降级。 */
export async function chatGPT(msg: string): Promise<string> {
    return kernelPost<string>("/api/ai/chatGPT", { msg });
}

export interface AIEditorAction {
    id: string;
    name: string;
    action: string;
}

export async function listAIEditorActions(): Promise<AIEditorAction[]> {
    const data = await kernelPost<AIEditorAction[]>("/api/ai/editor/lsActions", {});
    return Array.isArray(data) ? data : [];
}

/** id 传空串即新建动作。 */
export async function saveAIEditorAction(id: string, name: string, action: string): Promise<AIEditorAction> {
    return kernelPost<AIEditorAction>("/api/ai/editor/saveAction", { id, name, action });
}

export async function removeAIEditorAction(id: string): Promise<void> {
    await kernelPost("/api/ai/editor/removeAction", { id });
}

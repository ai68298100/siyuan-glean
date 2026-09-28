/**
 * 预置 AI 动作（T-1302）：总结 / 要点 / 反方观点。
 * 走内核 editor/lsActions + saveAction 持久化（出现在思源 AI 菜单里）；
 * 幂等：按名称找回已存在的动作（复用其 id，用户可改 prompt，插件不覆盖已改内容）。
 * 开关关闭时不删除用户已有的动作（避免误伤），只停止补建。
 */
import { listAIEditorActions, saveAIEditorAction } from "../api/ai";

export interface PresetActionDef {
    name: string;
    action: string;
}

export const PRESET_ACTIONS: PresetActionDef[] = [
    {
        name: "拾遗 · 总结",
        action: "请总结这篇文章的核心内容，用中文输出：先用一句话概括主旨，然后列出 3-5 个要点。保持克制，不要展开评论。",
    },
    {
        name: "拾遗 · 要点",
        action: "请提取这篇文章的所有关键要点，用中文以无序列表输出，每条一句话，按重要性排序。不要添加文中没有的信息。",
    },
    {
        name: "拾遗 · 反方观点",
        action: "请站在反方立场审视这篇文章：列出文中论点可能存在的漏洞、未被考虑的因素与相反证据。用中文输出，态度克制、就事论事。",
    },
];

export interface EnsureActionsResult {
    created: number;
    /** 用户已存在（或改过 prompt）的动作名 */
    kept: string[];
}

export async function ensurePresetActions(): Promise<EnsureActionsResult> {
    const existing = await listAIEditorActions();
    const byName = new Map(existing.map((action) => [action.name, action]));
    let created = 0;
    const kept: string[] = [];
    for (const preset of PRESET_ACTIONS) {
        const found = byName.get(preset.name);
        if (found) {
            kept.push(preset.name);
            continue;
        }
        await saveAIEditorAction("", preset.name, preset.action);
        created += 1;
    }
    return { created, kept };
}

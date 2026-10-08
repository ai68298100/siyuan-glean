/**
 * AI 标签规范化服务（T-1761）：扫描全库 AI 标签 → 相似组建议 → 用户逐组确认后合并。
 * ai-tags 不是手填保护字段（D-0013），但合并是显式用户动作：展示组内全部变体（diff）后才写。
 * 写入统一经 clip-store.writeClip（aiTags 序列化为逗号串），成功后增量同步索引。
 */
import type { Plugin } from "siyuan";
import { findSimilarTagGroups, type AiTagMergeSuggestion } from "../domain/enrich";
import { loadIndex } from "./index-store";
import { writeClip } from "./clip-store";

export interface AiTagMergePlan extends AiTagMergeSuggestion {
    /** 会受到合并影响的文档篇数 */
    affected: number;
}

/** 扫描索引内全部 AI 标签，返回相似组合并建议（含影响篇数）。不写任何东西。 */
export async function suggestAiTagMerges(plugin: Plugin): Promise<AiTagMergePlan[]> {
    const index = await loadIndex(plugin);
    const byTag = new Map<string, string[]>();
    for (const clip of Object.values(index.clips)) {
        for (const tag of clip.aiTags) {
            const bucket = byTag.get(tag);
            if (bucket) bucket.push(clip.id);
            else byTag.set(tag, [clip.id]);
        }
    }
    const suggestions = findSimilarTagGroups([...byTag.keys()]);
    return suggestions.map((suggestion) => {
        const affectedIds = new Set<string>();
        for (const variant of suggestion.variants) {
            for (const id of byTag.get(variant) ?? []) affectedIds.add(id);
        }
        return { ...suggestion, affected: affectedIds.size };
    });
}

/**
 * 应用一组合并：组内除 keep 外的全部变体替换为 keep，逐篇写回（aiTags 全量替换语义）。
 * 返回实际写成功的文档篇数；单篇失败不阻断。
 */
export async function applyAiTagMerge(plugin: Plugin, variants: string[], keep: string): Promise<number> {
    if (!keep.trim() || variants.length === 0 || !variants.includes(keep)) return 0;
    const index = await loadIndex(plugin);
    const from = new Set(variants.filter((variant) => variant !== keep));
    let ok = 0;
    for (const clip of Object.values(index.clips)) {
        if (!clip.aiTags.some((tag) => from.has(tag))) continue;
        const nextTags = clip.aiTags
            .map((tag) => (from.has(tag) ? keep : tag))
            .filter((tag, position, all) => all.indexOf(tag) === position);
        try {
            await writeClip(plugin, clip.id, { aiTags: nextTags });
            ok += 1;
        } catch {
            // 单篇失败不阻断；UI 通过刷新反映真实状态
        }
    }
    return ok;
}

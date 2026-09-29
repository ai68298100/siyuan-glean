/**
 * 闪卡端点层（T-1502，契约内核源码+spike ⑧ 双实证）：
 * - createRiffDeck {name} → deck 数据；getRiffDecks {} → deck 列表
 * - addRiffCards {deckID, blockIDs[]} —— block 必须已存在（内核 ValidateFlashcardBlockIDs），
 *   列表项（type='i'）为标准闪卡块：父级内容=正面，嵌套子列表=背面
 */
import { kernelPost } from "./client";

export interface RiffDeck {
    id: string;
    name: string;
    size?: number;
}

export async function getRiffDecks(): Promise<RiffDeck[]> {
    const data = await kernelPost<RiffDeck[]>("/api/riff/getRiffDecks", {});
    return Array.isArray(data) ? data : [];
}

export async function createRiffDeck(name: string): Promise<RiffDeck> {
    return kernelPost<RiffDeck>("/api/riff/createRiffDeck", { name });
}

export async function addRiffCards(deckID: string, blockIDs: string[]): Promise<RiffDeck> {
    return kernelPost<RiffDeck>("/api/riff/addRiffCards", { deckID, blockIDs });
}

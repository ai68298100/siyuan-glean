/**
 * TTS 朗读域层（T-1744，纯函数）：长文分块切句。
 * Web Speech API 的 utterance 过长会被部分引擎静默截断，按句切分逐块朗读；
 * 混排标点（中英）都作为切分点，块长上限内尽量合并。
 */

export const SPEECH_CHUNK_MAX = 220;

/** 按句子边界切分并合并到上限内：切分点为 。！？；…!?; 与换行。 */
export function chunkTextForSpeech(text: string, maxLength = SPEECH_CHUNK_MAX): string[] {
    const source = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!source) return [];
    const sentences = source
        .split(/(?<=[。！？；…!?;])|\n/)
        .map((part) => part.trim())
        .filter(Boolean);
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
        // 单句超上限时按硬上限再切，避免超长 utterance
        if (sentence.length > maxLength) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            for (let offset = 0; offset < sentence.length; offset += maxLength) {
                chunks.push(sentence.slice(offset, offset + maxLength));
            }
            continue;
        }
        if (current && current.length + sentence.length + 1 > maxLength) {
            chunks.push(current);
            current = sentence;
        } else {
            current = current ? `${current}${sentence}` : sentence;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/** TTS 可用性：Electron/浏览器端 window.speechSynthesis 存在即认为可用；Node/异常环境降级为不可用。 */
export function speechSupported(synthesis: unknown): boolean {
    return typeof synthesis === "object" && synthesis !== null;
}

/** 语速档位（T-1744）：循环切换。 */
export const SPEECH_RATES = [1, 1.25, 1.5, 0.75] as const;

export function nextSpeechRate(current: number): number {
    const index = SPEECH_RATES.findIndex((rate) => Math.abs(rate - current) < 0.01);
    return SPEECH_RATES[(index + 1 + SPEECH_RATES.length) % SPEECH_RATES.length];
}

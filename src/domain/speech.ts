export const SPEECH_CHUNK_MAX_LENGTH = 220;

export function normalizeSpeechText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function chunkSpeechText(text: string, maxLength = SPEECH_CHUNK_MAX_LENGTH): string[] {
    if (!Number.isInteger(maxLength) || maxLength < 1) return [];
    const normalized = normalizeSpeechText(text);
    if (!normalized) return [];

    const sentences = normalized.match(/[^。！？!?；;：:.]+[。！？!?；;：:.]?/g) ?? [normalized];
    const chunks: string[] = [];
    let current = "";

    const flush = () => {
        if (current) chunks.push(current);
        current = "";
    };

    for (const sentence of sentences) {
        if (Array.from(sentence).length > maxLength) {
            flush();
            const characters = Array.from(sentence);
            for (let index = 0; index < characters.length; index += maxLength) {
                chunks.push(characters.slice(index, index + maxLength).join(""));
            }
            continue;
        }

        const candidate = current ? `${current} ${sentence}` : sentence;
        if (Array.from(candidate).length <= maxLength) {
            current = candidate;
        } else {
            flush();
            current = sentence;
        }
    }
    flush();
    return chunks;
}

export function clampSpeechRate(rate: number): number {
    if (!Number.isFinite(rate)) return 1;
    return Math.min(1.5, Math.max(0.75, Math.round(rate * 4) / 4));
}

export function speechLanguage(text: string): "zh-CN" | "en-US" {
    const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
    const latinCharacters = (text.match(/[A-Za-z]/g) ?? []).length;
    return chineseCharacters >= latinCharacters ? "zh-CN" : "en-US";
}

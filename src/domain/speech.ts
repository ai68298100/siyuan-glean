export const SPEECH_CHUNK_MAX_LENGTH = 220;

export function normalizeSpeechText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function chunkSpeechText(text: string, maxLength = SPEECH_CHUNK_MAX_LENGTH): string[] {
    if (!Number.isInteger(maxLength) || maxLength < 1) return [];
    const normalized = normalizeSpeechText(text);
    if (!normalized) return [];

    // 小数点不是句尾：先把"数字.数字"里的点换成占位符，切分后还原，
    // 否则 "3.14" 会被切成 "3." / "14" 并在回拼时插进空格
    const DECIMAL_GUARD = "\u0000";
    const guarded = normalized.replace(/(\d)\.(\d)/g, `$1${DECIMAL_GUARD}$2`);
    const sentences = (guarded.match(/[^。！？!?；;：:.]+[。！？!?；;：:.]?/g) ?? [guarded])
        .map((part) => part.split(DECIMAL_GUARD).join("."));
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

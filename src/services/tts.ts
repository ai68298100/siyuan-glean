/**
 * TTS 朗读服务（T-1744）：Web Speech API（Electron 内走系统 TTS，调研确认离线可用）。
 * 会话级能力：不写任何属性、无任何持久化（纯视图行为）。
 * 可用性探测降级：无 speechSynthesis（Node/异常环境）时全部操作静默为空操作，UI 隐藏入口。
 * 真机朗读效果（voice 选择、CJK 断句、语速）随 B-0002/B-0004 验收。
 */
import { chunkTextForSpeech, speechSupported } from "../domain/tts";

interface SpeechSynthesisLike {
    speak(utterance: unknown): void;
    cancel(): void;
    pause(): void;
    resume(): void;
    speaking: boolean;
    paused: boolean;
}

interface SpeechUtteranceCtor {
    new (text: string): {
        text: string;
        lang: string;
        rate: number;
        onend: (() => void) | null;
        onerror: (() => void) | null;
    };
}

function synthesis(): SpeechSynthesisLike | null {
    try {
        const candidate = (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
        if (!speechSupported(candidate)) return null;
        return candidate as SpeechSynthesisLike;
    } catch {
        return null;
    }
}

function utteranceCtor(): SpeechUtteranceCtor | null {
    try {
        const ctor = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
        if (typeof ctor !== "function") return null;
        return ctor as SpeechUtteranceCtor;
    } catch {
        return null;
    }
}

/** 环境是否具备朗读能力（UI 据此显示/隐藏入口）。 */
export function ttsAvailable(): boolean {
    return synthesis() !== null && utteranceCtor() !== null;
}

export interface SpeakHandle {
    /** 停止并清空队列 */
    stop(): void;
    /** 朗读是否仍在进行（含排队块） */
    active(): boolean;
}

/**
 * 朗读文本：按句分块顺序朗读（避免超长 utterance 被引擎截断）。
 * rate 为语速倍率；onDone 在全部块读完或被停止时回调。
 * 无法定位语言时交给引擎按文本自动判定（不臆造 voice 选择）。
 */
export function speakText(text: string, rate: number, onDone?: () => void): SpeakHandle {
    const synth = synthesis();
    const Utterance = utteranceCtor();
    if (!synth || !Utterance) {
        onDone?.();
        return { stop: () => undefined, active: () => false };
    }
    synth.cancel();
    const chunks = chunkTextForSpeech(text);
    let stopped = false;
    let index = 0;

    const speakNext = (): void => {
        if (stopped) return;
        if (index >= chunks.length) {
            onDone?.();
            return;
        }
        const utterance = new Utterance(chunks[index]);
        utterance.lang = "zh-CN";
        utterance.rate = rate;
        utterance.onend = () => {
            index += 1;
            speakNext();
        };
        utterance.onerror = () => {
            index += 1;
            speakNext();
        };
        synth.speak(utterance);
    };
    speakNext();

    return {
        stop: () => {
            stopped = true;
            synth.cancel();
            onDone?.();
        },
        active: () => !stopped && (index < chunks.length || synth.speaking),
    };
}

export function stopSpeaking(): void {
    synthesis()?.cancel();
}

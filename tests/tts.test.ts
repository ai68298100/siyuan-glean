/** domain/tts 分句与语速档位单测（T-1744） */
import test from "node:test";
import assert from "node:assert/strict";

import { chunkTextForSpeech, nextSpeechRate, speechSupported, SPEECH_RATES } from "../src/domain/tts.ts";
import { clampSpeechRate, resumeSpeechChunkIndex } from "../src/domain/speech.ts";

test("chunkTextForSpeech：按中英句边界切分并合并到上限", () => {
    const chunks = chunkTextForSpeech("第一句话。第二句话！Third sentence? 最后；", 50);
    assert.deepEqual(chunks, ["第一句话。第二句话！Third sentence?最后；"]);
});

test("chunkTextForSpeech：单句超上限硬切，空白压缩，空输入空数组", () => {
    const long = "字".repeat(500);
    const chunks = chunkTextForSpeech(long, 220);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 220);
    assert.deepEqual(chunkTextForSpeech("   "), []);
    assert.deepEqual(chunkTextForSpeech("压缩  多个   空白", 50), ["压缩 多个 空白"]);
});

test("speechSupported：仅对象形态的 speechSynthesis 视为可用", () => {
    assert.equal(speechSupported({}), true);
    assert.equal(speechSupported(undefined), false);
    assert.equal(speechSupported(null), false);
});

test("nextSpeechRate：默认档循环 1→1.25→1.5→0.75→1", () => {
    assert.equal(nextSpeechRate(1), 1.25);
    assert.equal(nextSpeechRate(1.5), 0.75);
    assert.equal(nextSpeechRate(0.75), 1);
    assert.equal(nextSpeechRate(2), 1); // 未知档回默认
    assert.equal(SPEECH_RATES.length, 4);
});

test("resumeSpeechChunkIndex：在合法分块内接续，越界或空分块安全回退为 0（T-3337 / T-3383）", () => {
    const chunks = ["第一句", "第二句", "第三句"];
    assert.equal(resumeSpeechChunkIndex(chunks, 0), 0);
    assert.equal(resumeSpeechChunkIndex(chunks, 1), 1);
    assert.equal(resumeSpeechChunkIndex(chunks, 2), 2);

    // 越界或负数回退为 0
    assert.equal(resumeSpeechChunkIndex(chunks, 3), 0);
    assert.equal(resumeSpeechChunkIndex(chunks, 99), 0);
    assert.equal(resumeSpeechChunkIndex(chunks, -1), 0);
    assert.equal(resumeSpeechChunkIndex([], 0), 0);
});

test("clampSpeechRate：语速限制在 0.75 到 1.5 范围并四舍五入到 0.25 步长", () => {
    assert.equal(clampSpeechRate(1), 1);
    assert.equal(clampSpeechRate(1.23), 1.25);
    assert.equal(clampSpeechRate(2.5), 1.5);
    assert.equal(clampSpeechRate(0.2), 0.75);
    assert.equal(clampSpeechRate(Number.NaN), 1);
});

/** domain/reader 纯函数单测（T-1730d/e，D-0030）：摘录 DOM 与伴读 prompt。 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildQuoteBlockDom,
    buildSummarizePrompt,
    buildTranslatePrompt,
    clampExcerpt,
    EXCERPT_MAX_LENGTH,
} from "../src/domain/reader.ts";
import { chunkSpeechText, clampSpeechRate, normalizeSpeechText, speechLanguage } from "../src/domain/speech.ts";
import { readerShortcut, type ReaderKeyInput, type ReaderShortcut } from "../src/domain/reader-shortcuts.ts";
import { createLatestRequestGate } from "../src/libs/latest-request.ts";

const escape = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

test("clampExcerpt：压缩空白并截断", () => {
    assert.equal(clampExcerpt("  a\n\n b  "), "a b");
    assert.equal(clampExcerpt("x".repeat(EXCERPT_MAX_LENGTH + 10)).length, EXCERPT_MAX_LENGTH);
    assert.equal(clampExcerpt("   "), "");
});

test("buildQuoteBlockDom：引述块 DOM，逐行段落，空文本拒绝", () => {
    const dom = buildQuoteBlockDom("第一行\n\n第二行 <b>", escape);
    assert.ok(dom.startsWith('<div data-type="NodeBlockquote" class="bq">'));
    assert.ok(dom.includes(escape("第一行")));
    assert.ok(dom.includes("&lt;b&gt;"));
    assert.equal((dom.match(/NodeParagraph/g) ?? []).length, 2);
    assert.equal(buildQuoteBlockDom("   \n  ", escape), "");
});

test("buildSummarizePrompt / buildTranslatePrompt：只输出正文的指令式 prompt", () => {
    const summarize = buildSummarizePrompt("深度文章", "正文内容");
    assert.ok(summarize.includes("《深度文章》"));
    assert.ok(summarize.includes("正文内容"));
    assert.ok(!buildSummarizePrompt("", "内容").includes("《》"));
    const translate = buildTranslatePrompt("hello world");
    assert.ok(translate.includes("hello world"));
    assert.ok(translate.includes("只输出译文"));
});

test("speech：规范化文本并按句子拆分，长句不会超过上限", () => {
    assert.equal(normalizeSpeechText("  第一行\n\n 第二行  "), "第一行 第二行");
    assert.deepEqual(chunkSpeechText("第一句。第二句！", 20), ["第一句。 第二句！"]);
    assert.deepEqual(chunkSpeechText("一二三四五六七八", 3), ["一二三", "四五六", "七八"]);
});

test("speech：朗读速度限制在支持的档位", () => {
    assert.equal(clampSpeechRate(Number.NaN), 1);
    assert.equal(clampSpeechRate(0.1), 0.75);
    assert.equal(clampSpeechRate(1.13), 1.25);
    assert.equal(clampSpeechRate(2), 1.5);
});

test("speech：按当前段落选择中英文 voice 语言", () => {
    assert.equal(speechLanguage("这是中文文章"), "zh-CN");
    assert.equal(speechLanguage("This is an English article"), "en-US");
});

const readerKey: ReaderKeyInput = { key: "j", mode: "read", focused: true, blocked: false };

test("阅读单键：只在当前阅读页签焦点内执行映射", () => {
    const mappings: Array<[string, ReaderShortcut]> = [
        ["j", "scrollDown"], ["k", "scrollUp"], ["e", "edit"],
        ["m", "done"], ["x", "excerpt"], ["?", "help"],
    ];
    for (const [key, action] of mappings) {
        assert.equal(readerShortcut({ ...readerKey, key }), action);
        assert.equal(readerShortcut({ ...readerKey, key, focused: false }), null);
        assert.equal(readerShortcut({ ...readerKey, key, mode: "edit" }), null);
        assert.equal(readerShortcut({ ...readerKey, key, blocked: true }), null);
    }
    for (const key of ["J", "M", "Enter", "ArrowDown", " ", "/", "Escape", "Unidentified"]) {
        assert.equal(readerShortcut({ ...readerKey, key }), null);
    }
});

test("阅读单键：IME、宿主已处理事件和组合修饰键不会写入或滚动", () => {
    for (const patch of [
        { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
        { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    ]) {
        for (const key of ["j", "k", "e", "m", "x"]) {
            assert.equal(readerShortcut({ ...readerKey, key, ...patch }), null);
        }
    }
    assert.equal(readerShortcut({ ...readerKey, key: "?", shiftKey: true }), "help");
    assert.equal(readerShortcut({ ...readerKey, key: "?", shiftKey: true, ctrlKey: true }), null);
});

test("阅读单键：长按只允许滚动，不重复状态、编辑和摘录动作", () => {
    assert.equal(readerShortcut({ ...readerKey, repeat: true }), "scrollDown");
    assert.equal(readerShortcut({ ...readerKey, key: "k", repeat: true }), "scrollUp");
    for (const key of ["e", "m", "x", "?"]) {
        assert.equal(readerShortcut({ ...readerKey, key, repeat: true }), null);
    }
});

test("上下文请求：迟到的旧文响应不能覆盖新文，卸载使当前请求失效", async () => {
    const requests = createLatestRequestGate();
    let displayed = "";
    let completeOld: (value: string) => void = () => undefined;
    const oldResponse = new Promise<string>((resolve) => { completeOld = resolve; });
    const oldCurrent = requests.begin();
    const oldRead = oldResponse.then((value) => { if (oldCurrent()) displayed = value; });
    const newCurrent = requests.begin();
    if (newCurrent()) displayed = "new-document";
    completeOld("old-document");
    await oldRead;
    assert.equal(displayed, "new-document");
    requests.invalidate();
    assert.equal(newCurrent(), false);
    assert.equal(requests.begin()(), true);
    assert.equal(oldCurrent(), false);
});

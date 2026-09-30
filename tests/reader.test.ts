/** domain/reader 纯函数单测（T-1730d/e，D-0030）：摘录 DOM 与伴读 prompt。 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildAskPrompt,
    buildQuoteBlockDom,
    buildSummarizePrompt,
    buildTranslatePrompt,
    clampAskQuestion,
    clampExcerpt,
    EXCERPT_MAX_LENGTH,
} from "../src/domain/reader.ts";

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

test("buildAskPrompt：限定本文上下文 + 单轮问题（T-1760）", () => {
    const prompt = buildAskPrompt("深度文章", "正文内容……", "作者的主要论点是什么？");
    assert.ok(prompt.includes("《深度文章》"));
    assert.ok(prompt.includes("正文内容……"));
    assert.ok(prompt.includes("问题：作者的主要论点是什么？"));
    assert.ok(prompt.includes("只能回答文章相关内容"));
    // 空问题回退为默认问句
    assert.ok(buildAskPrompt("", "正文", "  ").includes("问题：这篇文章讲了什么？"));
    // 问题截断到 500
    assert.ok(buildAskPrompt("", "正文", "x".repeat(600)).length < 900);
});

test("clampAskQuestion：压缩空白并截断", () => {
    assert.equal(clampAskQuestion("  a   b  "), "a b");
    assert.equal(clampAskQuestion("x".repeat(600)).length, 500);
});

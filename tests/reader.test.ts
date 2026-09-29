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

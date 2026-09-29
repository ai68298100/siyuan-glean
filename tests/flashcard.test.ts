/** domain/flashcard 纯函数单测（T-1502） */
import test from "node:test";
import assert from "node:assert/strict";

import { buildFlashcardDom, buildQuoteCard, escapeDomText } from "../src/domain/flashcard.ts";

test("buildQuoteCard：front 截 60 字 + back 含来源", () => {
    const card = buildQuoteCard("深度学习入门", "这是一段" + "很长的".repeat(30) + "引文。");
    assert.ok(card.front.startsWith("「"));
    assert.ok(card.front.endsWith("」——还记得它出自哪篇文章、讲什么吗？"));
    assert.ok(card.front.length <= 90); // 57 字引文 + 包装
    assert.ok(card.back.includes("《深度学习入门》"));
    assert.ok(card.back.includes("引文。"));
});

test("buildQuoteCard：短引文不截断，无标题退化为通用来源", () => {
    const card = buildQuoteCard("", "简短引文");
    assert.equal(card.front, "「简短引文」——还记得它出自哪篇文章、讲什么吗？");
    assert.ok(card.back.startsWith("来源文章"));
});

test("buildQuoteCard：空白归一", () => {
    const card = buildQuoteCard("t", "  多   段\n空白  ");
    assert.ok(card.back.includes("多 段 空白"));
});

test("escapeDomText：尖括号与引号", () => {
    assert.equal(escapeDomText('<a href="x">&y</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;");
});

test("buildFlashcardDom：列表项结构 + 转义生效", () => {
    const dom = buildFlashcardDom("front <b>", 'back "q"');
    assert.ok(dom.includes('data-type="NodeListItem"'));
    assert.ok(dom.includes("front &lt;b&gt;"));
    assert.ok(dom.includes('back &quot;q&quot;'));
    assert.ok(!dom.includes("data-node-id")); // Lute 自动分配
    // 结构平衡：开闭 div 数量一致
    const opens = (dom.match(/<div /g) ?? []).length;
    const closes = (dom.match(/<\/div>/g) ?? []).length;
    assert.equal(opens, closes);
});

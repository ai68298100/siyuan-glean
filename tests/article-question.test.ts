import test from "node:test";
import assert from "node:assert/strict";
import {
    ARTICLE_QUESTION_CONTEXT_MAX_LENGTH,
    ARTICLE_QUESTION_MAX_LENGTH,
    buildArticleQuestionPrompt,
    clampArticleQuestion,
    parseArticleQuestionResponse,
} from "../src/domain/reader.ts";

test("本文问答问题和上下文有明确上限", () => {
    assert.equal(clampArticleQuestion("x".repeat(ARTICLE_QUESTION_MAX_LENGTH + 20)).length, ARTICLE_QUESTION_MAX_LENGTH);
    const prompt = buildArticleQuestionPrompt("标题", "正文", "问题", false);
    assert.match(prompt, /只输出 JSON/);
    assert.match(prompt, /正文/);
    assert.doesNotMatch(prompt, /上下文已截断/);
    assert.equal(buildArticleQuestionPrompt("", "x", "q", true).includes("上下文已截断"), true);
    assert.equal(ARTICLE_QUESTION_CONTEXT_MAX_LENGTH > ARTICLE_QUESTION_MAX_LENGTH, true);
});

test("本文问答只接受带逐字依据的 JSON", () => {
    const context = "第一段说明核心结论。第二段补充限制。";
    assert.deepEqual(parseArticleQuestionResponse(JSON.stringify({ answer: "核心结论", evidence: ["第一段说明核心结论。"], insufficient: false }), context), {
        answer: "核心结论", evidence: ["第一段说明核心结论。"], insufficient: false,
    });
    assert.deepEqual(parseArticleQuestionResponse("```json\n{\"answer\":\"依据不足\",\"evidence\":[],\"insufficient\":true}\n```", context), {
        answer: "依据不足", evidence: [], insufficient: true,
    });
    assert.equal(parseArticleQuestionResponse(JSON.stringify({ answer: "猜测", evidence: ["上下文没有这句话"], insufficient: false }), context), null);
    assert.equal(parseArticleQuestionResponse(JSON.stringify({ answer: "缺依据", evidence: [], insufficient: false }), context), null);
    assert.equal(parseArticleQuestionResponse("不是 JSON", context), null);
});

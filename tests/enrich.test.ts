/** domain/enrich 纯函数单测（T-1300） */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildAuthorPrompt,
    buildEnrichPrompt,
    extractJson,
    findSimilarTagGroups,
    isLikelyDuplicate,
    parseAuthorResponse,
    parseEnrichResponse,
} from "../src/domain/enrich.ts";

test("buildEnrichPrompt：含标题与正文截断", () => {
    const prompt = buildEnrichPrompt("深度学习入门", "正文内容。".repeat(5000));
    assert.ok(prompt.includes("文章标题：深度学习入门"));
    assert.ok(prompt.length < 8000); // 正文被截断到 6000
    assert.ok(prompt.includes('{"summary"'));
});

test("parseEnrichResponse：标准 JSON", () => {
    const parsed = parseEnrichResponse('{"summary":"一篇讲 AI 的文章。","tags":["AI","入门"]}');
    assert.ok(parsed);
    assert.equal(parsed.summary, "一篇讲 AI 的文章。");
    assert.deepEqual(parsed.tags, ["AI", "入门"]);
});

test("parseEnrichResponse：容忍 markdown 代码栏与前后杂文", () => {
    const raw = '好的，以下是结果：\n```json\n{"summary":"摘要内容","tags":["a","b"]}\n```\n希望有帮助';
    const parsed = parseEnrichResponse(raw);
    assert.ok(parsed);
    assert.equal(parsed.summary, "摘要内容");
});

test("parseEnrichResponse：标签去重/去 #/截断到 6 个", () => {
    const parsed = parseEnrichResponse(
        JSON.stringify({ summary: "s", tags: ["#AI", "ai", "ML", "机器学习", "深度学习", "NLP", "大模型", "Agent"] })
    );
    assert.ok(parsed);
    assert.equal(parsed.tags.length, 6);
    assert.deepEqual(parsed.tags, ["AI", "ML", "机器学习", "深度学习", "NLP", "大模型"]);
});

test("parseEnrichResponse：非法输入返回 null（静默降级）", () => {
    assert.equal(parseEnrichResponse(""), null);
    assert.equal(parseEnrichResponse("不是 JSON"), null);
    assert.equal(parseEnrichResponse('{"tags":["a"]}'), null); // 缺 summary
    assert.equal(parseEnrichResponse('{"summary":"s"}'), null); // 缺 tags
    assert.equal(parseEnrichResponse('{"summary":"  ","tags":["a"]}'), null);
});

test("extractJson：平衡花括号（字符串内花括号不干扰）", () => {
    const json = extractJson('前缀 {"summary":"含 } 花括号","tags":[]} 后缀');
    assert.ok(json);
    const parsed = JSON.parse(json);
    assert.equal(parsed.summary, "含 } 花括号");
});

test("isLikelyDuplicate：词元重叠 ≥80% 判重", () => {
    assert.equal(isLikelyDuplicate("理解 CUDA 极简心智模型", "CUDA 极简心智模型 指南"), true);
    assert.equal(isLikelyDuplicate("完全不同的话题", "风马牛不相及的内容"), false);
    assert.equal(isLikelyDuplicate("", "任意"), false);
});

test("findSimilarTagGroups：归一化相等与包含关系成组，孤立标签不成组（T-1761）", () => {
    const groups = findSimilarTagGroups([
        "机器学习", "机器 学习", "机器学习基础", "ML", "深度学习", "前端",
    ]);
    // 归一化相等：机器学习 / 机器 学习；包含关系：机器学习 ⊂ 机器学习基础
    assert.equal(groups.length, 1);
    assert.equal(groups[0].keep, "机器学习基础");
    assert.deepEqual([...groups[0].variants].sort(), ["机器 学习", "机器学习", "机器学习基础"].sort());
});

test("findSimilarTagGroups：短于 2 字的短标签不触发包含判定，空输入空组", () => {
    assert.deepEqual(findSimilarTagGroups(["AI", "ML", "A", "B"]), []);
    assert.deepEqual(findSimilarTagGroups([]), []);
    // ML/AI 互不包含 → 不成组
    const groups = findSimilarTagGroups(["人工智能", "AGI", "人工智能应用"]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].keep, "人工智能应用");
});

test("buildAuthorPrompt/parseAuthorResponse：作者推断指令与结果清洗（T-1813）", () => {
    const prompt = buildAuthorPrompt("深度文章", "点击上方蓝字关注 极客视界……");
    assert.ok(prompt.includes("深度文章"));
    assert.ok(prompt.includes("只输出作者名本身"));
    assert.equal(parseAuthorResponse("极客视界"), "极客视界");
    assert.equal(parseAuthorResponse("公众号：极客视界"), "极客视界");
    assert.equal(parseAuthorResponse("“极客视界”"), "极客视界");
    assert.equal(parseAuthorResponse("未知"), null);
    assert.equal(parseAuthorResponse(""), null);
    assert.equal(parseAuthorResponse("a".repeat(50)), null); // 超上限拒绝
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const guide = readFileSync(resolve(root, "docs/AI-ACCEPTANCE.md"), "utf8");
const enrich = readFileSync(resolve(root, "src/services/enrich-service.ts"), "utf8");
const readerAi = readFileSync(resolve(root, "src/services/reader-ai.ts"), "utf8");
const directAi = readFileSync(resolve(root, "src/api/ai-direct.ts"), "utf8");
const domainDirectAi = readFileSync(resolve(root, "src/domain/ai-direct.ts"), "utf8");
const actions = readFileSync(resolve(root, "src/services/ai-actions.ts"), "utf8");
const index = readFileSync(resolve(root, "src/index.ts"), "utf8");
const settings = readFileSync(resolve(root, "src/services/settings.ts"), "utf8");

const mainCases = ["AI-01", "AI-02", "AI-03", "AI-04", "AI-05", "AI-06", "AI-07", "AI-08", "AI-09"];
const failureCases = ["AI-F01", "AI-F02", "AI-F03", "AI-F04", "AI-F05", "AI-F06", "AI-F07", "AI-F08", "AI-F09"];

test("AI 真实验收矩阵覆盖主流程、失败样本和 B-0004 边界", () => {
    assert.match(guide, /T-3211/);
    assert.match(guide, /B-0004/);
    assert.match(guide, /真实模型验收/);
    for (const id of [...mainCases, ...failureCases]) assert.match(guide, new RegExp("`" + id + "`"));
    assert.match(guide, /不能替代真实模型质量验收/);
    assert.match(guide, /不得发生/);
});

test("AI 矩阵锁定数据主权、额度和失败恢复要求", () => {
    for (const field of ["custom-clip-url", "status", "priority", "rating", "用户标签", "用量"]) {
        assert.match(guide, new RegExp(field));
    }
    for (const term of ["skipped=error", "skipped=parse", "不阻断收录", "不增加用量", "可重试"]) {
        assert.match(guide, new RegExp(term));
    }
});

test("验收条目与 AI 代码入口保持对应", () => {
    assert.match(enrich, /usageToday/);
    assert.match(enrich, /aiQuotaAvailable/);
    assert.match(enrich, /appendLog/);
    assert.match(enrich, /findDuplicates/);
    assert.match(enrich, /findRelated/);
    assert.match(readerAi, /readerSummarize/);
    assert.match(readerAi, /readerTranslate/);
    assert.match(readerAi, /saveReaderSummary/);
    assert.match(directAi, /testDirectChannel/);
    assert.match(directAi, /browser-cors/);
    assert.match(actions, /拾遗 · 总结/);
    assert.match(actions, /拾遗 · 要点/);
    assert.match(actions, /拾遗 · 反方观点/);
    for (const tool of ["list_unread", "archive_stale", "weekly_digest"]) {
        assert.ok(index.includes(`name: "${tool}"`), `智能体工具缺少 ${tool}`);
    }
    assert.match(index, /completedArticles/);
    assert.match(index, /本周读完文章/);
    for (const field of ["enrichDailyCap", "dedupOnEnrich", "relatedWhileReading", "presetActions", "customSecretName"]) {
        assert.match(settings, new RegExp(field));
    }
});

test("验收记录不允许要求提交密钥或完整私密正文", () => {
    assert.match(guide, /不记录 API key/);
    assert.match(guide, /不记录.*完整文章正文/);
    assert.doesNotMatch(guide, /sk-[A-Za-z0-9]{12,}/);
});

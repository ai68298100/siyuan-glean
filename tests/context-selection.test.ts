import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { selectReadingContext, type ContextSelectionItem } from "../src/domain/context-selection.ts";

const sample = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/context-selection-sample.json"), "utf8")) as ContextSelectionItem[];

test("情境选文按预算过滤，未知分钟不会伪装成预算内", () => {
    const result = selectReadingContext(sample, { budget: 15, tag: "工作", limit: 10 });
    assert.deepEqual(result.candidates.map(({ item }) => item.id), ["fulltext-15", "link-only", "fulltext-5", "tie-a", "tie-b"]);
    assert.equal(result.diagnostics.unknownMinutes, 1);
    assert.equal(result.diagnostics.overBudget, 1);
    assert.equal(result.candidates.some(({ item }) => item.id === "unknown-minutes"), false);
});

test("情境选文只匹配根块用户标签，AI 标签不成为主题门槛", () => {
    const result = selectReadingContext(sample, { budget: 5, tag: "工作", limit: 10 });
    assert.equal(result.candidates.some(({ item }) => item.id === "ai-only-topic"), false);
    assert.equal(result.diagnostics.tagMiss, 2);
    assert.equal(result.candidates.every(({ item }) => (item.tags ?? []).some((tag) => tag.toLowerCase() === "工作")), true);
});

test("已读回看必须显式开启，候选/内部/排除条目永不进入", () => {
    const unread = selectReadingContext(sample, { budget: 5, tag: "工作", limit: 10 });
    assert.equal(unread.candidates.some(({ item }) => item.id === "done-review"), false);
    const review = selectReadingContext(sample, { budget: 5, tag: "工作", includeDone: true, limit: 10 });
    assert.equal(review.candidates.some(({ item }) => item.id === "done-review"), true);
    for (const id of ["candidate", "internal", "excluded"]) assert.equal(review.candidates.some(({ item }) => item.id === id), false);
    assert.equal(review.diagnostics.excluded, 3);
});

test("未知分钟可通过显式放宽进入候选，并保留可解释理由", () => {
    const result = selectReadingContext(sample, { budget: 5, tag: "工作", includeUnknownMinutes: true, limit: 10 });
    const candidate = result.candidates.find(({ item }) => item.id === "unknown-minutes");
    assert.ok(candidate);
    assert.equal(candidate.offlineReadable, true);
    assert.ok(candidate.reasons.some((reason) => reason.kind === "unknownMinutes"));
    assert.equal(candidate.reasons.some((reason) => reason.kind === "budget" && reason.value === "unknown"), true);
});

test("链接条目保留候选但明确只能打开原文，排序使用优先级/等待天数/id稳定收尾", () => {
    const result = selectReadingContext(sample, { budget: 15, tag: "工作", limit: 10 });
    const link = result.candidates.find(({ item }) => item.id === "link-only");
    assert.ok(link);
    assert.equal(link.offlineReadable, false);
    assert.ok(link.reasons.some((reason) => reason.kind === "linkOnly"));
    assert.deepEqual(result.candidates.slice(-2).map(({ item }) => item.id), ["tie-a", "tie-b"]);
});

test("情境选文是无写入的纯投影，输入与嵌套标签不被修改", () => {
    const before = structuredClone(sample);
    const result = selectReadingContext(sample, { budget: 30, tag: " 工作 ", limit: 3 });
    result.candidates[0].item.tags?.push("mutated-output");
    assert.deepEqual(sample, before);
});

test("无结果仍提供放宽所需诊断，预算枚举拒绝猜测", () => {
    const result = selectReadingContext(sample, { budget: 5, tag: "不存在", limit: 3 });
    assert.deepEqual(result.candidates, []);
    assert.equal(result.diagnostics.tagMiss, 9);
    assert.throws(() => selectReadingContext(sample, { budget: 10 as 5, tag: "工作" }), /Unsupported context budget/);
});

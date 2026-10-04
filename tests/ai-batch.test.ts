import test from "node:test";
import assert from "node:assert/strict";
import { AI_BATCH_EXPECTED_KEYS, AI_BATCH_MAX_BYTES, AI_BATCH_MAX_ROWS, aiBatchCounts, aiBatchDocumentMatches, aiBatchHasUnresolved, aiBatchOutputChanged, inspectAiBatchDocument, parseAiBatchJournal, recoverAiBatchJournal, validateAiBatchIds } from "../src/domain/ai-batch.ts";
import { ATTR } from "../src/domain/schema.ts";

const firstId = "20261004000000-first01";
const secondId = "20261004000000-second1";
const journal = () => ({ version: 1, taskId: "batch-test", createdAt: "2026-10-04T00:00:00.000Z", rows: [{ docId: firstId, stage: "pending", attempt: 0, reason: "" }] });
const snapshot = () => ({ meta: { id: firstId, title: "作者文章", box: "20261004000000-box0001", hpath: "/读库/文章" }, attrs: { [ATTR.status]: "inbox", [ATTR.url]: "https://example.org/first", [ATTR.summary]: "原摘要", [ATTR.aiTags]: "主题一,主题二" } });

test("检查点仅保留版本、任务日期、文档 ID 和派生结果；可解析对象与 JSON", () => {
    const source = journal();
    assert.deepEqual(parseAiBatchJournal(source), source);
    assert.deepEqual(parseAiBatchJournal(JSON.stringify(source)), source);
    for (const value of [undefined, null, ""]) assert.equal(parseAiBatchJournal(value), null);
    const parsed = parseAiBatchJournal(source)!;
    parsed.rows[0].stage = "skipped";
    assert.equal(source.rows[0].stage, "pending");
});

test("非法文件版本、结构、日期、ID、重复和数量拒绝，不清洗成默认记录", () => {
    const badValues: unknown[] = [
        {}, [], 0, false, "{", "null", "{}", { ...journal(), version: 2 }, { ...journal(), extra: "正文" },
        { ...journal(), taskId: "private/article" }, { ...journal(), createdAt: "2026-02-30T00:00:00.000Z" },
        { ...journal(), createdAt: "today" }, { ...journal(), rows: [] }, { ...journal(), rows: [null] },
        { ...journal(), rows: [{ ...journal().rows[0], docId: "bad'ID" }] },
        { ...journal(), rows: [journal().rows[0], journal().rows[0]] },
        { ...journal(), rows: [{ ...journal().rows[0], title: "文章标题" }] },
        " ".repeat(AI_BATCH_MAX_BYTES + 1),
        { ...journal(), rows: Array.from({ length: AI_BATCH_MAX_ROWS + 1 }, (_, index) => ({ ...journal().rows[0], docId: `20261004000000-${index.toString(36).padStart(7, "0")}` })) },
    ];
    for (const input of badValues) assert.throws(() => parseAiBatchJournal(input));
});

test("阶段与原因必须一致，尝试次数不可负、分数或假称未执行的成功", () => {
    const badRows = [
        { stage: "other", reason: "", attempt: 0 }, { stage: "pending", reason: "private prompt", attempt: 0 },
        { stage: "pending", reason: "", attempt: -1 }, { stage: "pending", reason: "", attempt: 0.1 },
        { stage: "pending", reason: "", attempt: Number.MAX_SAFE_INTEGER + 1 },
        { stage: "running", reason: "", attempt: 0 }, { stage: "succeeded", reason: "", attempt: 0 },
        { stage: "failed", reason: "error", attempt: 1 }, { stage: "unknown", reason: "parse", attempt: 1 },
        { stage: "skipped", reason: "", attempt: 0 }, { stage: "pending", reason: "parse", attempt: 1 },
    ];
    for (const row of badRows) assert.throws(() => parseAiBatchJournal({ ...journal(), rows: [{ docId: firstId, ...row }] }));
    for (const row of [
        { stage: "running", reason: "", attempt: 1 }, { stage: "succeeded", reason: "", attempt: 2 },
        { stage: "failed", reason: "parse", attempt: 1 }, { stage: "unknown", reason: "interrupted", attempt: 1 },
        { stage: "pending", reason: "cap", attempt: 2 }, { stage: "skipped", reason: "changed", attempt: 0 },
    ]) assert.ok(parseAiBatchJournal({ ...journal(), rows: [{ docId: firstId, ...row }] }));
});

test("重载 running 转 unknown，不变更其他状态、次数，不改变源记录", () => {
    const source = parseAiBatchJournal({ ...journal(), rows: [{ docId: firstId, stage: "running", attempt: 2, reason: "" }, { docId: secondId, stage: "succeeded", attempt: 1, reason: "" }] })!;
    const recovered = recoverAiBatchJournal(source);
    assert.deepEqual(recovered.rows[0], { docId: firstId, stage: "unknown", attempt: 2, reason: "interrupted" });
    assert.deepEqual(recovered.rows[1], source.rows[1]);
    assert.equal(source.rows[0].stage, "running");
    assert.equal(aiBatchHasUnresolved(recovered), true);
    assert.equal(aiBatchHasUnresolved({ ...source, rows: [source.rows[1]] }), false);
    assert.deepEqual(aiBatchCounts(recovered), { pending: 0, running: 0, succeeded: 1, failed: 0, unknown: 1, skipped: 0 });
});

test("输入 ID 明确校验，不静默去重、不接受非 ID 或超限", () => {
    assert.deepEqual(validateAiBatchIds([firstId, secondId]), [firstId, secondId]);
    assert.deepEqual(validateAiBatchIds([], true), []);
    for (const input of [[], [firstId, firstId], ["20261004000000-UPPER01"], [firstId, 42], "id", null]) assert.throws(() => validateAiBatchIds(input));
});

test("预览保留原始空值与摘要/AI 标签/状态/URL比较值，用户标签与其他属性不进入预览快照", () => {
    const source = snapshot();
    Object.assign(source.attrs, { tags: "用户标签", [ATTR.author]: "手填作者", [ATTR.rating]: "5", [ATTR.priority]: "1" });
    const preview = inspectAiBatchDocument(firstId, source);
    assert.equal(preview.eligible, true);
    assert.equal(preview.summary, "原摘要");
    assert.equal(preview.aiTagCount, 2);
    assert.equal(preview.replacesSummary, true);
    assert.equal(preview.replacesAiTags, true);
    assert.deepEqual(Object.keys(preview.expectedAttrs), [...AI_BATCH_EXPECTED_KEYS]);
    assert.equal(preview.expectedAttrs[ATTR.internal], null);
    assert.equal(preview.expectedAttrs.tags, undefined);
    const empty = inspectAiBatchDocument(firstId, { ...source, attrs: { [ATTR.status]: "inbox", [ATTR.summary]: "" } });
    assert.equal(empty.expectedAttrs[ATTR.summary], "");
    assert.equal(empty.expectedAttrs[ATTR.url], null);
    assert.equal(empty.replacesSummary, false);
});

test("候选、非法状态、明确 internal 和排除不能混入批量文章；同名已收录用户文档保留资格", () => {
    const source = snapshot();
    for (const attrs of [{ [ATTR.url]: "https://example.org" }, { [ATTR.status]: "broken" }, { ...source.attrs, [ATTR.internal]: "TRUE" }, { ...source.attrs, [ATTR.excluded]: "true" }]) {
        assert.equal(inspectAiBatchDocument(firstId, { ...source, attrs }).eligible, false);
    }
    for (const title of ["读库数据库", "读库闪卡", "读库周报"]) {
        assert.equal(inspectAiBatchDocument(firstId, { ...source, meta: { ...source.meta, title, hpath: `/读库周报/${title}` } }).eligible, true);
    }
});

test("预览拒绝错误元数据、错文 ID、非字符串属性与超长字段", () => {
    const source = snapshot();
    for (const value of [
        { ...source, meta: { ...source.meta, id: secondId } },
        { ...source, meta: { ...source.meta, box: "" } },
        { ...source, meta: { ...source.meta, title: "x".repeat(4097) } },
        { ...source, attrs: { ...source.attrs, [ATTR.summary]: "x".repeat(1024 * 1024 + 1) } },
        { ...source, attrs: { ...source.attrs, [ATTR.status]: 1 } },
    ]) assert.throws(() => inspectAiBatchDocument(firstId, value as typeof source));
});

test("执行比较资格、位置及原始属性，输出变化独立于标题和用户手填字段", () => {
    const source = snapshot();
    const expected = inspectAiBatchDocument(firstId, source);
    for (const attrs of [
        { ...source.attrs, [ATTR.summary]: "改摘要" }, { ...source.attrs, [ATTR.aiTags]: "改标签" },
        { ...source.attrs, [ATTR.status]: "done" }, { ...source.attrs, [ATTR.url]: "https://other.org" },
        { ...source.attrs, [ATTR.internal]: "true" },
    ]) assert.equal(aiBatchDocumentMatches(expected, inspectAiBatchDocument(firstId, { ...source, attrs })), false);
    assert.equal(aiBatchDocumentMatches(expected, inspectAiBatchDocument(firstId, { ...source, meta: { ...source.meta, hpath: "/移动后" } })), false);
    assert.equal(aiBatchDocumentMatches(expected, inspectAiBatchDocument(firstId, { ...source, meta: { ...source.meta, title: "新标题" }, attrs: { ...source.attrs, [ATTR.author]: "用户改作者" } })), true);
    assert.equal(aiBatchOutputChanged(expected, inspectAiBatchDocument(firstId, { ...source, attrs: { ...source.attrs, [ATTR.summary]: "新摘要" } })), true);
    assert.equal(aiBatchOutputChanged(expected, expected), false);
});

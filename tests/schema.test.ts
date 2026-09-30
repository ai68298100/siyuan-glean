/** domain/schema 纯函数单测 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    ATTR,
    canTransition,
    captureDefaults,
    countWords,
    daysSince,
    estimateMinutes,
    isClipDoc,
    isMarkedInternalDoc,
    parseClipAttrs,
    serializePatch,
    siteFromUrl,
    siyuanDate,
    siyuanTimestamp,
} from "../src/domain/schema.ts";

test("parseClipAttrs：完整 IAL 还原为强类型", () => {
    const attrs = parseClipAttrs({
        [ATTR.url]: "https://example.com/a",
        [ATTR.site]: "example.com",
        [ATTR.time]: "20260929010101",
        [ATTR.status]: "reading",
        [ATTR.words]: "1234",
        [ATTR.minutes]: "3",
        [ATTR.priority]: "4",
        [ATTR.rating]: "5",
        [ATTR.aiTags]: "ai, 隐私",
        [ATTR.summary]: "一篇好文章",
        [ATTR.lastSurfaced]: "20260928",
        [ATTR.src]: "migration",
    });
    assert.equal(attrs.url, "https://example.com/a");
    assert.equal(attrs.status, "reading");
    assert.equal(attrs.words, 1234);
    assert.equal(attrs.priority, 4);
    assert.deepEqual(attrs.aiTags, ["ai", "隐私"]);
    assert.equal(attrs.src, "migration");
});

test("parseClipAttrs：非法值丢弃、缺键为 undefined、aiTags 空数组兜底", () => {
    const attrs = parseClipAttrs({
        [ATTR.status]: "bogus-status",
        [ATTR.words]: "abc",
        [ATTR.priority]: "9",
    });
    assert.equal(attrs.status, undefined);
    assert.equal(attrs.words, undefined);
    assert.equal(attrs.priority, 5); // 越界值钳制到 1-5
    assert.deepEqual(attrs.aiTags, []);
    assert.equal(attrs.url, undefined);
});

test("isClipDoc：有状态或 URL 即认，空串不算", () => {
    assert.equal(isClipDoc({ [ATTR.status]: "inbox" }), true);
    assert.equal(isClipDoc({ [ATTR.url]: "https://x" }), true);
    assert.equal(isClipDoc({ [ATTR.status]: "" }), false);
    assert.equal(isClipDoc({}), false);
});

test("isMarkedInternalDoc：只有字符串 true 的 internal 标记才算插件宿主（T-1987）", () => {
    assert.equal(isMarkedInternalDoc({ [ATTR.internal]: "true" }), true);
    assert.equal(isMarkedInternalDoc({ [ATTR.internal]: "True" }), true);
    assert.equal(isMarkedInternalDoc({ [ATTR.internal]: "false" }), false);
    assert.equal(isMarkedInternalDoc({ [ATTR.internal]: "" }), false);
    assert.equal(isMarkedInternalDoc({}), false);
});

test("serializePatch：数字钳制与空串删除语义", () => {
    const patch = serializePatch({ priority: 9, rating: -1, status: "later", url: "", aiTags: ["a", "b"] });
    assert.equal(patch[ATTR.priority], "5");
    assert.equal(patch[ATTR.rating], "0");
    assert.equal(patch[ATTR.status], "later");
    assert.equal(patch[ATTR.url], null);
    assert.equal(patch[ATTR.aiTags], "a,b");
});

test("serializePatch：显式 null 保留（删除），undefined 键不出现", () => {
    const patch = serializePatch({ summary: null });
    assert.equal(patch[ATTR.summary], null);
    const patch2 = serializePatch({});
    assert.deepEqual(patch2, {});
});

test("estimateMinutes：400 字/分钟，最少 1 分钟", () => {
    assert.equal(estimateMinutes(0), 0);
    assert.equal(estimateMinutes(100), 1);
    assert.equal(estimateMinutes(800), 2);
    assert.equal(estimateMinutes(850), 2);
});

test("countWords：中英混排", () => {
    assert.equal(countWords("hello world"), 2);
    assert.equal(countWords("你好世界"), 4);
    assert.equal(countWords("你好 world 代码"), 5);
    assert.equal(countWords(""), 0);
});

test("siteFromUrl：去 www；非法输入返回空串", () => {
    assert.equal(siteFromUrl("https://www.example.com/a?b=1"), "example.com");
    assert.equal(siteFromUrl("not a url"), "");
});

test("siyuanTimestamp/siyuanDate：定长格式", () => {
    const now = new Date(2026, 8, 29, 7, 5, 3);
    assert.equal(siyuanTimestamp(now), "20260929070503");
    assert.equal(siyuanDate(now), "20260929");
});

test("daysSince：按入库时间算天数", () => {
    const now = new Date(2026, 8, 29, 12, 0, 0);
    assert.equal(daysSince("20260929120000", now), 0);
    assert.equal(daysSince("20260920120000", now), 9);
    assert.equal(daysSince("bad", now), null);
    assert.equal(daysSince(undefined, now), null);
});

test("canTransition：状态机白名单", () => {
    assert.equal(canTransition("inbox", "later"), true);
    assert.equal(canTransition("inbox", "archived"), true);
    assert.equal(canTransition("archived", "reading"), true);
    assert.equal(canTransition("done", "inbox"), false);
    assert.equal(canTransition("reading", "reading"), true);
});

test("captureDefaults：收录缺省值", () => {
    const now = new Date(2026, 8, 29, 8, 0, 0);
    const defaults = captureDefaults(now);
    assert.equal(defaults.status, "inbox");
    assert.equal(defaults.priority, 3);
    assert.equal(defaults.time, "20260929080000");
    assert.equal(defaults.src, "manual");
});

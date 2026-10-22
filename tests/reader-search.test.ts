/** domain/reader-search 纯函数单测 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    calculateMatchIndex,
    findTextOffsets,
    formatMatchCount,
    initialReaderSearchState,
    isFindShortcut,
    normalizeSearchKeyword,
} from "../src/domain/reader-search.ts";

test("initialReaderSearchState：初始状态安全", () => {
    const s = initialReaderSearchState();
    assert.equal(s.open, false);
    assert.equal(s.keyword, "");
    assert.equal(s.caseSensitive, false);
    assert.equal(s.activeIndex, -1);
    assert.equal(s.totalMatches, 0);
});

test("normalizeSearchKeyword：换行回车制表符规范为空格", () => {
    assert.equal(normalizeSearchKeyword("hello\r\nworld\ttest"), "hello  world test");
    assert.equal(normalizeSearchKeyword(""), "");
    assert.equal(normalizeSearchKeyword("   "), "   ");
});

test("calculateMatchIndex：空匹配集合返回 -1", () => {
    assert.equal(calculateMatchIndex(0, 0, "next"), -1);
    assert.equal(calculateMatchIndex(-1, 0, "prev"), -1);
});

test("calculateMatchIndex：next 方向循环切换", () => {
    // 只有 1 个匹配时
    assert.equal(calculateMatchIndex(-1, 1, "next"), 0);
    assert.equal(calculateMatchIndex(0, 1, "next"), 0);

    // 有 3 个匹配时：0 -> 1 -> 2 -> 0
    assert.equal(calculateMatchIndex(-1, 3, "next"), 0);
    assert.equal(calculateMatchIndex(0, 3, "next"), 1);
    assert.equal(calculateMatchIndex(1, 3, "next"), 2);
    assert.equal(calculateMatchIndex(2, 3, "next"), 0);
    assert.equal(calculateMatchIndex(10, 3, "next"), 0);
});

test("calculateMatchIndex：prev 方向倒序循环切换", () => {
    // 只有 1 个匹配时
    assert.equal(calculateMatchIndex(-1, 1, "prev"), 0);
    assert.equal(calculateMatchIndex(0, 1, "prev"), 0);

    // 有 3 个匹配时：2 -> 1 -> 0 -> 2
    assert.equal(calculateMatchIndex(-1, 3, "prev"), 2);
    assert.equal(calculateMatchIndex(2, 3, "prev"), 1);
    assert.equal(calculateMatchIndex(1, 3, "prev"), 0);
    assert.equal(calculateMatchIndex(0, 3, "prev"), 2);
    assert.equal(calculateMatchIndex(10, 3, "prev"), 2);
});

test("formatMatchCount：匹配计数与显示文本", () => {
    assert.deepEqual(formatMatchCount(-1, 0), { currentDisplay: 0, totalDisplay: 0, text: "0 / 0" });
    assert.deepEqual(formatMatchCount(0, 5), { currentDisplay: 1, totalDisplay: 5, text: "1 / 5" });
    assert.deepEqual(formatMatchCount(4, 5), { currentDisplay: 5, totalDisplay: 5, text: "5 / 5" });
    assert.deepEqual(formatMatchCount(5, 5), { currentDisplay: 0, totalDisplay: 5, text: "0 / 5" });
});

test("isFindShortcut：Ctrl+F 与 Cmd+F 快捷键识别与防护", () => {
    assert.equal(isFindShortcut({ key: "f", ctrlKey: true }), true);
    assert.equal(isFindShortcut({ key: "F", ctrlKey: true }), true);
    assert.equal(isFindShortcut({ key: "f", metaKey: true }), true);
    assert.equal(isFindShortcut({ key: "f" }), false);
    // Alt 键组合不触发
    assert.equal(isFindShortcut({ key: "f", ctrlKey: true, altKey: true }), false);
    // 输入法正在组合输入时防误触
    assert.equal(isFindShortcut({ key: "f", ctrlKey: true, isComposing: true }), false);
    // 其他按键不触发
    assert.equal(isFindShortcut({ key: "j", ctrlKey: true }), false);
});

test("findTextOffsets：大小写不敏感/敏感偏移量定位", () => {
    const text = "Siyuan Note Plugin siyuan reader";
    const insensitive = findTextOffsets(text, "siyuan");
    assert.equal(insensitive.length, 2);
    assert.deepEqual(insensitive[0], { start: 0, end: 6 });
    assert.deepEqual(insensitive[1], { start: 19, end: 25 });

    const sensitive = findTextOffsets(text, "siyuan", true);
    assert.equal(sensitive.length, 1);
    assert.deepEqual(sensitive[0], { start: 19, end: 25 });

    // 空串或未命中
    assert.deepEqual(findTextOffsets("", "foo"), []);
    assert.deepEqual(findTextOffsets(text, ""), []);
    assert.deepEqual(findTextOffsets(text, "not-exist"), []);
});

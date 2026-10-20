/**
 * 读库全键盘操作流（T-3392）回归。
 *
 * 覆盖两层：
 * 1. domain/library-keyboard.ts 的纯函数仲裁（键位、IME、修饰键、重复键、边界）；
 * 2. DockPanel 的实际接线（光标样式、提示条、动作路由），用静态断言防止接线回退。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveLibraryCursor, resolveLibraryShortcut, cyclePriorityValue, cycleRatingValue, type LibraryKeyboardContext } from "../src/domain/library-keyboard.ts";

const dock = readFileSync(new URL("../src/ui/DockPanel.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/index.scss", import.meta.url), "utf8");

const key = (value: string, extra: Record<string, unknown> = {}) => ({ key: value, ...extra });
const active: LibraryKeyboardContext = { cursorActive: true };

test("J/K 与方向键移动光标，未激活时方向键交给原生滚动", () => {
    assert.deepEqual(resolveLibraryShortcut(key("j"), active), { type: "move", delta: 1 });
    assert.deepEqual(resolveLibraryShortcut(key("J"), active), { type: "move", delta: 1 });
    assert.deepEqual(resolveLibraryShortcut(key("k")), { type: "move", delta: -1 });
    assert.deepEqual(resolveLibraryShortcut(key("ArrowDown"), active), { type: "move", delta: 1 });
    assert.deepEqual(resolveLibraryShortcut(key("ArrowUp"), active), { type: "move", delta: -1 });
    assert.equal(resolveLibraryShortcut(key("ArrowDown"), {}), null);
    assert.equal(resolveLibraryShortcut(key("ArrowUp"), {}), null);
});

test("输入法组合、修饰键与 Shift 组合不触发任何动作", () => {
    assert.equal(resolveLibraryShortcut(key("e", { isComposing: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("e", { keyCode: 229 }), active), null);
    assert.equal(resolveLibraryShortcut(key("e", { ctrlKey: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("e", { metaKey: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("e", { altKey: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("E", { shiftKey: true }), active), null);
});

test("文本输入、按钮原生语义与浮层打开时让出按键", () => {
    assert.equal(resolveLibraryShortcut(key("j"), { ...active, textEntry: true }), null);
    assert.equal(resolveLibraryShortcut(key("e"), { ...active, textEntry: true }), null);
    assert.equal(resolveLibraryShortcut(key("j"), { ...active, overlay: true }), null);
    assert.equal(resolveLibraryShortcut(key("Enter"), { ...active, nativeAction: true }), null);
    assert.deepEqual(resolveLibraryShortcut(key("Enter"), active), { type: "activate" });
});

test("字母动作只在光标激活后生效，长按不重复执行破坏性动作", () => {
    assert.equal(resolveLibraryShortcut(key("e"), {}), null);
    assert.equal(resolveLibraryShortcut(key("o"), {}), null);
    assert.equal(resolveLibraryShortcut(key("r"), {}), null);
    assert.equal(resolveLibraryShortcut(key("a"), {}), null);
    assert.equal(resolveLibraryShortcut(key("x"), {}), null);
    assert.equal(resolveLibraryShortcut(key("e", { repeat: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("a", { repeat: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("x", { repeat: true }), active), null);
    assert.deepEqual(resolveLibraryShortcut(key("j", { repeat: true }), active), { type: "move", delta: 1 });
});

test("O/R/A/E/X 映射到对应动作，Escape 只在光标激活时消费", () => {
    assert.deepEqual(resolveLibraryShortcut(key("o"), active), { type: "openDocument" });
    assert.deepEqual(resolveLibraryShortcut(key("r"), active), { type: "startReading" });
    assert.deepEqual(resolveLibraryShortcut(key("a"), active), { type: "later" });
    assert.deepEqual(resolveLibraryShortcut(key("e"), active), { type: "archive" });
    assert.deepEqual(resolveLibraryShortcut(key("x"), active), { type: "toggleSelect" });
    assert.deepEqual(resolveLibraryShortcut(key("Escape"), active), { type: "clearCursor" });
    assert.equal(resolveLibraryShortcut(key("Escape"), {}), null);
    assert.equal(resolveLibraryShortcut(key("z"), active), null);
});

test("快捷设置优先级与评分：P/1-5 调优先级，M 调评分，长按防抖保护（T-3413）", () => {
    assert.deepEqual(resolveLibraryShortcut(key("p"), active), { type: "cyclePriority" });
    assert.deepEqual(resolveLibraryShortcut(key("P"), active), { type: "cyclePriority" });
    assert.deepEqual(resolveLibraryShortcut(key("1"), active), { type: "setPriority", value: 1 });
    assert.deepEqual(resolveLibraryShortcut(key("3"), active), { type: "setPriority", value: 3 });
    assert.deepEqual(resolveLibraryShortcut(key("5"), active), { type: "setPriority", value: 5 });
    assert.deepEqual(resolveLibraryShortcut(key("m"), active), { type: "cycleRating" });
    assert.deepEqual(resolveLibraryShortcut(key("M"), active), { type: "cycleRating" });

    // 未激活光标不响应
    assert.equal(resolveLibraryShortcut(key("p"), {}), null);
    assert.equal(resolveLibraryShortcut(key("1"), {}), null);
    assert.equal(resolveLibraryShortcut(key("m"), {}), null);

    // 长按不重复写入（防抖节流保护）
    assert.equal(resolveLibraryShortcut(key("p", { repeat: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("1", { repeat: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("m", { repeat: true }), active), null);

    // 纯函数循环计算
    assert.equal(cyclePriorityValue(3), 4);
    assert.equal(cyclePriorityValue(4), 5);
    assert.equal(cyclePriorityValue(5), 1);
    assert.equal(cyclePriorityValue(1), 2);
    assert.equal(cyclePriorityValue(undefined), 4);

    assert.equal(cycleRatingValue(0), 1);
    assert.equal(cycleRatingValue(1), 2);
    assert.equal(cycleRatingValue(4), 5);
    assert.equal(cycleRatingValue(5), 0);
    assert.equal(cycleRatingValue(undefined), 1);
});

test("批量选择键位：S 需光标，F/C 只需已有勾选（T-3367）", () => {
    assert.deepEqual(resolveLibraryShortcut(key("s"), active), { type: "selectDisplayed" });
    assert.equal(resolveLibraryShortcut(key("s"), {}), null);
    assert.equal(resolveLibraryShortcut(key("s"), { cursorActive: false, hasSelection: true }), null);
    assert.deepEqual(resolveLibraryShortcut(key("f"), { hasSelection: true }), { type: "keepFiltered" });
    assert.deepEqual(resolveLibraryShortcut(key("c"), { hasSelection: true }), { type: "clearSelection" });
    assert.equal(resolveLibraryShortcut(key("f"), {}), null);
    assert.equal(resolveLibraryShortcut(key("c"), {}), null);
    // 有勾选但焦点在输入框 / 浮层中仍要让出
    assert.equal(resolveLibraryShortcut(key("c"), { hasSelection: true, textEntry: true }), null);
    assert.equal(resolveLibraryShortcut(key("f"), { hasSelection: true, overlay: true }), null);
    // 长按不重复执行批量动作
    assert.equal(resolveLibraryShortcut(key("s", { repeat: true }), active), null);
    assert.equal(resolveLibraryShortcut(key("c", { repeat: true }), { hasSelection: true }), null);
});

test("光标移动：首次进入按方向取端点，边界不回绕，空列表返回空串", () => {
    const ids = ["a", "b", "c"];
    assert.equal(moveLibraryCursor(ids, "", 1), "a");
    assert.equal(moveLibraryCursor(ids, "", -1), "c");
    assert.equal(moveLibraryCursor(ids, "a", 1), "b");
    assert.equal(moveLibraryCursor(ids, "c", 1), "c");
    assert.equal(moveLibraryCursor(ids, "a", -1), "a");
    assert.equal(moveLibraryCursor(ids, "gone", 1), "a");
    assert.equal(moveLibraryCursor(ids, "gone", -1), "c");
    assert.equal(moveLibraryCursor([], "a", 1), "");
});

test("DockPanel 接线：键盘光标样式、提示条与动作路由存在", () => {
    assert.match(dock, /import \{ moveLibraryCursor, resolveLibraryShortcut/);
    assert.match(dock, /let keyboardCursorId = \$state\(""\)/);
    assert.match(dock, /class:glean-drow--cursor=\{keyboardCursorId === entry\.id\}/);
    assert.match(dock, /class:glean-kcard--cursor=\{keyboardCursorId === entry\.id\}/);
    // 窄 Dock 的卡片布局同样参与光标与定位（候选也必须能按 id 找到）。
    assert.match(dock, /class:glean-card--cursor=\{keyboardCursorId === entry\.id\}/);
    assert.match(dock, /class="glean-kbdhint"/);
    assert.match(dock, /<kbd>S<\/kbd> \{t\(i18n, "library\.keyboardSelectDisplayed"\)\}/);
    assert.match(dock, /<kbd>F<\/kbd> \{t\(i18n, "library\.keyboardKeepFiltered"\)\}/);
    assert.match(dock, /<kbd>C<\/kbd> \{t\(i18n, "library\.keyboardClearSelection"\)\}/);
    assert.match(dock, /if \(action\.type === "selectDisplayed"\) \{[\s\S]*?selectDisplayedArticles\(\);/);
    assert.match(dock, /if \(action\.type === "keepFiltered"\) \{[\s\S]*?retainSelectionToFilter\(\);/);
    assert.match(dock, /if \(action\.type === "clearSelection"\) \{[\s\S]*?clearSelection\(\);/);
    assert.match(dock, /case "cyclePriority":[\s\S]*?cyclePriorityValue\(entry\.priority\)/);
    assert.match(dock, /case "setPriority":[\s\S]*?await setPriority\(entry, action\.value\)/);
    assert.match(dock, /case "cycleRating":[\s\S]*?cycleRatingValue\(entry\.rating\)/);
    assert.match(dock, /<kbd>P<\/kbd><kbd>1-5<\/kbd> \{t\(i18n, "library\.keyboardPriority"\)\}/);
    assert.match(dock, /<kbd>M<\/kbd> \{t\(i18n, "library\.keyboardRating"\)\}/);
    assert.match(dock, /hasSelection: selection\.size > 0/);
    assert.match(dock, /case "later":[\s\S]*?await setStatus\(entry, "later"\)/);
    assert.match(dock, /case "archive":[\s\S]*?facade\.openArchiveDialog\(entry\.id\)/);
    assert.match(dock, /if \(action\.type === "activate" \|\| action\.type === "openDocument"\) selectPreview\(entry\.id\)/);
    // 移动端不注册键盘流；桌面端只在读库视图接管。
    assert.match(dock, /if \(!root \|\| facade\.isMobile \|\| view !== "library"\) return;/);
});

test("样式：光标描边使用设计令牌并提供强制颜色系统回退", () => {
    assert.match(styles, /\.glean-drow--cursor,\s*\n\.glean-kcard--cursor,\s*\n\.glean-card--cursor\s*\{\s*\n\s*outline: 2px solid var\(--glean-accent-b\);/);
    assert.match(styles, /@media \(forced-colors: active\) \{[\s\S]*?\.glean-drow--cursor,[\s\S]*?outline: 2px solid Highlight;/);
    assert.match(styles, /\.glean-kbdhint[\s\S]*?kbd \{/);
});

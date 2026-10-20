import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";
import { addDisplayedSelection, librarySelectionScope, retainFilteredSelection } from "../src/domain/library-selection.ts";

const dock = readFileSync(new URL("../src/ui/DockPanel.svelte", import.meta.url), "utf8");
const bar = readFileSync(new URL("../src/ui/LibraryBatchBar.svelte", import.meta.url), "utf8");
const transpile = (source: string) => transpileModule(source, { compilerOptions: { target: ScriptTarget.ESNext } }).outputText;
const ids = (count: number) => Array.from({ length: count }, (_, index) => `article-${index}`);

test("选择范围：100 篇同范围只挂载 80 篇，未挂载选择不计为隐藏", () => {
    const all = ids(100);
    const selected = new Set(all);
    assert.deepEqual(librarySelectionScope(selected, all, all.slice(0, 80)), {
        selectedCount: 100, hiddenCount: 0, displayedCount: 80, displayedSelectedCount: 80,
    });
    assert.equal(selected.size, 100);
    assert.equal(all.length, 100);
});

test("选择范围：队列与筛选变化只改变隐藏计数，不修改会话集合", () => {
    const selected = new Set(["inbox-a", "later-b", "later-c"]);
    assert.deepEqual(librarySelectionScope(selected, ["inbox-a"], ["inbox-a"]), {
        selectedCount: 3, hiddenCount: 2, displayedCount: 1, displayedSelectedCount: 1,
    });
    assert.deepEqual(librarySelectionScope(selected, ["later-b", "later-c"], ["later-b"]), {
        selectedCount: 3, hiddenCount: 1, displayedCount: 1, displayedSelectedCount: 1,
    });
    assert.deepEqual(librarySelectionScope(selected, [], []), {
        selectedCount: 3, hiddenCount: 3, displayedCount: 0, displayedSelectedCount: 0,
    });
    assert.deepEqual([...selected], ["inbox-a", "later-b", "later-c"]);
});

test("选择范围：重复 ID 去重，未选中的当前文章不改变已选计数", () => {
    assert.deepEqual(librarySelectionScope(new Set(["a", "hidden"]), ["a", "a", "b"], ["a", "a", "b"]), {
        selectedCount: 2, hiddenCount: 1, displayedCount: 2, displayedSelectedCount: 1,
    });
});

test("选择已显示文章：不可变合并，保留隐藏选择且不会重复选中", () => {
    const selected = new Set(["hidden", "a"]);
    const displayed = ["a", "b", "b"];
    const next = addDisplayedSelection(selected, displayed);
    assert.notEqual(next, selected);
    assert.deepEqual([...next], ["hidden", "a", "b"]);
    assert.deepEqual([...selected], ["hidden", "a"]);
    assert.deepEqual(displayed, ["a", "b", "b"]);
});

test("仅保留当前结果：显式清理隐藏项，保留第 80 篇之后的同范围选择", () => {
    const all = ids(100);
    const selected = new Set([all[0], all[90], "other-queue"]);
    const next = retainFilteredSelection(selected, all);
    assert.notEqual(next, selected);
    assert.deepEqual([...next], [all[0], all[90]]);
    assert.deepEqual([...selected], [all[0], all[90], "other-queue"]);
    assert.equal(retainFilteredSelection(selected, []).size, 0);
});

function scopeProjection(state: Record<string, unknown>) {
    const start = dock.indexOf("const filteredSelectionIds =");
    const end = dock.indexOf("function selectDisplayedArticles()", start);
    assert.ok(start >= 0 && end > start);
    return runInNewContext(`${transpile(dock.slice(start, end))}; ({ filteredSelectionIds, displayedSelectionIds, selectionScope })`, {
        $derived: (value: unknown) => value, librarySelectionScope, ...state,
    });
}

test("实际列表接线：完整结果与显示窗口都排除候选，选择显示项不扩大到未挂载文章", () => {
    const rows = [
        { kind: "clip", id: "article-a" }, { kind: "candidate", id: "candidate-a" },
        { kind: "clip", id: "article-b" },
    ];
    for (const isTabCanvas of [false, true]) {
        const selected = new Set(["article-b", "other-queue"]);
        const result = scopeProjection({ isTabCanvas, layoutMode: "list", rows, visibleRows: rows.slice(0, 2), selection: selected });
        assert.deepEqual(Array.from(result.filteredSelectionIds), ["article-a", "article-b"]);
        assert.deepEqual(Array.from(result.displayedSelectionIds), ["article-a"]);
        assert.equal(result.selectionScope.hiddenCount, 1);
        assert.equal(result.selectionScope.displayedSelectedCount, 0);
        assert.deepEqual([...addDisplayedSelection(selected, result.displayedSelectionIds)], ["article-b", "other-queue", "article-a"]);
    }
});

test("实际看板接线：使用全部状态列的完整结果，显示项按每列挂载窗口累计", () => {
    const kanbanCols = [
        { status: "inbox", items: [{ id: "inbox-a" }, { id: "inbox-b" }] },
        { status: "later", items: [{ id: "later-a" }, { id: "later-b" }] },
        { status: "done", items: [{ id: "done-a" }] },
    ];
    const result = scopeProjection({
        isTabCanvas: true, layoutMode: "kanban", kanbanCols,
        visibleKanbanCols: kanbanCols.map((column) => ({ ...column, items: column.items.slice(0, 1) })),
        selection: new Set(["inbox-b", "later-a", "done-a"]),
        rows: [{ kind: "clip", id: "inbox-a" }], visibleRows: [{ kind: "clip", id: "inbox-a" }],
    });
    assert.deepEqual(Array.from(result.filteredSelectionIds), ["inbox-a", "inbox-b", "later-a", "later-b", "done-a"]);
    assert.deepEqual(Array.from(result.displayedSelectionIds), ["inbox-a", "later-a", "done-a"]);
    assert.equal(result.selectionScope.hiddenCount, 0);
    assert.equal(result.selectionScope.displayedCount, 3);
    assert.equal(result.selectionScope.displayedSelectedCount, 2);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function batchHarness(initial = ["a", "b"]) {
    const start = dock.indexOf("function toggleSelect(");
    const end = dock.indexOf("function openDoc(", start);
    assert.ok(start >= 0 && end > start);
    const writes: Array<{ ids: string[]; status: string }> = [];
    const messages: Array<{ key: string; data?: Record<string, unknown> }> = [];
    const pending: ReturnType<typeof deferred<any>>[] = [];
    const state = {
        selection: new Set(initial), batchBusy: false, offline: false,
        batchAddedDuringRun: new Set<string>(),
        tick: async () => {},
        document: { activeElement: null },
        disposed: false,
        rootEl: null,
        searchInput: null as { focus(options?: { preventScroll?: boolean }): void } | null,
        searchToggle: null,
        canRestoreLibraryFocus: (origin: unknown) => state.document.activeElement === origin,
        restoreLibrarySelectionFocus: () => state.searchInput?.focus({ preventScroll: true }),
        facade: { pluginInstance: {}, settings: { integration: { checkinEnabled: false } }, notifyDataChanged() {} },
        batchSetStatusDetailed: (_plugin: unknown, selectedIds: string[], status: string) => {
            writes.push({ ids: [...selectedIds], status });
            const write = deferred<any>();
            pending.push(write);
            return write.promise;
        },
        reload: async () => {}, index: { clips: {} },
        statusFailureKey: (kind: string) => `failure.${kind}`,
        writeFailureMessage: (_error: unknown, fallback: string) => fallback,
        t: (_i18n: unknown, key: string, data?: Record<string, unknown>) => ({ key, data }), i18n: {},
        showMessage: (message: { key: string; data?: Record<string, unknown> }) => messages.push(message),
        console: { warn() {} },
    };
    const controls = runInNewContext(`${transpile(dock.slice(start, end))}; ({ toggleSelect, batchApply })`, state) as {
        toggleSelect(id: string, event: { stopPropagation(): void }): void;
        batchApply(status: string): Promise<void>;
    };
    return { state, controls, writes, pending, messages, toggle(id: string) { controls.toggleSelect(id, { stopPropagation() {} }); } };
}

const writeResult = (succeeded: string[], failed: string[] = []) => ({
    ok: succeeded.length, succeeded,
    failures: failed.map((id) => ({ id, kind: "network" })), indexSyncFailed: [],
});

test("实际批量状态：冻结点击时 ID，保留失败与运行中新选择，重试不重跑已成功项", async () => {
    const current = batchHarness();
    const first = current.controls.batchApply("archived");
    current.toggle("c");
    assert.deepEqual(current.writes, [{ ids: ["a", "b"], status: "archived" }]);
    current.pending[0].resolve(writeResult(["a"], ["b"]));
    await first;
    assert.deepEqual([...current.state.selection], ["b", "c"]);
    assert.equal(current.state.batchBusy, false);
    assert.equal(current.messages[0].data?.total, 2);
    const retry = current.controls.batchApply("archived");
    assert.deepEqual(current.writes[1], { ids: ["b", "c"], status: "archived" });
    current.pending[1].resolve(writeResult(["b", "c"]));
    await retry;
    assert.equal(current.state.selection.size, 0);
});

test("实际批量状态：运行时取消一项不改变已提交快照，也不会恢复已取消的失败项", async () => {
    const current = batchHarness();
    const first = current.controls.batchApply("reading");
    current.toggle("b");
    current.toggle("c");
    current.pending[0].resolve(writeResult(["a"], ["b"]));
    await first;
    assert.deepEqual(current.writes[0], { ids: ["a", "b"], status: "reading" });
    assert.deepEqual([...current.state.selection], ["c"]);
});

test("实际批量状态：同一 ID 在运行中取消后重新选择，成功回执不清掉新选择", async () => {
    const current = batchHarness();
    const first = current.controls.batchApply("archived");
    current.toggle("a");
    current.toggle("a");
    current.pending[0].resolve(writeResult(["a", "b"]));
    await first;
    assert.deepEqual([...current.state.selection], ["a"]);
});

test("实际批量状态：传输失败保留当前选择、解除忙态并允许显式重试", async () => {
    const current = batchHarness();
    const first = current.controls.batchApply("archived");
    current.toggle("c");
    current.pending[0].reject(new Error("network unavailable"));
    await first;
    assert.deepEqual([...current.state.selection], ["a", "b", "c"]);
    assert.equal(current.state.batchBusy, false);
    assert.equal(current.messages.length, 1);
    const retry = current.controls.batchApply("archived");
    assert.deepEqual(current.writes[1].ids, ["a", "b", "c"]);
    current.pending[1].resolve(writeResult(["a", "b", "c"]));
    await retry;
});

test("实际批量状态：忙态与空选择阻止第二次提交", async () => {
    const current = batchHarness();
    const first = current.controls.batchApply("archived");
    await current.controls.batchApply("done");
    assert.equal(current.writes.length, 1);
    current.pending[0].resolve(writeResult(["a", "b"]));
    await first;
    await current.controls.batchApply("reading");
    assert.equal(current.writes.length, 1);
});

test("实际批量状态：成功清空后等待渲染再回到搜索入口，部分失败不抢焦点", async () => {
    const current = batchHarness();
    const trigger = {};
    const focusCalls: Array<{ preventScroll?: boolean } | undefined> = [];
    current.state.document.activeElement = trigger;
    current.state.rootEl = { getClientRects: () => [{}] };
    current.state.searchInput = { focus: (options) => focusCalls.push(options) };
    const first = current.controls.batchApply("archived");
    current.pending[0].resolve(writeResult(["a", "b"]));
    await first;
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);

    focusCalls.length = 0;
    current.state.selection = new Set(["a", "b"]);
    const retry = current.controls.batchApply("archived");
    current.pending[1].resolve(writeResult(["a"], ["b"]));
    await retry;
    await Promise.resolve();
    assert.deepEqual(focusCalls, []);
    assert.deepEqual([...current.state.selection], ["b"]);
});

test("批量范围说明与操作接线：隐藏项有提示，显示选择/显式清理与 AI 共用会话集合", () => {
    assert.match(bar, /library\.selectionSummary/);
    assert.match(bar, /library\.selectionHidden/);
    assert.match(bar, /library\.selectDisplayed/);
    assert.match(bar, /library\.keepFiltered/);
    assert.match(bar, /aria-atomic="true"/);
    assert.match(dock, /onSelectDisplayed=\{selectDisplayedArticles\}/);
    assert.match(dock, /onKeepFiltered=\{keepFilteredArticles\}/);
    assert.match(dock, /function keepFilteredArticles\(origin: Element \| null = document\.activeElement\)/);
    assert.match(bar, /onKeepFiltered\(origin\)/);
    assert.match(dock, /onClear=\{clearSelection\}/);
    const start = dock.indexOf("function openSelectedAi()");
    const end = dock.indexOf("async function moveTo(", start);
    const state = { batchBusy: false, selection: new Set(["current", "hidden"]), aiBatchIds: [] as string[], aiBatchOpen: false };
    const open = runInNewContext(`${transpile(dock.slice(start, end))}; openSelectedAi`, state) as () => void;
    open();
    assert.deepEqual(Array.from(state.aiBatchIds), ["current", "hidden"]);
    state.selection.add("later");
    assert.deepEqual(Array.from(state.aiBatchIds), ["current", "hidden"]);
    state.batchBusy = true;
    state.aiBatchOpen = false;
    open();
    assert.equal(state.aiBatchOpen, false);
});

test("批量操作焦点：移动 Dock 搜索折叠时，清理/保留后回到可见搜索入口", () => {
    assert.match(dock, /function restoreLibrarySelectionFocus\(\): void/);
    assert.match(dock, /\(searchInput \?\? searchToggle\)\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(dock, /canRestoreLibraryFocus\(origin\)\) restoreLibrarySelectionFocus\(\)/);
    assert.doesNotMatch(dock, /canRestoreLibraryFocus\(origin\)\) searchInput\?\.focus\(\)/);
    const batchStart = dock.indexOf("async function batchApply(status: ClipStatus)");
    const batchEnd = dock.indexOf("async function applySelectedStatus", batchStart);
    assert.ok(batchStart >= 0 && batchEnd > batchStart);
    const batch = dock.slice(batchStart, batchEnd);
    assert.match(batch, /const origin = document\.activeElement/);
    assert.match(batch, /selection\.size === 0/);
    assert.match(batch, /restoreLibrarySelectionFocus\(\)/);
});

test("列表、看板与移动卡片的选择控件都提供可见提示和可编程名称", () => {
    assert.match(dock, /class="glean-kcard__select" title=\{t\(i18n, "library\.selectArticle"\)\}/);
    assert.match(dock, /class="glean-drow__select" title=\{t\(i18n, "library\.selectArticle"\)\}/);
    const mobileCard = /<label class="glean-card__check" title=\{t\(i18n, "library\.selectArticle"\)\}>[\s\S]*?<input[\s\S]*?aria-label=\{t\(i18n, "library\.selectArticle"\)\}[\s\S]*?onclick=\{\(event\) => event\.stopPropagation\(\)\}/;
    assert.match(dock, mobileCard);
});

test("批量条键盘与焦点：获焦在批量条内部时按 Escape 安全取消选择并回退焦点", () => {
    const rawBar = readFileSync(new URL("../src/ui/LibraryBatchBar.svelte", import.meta.url), "utf8");
    assert.match(rawBar, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(rawBar, /if \(event\.key === "Escape" && !busy && selectedCount > 0\) \{/);
    assert.match(rawBar, /if \(barEl && document\.activeElement && barEl\.contains\(document\.activeElement\)\) \{/);
    assert.match(rawBar, /onClear\(\);/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createSourceFile, forEachChild, isFunctionDeclaration, ScriptKind, ScriptTarget, type Node } from "typescript";

const prototype = readFileSync(resolve(import.meta.dirname, "../design/prototype-v2.html"), "utf8");
const script = prototype.match(/<script>([\s\S]*?)<\/script>/)![1];

function harness() {
    const ast = createSourceFile("prototype.js", script, ScriptTarget.Latest, true, ScriptKind.JS);
    const functions = new Map<string, string>();
    const collect = (node: Node) => {
        if (isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
        forEachChild(node, collect);
    };
    collect(ast);
    const names = ["selectedFilterCount", "matchesLibraryRow", "applyLibraryFilters", "librarySelectionRows", "filteredLibrarySelectionRows", "displayedLibrarySelectionInputs", "updateSelection", "retainFilteredLibrarySelection", "selectDisplayedLibraryItems", "clearLibrarySelection", "runAction"];
    const classList = () => {
        const classes = new Set<string>();
        return { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name), toggle: (name: string, value: boolean) => { if (value) classes.add(name); else classes.delete(name); } };
    };
    const element = () => ({ classList: classList(), dataset: {} as Record<string, string>, textContent: "", disabled: false, attrs: {} as Record<string, string>, setAttribute(name: string, value: string) { this.attrs[name] = value; } });
    const makeRow = (id: string, status: string, site: string, rendered = true) => {
        const input = { checked: false, disabled: false };
        const row = {
            dataset: { libraryId: id, status, item: id, site, tags: "阅读", aiTags: "方法", author: "作者", source: "manual", timeSource: "unknown", contentType: "fulltext", time: "2026-10-18" },
            textContent: id, classList: classList(), rendered,
            querySelector: () => input,
            getClientRects: () => row.rendered && !row.classList.contains("hidden") ? [{}] : [],
        };
        return { row, input };
    };
    const samples = [makeRow("first", "inbox", "example.com"), makeRow("second", "reading", "example.org"), makeRow("unrendered", "inbox", "example.com", false)];
    const nodes = new Map<string, ReturnType<typeof element>>();
    for (const selector of ["[data-library-batch]", "[data-selected-count]", "[data-selected-hidden]", "[data-selection-hidden-hint]", '[data-action="library-selection-retain"]', '[data-action="library-selection-displayed"]', '[data-action="batch-done"]', '[data-action="batch-archive"]', '[data-action="batch-ai"]', "[data-library-data]", "[data-library-filter-empty]", "[data-library-empty]", "[data-tag-filter-chip]", "[data-mobile-filter-badge]", '[data-action="mobile-filter-open"]', '[data-action="library-clear"]', "[data-library-result-count]"]) nodes.set(selector, element());
    const library = { dataset: { libraryResult: "data" }, querySelector: (selector: string) => selector === "[data-library-items]" ? list : nodes.get(selector) };
    const list = { querySelectorAll: () => samples.map((sample) => sample.row), append() {} };
    const search = { value: "" }, messages: string[] = [];
    const scope: any = {
        activeQueue: "inbox", appliedFilters: { site: "", tag: "", author: "", aiTag: "", source: "", timeSource: "", contentType: "", sortBy: "time", direction: "desc" },
        filterKeys: ["site", "tag", "author", "aiTag", "source", "timeSource", "contentType"],
        say: (message: string) => messages.push(message),
        document: {
            querySelector: (selector: string) => selector === "#library" ? library : selector === "#library-search" ? search : selector === '#library [data-queue][aria-pressed="true"]' ? { dataset: { queue: scope.activeQueue } } : nodes.get(selector),
            querySelectorAll: (selector: string) => selector === "[data-library-items] [data-library-id]" ? samples.map((sample) => sample.row) : selector === "[data-library-result-count]" ? [nodes.get(selector)] : [nodes.get('[data-action="batch-done"]'), nodes.get('[data-action="batch-archive"]'), nodes.get('[data-action="batch-ai"]')],
        },
    };
    runInNewContext(`${names.map((name) => functions.get(name)).join("\n")}\nObject.assign(globalThis,{applyLibraryFilters,updateSelection,retainFilteredLibrarySelection,selectDisplayedLibraryItems,clearLibrarySelection,runAction});`, scope);
    return { scope, samples, nodes, library, search, messages };
}

test("批量原型控件位于数据容器之外，零选择隐藏并明确合成边界", () => {
    assert.doesNotThrow(() => new Function(script));
    assert.match(prototype, /<\/section>\s*<section class="glean-demo-batch hidden" data-library-batch/);
    assert.match(prototype, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(prototype, /隐藏项仍参与批量/);
    for (const action of ["library-selection-retain", "library-selection-displayed", "library-selection-clear"]) assert.match(prototype, new RegExp(`data-action="${action}"`));
    const state = harness();
    state.scope.updateSelection();
    assert.equal(state.nodes.get("[data-library-batch]")!.classList.contains("hidden"), true);
});

test("切换筛选和队列保留选择，隐藏数量按完整匹配结果而非显示窗口计算", () => {
    const state = harness();
    state.samples[0].input.checked = true;
    state.samples[2].input.checked = true;
    state.scope.applyLibraryFilters();
    assert.equal(state.nodes.get("[data-selected-count]")!.textContent, "已选 2 篇（合成演示）");
    assert.equal(state.nodes.get("[data-selected-hidden]")!.textContent, "当前筛选外 0 篇");
    state.scope.activeQueue = "reading";
    state.scope.applyLibraryFilters();
    assert.equal(state.samples[0].input.checked, true);
    assert.equal(state.samples[2].input.checked, true);
    assert.equal(state.nodes.get("[data-selected-hidden]")!.textContent, "当前筛选外 2 篇");
    assert.equal(state.nodes.get("[data-selection-hidden-hint]")!.classList.contains("hidden"), false);
    assert.equal(state.nodes.get("[data-library-batch]")!.classList.contains("hidden"), false);
    state.scope.appliedFilters.site = "missing.example";
    state.scope.applyLibraryFilters();
    assert.equal(state.nodes.get("[data-library-filter-empty]")!.classList.contains("hidden"), false);
    assert.equal(state.nodes.get("[data-library-batch]")!.classList.contains("hidden"), false);
});

test("看板选择范围包含所有匹配状态，不受列表队列限制", () => {
    const state = harness();
    state.samples[0].input.checked = true;
    state.samples[1].input.checked = true;
    state.scope.activeQueue = "archived";
    state.nodes.get("[data-library-data]")!.dataset.layout = "kanban";
    state.scope.applyLibraryFilters();
    assert.equal(state.nodes.get("[data-selected-hidden]")!.textContent, "当前筛选外 0 篇");
    state.scope.appliedFilters.site = "example.com";
    state.scope.applyLibraryFilters();
    assert.equal(state.nodes.get("[data-selected-hidden]")!.textContent, "当前筛选外 1 篇");
});

test("选择已显示只合并已挂载文章，保留筛选外选择并排除未显示条目", () => {
    const state = harness();
    state.samples[1].input.checked = true;
    state.scope.applyLibraryFilters();
    state.scope.runAction("library-selection-displayed", {});
    assert.deepEqual(state.samples.map((sample) => sample.input.checked), [true, true, false]);
    assert.match(state.messages[0], /已追加选择 1 篇.*筛选外选择仍保留/);
    assert.equal(state.nodes.get('[data-action="library-selection-displayed"]')!.disabled, true);
});

test("仅保留当前筛选显式裁剪全部结果，清空后隐藏批量区", () => {
    const state = harness();
    state.samples.forEach((sample) => sample.input.checked = true);
    state.scope.applyLibraryFilters();
    state.scope.runAction("library-selection-retain", {});
    assert.deepEqual(state.samples.map((sample) => sample.input.checked), [true, false, true]);
    state.scope.runAction("library-selection-clear", {});
    assert.equal(state.samples.some((sample) => sample.input.checked), false);
    assert.equal(state.nodes.get("[data-library-batch]")!.classList.contains("hidden"), true);
});

test("合成批量操作消费全部选中项，包含筛选外选择", () => {
    const state = harness();
    state.samples[0].input.checked = true;
    state.samples[1].input.checked = true;
    state.scope.applyLibraryFilters();
    state.scope.runAction("batch-done", {});
    assert.equal(state.samples.some((sample) => sample.input.checked), false);
    assert.match(state.messages[0], /全部 2 篇选择，含筛选外文章；没有真实写入/);
});

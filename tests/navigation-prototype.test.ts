import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const prototype = readFileSync(resolve(import.meta.dirname, "../design/prototype-v2.html"), "utf8");
const script = prototype.match(/<script>([\s\S]*?)<\/script>/)![1];

test("canonical 原型脚本有效，返回读库入口明确单实例与恢复边界", () => {
    assert.doesNotThrow(() => new Function(script));
    assert.match(prototype, /data-action="reader-library" aria-describedby="library-return-boundary"/);
    assert.match(prototype, /data-library-id="demo-reading" data-status="inbox"/);
    assert.match(prototype, /data-library-target="demo-reading"/);
    assert.match(prototype, /实际由思源 SDK 选择或新建目标工作台/);
    assert.match(prototype, /不承诺原始实例、像素滚动偏移或跨重载恢复/);
    assert.match(script, /case 'reader-library':returnToLibrary\(\);break/);
});

function harness({ hidden = false, missing = false } = {}) {
    const source = script.match(/  function returnToLibrary\(\)\{[\s\S]*?\n  \}/)![0];
    const classes = new Set<string>();
    const messages: string[] = [], scrolls: unknown[] = [], focuses: unknown[] = [], ticks: Array<() => void> = [];
    const filters = { site: hidden ? "example.org" : "example.com", tag: "阅读", sortBy: "rating", direction: "asc" };
    const target = {
        dataset: { libraryId: "demo-reading", status: "inbox" },
        isConnected: true,
        classList: { contains: (name: string) => classes.has(name), add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
        scrollIntoView: (options: unknown) => scrolls.push(options),
        querySelector: () => ({ focus: (options: unknown) => focuses.push(options) }),
    };
    const queues = ["inbox", "reading"].map((queue) => ({ dataset: { queue }, pressed: queue === "reading", setAttribute(_name: string, value: string) { this.pressed = value === "true"; } }));
    const scope: any = {
        activeView: "reader", libraryReturnTimer: 0, layout: "kanban", clearCount: 0,
        document: {
            querySelector: () => ({ dataset: { libraryTarget: "demo-reading" } }),
            querySelectorAll: (selector: string) => selector === "[data-library-items] [data-library-id]" ? (missing ? [] : [target]) : selector === "#library [data-queue]" ? queues : [],
        },
        navigate: (view: string) => { scope.activeView = view; },
        setDemoState: () => {},
        showLibraryResult: () => { if (filters.site !== "example.com") classes.add("hidden"); },
        clearLibraryFilters: () => { scope.clearCount += 1; filters.site = ""; filters.tag = ""; classes.delete("hidden"); },
        queueMicrotask: (callback: () => void) => ticks.push(callback),
        say: (message: string) => messages.push(message),
        setTimeout: () => 1, clearTimeout: () => {},
    };
    runInNewContext(`${source}\nglobalThis.returnToLibrary = returnToLibrary;`, scope);
    return { scope, target, filters, queues, messages, scrolls, focuses, ticks, classes };
}

test("原型返回可见文章保留筛选、排序、队列和布局，并定位确切条目", () => {
    const state = harness();
    const before = { ...state.filters };
    state.scope.returnToLibrary();
    state.ticks.shift()!();
    assert.equal(state.scope.activeView, "library");
    assert.equal(state.scope.clearCount, 0);
    assert.deepEqual(state.filters, before);
    assert.deepEqual(state.queues.map((queue) => queue.pressed), [false, true]);
    assert.equal(state.scope.layout, "kanban");
    assert.equal(state.scrolls.length, 1);
    assert.equal(state.focuses.length, 1);
    assert.equal(state.classes.has("glean-return-target"), true);
    assert.match(state.messages[0], /已保留当前筛选/);
});

test("原型目标被筛掉时才放宽，排序布局保留并切换目标状态队列", () => {
    const state = harness({ hidden: true });
    state.scope.returnToLibrary();
    state.ticks.shift()!();
    assert.equal(state.scope.clearCount, 1);
    assert.deepEqual(state.filters, { site: "", tag: "", sortBy: "rating", direction: "asc" });
    assert.deepEqual(state.queues.map((queue) => queue.pressed), [true, false]);
    assert.equal(state.scope.layout, "kanban");
    assert.match(state.messages[0], /目标被筛掉/);
});

test("原型目标不存在时仅反馈，不清空筛选或制造定位", () => {
    const state = harness({ missing: true });
    state.scope.returnToLibrary();
    assert.equal(state.scope.activeView, "library");
    assert.equal(state.scope.clearCount, 0);
    assert.equal(state.ticks.length, 0);
    assert.match(state.messages[0], /目标文章已不存在/);
});

test("原型提交前主动离页或目标断开不会滚动和聚焦旧条目", () => {
    for (const change of ["view", "disconnected"]) {
        const state = harness();
        state.scope.returnToLibrary();
        if (change === "view") state.scope.activeView = "home";
        else state.target.isConnected = false;
        state.ticks.shift()!();
        assert.deepEqual(state.scrolls, []);
        assert.deepEqual(state.focuses, []);
    }
});

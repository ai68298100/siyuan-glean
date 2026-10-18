import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createSourceFile, isCallExpression, isExpressionStatement, isFunctionDeclaration, ScriptTarget, transpileModule } from "typescript";
import { filterAndSortLibrary } from "../src/domain/library-view.ts";
import { normalizePreviewRatio, previewRatioFromPointer, nextPreviewId } from "../src/domain/workbench-preview.ts";
import { normalizeUiPrefs, loadUiPrefs, saveUiPrefs } from "../src/services/prefs.ts";
import { createProtyleController, type ProtyleInstance } from "../src/libs/protyle-controller.ts";

function navigationHarness() {
    const dock = readFileSync(resolve(import.meta.dirname, "../src/ui/DockPanel.svelte"), "utf8");
    const script = dock.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1];
    const ast = createSourceFile("DockPanel.ts", script, ScriptTarget.Latest, true);
    const functionNames = ["clearFilters", "focusClipById", "focusRowIndex", "canRestoreLibraryFocus", "cancelPendingLibraryFocus", "markPrefsInteraction", "selectMobileView"];
    const functions = functionNames.map((name) => ast.statements.find((item) => isFunctionDeclaration(item) && item.name?.text === name)!.getText(ast));
    const effect = ast.statements.find((item) => isExpressionStatement(item) && isCallExpression(item.expression)
        && item.expression.expression.getText(ast) === "$effect" && item.expression.arguments[0].getText(ast).includes("const id = pendingFocusId;"));
    assert.ok(effect && isExpressionStatement(effect) && isCallExpression(effect.expression));
    const code = transpileModule(`${functions.join("\n")}; globalThis.invoke = focusClipById; globalThis.selectView = selectMobileView; globalThis.focusEffect = (${effect.expression.arguments[0].getText(ast)});`, { compilerOptions: { target: ScriptTarget.ESNext } }).outputText;
    const reloadRequests: Array<() => void> = [];
    const ticks: Array<() => void> = [];
    const scrolls: unknown[] = [];
    const focuses: unknown[] = [];
    const target = {
        isConnected: true,
        scrollIntoView: (options: unknown) => scrolls.push(options),
        querySelector: () => ({ focus: (options: unknown) => focuses.push(options) }),
        classList: { add() {}, remove() {} },
    };
    const rootEl = { isConnected: true, querySelector: () => target, getClientRects: () => [{}] };
    const origin = { isConnected: true };
    const document = { activeElement: origin, body: { isConnected: true } };
    const entry = { id: "article-A", title: "Article A", hpath: "/A", updated: "", kind: "clip", status: "reading", site: "example.org", author: "Author", tags: ["topic"], aiTags: ["ai-topic"], src: "web", timeSource: "clip", contentType: "fulltext" };
    const scope: any = {
        view: "library", loading: false, disposed: false, focusGeneration: 0, focusRequested: false, pendingFocusId: "",
        index: { clips: { "article-A": entry }, candidates: {} },
        activeQueue: "reading", authorTimeline: true, selectedSite: "example.org", selectedAuthor: "Author", selectedTag: "topic", selectedAiTag: "ai-topic", selectedSource: "web", selectedTimeSource: "clip", selectedContentType: "fulltext", keyword: "Article A",
        isTabCanvas: true, layoutMode: "list", previewPrefsTouched: false, previewEnabled: true, previewRevision: 0, previewId: "", previewSplit: null, renderLimit: 80, applyingPrefs: false, prefsLoading: false, prefsUserTouched: false, sortBy: "time", sortDirection: "desc",
        rootEl, document, focusReturnOrigin: null, focusFlashTimer: null, focusFlashTarget: null, CSS: { escape: (value: string) => value },
        window: { setTimeout: () => 1, clearTimeout() {} },
        reload: () => new Promise<void>((resolve) => reloadRequests.push(resolve)),
        tick: () => new Promise<void>((resolve) => ticks.push(resolve)),
    };
    const filtered = (status: string) => filterAndSortLibrary(Object.values(scope.index.clips) as any, {
        status: status as any, site: scope.selectedSite, author: scope.selectedAuthor, tag: scope.selectedTag, aiTag: scope.selectedAiTag, src: scope.selectedSource, timeSource: scope.selectedTimeSource, contentType: scope.selectedContentType, keyword: scope.keyword,
    });
    Object.defineProperty(scope, "rows", { get: () => filtered(scope.authorTimeline ? "all" : scope.activeQueue) });
    Object.defineProperty(scope, "kanbanCols", { get: () => ["inbox", "later", "reading", "done", "archived"].map((status) => ({ items: filtered("all").filter((entry) => entry.status === status) })) });
    Object.defineProperty(scope, "activeFilterKey", { get: () => JSON.stringify([scope.authorTimeline, scope.activeQueue, scope.selectedSite, scope.selectedAuthor, scope.selectedTag, scope.selectedAiTag, scope.selectedSource, scope.selectedTimeSource, scope.selectedContentType, scope.keyword, scope.sortBy, scope.sortDirection]) });
    runInNewContext(code, scope);
    return { scope, reloadRequests, ticks, scrolls, focuses, target, rootEl, document, origin };
}

test("原生正文返回仍可见的工作台文章保留当前筛选、队列、排序布局和预览", async () => {
    const { scope } = navigationHarness();
    scope.view = "resurface";
    scope.previewId = "article-A";
    scope.sortBy = "rating";
    scope.sortDirection = "asc";
    const preserved = [scope.activeQueue, scope.authorTimeline, scope.selectedSite, scope.selectedAuthor, scope.selectedTag, scope.selectedAiTag, scope.selectedSource, scope.selectedTimeSource, scope.selectedContentType, scope.keyword, scope.layoutMode, scope.previewId, scope.sortBy, scope.sortDirection];
    await scope.invoke("article-A");
    assert.equal(scope.view, "library");
    assert.deepEqual([scope.activeQueue, scope.authorTimeline, scope.selectedSite, scope.selectedAuthor, scope.selectedTag, scope.selectedAiTag, scope.selectedSource, scope.selectedTimeSource, scope.selectedContentType, scope.keyword, scope.layoutMode, scope.previewId, scope.sortBy, scope.sortDirection], preserved);
});

test("返回看板在其他队列的可见文章仍保留筛选和队列，分页按目标列扩展", async () => {
    const { scope } = navigationHarness();
    scope.layoutMode = "kanban";
    scope.authorTimeline = false;
    scope.activeQueue = "inbox";
    await scope.invoke("article-A");
    assert.equal(scope.activeQueue, "inbox");
    assert.equal(scope.selectedTag, "topic");
    assert.equal(scope.layoutMode, "kanban");
    scope.renderLimit = 0;
    scope.focusEffect();
    assert.equal(scope.renderLimit, 1);
});

test("只有返回目标被当前筛选隐藏时才放宽，并沿用工作台布局", async () => {
    const { scope } = navigationHarness();
    scope.selectedTag = "unrelated";
    scope.layoutMode = "kanban";
    await scope.invoke("article-A");
    assert.equal(scope.activeQueue, "reading");
    assert.equal(scope.authorTimeline, false);
    assert.equal(scope.selectedTag, "");
    assert.equal(scope.keyword, "");
    assert.equal(scope.layoutMode, "kanban");
    assert.equal(scope.rows[0].id, "article-A");
});

test("窄画布返回读库先收起实际替换列表的预览，宽画布和显式预览入口保持预览", async () => {
    for (const mode of ["narrow", "wide", "explicit", "hidden-host"]) {
        const { scope } = navigationHarness();
        scope.previewId = "article-A";
        scope.previewSplit = {
            querySelector: (selector: string) => ({
                getClientRects: () => mode === "hidden-host" ? [] : selector === ".glean-lib__main" && mode !== "wide" ? [] : [{}],
            }),
        };
        await scope.invoke("article-A", mode === "explicit");
        assert.equal(scope.previewId, mode === "narrow" ? "" : "article-A");
        assert.equal(scope.previewEnabled, true);
        assert.equal(scope.selectedTag, "topic");
        assert.equal(scope.keyword, "Article A");
        if (mode === "narrow") assert.equal(scope.previewRevision, 1);
    }
});

test("同篇重复返回等待对账时只有最新请求调整筛选，卸载后不调整", async () => {
    const { scope, reloadRequests } = navigationHarness();
    scope.loading = true;
    const older = scope.invoke("article-A");
    const newer = scope.invoke("article-A");
    scope.loading = false;
    reloadRequests[1]();
    await newer;
    scope.selectedTag = "user-changed";
    reloadRequests[0]();
    await older;
    assert.equal(scope.selectedTag, "user-changed");
    scope.loading = true;
    const closing = scope.invoke("article-A");
    scope.disposed = true;
    reloadRequests[2]();
    await closing;
    assert.equal(scope.selectedTag, "user-changed");
});

test("等待读库对账期间主动移焦会取消迟到定位，保留用户当前筛选", async () => {
    const { scope, reloadRequests, document } = navigationHarness();
    scope.loading = true;
    scope.selectedTag = "unrelated";
    const pending = scope.invoke("article-A");
    document.activeElement = { isConnected: true };
    reloadRequests.shift()!();
    await pending;
    assert.equal(scope.selectedTag, "unrelated");
    assert.equal(scope.pendingFocusId, "");
});

test("主动切离后返回读库不重放旧定位，取消定位仍阻止迟到默认视图恢复", async () => {
    const { scope, ticks, scrolls, focuses } = navigationHarness();
    scope.prefsLoading = true;
    await scope.invoke("article-A");
    scope.focusEffect();
    scope.selectView("stats");
    scope.selectView("library");
    ticks.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    scope.focusEffect();
    assert.equal(scope.pendingFocusId, "");
    assert.equal(scope.focusRequested, true);
    assert.equal(scope.prefsUserTouched, true);
    assert.equal(ticks.length, 0);
    assert.deepEqual(scrolls, []);
    assert.deepEqual(focuses, []);
});

test("对账期间在原焦点修改筛选仍取消旧请求，不清除用户新筛选", async () => {
    const { scope, reloadRequests } = navigationHarness();
    scope.loading = true;
    const pending = scope.invoke("article-A");
    scope.selectedTag = "user-new-filter";
    reloadRequests.shift()!();
    await pending;
    assert.equal(scope.selectedTag, "user-new-filter");
    assert.equal(scope.pendingFocusId, "");
});

test("渲染期间修改排序或布局会取消旧定位，不因同一焦点而滚动重排结果", async () => {
    for (const changeLayout of [false, true]) {
        const { scope, ticks, scrolls, focuses } = navigationHarness();
        await scope.invoke("article-A");
        scope.focusEffect();
        if (changeLayout) scope.layoutMode = "kanban";
        else scope.sortDirection = "asc";
        ticks.shift()!();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(scope.pendingFocusId, "");
        assert.deepEqual(scrolls, []);
        assert.deepEqual(focuses, []);
    }
});

test("工作台等待渲染期间主动移焦或宿主页签隐藏时不回焦、不滚动", async () => {
    for (const hidden of [false, true]) {
        const harness = navigationHarness();
        await harness.scope.invoke("article-A");
        harness.scope.focusEffect();
        if (hidden) harness.rootEl.getClientRects = () => [];
        else harness.document.activeElement = { isConnected: true };
        harness.ticks.shift()!();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(harness.scrolls, []);
        assert.deepEqual(harness.focuses, []);
        assert.equal(harness.scope.pendingFocusId, "");
    }
});

test("原焦点节点被渲染移除且焦点退回 body 时仍能恢复到返回文章标题", async () => {
    const { scope, ticks, document, origin, scrolls, focuses } = navigationHarness();
    await scope.invoke("article-A");
    scope.focusEffect();
    origin.isConnected = false;
    document.activeElement = document.body;
    ticks.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scrolls.length, 1);
    assert.equal(focuses.length, 1);
    assert.equal(scope.pendingFocusId, "");
});

test("工作台渲染迟到不会滚动新视图或断开的节点，同篇新请求仅滚动和聚焦一次", async () => {
    const first = navigationHarness();
    await first.scope.invoke("article-A");
    first.scope.focusEffect();
    first.scope.view = "stats";
    first.ticks.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(first.scrolls, []);
    const disconnected = navigationHarness();
    await disconnected.scope.invoke("article-A");
    disconnected.scope.focusEffect();
    disconnected.rootEl.isConnected = false;
    disconnected.ticks.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(disconnected.scrolls, []);
    const repeated = navigationHarness();
    await repeated.scope.invoke("article-A");
    repeated.scope.focusEffect();
    await repeated.scope.invoke("article-A");
    repeated.scope.focusEffect();
    repeated.ticks[0]();
    repeated.ticks[1]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(repeated.scrolls.length, 1);
    assert.equal((repeated.scrolls[0] as { block: string }).block, "nearest");
    assert.equal(repeated.focuses.length, 1);
    assert.equal((repeated.focuses[0] as { preventScroll: boolean }).preventScroll, true);
});

test("预览宽度：有限比例、边界和无效拖动尺寸", () => {
    for (const value of [undefined, null, "0.5", NaN, Infinity, {}]) assert.equal(normalizePreviewRatio(value), 0.45);
    assert.equal(normalizePreviewRatio(0.1), 0.25);
    assert.equal(normalizePreviewRatio(0.9), 0.65);
    assert.equal(previewRatioFromPointer(550, 1000, 1000), 0.45);
    assert.equal(previewRatioFromPointer(0, 1000, 1000), 0.65);
    assert.equal(previewRatioFromPointer(550, 1000, 0), null);
    assert.equal(previewRatioFromPointer(NaN, 1000, 1000), null);
});

test("连续分拣：按操作前顺序选仍可见下一项，末项回到上一项，无候选关闭", () => {
    assert.equal(nextPreviewId(["a", "b", "c", "d"], ["d", "a", "c"], "b"), "c");
    assert.equal(nextPreviewId(["a", "b", "c"], ["a", "b"], "c"), "b");
    assert.equal(nextPreviewId(["a"], ["a", "new"], "a"), "");
    assert.equal(nextPreviewId(["a"], [], "a"), "");
    assert.equal(nextPreviewId(["a"], ["a"], "missing"), "");
});

test("预览偏好：严格开关、夹取比例，与阅读/侧栏并发保存互不覆盖", async () => {
    for (const value of [undefined, null, "false", 0]) assert.equal(normalizeUiPrefs({ workbenchPreviewEnabled: value }).workbenchPreviewEnabled, true);
    assert.equal(normalizeUiPrefs({ workbenchPreviewEnabled: false }).workbenchPreviewEnabled, false);
    let data: unknown;
    const plugin = { async loadData() { return data; }, async saveData(_file: string, value: unknown) { data = value; } } as never;
    await Promise.all([
        saveUiPrefs(plugin, { workbenchPreviewEnabled: false }),
        saveUiPrefs(plugin, { workbenchPreviewRatio: 0.99 }),
        saveUiPrefs(plugin, { readerSidebarCollapsed: true, libraryRailGroups: { tags: { collapsed: true, expanded: true } } }),
    ]);
    const prefs = await loadUiPrefs(plugin);
    assert.equal(prefs.workbenchPreviewEnabled, false);
    assert.equal(prefs.workbenchPreviewRatio, 0.65);
    assert.equal(prefs.readerSidebarCollapsed, true);
    assert.equal(prefs.libraryRailGroups.tags.expanded, true);
});

function controllerHarness() {
    let mountCount = 0;
    const children: Array<{ className: string; removed: boolean; remove(): void }> = [];
    const host = {
        ownerDocument: { createElement() { return { className: "", removed: false, remove() { this.removed = true; } }; } },
        replaceChildren(child: typeof children[number]) { children.push(child); },
    } as unknown as HTMLElement;
    const calls: string[] = [];
    let complete: (instance: ProtyleInstance) => void = () => {};
    let resize: () => void = () => {};
    const instance: ProtyleInstance = {
        switchMode(mode) { calls.push(mode); }, resize() { calls.push("resize"); }, destroy() { calls.push("destroy"); },
    };
    const options = {
        host, mode: "preview" as const,
        create(_mount: HTMLElement, ready: (instance: ProtyleInstance) => void) { mountCount += 1; complete = ready; return instance; },
        observe(_host: HTMLElement, callback: () => void) { resize = callback; return () => calls.push("disconnect"); },
        onReady() { calls.push("ready"); },
    };
    return { options, calls, children, instance, ready(withInstance?: ProtyleInstance) { complete(withInstance ?? instance); }, resize() { resize(); }, mounts() { return mountCount; } };
}

test("Protyle：加载前模式意图保留，同文模式切换不重建，resize和销毁幂等", () => {
    const harness = controllerHarness();
    const controller = createProtyleController(harness.options);
    controller.setMode("wysiwyg");
    harness.resize();
    assert.deepEqual(harness.calls, []);
    harness.ready();
    assert.deepEqual(harness.calls, ["ready", "wysiwyg", "resize"]);
    controller.setMode("wysiwyg");
    controller.setMode("preview");
    harness.resize();
    assert.equal(harness.mounts(), 1);
    assert.deepEqual(harness.calls.slice(3), ["preview", "resize"]);
    controller.destroy();
    controller.destroy();
    controller.setMode("wysiwyg");
    harness.resize();
    assert.deepEqual(harness.calls.slice(-2), ["disconnect", "destroy"]);
    assert.equal(harness.children[0].removed, true);
});

test("Protyle：切文使用独立子宿主，迟到ready只清理旧实例", () => {
    const old = controllerHarness();
    const oldController = createProtyleController(old.options);
    oldController.destroy();
    const current = controllerHarness();
    createProtyleController({ ...current.options, host: old.options.host });
    old.ready();
    // 迟到 ready 传回的是 destroy() 已销毁过的同一实例：不重复销毁
    assert.deepEqual(old.calls, ["disconnect", "destroy"]);
    assert.equal(old.calls.includes("ready"), false);
    assert.equal(old.children.length, 2);
    assert.equal(old.children[0].removed, true);
    assert.equal(old.children[1].removed, false);
    // 迟到 ready 若带来未被销毁过的新实例，仍要销毁防止泄漏
    const late = controllerHarness();
    const lateController = createProtyleController(late.options);
    lateController.destroy();
    const fresh: ProtyleInstance = { switchMode() {}, resize() {}, destroy() { late.calls.push("destroy"); } };
    late.ready(fresh);
    assert.deepEqual(late.calls, ["disconnect", "destroy", "destroy"]);
    current.ready();
    assert.deepEqual(current.calls, ["ready", "resize"]);
});

test("Protyle：构造与resize异常可反馈，不遗留挂载节点", () => {
    const harness = controllerHarness();
    const errors: unknown[] = [];
    createProtyleController({ ...harness.options, create() { throw new Error("unavailable"); }, onError: (error) => errors.push(error) });
    assert.equal(errors.length, 1);
    assert.equal(harness.children[0].removed, true);
    const next = controllerHarness();
    next.instance.resize = () => { throw new Error("resize failed"); };
    const controller = createProtyleController({ ...next.options, onError: (error) => errors.push(error) });
    next.ready();
    assert.equal(errors.length, 2);
    controller.destroy();
});

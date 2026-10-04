import test from "node:test";
import assert from "node:assert/strict";
import { normalizePreviewRatio, previewRatioFromPointer, nextPreviewId } from "../src/domain/workbench-preview.ts";
import { normalizeUiPrefs, loadUiPrefs, saveUiPrefs } from "../src/services/prefs.ts";
import { createProtyleController, type ProtyleInstance } from "../src/libs/protyle-controller.ts";

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
    return { options, calls, children, instance, ready() { complete(instance); }, resize() { resize(); }, mounts() { return mountCount; } };
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
    assert.deepEqual(old.calls, ["disconnect", "destroy", "destroy"]);
    assert.equal(old.calls.includes("ready"), false);
    assert.equal(old.children.length, 2);
    assert.equal(old.children[0].removed, true);
    assert.equal(old.children[1].removed, false);
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

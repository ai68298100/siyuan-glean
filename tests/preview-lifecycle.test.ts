import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const preview = readFileSync(new URL("../src/ui/WorkbenchPreview.svelte", import.meta.url), "utf8");
const protyle = readFileSync(new URL("../src/ui/ProtyleHost.svelte", import.meta.url), "utf8");
const transpile = (source: string) => transpileModule(source, { compilerOptions: { target: ScriptTarget.ESNext } }).outputText;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function previewHarness() {
    const start = preview.indexOf("    async function process(");
    const end = preview.indexOf("    function statusAction(", start);
    assert.ok(start >= 0 && end > start);
    const calls: string[] = [];
    const state = {
        busy: false, mounted: true, editingUrl: true, entry: { id: "article-a" },
        untrack: (callback: () => unknown) => callback(),
        onProcessed: async () => { calls.push("processed"); },
        onRefresh: async () => { calls.push("refresh"); },
        showMessage: (_text: string) => { calls.push("message"); },
        t: (_i18n: unknown, key: string) => key, i18n: {},
        facade: { notifyDataChanged: () => { calls.push("notify"); } },
        load: async () => { calls.push("load"); },
        fail: () => { calls.push("failed"); },
    };
    const process = runInNewContext(`${transpile(preview.slice(start, end))}; process`, state) as (action: () => Promise<unknown>, successKey: string, advance?: boolean) => Promise<void>;
    return { calls, state, process };
}

test("预览慢写：离页成功只广播真实数据，不提示、推进或刷新旧页面", async () => {
    for (const abandon of ["close", "switch"] as const) {
        for (const advance of [true, false]) {
            const current = previewHarness();
            const write = deferred<{ indexSyncFailed: boolean }>();
            const pending = current.process(() => write.promise, "success", advance);
            if (abandon === "close") current.state.mounted = false;
            else current.state.entry = { id: "article-b" };
            write.resolve({ indexSyncFailed: false });
            await pending;
            assert.deepEqual(current.calls, ["notify"], `${abandon}, advance=${advance}`);
            assert.equal(current.state.editingUrl, true);
        }
    }
});

test("预览慢写：离页失败静默，当前页面失败仍显示并重新读回", async () => {
    for (const abandon of ["close", "switch", "stay"] as const) {
        const current = previewHarness();
        const write = deferred<void>();
        const pending = current.process(() => write.promise, "success");
        if (abandon === "close") current.state.mounted = false;
        if (abandon === "switch") current.state.entry = { id: "article-b" };
        write.reject(new Error("write rejected"));
        await pending;
        assert.deepEqual(current.calls, abandon === "stay" ? ["failed", "load"] : []);
        if (abandon === "stay") assert.equal(current.state.busy, false);
    }
});

test("预览写入：当前页面先广播再反馈，刷新期间离页不继续回填", async () => {
    const current = previewHarness();
    await current.process(async () => ({ indexSyncFailed: true }), "success");
    assert.deepEqual(current.calls, ["notify", "message", "processed"]);
    assert.equal(current.state.busy, false);

    const refreshed = previewHarness();
    const refresh = deferred<void>();
    const refreshStarted = deferred<void>();
    refreshed.state.onRefresh = async () => { refreshed.calls.push("refresh"); refreshStarted.resolve(); await refresh.promise; };
    const pending = refreshed.process(async () => ({}), "success", false);
    await refreshStarted.promise;
    refreshed.state.mounted = false;
    refresh.resolve();
    await pending;
    assert.deepEqual(refreshed.calls, ["notify", "message", "refresh"]);
    assert.equal(refreshed.state.editingUrl, true);
});

test("预览离页或忙碌时不启动第二次写入", async () => {
    for (const initial of [{ mounted: false, busy: false }, { mounted: true, busy: true }]) {
        const current = previewHarness();
        Object.assign(current.state, initial);
        await current.process(async () => { current.calls.push("write"); }, "success");
        assert.deepEqual(current.calls, []);
    }
});

class FocusNode {
    isConnected = true;
    parent: FocusNode | null = null;
    ownerDocument!: FocusDocument;
    listeners = new Map<string, Set<(event: { target: FocusNode }) => void>>();
    addEventListener(type: string, listener: (event: { target: FocusNode }) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
    }
    removeEventListener(type: string, listener: (event: { target: FocusNode }) => void) { this.listeners.get(type)?.delete(listener); }
    emit(type: string, target: FocusNode) { for (const listener of this.listeners.get(type) ?? []) listener({ target }); }
    contains(target: FocusNode): boolean { return target === this || Boolean(target.parent && this.contains(target.parent)); }
    focus() { this.ownerDocument.focus(this); }
}

class FocusDocument extends FocusNode {
    body = new FocusNode();
    activeElement: FocusNode = this.body;
    host!: FocusNode;
    constructor() { super(); this.ownerDocument = this; this.body.ownerDocument = this; }
    focus(target: FocusNode) {
        this.activeElement = target;
        if (this.host?.contains(target)) this.host.emit("focusin", target);
        this.emit("focusin", target);
    }
}

function focusHarness() {
    const start = protyle.indexOf("    $effect(() => {");
    const end = protyle.indexOf("    $effect(() => {\n        const element = host;\n        const id = docId;", start);
    assert.ok(start >= 0 && end > start);
    const owner = new FocusDocument();
    const host = new FocusNode();
    const origin = new FocusNode();
    const retry = new FocusNode();
    const external = new FocusNode();
    for (const node of [host, origin, retry, external]) node.ownerDocument = owner;
    origin.parent = host;
    owner.host = host;
    const effects: Array<() => (() => void) | undefined> = [];
    const state = {
        host, docId: "article-a", hostHadFocus: false, hostFocusOrigin: null as FocusNode | null,
        stage: "ready", retryButton: retry, tick: () => Promise.resolve(), Node: FocusNode,
        $effect: (effect: () => (() => void) | undefined) => effects.push(effect),
    };
    runInNewContext(transpile(protyle.slice(start, end)), state);
    const observeCleanup = effects[0]()!;
    return {
        owner, host, origin, retry, external, state,
        fail() { state.stage = "failed"; return effects[1](); },
        dispose() { observeCleanup(); },
    };
}

test("正文失败回焦：确切正文焦点及节点移除后的 body 退路可交给重试", async () => {
    for (const removed of [false, true]) {
        const current = focusHarness();
        current.owner.focus(current.origin);
        if (removed) { current.origin.isConnected = false; current.owner.activeElement = current.owner.body; }
        current.fail();
        await Promise.resolve();
        assert.equal(current.owner.activeElement, current.retry);
        current.dispose();
    }
});

test("正文失败回焦：失败前或 tick 等待期间的主动移焦不会被抢回", async () => {
    for (const beforeFailure of [false, true]) {
        const current = focusHarness();
        current.owner.focus(current.origin);
        if (beforeFailure) current.owner.focus(current.external);
        current.fail();
        if (!beforeFailure) current.owner.focus(current.external);
        await Promise.resolve();
        assert.equal(current.owner.activeElement, current.external);
        current.dispose();
    }
});

test("正文失败回焦：曾主动移焦后节点消失也不会复用旧焦点资格", async () => {
    const current = focusHarness();
    current.owner.focus(current.origin);
    current.owner.focus(current.external);
    current.origin.isConnected = false;
    current.external.isConnected = false;
    current.owner.activeElement = current.owner.body;
    current.fail();
    await Promise.resolve();
    assert.equal(current.owner.activeElement, current.owner.body);
    current.dispose();
});

test("正文失败回焦：销毁、切换宿主或移除重试按钮使迟到回焦失效", async () => {
    for (const abandon of ["destroy", "switch", "target-removed"] as const) {
        const current = focusHarness();
        current.owner.focus(current.origin);
        const cleanup = current.fail();
        if (abandon === "destroy") cleanup?.();
        if (abandon === "switch") current.state.host = new FocusNode();
        if (abandon === "target-removed") current.retry.isConnected = false;
        await Promise.resolve();
        assert.equal(current.owner.activeElement, current.origin, abandon);
        current.dispose();
        assert.equal(current.owner.listeners.get("focusin")?.size, 0);
        assert.equal(current.host.listeners.get("focusin")?.size, 0);
    }
});

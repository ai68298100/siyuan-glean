import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-context-controller:siyuan", shortCircuit: true };
        if (specifier === "svelte") return { url: "glean-context-controller:svelte", shortCircuit: true };
        if (specifier.endsWith("/ReadingContext.svelte")) return { url: "glean-context-controller:component", shortCircuit: true };
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-context-controller:siyuan") return {
            format: "module", shortCircuit: true,
            source: "export const getAllEditor = () => globalThis.__gleanContextController.editors;",
        };
        if (url === "glean-context-controller:svelte") return {
            format: "module", shortCircuit: true,
            source: "export const mount = (...args) => globalThis.__gleanContextController.mount(...args); export const unmount = (...args) => globalThis.__gleanContextController.unmount(...args);",
        };
        if (url === "glean-context-controller:component") return { format: "module", source: "export default {};", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { installReadingContext } = await import("../src/ui/reading-context-controller.ts");

class FakeElement {
    className = "";
    parentElement = null;
    children = [];
    constructor(connected = false) { this.connectedRoot = connected; }
    get isConnected() { return this.connectedRoot || Boolean(this.parentElement?.isConnected); }
    closest(selector) {
        if (selector === ".glean-protyle-host" && this.className.split(/\s+/).includes("glean-protyle-host")) return this;
        return this.parentElement?.closest(selector) ?? null;
    }
    prepend(element) {
        element.remove();
        element.parentElement = this;
        this.children.unshift(element);
    }
    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((element) => element !== this);
        this.parentElement = null;
    }
}

function harness() {
    const listeners = new Map();
    const mounts = [];
    const unmounts = [];
    const refreshes = [];
    const editors = [];
    const body = new FakeElement(true);
    const bus = {
        on(name, handler) { listeners.set(name, [...listeners.get(name) ?? [], handler]); },
        off(name, handler) { listeners.set(name, (listeners.get(name) ?? []).filter((current) => current !== handler)); },
        emit(name, protyle) { for (const handler of [...listeners.get(name) ?? []]) handler({ detail: { protyle } }); },
    };
    const current = {
        editors, mounts, unmounts, refreshes, listeners, bus, body,
        mount(_component, options) {
            const instance = { target: options.target, props: options.props };
            mounts.push(instance);
            return instance;
        },
        unmount(instance) { unmounts.push(instance); return Promise.resolve(); },
        editor(id, parent = body) {
            const element = new FakeElement();
            element.className = "protyle";
            parent.prepend(element);
            const protyle = { element, block: { rootID: id } };
            editors.push({ protyle });
            return protyle;
        },
        start() { return installReadingContext({ pluginInstance: { eventBus: bus } }); },
        onRefresh: null,
    };
    Object.assign(globalThis, {
        HTMLElement: FakeElement,
        __gleanContextController: current,
        document: {
            createElement() { return new FakeElement(); },
            dispatchEvent(event) {
                assert.equal(event.type, "glean:reading-context-refresh");
                refreshes.push(event.detail.id);
                current.onRefresh?.();
                return true;
            },
        },
    });
    return current;
}

test("普通长文重复分段加载保持原挂载，不请求属性刷新或重建骨架屏", (t) => {
    const current = harness();
    const protyle = current.editor("20261016120000-normal1");
    t.after(current.start());
    const target = protyle.element.children[0];
    for (let index = 0; index < 30; index += 1) {
        current.bus.emit("loaded-protyle-dynamic", protyle);
        current.bus.emit("loaded-protyle-static", protyle);
    }
    assert.equal(current.mounts.length, 1);
    assert.equal(current.unmounts.length, 0);
    assert.deepEqual(current.refreshes, []);
    assert.deepEqual(protyle.element.children, [target]);
    assert.equal(target.isConnected, true);
});

test("切回旧编辑器保鲜一次，重复激活和正文加载不重复请求", (t) => {
    const current = harness();
    const first = current.editor("20261016120000-first01");
    const second = current.editor("20261016120000-second1");
    t.after(current.start());
    current.bus.emit("switch-protyle", first);
    for (let index = 0; index < 10; index += 1) {
        current.bus.emit("switch-protyle", first);
        current.bus.emit("loaded-protyle-dynamic", first);
    }
    current.bus.emit("switch-protyle", second);
    current.bus.emit("switch-protyle", first);
    current.bus.emit("switch-protyle", first);
    assert.deepEqual(current.refreshes, [first.block.rootID, second.block.rootID, first.block.rootID]);
    assert.equal(current.mounts.length, 2);
    assert.equal(current.unmounts.length, 0);
});

test("分屏同文档按编辑器激活去重，刷新期间重入switch不会产生循环", (t) => {
    const current = harness();
    const first = current.editor("20261016120000-shared1");
    const second = current.editor(first.block.rootID);
    t.after(current.start());
    current.onRefresh = () => current.bus.emit("switch-protyle", first);
    current.bus.emit("switch-protyle", first);
    assert.deepEqual(current.refreshes, [first.block.rootID]);
    current.onRefresh = null;
    current.bus.emit("switch-protyle", second);
    current.bus.emit("switch-protyle", second);
    current.bus.emit("switch-protyle", first);
    assert.equal(current.refreshes.length, 3);
    assert.equal(current.mounts.length, 2);
});

test("阅读页签和工作台内嵌Protyle从首次扫描及后续宿主事件中排除", (t) => {
    const current = harness();
    const native = current.editor("20261016120000-native1");
    const embedded = [];
    for (const surface of ["glean-reader__host", "glean-preview__body"]) {
        const host = new FakeElement();
        host.className = `glean-protyle-host ${surface}`;
        current.body.prepend(host);
        const mount = new FakeElement();
        mount.className = "glean-protyle-mount";
        host.prepend(mount);
        embedded.push(current.editor("20261016120000-inside1", mount));
    }
    t.after(current.start());
    current.bus.emit("switch-protyle", native);
    for (const protyle of embedded) {
        current.bus.emit("loaded-protyle-static", protyle);
        current.bus.emit("loaded-protyle-dynamic", protyle);
        current.bus.emit("switch-protyle", protyle);
        assert.deepEqual(protyle.element.children, []);
    }
    current.bus.emit("switch-protyle", native);
    assert.equal(current.mounts.length, 1);
    assert.deepEqual(current.refreshes, [native.block.rootID, native.block.rootID]);
});

test("已有错误挂载进入内嵌宿主后卸载清理，恢复为原生编辑器可重新挂载", (t) => {
    const current = harness();
    const protyle = current.editor("20261016120000-native1");
    t.after(current.start());
    const oldTarget = protyle.element.children[0];
    const embeddedHost = new FakeElement();
    embeddedHost.className = "glean-protyle-host";
    current.body.prepend(embeddedHost);
    embeddedHost.prepend(protyle.element);
    current.bus.emit("loaded-protyle-dynamic", protyle);
    assert.equal(current.unmounts.length, 1);
    assert.equal(oldTarget.isConnected, false);
    assert.deepEqual(protyle.element.children, []);
    current.bus.emit("switch-protyle", protyle);
    assert.equal(current.mounts.length, 1);
    current.body.prepend(protyle.element);
    current.bus.emit("loaded-protyle-static", protyle);
    assert.equal(current.mounts.length, 2);
    assert.notEqual(protyle.element.children[0], oldTarget);
});

test("真实根文档切换、目标丢失和编辑器销毁各自只重建必要的挂载", (t) => {
    const current = harness();
    const protyle = current.editor("20261016120000-before1");
    t.after(current.start());
    const firstTarget = protyle.element.children[0];
    protyle.block.rootID = "20261016120000-after01";
    current.bus.emit("switch-protyle", protyle);
    assert.equal(current.mounts.length, 2);
    assert.equal(current.unmounts.length, 1);
    assert.equal(firstTarget.isConnected, false);
    assert.equal(current.mounts[1].props.docId, protyle.block.rootID);
    assert.deepEqual(current.refreshes, []);
    protyle.element.children[0].remove();
    current.bus.emit("loaded-protyle-static", protyle);
    assert.equal(current.mounts.length, 3);
    assert.equal(current.unmounts.length, 2);
    current.bus.emit("destroy-protyle", protyle);
    current.bus.emit("destroy-protyle", protyle);
    assert.equal(current.unmounts.length, 3);
    assert.deepEqual(protyle.element.children, []);
    current.bus.emit("loaded-protyle-static", protyle);
    assert.equal(current.mounts.length, 4);
});

test("根文档消失和插件卸载移除上下文与全部事件监听", () => {
    const current = harness();
    const first = current.editor("20261016120000-first01");
    const second = current.editor("20261016120000-second1");
    const dispose = current.start();
    first.block.rootID = "";
    current.bus.emit("loaded-protyle-static", first);
    current.bus.emit("loaded-protyle-dynamic", { element: null });
    assert.deepEqual(first.element.children, []);
    assert.equal(current.unmounts.length, 1);
    dispose();
    dispose();
    assert.equal(current.unmounts.length, 2);
    assert.deepEqual(second.element.children, []);
    assert.equal([...current.listeners.values()].flat().length, 0);
    current.bus.emit("loaded-protyle-static", first);
    assert.equal(current.mounts.length, 2);
});

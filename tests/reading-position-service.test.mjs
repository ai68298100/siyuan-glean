import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import ts from "typescript";

const controlsUrl = new URL("../src/ui/ReadingPositionControls.svelte", import.meta.url);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-position:siyuan", shortCircuit: true };
        if (specifier.startsWith("glean-position:controls-")) return { url: specifier, shortCircuit: true };
        if (specifier.startsWith(".")) {
            const qualified = /\.[cm]?[jt]s$/.test(specifier) ? specifier : `${specifier}.ts`;
            return nextResolve(context.parentURL?.startsWith("glean-position:controls-") ? new URL(qualified, controlsUrl).href : qualified, context);
        }
        return nextResolve(specifier, context.parentURL?.startsWith("glean-position:controls-") ? { ...context, parentURL: controlsUrl.href } : context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-position:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanPositionPost(...args);", shortCircuit: true };
        if (url.startsWith("glean-position:controls-")) {
            const script = readFileSync(controlsUrl, "utf8").match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
            const runes = `const $props = () => globalThis.__gleanPositionProps; const $state = Object.assign((value) => value, { raw: (value) => value }); const $derived = (value) => value; const $effect = (callback) => globalThis.__gleanPositionEffects.push(callback);`;
            const probe = `export const controls = { reload, remember, restore, openSavedBlock, change(id, element) { docId = id; host = element; }, inspect() { return { snapshot, busy, messageKey, blockFallback }; } };`;
            const source = ts.transpileModule(`${runes}\n${script}\n${probe}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
            return { format: "module", source, shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});

const { readReadingPosition, saveReadingPosition, verifyReadingBlock, ClipRestoreError } = await import("../src/services/clip-store.ts");
const { captureReadingPosition, restoreReadingPosition, readingViewport } = await import("../src/libs/reading-position.ts");
const docId = "20261004120000-aaaaaaa";
const otherDocId = "20261004120000-bbbbbbb";
const blockId = "20261004120000-ccccccc";
const otherBlockId = "20261004120000-ddddddd";
const position = { version: 1, blockId, offset: 125, at: "2026-10-04T04:00:00.000Z" };
const positionKey = "custom-clip-reading-position";

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function harness() {
    const calls = [];
    const files = new Map();
    const attrs = new Map();
    const documents = new Map();
    const blocks = new Map([[blockId, docId], [otherBlockId, otherDocId]]);
    const hooks = {};
    const state = { writeBeforeFailure: false, writeFailure: false, discardWrite: false, indexFailure: false };
    for (const id of [docId, otherDocId]) {
        documents.set(id, { id, content: id, box: "test-box", hpath: `/${id}`, updated: "20261004120000" });
        attrs.set(id, { "custom-clip-status": "reading", "custom-clip-author": "用户", "custom-clip-url": "https://example.test/article", "custom-clip-priority": "5", "custom-clip-rating": "4", "custom-clip-done-time": "20261001000000", "custom-clip-minutes": "10", tags: "用户标签" });
    }
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { if (state.indexFailure) throw new Error("private index failure"); files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanPositionPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        await hooks[route]?.(body);
        if (route === "/api/query/sql") {
            const id = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
            if (/SELECT id, root_id/.test(body.stmt)) return { code: 0, data: blocks.has(id) ? [{ id, root_id: blocks.get(id) }] : [] };
            return { code: 0, data: documents.has(id) ? [{ ...documents.get(id) }] : [] };
        }
        if (route === "/api/attr/getBlockAttrs") return { code: 0, data: { ...attrs.get(body.id) } };
        if (route === "/api/attr/setBlockAttrs") {
            if (!state.discardWrite && (!state.writeFailure || state.writeBeforeFailure)) attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs });
            if (state.writeFailure) throw new Error("private write failure");
            return { code: 0, data: null };
        }
        throw new Error(`未模拟端点：${route}`);
    };
    return { calls, files, attrs, documents, blocks, hooks, state, plugin, writes: () => calls.filter((call) => call.route === "/api/attr/setBlockAttrs") };
}

function element(parent = null, options = {}) {
    const children = [];
    const attributes = new Map(Object.entries(options.attributes ?? {}));
    const ownerDocument = parent?.ownerDocument ?? { defaultView: { getComputedStyle: (node) => ({ overflowY: node.overflow, display: node.display, visibility: node.visibility }) } };
    const node = {
        parentElement: parent,
        isConnected: true, viewport: false, clientHeight: 100, scrollHeight: 1000, clientTop: 0, scrollTop: 200,
        top: 100, height: 100, width: 300, overflow: "auto", display: "block", visibility: "visible", focusCalls: [], scrollCalls: [],
        ...options,
        ownerDocument, children, attributes,
        contains(candidate) { return candidate === node || children.some((child) => child.contains(candidate)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        getClientRects() { return node.display === "none" ? [] : [node.getBoundingClientRect()]; },
        getBoundingClientRect() { return { top: node.top, bottom: node.top + node.height, width: node.width, height: node.height }; },
        querySelectorAll(selector) {
            const descendants = children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
            if (selector === ".protyle-content, .protyle-preview") return descendants.filter((child) => child.viewport);
            if (selector === "[data-node-id]") return descendants.filter((child) => child.attributes.has("data-node-id"));
            return descendants;
        },
        scrollTo(value) { node.scrollCalls.push(value); node.scrollTop = value.top; },
        focus(value) { node.focusCalls.push(value); },
    };
    parent?.children.push(node);
    return node;
}

function dom() {
    const host = element();
    const viewport = element(host, { viewport: true });
    const block = element(viewport, { top: 50, height: 200, attributes: { "data-node-id": blockId, "data-type": "NodeParagraph" } });
    return { host, viewport, block };
}

let uiCount = 0;
async function controls(fixture, host) {
    const jumps = [];
    let notifications = 0;
    globalThis.__gleanPositionProps = { docId, host, facade: { pluginInstance: fixture.plugin, i18n: {}, openReadingDocument: (id) => jumps.push(id), notifyDataChanged: () => { notifications += 1; } } };
    const effects = [];
    globalThis.__gleanPositionEffects = effects;
    const { controls: current } = await import(`glean-position:controls-${++uiCount}`);
    let cleanup = effects[0]();
    await new Promise((resolve) => setImmediate(resolve));
    return {
        ...current, jumps, notifications: () => notifications,
        switch(id, element) { cleanup(); current.change(id, element); cleanup = effects[0](); },
        dispose() { cleanup(); },
    };
}

test("读取位置为只读，非法旧值保留且不写五态或索引", async () => {
    const fixture = harness();
    for (const raw of [undefined, "", "legacy", JSON.stringify(position)]) {
        if (raw === undefined) delete fixture.attrs.get(docId)[positionKey];
        else fixture.attrs.get(docId)[positionKey] = raw;
        const before = structuredClone([...fixture.attrs]);
        const snapshot = await readReadingPosition(docId);
        assert.equal(snapshot.raw, raw ?? null);
        assert.deepEqual(snapshot.position, raw === JSON.stringify(position) ? position : null);
        assert.deepEqual([...fixture.attrs], before);
    }
    assert.equal(fixture.writes().length, 0);
    assert.equal(fixture.files.size, 0);
});

test("明确保存仅写阅读位置属性，返回读回快照，保留五态、完成时间与用户字段", async () => {
    const fixture = harness();
    const expected = await readReadingPosition(docId);
    const before = structuredClone(fixture.attrs.get(docId));
    const after = await saveReadingPosition(fixture.plugin, docId, expected, position);
    assert.deepEqual(after.position, position);
    assert.equal(after.raw, JSON.stringify(position));
    assert.deepEqual(fixture.attrs.get(docId), { ...before, [positionKey]: JSON.stringify(position) });
    assert.deepEqual(fixture.writes().map((call) => call.body), [{ id: docId, attrs: { [positionKey]: JSON.stringify(position) } }]);
});

for (const change of ["bookmark", "location", "internal", "unqualified", "deleted", "movedBlock"]) {
    test(`保存前 ${change} 变化拒绝旧快照，没有属性写入`, async () => {
        const fixture = harness();
        const expected = await readReadingPosition(docId);
        if (change === "bookmark") fixture.attrs.get(docId)[positionKey] = JSON.stringify({ ...position, offset: 20 });
        if (change === "location") fixture.documents.get(docId).hpath = "/移动后";
        if (change === "internal") fixture.attrs.get(docId)["custom-clip-internal"] = "true";
        if (change === "unqualified") delete fixture.attrs.get(docId)["custom-clip-status"];
        if (change === "deleted") fixture.documents.delete(docId);
        if (change === "movedBlock") fixture.blocks.set(blockId, otherDocId);
        await assert.rejects(saveReadingPosition(fixture.plugin, docId, expected, position), ClipRestoreError);
        assert.equal(fixture.writes().length, 0);
    });
}

test("写入点再次核对书签，不覆盖读取之后其他客户端的修改", async () => {
    const fixture = harness();
    const expected = await readReadingPosition(docId);
    fixture.hooks["/api/query/sql"] = (body) => {
        if (/SELECT id, root_id/.test(body.stmt)) fixture.attrs.get(docId)[positionKey] = "其他客户端的新值";
    };
    await assert.rejects(saveReadingPosition(fixture.plugin, docId, expected, position), ClipRestoreError);
    assert.equal(fixture.writes().length, 0);
    assert.equal(fixture.attrs.get(docId)[positionKey], "其他客户端的新值");
});

test("同插件同文保存串行，第二份旧快照冲突，不重复覆盖", async () => {
    const fixture = harness();
    const expected = await readReadingPosition(docId);
    const outcomes = await Promise.allSettled([
        saveReadingPosition(fixture.plugin, docId, expected, position),
        saveReadingPosition(fixture.plugin, docId, expected, { ...position, offset: 300 }),
    ]);
    assert.equal(outcomes[0].status, "fulfilled");
    assert.equal(outcomes[1].status, "rejected");
    assert.equal(fixture.writes().length, 1);
    assert.equal(fixture.attrs.get(docId)[positionKey], JSON.stringify(position));
});

test("服务拒绝来自另一文档的预期快照，即使其 raw/位置看似相同", async () => {
    const fixture = harness();
    fixture.documents.get(otherDocId).hpath = fixture.documents.get(docId).hpath;
    const wrongSnapshot = await readReadingPosition(otherDocId);
    await assert.rejects(saveReadingPosition(fixture.plugin, docId, wrongSnapshot, position), ClipRestoreError);
    assert.equal(fixture.writes().length, 0);
});

for (const failure of ["discardWrite", "writeFailure", "writeBeforeFailure", "indexFailure"]) {
    test(`${failure} 以读回事实判断保存，不自动重发未知写入`, async () => {
        const fixture = harness();
        const expected = await readReadingPosition(docId);
        if (failure === "writeBeforeFailure") { fixture.state.writeFailure = true; fixture.state.writeBeforeFailure = true; }
        else fixture.state[failure] = true;
        if (failure === "writeBeforeFailure" || failure === "indexFailure") {
            assert.deepEqual((await saveReadingPosition(fixture.plugin, docId, expected, position)).position, position);
        } else {
            await assert.rejects(saveReadingPosition(fixture.plugin, docId, expected, position));
        }
        assert.equal(fixture.writes().length, 1);
    });
}

test("保存后位置或块归属变化不报告成功，恢复核验不以不存在或移走的块替代", async () => {
    const fixture = harness();
    const expected = await readReadingPosition(docId);
    fixture.hooks["/api/attr/setBlockAttrs"] = () => { fixture.blocks.set(blockId, otherDocId); };
    await assert.rejects(saveReadingPosition(fixture.plugin, docId, expected, position), ClipRestoreError);
    await assert.rejects(verifyReadingBlock(docId, blockId), ClipRestoreError);
    fixture.blocks.delete(blockId);
    await assert.rejects(verifyReadingBlock(docId, blockId), ClipRestoreError);
    const before = fixture.calls.length;
    await assert.rejects(verifyReadingBlock(docId, "bad-id"), ClipRestoreError);
    assert.equal(fixture.calls.length, before);
});

test("DOM 保存块内偏移，恢复只滚动当前正文 viewport，外部同 ID 块不受影响", () => {
    const { host, viewport, block } = dom();
    assert.equal(readingViewport(host), viewport);
    assert.deepEqual(captureReadingPosition(host, new Date(position.at)), { ...position, offset: 50 });
    assert.equal(restoreReadingPosition(host, position), true);
    assert.deepEqual(viewport.scrollCalls, [{ top: 275, behavior: "auto" }]);
    assert.deepEqual(block.focusCalls, [{ preventScroll: true }]);
    const external = dom();
    assert.equal(external.viewport.scrollCalls.length, 0);
});

for (const change of ["detached", "hidden", "zeroHeight", "noOverflow", "overflowHidden", "invalidId", "noBlocks"]) {
    test(`DOM ${change} 不选择宿主/其他容器作为回退，不伪造位置`, () => {
        const { host, viewport, block } = dom();
        if (change === "detached") host.isConnected = false;
        if (change === "hidden") viewport.display = "none";
        if (change === "zeroHeight") viewport.height = 0;
        if (change === "noOverflow") viewport.scrollHeight = viewport.clientHeight;
        if (change === "overflowHidden") viewport.overflow = "hidden";
        if (change === "invalidId") block.attributes.set("data-node-id", 'id" onclick="bad');
        if (change === "noBlocks") viewport.children.length = 0;
        assert.equal(captureReadingPosition(host), null);
        assert.equal(restoreReadingPosition(host, position), false);
        assert.equal(viewport.scrollCalls.length, 0);
        assert.equal(host.scrollCalls.length, 0);
    });
}

test("DOM 嵌套 viewport 选真实内层滚动容器；块嵌套选顶部最接近的真实子块", () => {
    const { host, viewport, block } = dom();
    const inner = element(viewport, { viewport: true });
    const parent = element(inner, { top: 0, height: 800, attributes: { "data-node-id": otherBlockId } });
    const child = element(parent, { top: 75, height: 150, attributes: { "data-node-id": blockId } });
    assert.equal(readingViewport(host), inner);
    assert.deepEqual(captureReadingPosition(host, new Date(position.at)), { ...position, offset: 25 });
    assert.equal(block.focusCalls.length, 0);
    assert.equal(restoreReadingPosition(host, position), true);
    assert.equal(child.focusCalls.length, 1);
    assert.equal(viewport.scrollCalls.length, 0);
});

test("DOM 块间空白选下一可见块；旧 offset 超出新块高度时限在块内，滚动不越界", () => {
    const { host, viewport, block } = dom();
    block.top = 120;
    block.height = 50;
    assert.equal(captureReadingPosition(host, new Date(position.at)).offset, 0);
    assert.equal(restoreReadingPosition(host, { ...position, offset: 10000 }), true);
    assert.equal(viewport.scrollCalls[0].top, 269);
    viewport.scrollTop = 850;
    block.top = 180;
    assert.equal(restoreReadingPosition(host, position), true);
    assert.equal(viewport.scrollCalls[1].top, 900);
});

test("DOM 上限10000与无效时间、重复锚点、未渲染保存块均不猜测", () => {
    const { host, viewport, block } = dom();
    block.top = -20000;
    block.height = 22000;
    assert.equal(captureReadingPosition(host, new Date(position.at)).offset, 10000);
    assert.equal(captureReadingPosition(host, new Date(NaN)), null);
    assert.equal(restoreReadingPosition(host, { ...position, offset: 10001 }), false);
    assert.equal(restoreReadingPosition(host, { ...position, blockId: otherBlockId }), false);
    element(viewport, { attributes: { "data-node-id": blockId } });
    assert.equal(captureReadingPosition(host), null);
    assert.equal(restoreReadingPosition(host, position), false);
});

test("UI 自动读取不恢复、不写；只有明确 remember 才保存", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    const currentDom = dom();
    const ui = await controls(fixture, currentDom.host);
    assert.equal(ui.inspect().messageKey, "reading.position.ready");
    assert.equal(fixture.writes().length, 0);
    assert.equal(currentDom.viewport.scrollCalls.length, 0);
    await ui.remember();
    assert.equal(ui.inspect().messageKey, "reading.position.saved");
    assert.equal(fixture.writes().length, 1);
    assert.equal(ui.notifications(), 1);
    ui.dispose();
    assert.equal(fixture.writes().length, 1);
});

test("UI 非法旧书签原值保留，用户明确记住当前位置后才替换", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = "旧版未识别书签";
    const currentDom = dom();
    const ui = await controls(fixture, currentDom.host);
    assert.equal(ui.inspect().messageKey, "reading.position.invalid");
    assert.equal(fixture.attrs.get(docId)[positionKey], "旧版未识别书签");
    assert.equal(fixture.writes().length, 0);
    await ui.remember();
    assert.equal(ui.inspect().messageKey, "reading.position.saved");
    assert.equal(JSON.parse(fixture.attrs.get(docId)[positionKey]).blockId, blockId);
    assert.equal(fixture.writes().length, 1);
    ui.dispose();
});

test("UI 保存结果未能读回时必须重新读取后再明确保存，不盲重发", async () => {
    const fixture = harness();
    const currentDom = dom();
    const ui = await controls(fixture, currentDom.host);
    fixture.state.writeFailure = true;
    await ui.remember();
    assert.equal(ui.inspect().messageKey, "reading.position.saveFailed");
    assert.equal(ui.inspect().snapshot, null);
    assert.equal(fixture.writes().length, 1);
    fixture.state.writeFailure = false;
    await ui.remember();
    assert.equal(fixture.writes().length, 1);
    await ui.reload();
    await ui.remember();
    assert.equal(fixture.writes().length, 2);
    assert.equal(ui.inspect().messageKey, "reading.position.saved");
    ui.dispose();
});

test("UI 恢复先读取最新书签并核验真实根归属，读取失败不滚动", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    const currentDom = dom();
    const ui = await controls(fixture, currentDom.host);
    fixture.attrs.get(docId)[positionKey] = JSON.stringify({ ...position, offset: 10 });
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.restored");
    assert.equal(currentDom.viewport.scrollCalls[0].top, 160);
    fixture.blocks.set(blockId, otherDocId);
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.blockMissing");
    assert.equal(currentDom.viewport.scrollCalls.length, 1);
    fixture.hooks["/api/attr/getBlockAttrs"] = () => { throw new Error("private offline details"); };
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.readFailed");
    assert.equal(currentDom.viewport.scrollCalls.length, 1);
    ui.dispose();
});

for (const action of ["reload", "remember", "restore"]) {
    for (const abandon of ["switch", "dispose"]) {
        test(`UI ${action} 期间 ${abandon} 丢弃迟到结果，不误滚动或更新新文档`, async () => {
            const fixture = harness();
            fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
            const firstDom = dom();
            const nextDom = dom();
            const ui = await controls(fixture, firstDom.host);
            const gate = deferred();
            const started = deferred();
            fixture.hooks[action === "remember" ? "/api/attr/setBlockAttrs" : "/api/attr/getBlockAttrs"] = async (body) => {
                if (body.id === docId) { started.resolve(); await gate.promise; }
            };
            const pending = ui[action]();
            await started.promise;
            if (abandon === "switch") {
                ui.switch(otherDocId, nextDom.host);
                await new Promise((resolve) => setImmediate(resolve));
            } else ui.dispose();
            const before = structuredClone(ui.inspect());
            gate.resolve();
            await pending;
            assert.deepEqual(ui.inspect(), before);
            assert.equal(ui.notifications(), 0);
            assert.equal(ui.jumps.length, 0);
            assert.equal(firstDom.viewport.scrollCalls.length, 0);
            assert.equal(nextDom.viewport.scrollCalls.length, 0);
            assert.equal(fixture.writes().filter((call) => call.body.id === otherDocId).length, 0);
            if (abandon === "switch") ui.dispose();
        });
    }
}

test("UI 保存块尚未渲染只提供原块打开动作；点击前重读并核验，不能旧文档跳转", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    const empty = dom();
    empty.viewport.children.length = 0;
    const ui = await controls(fixture, empty.host);
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.notRendered");
    assert.deepEqual(ui.inspect().blockFallback, { docId, blockId });
    const gate = deferred();
    const started = deferred();
    fixture.hooks["/api/query/sql"] = async (body) => { if (/SELECT id, root_id/.test(body.stmt)) { started.resolve(); await gate.promise; } };
    const pending = ui.openSavedBlock();
    await started.promise;
    ui.switch(otherDocId, empty.host);
    gate.resolve();
    await pending;
    assert.deepEqual(ui.jumps, []);
    ui.dispose();
});

test("UI 原块打开动作拒绝书签被更新或块被移走，不以其他块代替", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    const empty = dom();
    empty.viewport.children.length = 0;
    const ui = await controls(fixture, empty.host);
    await ui.restore();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify({ ...position, blockId: otherBlockId });
    await ui.openSavedBlock();
    assert.equal(ui.inspect().messageKey, "reading.position.changed");
    assert.deepEqual(ui.jumps, []);
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    await ui.restore();
    fixture.blocks.set(blockId, otherDocId);
    await ui.openSavedBlock();
    assert.equal(ui.inspect().messageKey, "reading.position.blockMissing");
    assert.deepEqual(ui.jumps, []);
    ui.dispose();
});

test("UI 明确打开未渲染的原块只跳到再次核验成功的确切块 ID", async () => {
    const fixture = harness();
    fixture.attrs.get(docId)[positionKey] = JSON.stringify(position);
    const currentDom = dom();
    currentDom.viewport.children.length = 0;
    const ui = await controls(fixture, currentDom.host);
    await ui.restore();
    assert.equal(currentDom.viewport.scrollCalls.length, 0);
    await ui.openSavedBlock();
    assert.deepEqual(ui.jumps, [blockId]);
    assert.equal(fixture.writes().length, 0);
    ui.dispose();
});

test("UI 编译无警告，ReaderTab 仅接入控件，不监听滚动、卸载写入或展示进度/计时", () => {
    const source = readFileSync(controlsUrl, "utf8");
    assert.deepEqual(compile(source, { filename: "ReadingPositionControls.svelte", generate: "client" }).warnings, []);
    assert.doesNotMatch(source, /addEventListener\(["'](?:scroll|blur|beforeunload)|percent|setInterval|batchSetStatus/);
    const reader = readFileSync(new URL("../src/ui/ReaderTab.svelte", import.meta.url), "utf8");
    assert.match(reader, /<ReadingPositionControls \{facade\} \{docId\} host=\{protyleHost\}/);
});

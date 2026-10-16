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

const { readReadingPosition, saveReadingPosition, readReadingMinutes, saveReadingMinutes, addReadingMinutes, verifyReadingBlock, ClipRestoreError } = await import("../src/services/clip-store.ts");
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
    const ownerDocument = parent?.ownerDocument ?? { defaultView: { getComputedStyle: (node) => {
        let visibility = node.visibility;
        for (let current = node.parentElement; current; current = current.parentElement) if (current.visibility !== "visible") visibility = current.visibility;
        return { overflowY: node.overflow, display: node.display, visibility };
    } } };
    const node = {
        parentElement: parent,
        isConnected: true, viewport: false, clientHeight: 100, scrollHeight: 1000, clientTop: 0, scrollTop: 200,
        top: 100, height: 100, width: 300, overflow: "auto", display: "block", visibility: "visible", focusCalls: [], scrollCalls: [],
        className: options.viewport ? "protyle-content" : "", tagName: "DIV",
        ...options,
        ownerDocument, children, attributes,
        contains(candidate) { return candidate === node || children.some((child) => child.contains(candidate)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        getClientRects() {
            for (let current = node; current; current = current.parentElement) if (current.display === "none") return [];
            return [node.getBoundingClientRect()];
        },
        getBoundingClientRect() { return { top: node.top, bottom: node.top + node.height, width: node.width, height: node.height }; },
        matches(selector) { return selector.startsWith(".") && node.className.split(/\s+/).includes(selector.slice(1)); },
        closest(selector) {
            for (let current = node; current; current = current.parentElement) if (current.matches(selector)) return current;
            return null;
        },
        querySelectorAll(selector) {
            const descendants = children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
            if (selector === ".protyle-content, .protyle-preview, .protyle-preview .b3-typography") return descendants.filter((child) => child.matches(".protyle-content") || child.matches(".protyle-preview") || (child.matches(".b3-typography") && child.closest(".protyle-preview")));
            if (selector === "[data-node-id], [id]") return descendants.filter((child) => child.attributes.has("data-node-id") || child.attributes.has("id"));
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

function previewDom({ short = false, innerScroll = true } = {}) {
    const host = element();
    const preview = element(host, { viewport: true, className: "protyle-preview", scrollHeight: short || innerScroll ? 100 : 1000, scrollTop: short || innerScroll ? 0 : 200 });
    const toolbar = element(preview, { className: "protyle-preview__action" });
    const typography = element(preview, { className: "b3-typography", overflow: innerScroll ? "auto" : "visible", scrollHeight: short ? 100 : 1000, scrollTop: short ? 0 : 200 });
    const root = element(typography, { top: 100, height: 40, tagName: "H1", attributes: { id: docId } });
    const block = element(typography, { top: short ? 145 : 50, height: short ? 40 : 200, tagName: "P", attributes: { id: blockId } });
    return { host, viewport: innerScroll ? typography : preview, preview, toolbar, typography, root, block };
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

test("真实阅读分钟独立写回，保留预计分钟与用户字段并校验位置", async () => {
    const fixture = harness();
    const before = await readReadingMinutes(docId);
    assert.equal(before.raw, null);
    assert.equal(before.minutes, 0);
    const saved = await saveReadingMinutes(fixture.plugin, docId, {
        raw: before.raw,
        location: { box: before.meta.box, hpath: before.meta.hpath },
    }, 7);
    assert.equal(saved.minutes, 7);
    assert.equal(fixture.attrs.get(docId)["custom-clip-read-minutes"], "7");
    assert.equal(fixture.attrs.get(docId)["custom-clip-minutes"], "10");
    assert.equal(fixture.attrs.get(docId)["custom-clip-author"], "用户");
});

test("真实阅读分钟并发结算在同一文档队列内累加，不丢失任一会话增量", async () => {
    const fixture = harness();
    const outcomes = await Promise.all([
        addReadingMinutes(fixture.plugin, docId, 3),
        addReadingMinutes(fixture.plugin, docId, 4),
    ]);
    assert.deepEqual(outcomes, [3, 4]);
    assert.equal(fixture.attrs.get(docId)["custom-clip-read-minutes"], "7");
    assert.equal((await readReadingMinutes(docId)).minutes, 7);
});

test("真实阅读分钟拒绝旧快照、移动后的文档和写入后读回不一致", async () => {
    const fixture = harness();
    const before = await readReadingMinutes(docId);
    fixture.attrs.get(docId)["custom-clip-read-minutes"] = "2";
    await assert.rejects(() => saveReadingMinutes(fixture.plugin, docId, {
        raw: before.raw,
        location: { box: before.meta.box, hpath: before.meta.hpath },
    }, 7), (error) => error instanceof ClipRestoreError && error.reason === "changed");
    assert.equal(fixture.writes().length, 0);
    fixture.attrs.get(docId)["custom-clip-read-minutes"] = before.raw ?? "";
    fixture.documents.get(docId).hpath = "/moved";
    await assert.rejects(() => saveReadingMinutes(fixture.plugin, docId, {
        raw: before.raw,
        location: { box: before.meta.box, hpath: before.meta.hpath },
    }, 7), (error) => error instanceof ClipRestoreError && error.reason === "changed");
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

test("DOM 预览合法id锚点可保存恢复，确切文档根被排除而正文h1可定位", () => {
    const { host, viewport, block, root } = previewDom({ innerScroll: false });
    block.tagName = "H1";
    assert.equal(readingViewport(host), viewport);
    assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), { ...position, offset: 50 });
    assert.equal(restoreReadingPosition(host, position, docId), true);
    assert.deepEqual(viewport.scrollCalls, [{ top: 275, behavior: "auto" }]);
    assert.equal(block.focusCalls.length, 1);
    assert.equal(root.focusCalls.length, 0);
    assert.equal(restoreReadingPosition(host, { ...position, blockId: docId }, docId), false);
    assert.equal(captureReadingPosition(host), null);
    assert.equal(restoreReadingPosition(host, position), false);
});

test("DOM 原生preview外壳不滚动时选typography，长文恢复回相同真实scrollTop", () => {
    const { host, preview, typography, block } = previewDom();
    Object.assign(preview, { clientHeight: 634, scrollHeight: 634, height: 634, display: "flex" });
    Object.assign(typography, { clientHeight: 594, scrollHeight: 12362, height: 594, top: 140, scrollTop: 600, display: "flex" });
    block.getBoundingClientRect = () => ({ top: typography.top + 560 - typography.scrollTop, bottom: typography.top + 860 - typography.scrollTop, width: 300, height: 300 });
    assert.equal(readingViewport(host), typography);
    const saved = captureReadingPosition(host, new Date(position.at), docId);
    assert.deepEqual(saved, { ...position, offset: 40 });
    typography.scrollTop = 0;
    assert.equal(restoreReadingPosition(host, saved, docId), true);
    assert.equal(typography.scrollTop, 600);
    assert.deepEqual(typography.scrollCalls, [{ top: 600, behavior: "auto" }]);
    assert.deepEqual(preview.scrollCalls, []);
    assert.deepEqual(host.scrollCalls, []);
    assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), saved);
});

test("DOM viewport不接受preview在宿主外的typography，也不接受隐藏兄弟滚动区", () => {
    const externalPreview = element(null, { className: "protyle-preview" });
    const host = element(externalPreview);
    const unrelated = element(host, { className: "b3-typography" });
    element(unrelated, { attributes: { id: blockId } });
    assert.equal(readingViewport(host), null);
    assert.equal(captureReadingPosition(host, new Date(position.at), docId), null);
    const current = previewDom();
    const hiddenPreview = element(current.host, { className: "protyle-preview", display: "none" });
    element(hiddenPreview, { className: "b3-typography", scrollHeight: 12362 });
    assert.equal(readingViewport(current.host), current.typography);
});

for (const mode of ["edit", "preview"]) {
    test(`DOM ${mode}短文有真实overflow容器时允许记住/恢复，滚动保持零`, () => {
        const { host, viewport, block } = mode === "preview" ? previewDom({ short: true }) : dom();
        viewport.scrollHeight = viewport.clientHeight;
        viewport.scrollTop = 0;
        block.top = 145;
        block.height = 40;
        assert.equal(readingViewport(host), viewport);
        assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), { ...position, offset: 0 });
        assert.equal(restoreReadingPosition(host, position, docId), true);
        assert.deepEqual(viewport.scrollCalls, [{ top: 0, behavior: "auto" }]);
    });
}

test("DOM 编辑模式排除确切文档根与NodeDocument，不消费只有id的外部标记", () => {
    const { host, viewport } = dom();
    element(viewport, { top: 95, attributes: { "data-node-id": docId } });
    element(viewport, { top: 98, attributes: { "data-node-id": otherBlockId, "data-type": "NodeDocument" } });
    element(viewport, { top: 99, attributes: { id: blockId } });
    assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), { ...position, offset: 50 });
    assert.equal(restoreReadingPosition(host, position, docId), true);
    assert.equal(restoreReadingPosition(host, { ...position, blockId: docId }, docId), false);
});

test("DOM 预览只消费宿主内preview typography锚点，工具条/外部同id不干扰", () => {
    const { host, viewport, toolbar } = previewDom();
    element(toolbar, { attributes: { id: blockId } });
    element(host, { attributes: { id: blockId } });
    const outsideTypography = element(host, { className: "b3-typography" });
    element(outsideTypography, { attributes: { id: blockId } });
    const external = previewDom();
    assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), { ...position, offset: 50 });
    assert.equal(restoreReadingPosition(host, position, docId), true);
    assert.equal(viewport.scrollCalls.length, 1);
    assert.equal(external.viewport.scrollCalls.length, 0);
});

for (const change of ["rootOnly", "duplicate", "hiddenBlock", "hiddenTypography", "invisibleTypography", "invalidId", "hiddenViewport"]) {
    test(`DOM 预览${change}不猜测可用块`, () => {
        const { host, viewport, typography, block } = previewDom();
        if (change === "rootOnly") typography.children.splice(typography.children.indexOf(block), 1);
        if (change === "duplicate") element(typography, { attributes: { id: blockId } });
        if (change === "hiddenBlock") block.display = "none";
        if (change === "hiddenTypography") typography.display = "none";
        if (change === "invisibleTypography") typography.visibility = "hidden";
        if (change === "invalidId") block.attributes.set("id", 'bad-id" onclick="bad');
        if (change === "hiddenViewport") viewport.display = "none";
        assert.equal(captureReadingPosition(host, new Date(position.at), docId), null);
        assert.equal(restoreReadingPosition(host, position, docId), false);
        assert.equal(viewport.scrollCalls.length, 0);
    });
}

test("DOM 预览隐藏的重复锚点不替代或干扰唯一可见原块", () => {
    const { host, typography, block } = previewDom();
    element(typography, { display: "none", attributes: { id: blockId } });
    assert.deepEqual(captureReadingPosition(host, new Date(position.at), docId), { ...position, offset: 50 });
    assert.equal(restoreReadingPosition(host, position, docId), true);
    assert.equal(block.focusCalls.length, 1);
});

test("DOM 已溢出外层优先于无滚动内层，不把短内容子容器误作真实滚动目标", () => {
    const { host, viewport } = dom();
    element(viewport, { viewport: true, className: "protyle-preview", scrollHeight: 100, clientHeight: 100 });
    assert.equal(readingViewport(host), viewport);
});

for (const change of ["detached", "hidden", "zeroHeight", "overflowHidden", "invalidId", "noBlocks"]) {
    test(`DOM ${change} 不选择宿主/其他容器作为回退，不伪造位置`, () => {
        const { host, viewport, block } = dom();
        if (change === "detached") host.isConnected = false;
        if (change === "hidden") viewport.display = "none";
        if (change === "zeroHeight") viewport.height = 0;
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

test("UI 默认read预览短文可显式保存恢复，仍经服务核验块归属", async () => {
    const fixture = harness();
    const currentDom = previewDom({ short: true });
    const ui = await controls(fixture, currentDom.host);
    await ui.remember();
    assert.equal(ui.inspect().messageKey, "reading.position.saved");
    assert.equal(JSON.parse(fixture.attrs.get(docId)[positionKey]).blockId, blockId);
    assert.equal(fixture.writes().length, 1);
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.restored");
    assert.deepEqual(currentDom.viewport.scrollCalls, [{ top: 0, behavior: "auto" }]);
    fixture.blocks.set(blockId, otherDocId);
    await ui.restore();
    assert.equal(ui.inspect().messageKey, "reading.position.blockMissing");
    assert.equal(currentDom.viewport.scrollCalls.length, 1);
    assert.equal(fixture.writes().length, 1);
    ui.dispose();
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

test("UI 编译无警告，ReaderTab 不监听滚动/卸载写入或展示百分比", () => {
    const source = readFileSync(controlsUrl, "utf8");
    assert.deepEqual(compile(source, { filename: "ReadingPositionControls.svelte", generate: "client" }).warnings, []);
    assert.doesNotMatch(source, /addEventListener\(["'](?:scroll|beforeunload)|percent|setInterval|batchSetStatus/);
    const reader = readFileSync(new URL("../src/ui/ReaderTab.svelte", import.meta.url), "utf8");
    assert.match(reader, /<ReadingPositionControls \{facade\} \{docId\} host=\{protyleHost\}/);
});

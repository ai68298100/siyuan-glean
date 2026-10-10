import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-library-db-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-library-db-test:siyuan") {
            return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanLibraryDbPost(...args);", shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});

const { bindAllClipsToLibrary, LIBRARY_DOC_TITLE } = await import("../src/services/library-db.ts");
const { mapBoundDocIds } = await import("../src/api/av.ts");
const { normalizeSettings } = await import("../src/services/settings.ts");
const { emptyIndex } = await import("../src/services/index-store.ts");
const { ATTR } = await import("../src/domain/schema.ts");

const firstId = "20261004120000-aaaaaaa";
const secondId = "20261004120000-bbbbbbb";
const internalId = "20261004120000-intern1";
const missingId = "20261004120000-miss001";
const candidateId = "20261004120000-candid1";
const hostId = "20261004120000-host001";
const notebookId = "20261004110000-box0001";
const avId = "20261004100000-av00001";
const dbBlockId = "20261004100000-db00001";
const blockKey = "20261004100000-key0001";
const statusKey = "20261004100000-key0002";
const sourceAttrs = {
    [ATTR.status]: "reading",
    [ATTR.url]: "https://example.test/article",
    [ATTR.author]: "用户署名",
    [ATTR.priority]: "4",
    [ATTR.rating]: "5",
    tags: "用户标签",
    "custom-user-note": "原始备注",
};

function harness() {
    const documents = new Map();
    const attributes = new Map();
    const markdowns = new Map();
    const itemIds = new Map();
    const rows = new Map();
    const columns = [
        { id: blockKey, name: "文档", type: "block" },
        { id: statusKey, name: "状态", type: "select" },
        { id: "20261004100000-key0003", name: "字数", type: "number" },
        { id: "20261004100000-key0004", name: "时长", type: "number" },
        { id: "20261004100000-key0005", name: "来源", type: "url" },
    ];
    const calls = [];
    const saves = [];
    const files = new Map([["glean-index.json", emptyIndex()]]);
    const settings = normalizeSettings({ anchorNotebooks: [notebookId] });
    const controls = {
        failScan: false,
        failBatch: false,
        failIndexSave: false,
        failReads: new Set(),
        failMeta: new Set(),
        skipBinding: new Set(),
        bindingMode: "apply",
        cellMode: "apply",
        mappingResponse: null,
        onMap: null,
        beforeCell: null,
        afterCell: null,
        onRender: null,
    };
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) {
            saves.push({ name, value: structuredClone(value) });
            if (controls.failIndexSave && name === "glean-index.json") throw new Error("Index save failed");
            files.set(name, structuredClone(value));
        },
    };
    function add(id, attrs = sourceAttrs, meta = {}, markdown = "# 原文\n\n正文、块引用和用户格式必须保留。") {
        documents.set(id, { id, content: `文章 ${id}`, box: notebookId, hpath: `/文章/${id}`, updated: "20261004120000", tag: "", ...meta });
        attributes.set(id, structuredClone(attrs));
        markdowns.set(id, markdown);
    }
    function addRow(docId, status = "inbox") {
        if (itemIds.has(docId)) return itemIds.get(docId);
        const itemId = `20261005120000-${String(rows.size + 1).padStart(7, "0")}`;
        itemIds.set(docId, itemId);
        rows.set(itemId, {
            id: itemId,
            cells: [
                { value: { keyID: blockKey, type: "block", block: { id: docId, content: documents.get(docId)?.content ?? "旧行" } } },
                { value: { keyID: columns.find((column) => column.name === "状态")?.id ?? statusKey, type: "select", mSelect: [{ content: status }] } },
            ],
        });
        return itemId;
    }
    function statusCell(docId) {
        return rows.get(itemIds.get(docId))?.cells.find((cell) => cell.value.keyID === statusKey)?.value;
    }
    add(firstId);
    add(hostId, { [ATTR.internal]: "true" }, { content: LIBRARY_DOC_TITLE, hpath: `/${LIBRARY_DOC_TITLE}` }, "# 读库数据库\n\n");
    globalThis.__gleanLibraryDbPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        switch (route) {
            case "/api/attr/getBlockAttrs":
                if (controls.failReads.has(body.id)) throw new Error("Attributes unavailable");
                return { code: 0, data: structuredClone(attributes.get(body.id) ?? {}) };
            case "/api/attr/batchGetBlockAttrs":
                if (controls.failBatch) throw new Error("Batch attributes unavailable");
                return { code: 0, data: Object.fromEntries(body.ids.filter((id) => documents.has(id)).map((id) => [id, structuredClone(attributes.get(id) ?? {})])) };
            case "/api/export/exportMdContent":
                return { code: 0, data: { hPath: documents.get(body.id)?.hpath, content: markdowns.get(body.id) ?? "" } };
            case "/api/query/sql": {
                const sourceId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                if (sourceId) {
                    if (controls.failMeta.has(sourceId)) throw new Error("Metadata unavailable");
                    return { code: 0, data: documents.has(sourceId) ? [structuredClone(documents.get(sourceId))] : [] };
                }
                if (body.stmt.includes("type = 'av'")) {
                    assert.ok(body.stmt.includes(`parent_id = '${hostId}'`));
                    return { code: 0, data: [{ id: dbBlockId, parent_id: hostId, markdown: `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>` }] };
                }
                if (body.stmt.includes(`content = '${LIBRARY_DOC_TITLE}'`)) {
                    assert.ok(body.stmt.includes(`box = '${notebookId}'`));
                    return { code: 0, data: [structuredClone(documents.get(hostId))] };
                }
                if (controls.failScan) throw new Error("Scan unavailable");
                let result = [...documents.values()];
                if (body.stmt.includes("box IN")) {
                    const boxes = [...body.stmt.match(/box IN \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
                    result = result.filter((document) => boxes.includes(document.box));
                } else if (body.stmt.includes("tag LIKE")) {
                    result = result.filter((document) => document.tag.includes("剪藏") || attributes.get(document.id)?.tags?.includes("剪藏"));
                } else if (body.stmt.includes("custom-clip-status")) {
                    result = result.filter((document) => ATTR.status in (attributes.get(document.id) ?? {}) || ATTR.url in (attributes.get(document.id) ?? {}));
                } else assert.fail(`Unexpected SQL ${body.stmt}`);
                result.sort((first, second) => second.updated.localeCompare(first.updated) || second.id.localeCompare(first.id));
                const offset = Number(/OFFSET\s+(\d+)/.exec(body.stmt)?.[1] ?? 0);
                const limit = Number(/LIMIT\s+(\d+)/.exec(body.stmt)?.[1] ?? 500);
                return { code: 0, data: structuredClone(result.slice(offset, offset + limit)) };
            }
            case "/api/av/renderAttributeView": {
                assert.deepEqual(body, { id: avId, blockID: dbBlockId, query: "", pageSize: -1, createIfNotExist: false });
                const rendered = structuredClone({ view: { columns, rows: [...rows.values()] } });
                const data = controls.onRender ? await controls.onRender(rendered) : rendered;
                return { code: 0, data };
            }
            case "/api/av/addAttributeViewKey":
                assert.equal(body.avID, avId);
                assert.equal(body.keyIcon, "");
                columns.push({ id: body.keyID, name: body.keyName, type: body.keyType });
                return { code: 0, data: null };
            case "/api/av/addAttributeViewBlocks":
                assert.equal(body.avID, avId);
                assert.equal(body.blockID, dbBlockId);
                if (controls.bindingMode === "reject") throw new Error("Binding rejected");
                for (const source of body.srcs) {
                    assert.equal(source.isDetached, false);
                    if (!controls.skipBinding.has(source.id)) addRow(source.id);
                }
                if (controls.bindingMode === "ackLost") throw new Error("Binding acknowledgement lost");
                return { code: 0, data: null };
            case "/api/av/getAttributeViewItemIDsByBoundIDs": {
                assert.equal(body.avID, avId);
                const mapped = Object.fromEntries(body.blockIDs.filter((id) => itemIds.has(id)).map((id) => [id, itemIds.get(id)]));
                const data = controls.mappingResponse ? await controls.mappingResponse(mapped, body.blockIDs) : mapped;
                if (controls.onMap) await controls.onMap();
                return { code: 0, data: structuredClone(data) };
            }
            case "/api/av/setAttributeViewBlockAttr": {
                assert.equal(body.avID, avId);
                assert.ok(rows.has(body.itemID), "Cell writes must use mapped itemID");
                if (controls.beforeCell) await controls.beforeCell(body);
                if (controls.cellMode === "reject") throw new Error("Cell write rejected");
                if (controls.cellMode !== "ignore") {
                    const row = rows.get(body.itemID);
                    const existing = row.cells.find((cell) => cell.value.keyID === body.keyID);
                    const value = { keyID: body.keyID, type: "select", ...structuredClone(body.value) };
                    if (existing) existing.value = value;
                    else row.cells.push({ value });
                }
                if (controls.afterCell) await controls.afterCell(body);
                if (controls.cellMode === "ackLost") throw new Error("Cell acknowledgement lost");
                return { code: 0, data: null };
            }
            default: assert.fail(`Unexpected endpoint ${route}`);
        }
    };
    return {
        plugin, settings, documents, attributes, markdowns, itemIds, rows, columns, calls, saves, files, controls, add, addRow, statusCell,
        bindingCalls() { return calls.filter((call) => call.route === "/api/av/addAttributeViewBlocks"); },
        cellWrites() { return calls.filter((call) => call.route === "/api/av/setAttributeViewBlockAttr"); },
        avMutations() { return calls.filter((call) => /\/api\/av\/(addAttributeView|setAttributeView)/.test(call.route)); },
    };
}

function sourceSnapshot(fixture) {
    return structuredClone({ documents: fixture.documents, attributes: fixture.attributes, markdowns: fixture.markdowns });
}

function assertNoRootWrites(fixture) {
    assert.ok(fixture.calls.every((call) => !/\/api\/(attr\/.*set|attr\/.*Set|block\/(update|delete|insert)|filetree\/create|transactions)/.test(call.route)));
    assert.ok(fixture.saves.every((save) => save.name === "glean-index.json"));
}

function assertSourcesUnchanged(fixture, before) {
    assert.deepEqual(sourceSnapshot(fixture), before);
    assertNoRootWrites(fixture);
}

function assertOneCellWrite(fixture, status = "reading") {
    assert.deepEqual(fixture.cellWrites(), [{
        route: "/api/av/setAttributeViewBlockAttr",
        body: { avID: avId, keyID: statusKey, itemID: fixture.itemIds.get(firstId), value: { mSelect: [{ content: status }] } },
    }]);
}

function assertFailure(result, docId, reason) {
    assert.ok(result.failures.some((failure) => failure.docId === docId && failure.reason === reason), JSON.stringify(result));
}

test("根属性决定状态，陈旧索引和 AV 单元格不能成为文章状态事实源", async () => {
    const fixture = harness();
    fixture.files.set("glean-index.json", { ...emptyIndex(), clips: { [firstId]: { id: firstId, status: "inbox", title: "过期标题" }, [missingId]: { id: missingId, status: "done" } } });
    fixture.addRow(firstId, "archived");
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.deepEqual(result, { bound: 0, boundDocIds: [], existingDocIds: [firstId], synced: 1, failures: [] });
    assertOneCellWrite(fixture, "reading");
    assert.equal(fixture.statusCell(firstId).mSelect[0].content, "reading");
    assert.equal(fixture.files.get("glean-index.json").clips[firstId].status, "reading");
    assert.equal(fixture.files.get("glean-index.json").clips[missingId], undefined);
    assert.equal(fixture.bindingCalls().length, 0);
    assert.ok(fixture.calls.some((call) => call.route === "/api/attr/batchGetBlockAttrs"));
    assertSourcesUnchanged(fixture, before);
});

test("internal 和无有效状态的候选不绑定、不投影；已有 internal 行也不更新", async () => {
    const fixture = harness();
    fixture.add(internalId, { [ATTR.status]: "done", [ATTR.internal]: "true" });
    fixture.add(candidateId, { [ATTR.url]: "https://candidate.test/article", [ATTR.status]: "obsolete" });
    const internalItem = fixture.addRow(internalId, "archived");
    const existingRow = structuredClone(fixture.rows.get(internalItem));
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.bound, 1);
    assert.deepEqual(result.boundDocIds, [firstId]);
    assert.deepEqual(result.existingDocIds, [internalId]);
    assert.equal(result.synced, 1);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(fixture.bindingCalls()[0].body.srcs, [{ id: firstId, isDetached: false, content: fixture.documents.get(firstId).content }]);
    assertOneCellWrite(fixture);
    assert.deepEqual(fixture.rows.get(internalItem), existingRow);
    assert.ok(!fixture.itemIds.has(candidateId));
    assertSourcesUnchanged(fixture, before);
});

test("空有效库只返回零数量，陈旧缓存中的文章不会被绑定", async () => {
    const fixture = harness();
    delete fixture.attributes.get(firstId)[ATTR.status];
    fixture.files.set("glean-index.json", { ...emptyIndex(), clips: { [firstId]: { id: firstId, status: "reading" } } });
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.deepEqual(result, { bound: 0, boundDocIds: [], existingDocIds: [], synced: 0, failures: [] });
    assert.equal(fixture.avMutations().length, 0);
    assertSourcesUnchanged(fixture, before);
});

for (const failure of ["scan", "batch", "indexSave"]) {
    test(`完整对账 ${failure} 失败不得以旧索引继续投影，失败后释放刷新锁`, async () => {
        const fixture = harness();
        fixture.files.set("glean-index.json", { ...emptyIndex(), sentinel: "旧缓存" });
        const before = sourceSnapshot(fixture);
        const control = failure === "scan" ? "failScan" : failure === "batch" ? "failBatch" : "failIndexSave";
        fixture.controls[control] = true;
        await assert.rejects(bindAllClipsToLibrary(fixture.plugin, fixture.settings), /unavailable|Index save failed/);
        assert.equal(fixture.avMutations().length, 0);
        assert.equal(fixture.files.get("glean-index.json").sentinel, "旧缓存");
        fixture.controls[control] = false;
        assert.equal((await bindAllClipsToLibrary(fixture.plugin, fixture.settings)).synced, 1);
        assertSourcesUnchanged(fixture, before);
    });
}

for (const bindingMode of ["apply", "ackLost", "reject"]) {
    test(`绑定 ${bindingMode} 的数量来自实际 ID 映射，部分绑定不宣称全部成功`, async () => {
        const fixture = harness();
        fixture.add(secondId, { ...sourceAttrs, [ATTR.status]: "done" });
        fixture.controls.skipBinding.add(secondId);
        fixture.controls.bindingMode = bindingMode;
        const before = sourceSnapshot(fixture);
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        const accepted = bindingMode !== "reject";
        assert.equal(result.bound, accepted ? 1 : 0);
        assert.deepEqual(result.boundDocIds, accepted ? [firstId] : []);
        assert.equal(result.synced, accepted ? 1 : 0);
        assertFailure(result, secondId, bindingMode === "apply" ? "unbound" : "write");
        if (!accepted) assertFailure(result, firstId, "write");
        assert.equal(fixture.bindingCalls().length, 1);
        assert.equal(fixture.bindingCalls()[0].body.srcs.length, 2);
        assert.equal(fixture.cellWrites().length, accepted ? 1 : 0);
        if (accepted) assertOneCellWrite(fixture);
        assertSourcesUnchanged(fixture, before);
    });
}

test("绑定响应丢失但所有行实际存在时，按映射确认成功，不重复发送绑定", async () => {
    const fixture = harness();
    fixture.add(secondId, { ...sourceAttrs, [ATTR.status]: "done" });
    fixture.controls.bindingMode = "ackLost";
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.bound, 2);
    assert.equal(result.synced, 2);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(new Set(result.boundDocIds), new Set([firstId, secondId]));
    assert.equal(fixture.bindingCalls().length, 1);
    assert.equal(fixture.cellWrites().length, 2);
    assertSourcesUnchanged(fixture, before);
});

test("映射缺键或空串只表示未绑定，未知 ID 不能增加绑定数", async () => {
    const fixture = harness();
    fixture.add(secondId);
    fixture.controls.mappingResponse = () => ({ [firstId]: "", [missingId]: "20261005120000-row0001" });
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.bound, 0);
    assert.deepEqual(result.boundDocIds, []);
    assert.equal(result.synced, 0);
    assertFailure(result, firstId, "unbound");
    assertFailure(result, secondId, "unbound");
    assert.equal(fixture.cellWrites().length, 0);
    assertSourcesUnchanged(fixture, before);
});

test("超过 50 篇分批绑定，行 itemID 不冒充文档 ID，数量逐篇由映射确认", async () => {
    const fixture = harness();
    for (let index = 0; index < 50; index += 1) fixture.add(`20261004130000-${index.toString(36).padStart(7, "0")}`);
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.bound, 51);
    assert.equal(result.synced, 51);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(fixture.bindingCalls().map((call) => call.body.srcs.length), [50, 1]);
    const requested = fixture.bindingCalls().flatMap((call) => call.body.srcs.map((source) => source.id));
    assert.equal(new Set(requested).size, 51);
    assert.deepEqual(new Set(result.boundDocIds), new Set(requested));
    assert.ok(fixture.cellWrites().every((call) => !requested.includes(call.body.itemID)));
    assertSourcesUnchanged(fixture, before);
});

for (const cellMode of ["apply", "ackLost", "reject", "ignore"]) {
    test(`状态写 ${cellMode} 只有 AV 实际读回匹配才计 synced，读回重试不重发写入`, async () => {
        const fixture = harness();
        fixture.controls.cellMode = cellMode;
        const before = sourceSnapshot(fixture);
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        const persisted = cellMode === "apply" || cellMode === "ackLost";
        assert.equal(result.bound, 1);
        assert.equal(result.synced, persisted ? 1 : 0);
        if (persisted) assert.deepEqual(result.failures, []);
        else assertFailure(result, firstId, cellMode === "reject" ? "write" : "readback");
        assert.equal(fixture.statusCell(firstId).mSelect[0].content, persisted ? "reading" : "inbox");
        assertOneCellWrite(fixture);
        const writePosition = fixture.calls.findIndex((call) => call.route === "/api/av/setAttributeViewBlockAttr");
        assert.ok(fixture.calls.slice(writePosition + 1).some((call) => call.route === "/api/av/renderAttributeView"));
        assert.ok(fixture.calls.slice(writePosition + 1).some((call) => call.route === "/api/attr/getBlockAttrs"));
        assertSourcesUnchanged(fixture, before);
    });
}

test("setCell 报错但原单元格已经匹配时，实际读回可以确认对齐", async () => {
    const fixture = harness();
    fixture.addRow(firstId, "reading");
    fixture.controls.cellMode = "reject";
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.bound, 0);
    assert.equal(result.synced, 1);
    assert.deepEqual(result.failures, []);
    assertOneCellWrite(fixture);
    assertSourcesUnchanged(fixture, before);
});

for (const cellMode of ["apply", "ackLost"]) {
    test(`状态 ${cellMode} 已落盘但 AV 读回不可用时不能报告 synced`, async () => {
        const fixture = harness();
        fixture.controls.cellMode = cellMode;
        fixture.controls.onRender = (rendered) => {
            if (fixture.cellWrites().length) throw new Error("AV render unavailable");
            return rendered;
        };
        const before = sourceSnapshot(fixture);
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        assert.equal(result.bound, 1);
        assert.equal(result.synced, 0);
        assertFailure(result, firstId, cellMode === "ackLost" ? "write" : "readback");
        assert.equal(fixture.statusCell(firstId).mSelect[0].content, "reading");
        assertOneCellWrite(fixture);
        assertSourcesUnchanged(fixture, before);
    });
}

test("AV 渲染短暂滞后只重试读取，观察到实际值后成功，状态写仍只有一次", async () => {
    const fixture = harness();
    let observations = 0;
    fixture.controls.onRender = (rendered) => {
        if (fixture.cellWrites().length) {
            observations += 1;
            if (observations === 1) rendered.view.rows[0].cells.find((cell) => cell.value.keyID === statusKey).value.mSelect = [{ content: "inbox" }];
        }
        return rendered;
    };
    const before = sourceSnapshot(fixture);
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.synced, 1);
    assert.deepEqual(result.failures, []);
    assert.equal(observations, 2);
    assertOneCellWrite(fixture);
    assertSourcesUnchanged(fixture, before);
});

for (const observedChange of ["wrongRow", "wrongKey", "missingCell"]) {
    test(`AV 读回 ${observedChange} 即使存在同名状态值也不能冒充当前 item 的对齐`, async () => {
        const fixture = harness();
        fixture.controls.onRender = (rendered) => {
            if (!fixture.cellWrites().length) return rendered;
            const row = rendered.view.rows[0];
            if (observedChange === "wrongRow") row.id = "20261005120000-other01";
            else if (observedChange === "wrongKey") row.cells.find((cell) => cell.value.keyID === statusKey).value.keyID = "20261004100000-other01";
            else row.cells = row.cells.filter((cell) => cell.value.keyID !== statusKey);
            return rendered;
        };
        const before = sourceSnapshot(fixture);
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        assert.equal(result.synced, 0);
        assertFailure(result, firstId, "readback");
        assertOneCellWrite(fixture);
        assertSourcesUnchanged(fixture, before);
    });
}

for (const change of ["statusRemoved", "statusInvalid", "internal"]) {
    test(`投影前来源 ${change} 变化返回 changed，不写单元格`, async () => {
        const fixture = harness();
        fixture.controls.onMap = () => {
            if (change === "statusRemoved") delete fixture.attributes.get(firstId)[ATTR.status];
            else if (change === "statusInvalid") fixture.attributes.get(firstId)[ATTR.status] = "invalid-status";
            else fixture.attributes.get(firstId)[ATTR.internal] = "true";
        };
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        assert.equal(result.bound, 1);
        assert.equal(result.synced, 0);
        assertFailure(result, firstId, "changed");
        assert.equal(fixture.cellWrites().length, 0);
        assertNoRootWrites(fixture);
    });
}

test("对账后根状态更新时投影最新有效状态，而非扫描时的缓存状态", async () => {
    const fixture = harness();
    fixture.controls.onMap = () => { fixture.attributes.get(firstId)[ATTR.status] = "done"; };
    const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(result.synced, 1);
    assert.deepEqual(result.failures, []);
    assertOneCellWrite(fixture, "done");
    assert.equal(fixture.attributes.get(firstId)[ATTR.status], "done");
    assert.equal(fixture.attributes.get(firstId)[ATTR.doneTime], undefined);
    assertNoRootWrites(fixture);
});

for (const change of ["status", "internal"]) {
    test(`状态写后来源 ${change} 变化返回 changed，AV 值匹配也不计 synced`, async () => {
        const fixture = harness();
        fixture.controls.afterCell = () => {
            if (change === "status") fixture.attributes.get(firstId)[ATTR.status] = "archived";
            else fixture.attributes.get(firstId)[ATTR.internal] = "true";
        };
        const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        assert.equal(result.synced, 0);
        assertFailure(result, firstId, "changed");
        assert.equal(fixture.statusCell(firstId).mSelect[0].content, "reading");
        assertOneCellWrite(fixture);
        assertNoRootWrites(fixture);
        if (change === "status") assert.equal(fixture.attributes.get(firstId)[ATTR.status], "archived");
        else assert.equal(fixture.attributes.get(firstId)[ATTR.internal], "true");
    });
}

for (const stage of ["beforeCell", "readback"]) {
    for (const failure of ["missing", "attributes", "metadata"]) {
        test(`${stage} 时来源 ${failure} 不可用逐篇报告 unavailable，不假报对齐`, async () => {
            const fixture = harness();
            const makeUnavailable = () => {
                if (failure === "missing") fixture.documents.delete(firstId);
                else if (failure === "attributes") fixture.controls.failReads.add(firstId);
                else fixture.controls.failMeta.add(firstId);
            };
            if (stage === "beforeCell") fixture.controls.onMap = makeUnavailable;
            else fixture.controls.afterCell = makeUnavailable;
            const result = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
            assert.equal(result.bound, 1);
            assert.equal(result.synced, 0);
            assertFailure(result, firstId, "unavailable");
            assert.equal(fixture.cellWrites().length, stage === "beforeCell" ? 0 : 1);
            assertNoRootWrites(fixture);
        });
    }
}

test("再次显式刷新复用宿主、字段和绑定行；AV 用户改值只能被根状态重新投影", async () => {
    const fixture = harness();
    const before = sourceSnapshot(fixture);
    const first = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(first.bound, 1);
    assert.equal(first.synced, 1);
    const itemId = fixture.itemIds.get(firstId);
    fixture.statusCell(firstId).mSelect = [{ content: "done" }];
    assert.equal(fixture.attributes.get(firstId)[ATTR.status], "reading");
    const second = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.deepEqual(second, { bound: 0, boundDocIds: [], existingDocIds: [firstId], synced: 1, failures: [] });
    assert.equal(fixture.rows.size, 1);
    assert.equal(fixture.itemIds.get(firstId), itemId);
    assert.equal(fixture.statusCell(firstId).mSelect[0].content, "reading");
    assert.equal(fixture.bindingCalls().length, 1);
    assert.equal(fixture.calls.filter((call) => call.route === "/api/av/addAttributeViewKey").length, 0);
    assert.equal(fixture.cellWrites().length, 2);
    assertSourcesUnchanged(fixture, before);
});

test("AV 刷新遇到事务短暂空 rows 时等待已有行，不重复绑定", async () => {
    const fixture = harness();
    let delayed = true;
    fixture.controls.onRender = (rendered) => {
        // 模拟思源事务刚落库时的短暂空响应：只发生在第二次刷新识别已有行的阶段。
        if (delayed && fixture.bindingCalls().length === 1 && fixture.cellWrites().length >= 1) {
            delayed = false;
            return { view: { ...rendered.view, rows: [] } };
        }
        return rendered;
    };
    const first = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(first.bound, 1);
    const second = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(second.bound, 0);
    assert.deepEqual(second.existingDocIds, [firstId]);
    assert.equal(fixture.bindingCalls().length, 1);
    assert.equal(second.synced, 1);
});

test("部分绑定后显式再刷新仅补缺失行，已绑定文章不会重复绑定", async () => {
    const fixture = harness();
    fixture.add(secondId);
    fixture.controls.skipBinding.add(secondId);
    const before = sourceSnapshot(fixture);
    const first = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(first.bound, 1);
    assertFailure(first, secondId, "unbound");
    const existingItem = fixture.itemIds.get(firstId);
    fixture.controls.skipBinding.clear();
    const second = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(second.bound, 1);
    assert.deepEqual(second.boundDocIds, [secondId]);
    assert.equal(second.synced, 2);
    assert.deepEqual(second.failures, []);
    assert.deepEqual(fixture.bindingCalls()[1].body.srcs.map((source) => source.id), [secondId]);
    assert.equal(fixture.rows.size, 2);
    assert.equal(fixture.itemIds.get(firstId), existingItem);
    assertSourcesUnchanged(fixture, before);
});

test("缺少字段时按已有主键后续建，下一次刷新按当前列名复用字段 ID", async () => {
    const fixture = harness();
    fixture.columns.splice(1);
    const before = sourceSnapshot(fixture);
    const first = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    assert.equal(first.synced, 1);
    const added = fixture.calls.filter((call) => call.route === "/api/av/addAttributeViewKey");
    assert.deepEqual(added.map((call) => [call.body.keyName, call.body.keyType, call.body.keyIcon]), [["状态", "select", ""], ["字数", "number", ""], ["时长", "number", ""], ["来源", "url", ""]]);
    assert.equal(added[0].body.previousKeyID, blockKey);
    for (let index = 1; index < added.length; index += 1) assert.equal(added[index].body.previousKeyID, added[index - 1].body.keyID);
    const createdStatusKey = added[0].body.keyID;
    assert.equal(fixture.cellWrites()[0].body.keyID, createdStatusKey);
    assert.equal((await bindAllClipsToLibrary(fixture.plugin, fixture.settings)).synced, 1);
    assert.equal(fixture.calls.filter((call) => call.route === "/api/av/addAttributeViewKey").length, 4);
    assert.equal(fixture.cellWrites()[1].body.keyID, createdStatusKey);
    assertSourcesUnchanged(fixture, before);
});

for (const columns of [undefined, null, {}, "columns"]) {
    test(`columns=${JSON.stringify(columns)} 不可用必须拒绝，不能按空列补建或假报成功`, async () => {
        const fixture = harness();
        fixture.controls.onRender = (rendered) => { rendered.view.columns = columns; return rendered; };
        const before = sourceSnapshot(fixture);
        await assert.rejects(bindAllClipsToLibrary(fixture.plugin, fixture.settings), /Database columns unavailable/);
        assert.equal(fixture.avMutations().length, 0);
        fixture.controls.onRender = null;
        assert.equal((await bindAllClipsToLibrary(fixture.plugin, fixture.settings)).synced, 1);
        assertSourcesUnchanged(fixture, before);
    });
}

test("同插件刷新重入立即拒绝，不产生第二次扫描或写入；完成后释放锁", async () => {
    const fixture = harness();
    const before = sourceSnapshot(fixture);
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    fixture.controls.beforeCell = async () => { entered.resolve(); await released.promise; };
    const refreshing = bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    await entered.promise;
    const callCount = fixture.calls.length;
    try {
        await assert.rejects(bindAllClipsToLibrary(fixture.plugin, fixture.settings), /Database refresh already running/);
        assert.equal(fixture.calls.length, callCount);
    } finally { released.resolve(); }
    assert.equal((await refreshing).synced, 1);
    assert.equal(fixture.cellWrites().length, 1);
    fixture.controls.beforeCell = null;
    assert.equal((await bindAllClipsToLibrary(fixture.plugin, fixture.settings)).synced, 1);
    assert.equal(fixture.bindingCalls().length, 1);
    assertSourcesUnchanged(fixture, before);
});

test("刷新锁按插件实例隔离，另一个插件实例不被当前实例的忙碌锁阻止", async () => {
    const fixture = harness();
    fixture.addRow(firstId);
    const anotherPlugin = { ...fixture.plugin };
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    let firstCall = true;
    fixture.controls.beforeCell = async () => {
        if (firstCall) { firstCall = false; entered.resolve(); await released.promise; }
    };
    const before = sourceSnapshot(fixture);
    const pending = bindAllClipsToLibrary(fixture.plugin, fixture.settings);
    await entered.promise;
    try { assert.equal((await bindAllClipsToLibrary(anotherPlugin, fixture.settings)).synced, 1); }
    finally { released.resolve(); }
    assert.equal((await pending).synced, 1);
    assert.equal(fixture.bindingCalls().length, 0);
    assertSourcesUnchanged(fixture, before);
});

test("真实 mapBoundDocIds 只返回请求 ID 的合法映射，缺键和空串可表示部分绑定", async () => {
    const fixture = harness();
    const itemId = fixture.addRow(firstId);
    fixture.controls.mappingResponse = (mapped) => ({ ...mapped, [secondId]: "", [missingId]: "20261005120000-row0001" });
    assert.deepEqual(await mapBoundDocIds(avId, [firstId, secondId]), { [firstId]: itemId });
    assert.deepEqual(fixture.calls.at(-1).body, { avID: avId, blockIDs: [firstId, secondId] });
});

const invalidMaps = [
    ["null", null],
    ["array", []],
    ["text", "mapping"],
    ["number", 1],
    ["boolean", true],
    ["nonString", { [firstId]: 1 }],
    ["arrayItem", { [firstId]: ["20261005120000-row0001"] }],
    ["invalidID", { [firstId]: "not-an-item-id" }],
    ["nullItem", { [firstId]: null }],
    ["duplicateItem", { [firstId]: "20261005120000-row0001", [secondId]: "20261005120000-row0001" }],
];

for (const [name, mapped] of invalidMaps) {
    test(`绑定映射 ${name} 运行时拒绝，不返回虚假数量，拒绝后释放插件刷新锁`, async () => {
        const fixture = harness();
        fixture.add(secondId);
        fixture.controls.mappingResponse = () => mapped;
        const before = sourceSnapshot(fixture);
        await assert.rejects(mapBoundDocIds(avId, [firstId, secondId]), /Invalid AV binding map|Invalid AV item ID/);
        await assert.rejects(bindAllClipsToLibrary(fixture.plugin, fixture.settings), /Invalid AV binding map|Invalid AV item ID/);
        assert.equal(fixture.cellWrites().length, 0);
        fixture.controls.mappingResponse = null;
        const recovered = await bindAllClipsToLibrary(fixture.plugin, fixture.settings);
        assert.equal(recovered.bound, 0);
        assert.equal(recovered.synced, 2);
        assert.deepEqual(recovered.failures, []);
        assert.equal(fixture.bindingCalls().length, 1);
        assertSourcesUnchanged(fixture, before);
    });
}

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-external-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-external-test:siyuan") {
            return {
                format: "module",
                source: "export const fetchSyncPost = async (...args) => globalThis.__gleanExternalPost(...args);",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { kernelPost } = await import("../src/api/client.ts");
const { putFile } = await import("../src/api/assets.ts");
const { getShorthands, getShorthand, removeShorthands } = await import("../src/api/inbox.ts");
const { migrateShorthand } = await import("../src/services/inbox-service.ts");
const { snapshotClip } = await import("../src/services/snapshot-service.ts");
const { captureClip, captureDocument } = await import("../src/services/clip-store.ts");
const { normalizeSettings } = await import("../src/services/settings.ts");

function mockResponse(response) {
    const calls = [];
    globalThis.__gleanExternalPost = async (route, body) => {
        calls.push({ route, body });
        if (response instanceof Error) throw response;
        return response;
    };
    return calls;
}

const cloudItem = {
    oId: "cloud-1", shorthandTitle: "文章", shorthandMd: "真实正文",
    shorthandDesc: "", shorthandURL: "https://example.com/article", hCreated: "2026-09-29 10:00",
};

test("内核 Promise 传输保留成功数据和原始请求", async () => {
    const calls = mockResponse({ code: 0, data: { value: 42 } });
    const body = { id: "doc" };
    assert.deepEqual(await kernelPost("/api/attr/getBlockAttrs", body), { value: 42 });
    assert.equal(calls[0].body, body);
});

test("内核非零、缺响应、缺 code 和字符串 code 均拒绝", async () => {
    for (const response of [undefined, null, "html", {}, { code: "0" }, { code: 1, msg: "failed" }, { code: Number.NaN }]) {
        mockResponse(response);
        await assert.rejects(kernelPost("/api/query/sql"));
    }
});

test("宿主网络拒绝和 JSON 解析失败会结束调用而非悬挂", async () => {
    for (const error of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected end of JSON input")]) {
        mockResponse(error);
        await assert.rejects(kernelPost("/api/query/sql"), (actual) => actual === error);
    }
});

test("资产写入直接透传 FormData 的路径和文件", async () => {
    const calls = mockResponse({ code: 0, data: null });
    await putFile("/assets/article.html", new Blob(["<p>正文</p>"], { type: "text/html" }), "article.html");
    assert.equal(calls[0].route, "/api/file/putFile");
    assert.ok(calls[0].body instanceof FormData);
    assert.equal(calls[0].body.get("path"), "/assets/article.html");
    const file = calls[0].body.get("file");
    assert.equal(file.name, "article.html");
    assert.equal(await file.text(), "<p>正文</p>");
});

test("资产写入和云端删除不能把异常响应当成功", async () => {
    for (const response of [undefined, {}, { code: -1 }, new TypeError("offline")]) {
        mockResponse(response);
        await assert.rejects(putFile("/assets/article.html", new Blob(["html"]), "article.html"));
        await assert.rejects(removeShorthands(["cloud-1"]));
    }
});

test("收集箱双层成功响应保留分页和来源数据", async () => {
    mockResponse({ code: 0, data: { code: 0, data: {
        pagination: { paginationRecordCount: 3, paginationPageCount: 2 }, shorthands: [cloudItem],
    } } });
    const result = await getShorthands(1);
    assert.equal(result.error, "");
    assert.equal(result.page.recordCount, 3);
    assert.equal(result.page.hasMore, true);
    assert.deepEqual(result.page.shorthands, [cloudItem]);
});

test("收集箱合法空列表保持可用，内层失败不能伪装成空列表", async () => {
    mockResponse({ code: 0, data: { code: 0, data: { shorthands: [] } } });
    assert.deepEqual(await getShorthands(), { page: { shorthands: [], recordCount: 0, hasMore: false }, error: "" });
    for (const response of [
        { code: 0, data: { code: 1, msg: "subscription expired", data: { shorthands: [] } } },
        { code: 0, data: { data: { shorthands: [] } } },
        { code: 0, data: { code: 0, data: { shorthands: {} } } },
        { code: 0, data: null },
        { code: 1 },
        new TypeError("offline"),
    ]) {
        mockResponse(response);
        const result = await getShorthands();
        assert.equal(result.page, null);
        assert.ok(result.error);
    }
});

test("损坏的收集箱条目或分页不被伪装为可用数据", async () => {
    for (const data of [
        { shorthands: [null] }, { shorthands: [{}] }, { shorthands: [{ oId: "" }] },
        { shorthands: [{ oId: Number.NaN }] }, { shorthands: [{ oId: {} }] },
        { shorthands: [{ ...cloudItem, shorthandMd: {} }] },
        { shorthands: [], pagination: { paginationPageCount: "bad" } },
        { shorthands: [], pagination: { paginationRecordCount: -1 } },
    ]) {
        mockResponse({ code: 0, data: { code: 0, data } });
        assert.equal((await getShorthands()).page, null);
    }
});

test("收集箱详情错误和空载荷降级为 null，合法载荷可回退请求 ID", async () => {
    for (const response of [null, { code: 1 }, { code: 0, data: {} }, { code: 0, data: [] }, new Error("offline")]) {
        mockResponse(response);
        assert.equal(await getShorthand("cloud-1"), null);
    }
    const { oId, ...details } = cloudItem;
    mockResponse({ code: 0, data: details });
    assert.deepEqual(await getShorthand(oId), cloudItem);
});

function serviceHarness() {
    const attrs = new Map();
    const files = new Map();
    const calls = [];
    const responses = new Map();
    const plugin = {
        settings: normalizeSettings({}),
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanExternalPost = async (route, body) => {
        calls.push({ route, body });
        if (responses.has(route)) {
            const response = typeof responses.get(route) === "function" ? await responses.get(route)(body) : responses.get(route);
            if (response instanceof Error) throw response;
            if (response !== undefined) return response;
        }
        let data;
        switch (route) {
            case "/api/query/sql": {
                const docId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                const ids = docId ? [docId] : [...attrs.keys()].filter((id) => attrs.get(id)["custom-clip-status"] || attrs.get(id)["custom-clip-url"]);
                data = ids.map((id) => ({ id, box: "box", content: id, hpath: `/${id}`, updated: "20260929000000" }));
                break;
            }
            case "/api/filetree/createDocWithMd":
                attrs.set("new-doc", {});
                data = "new-doc";
                break;
            case "/api/attr/getBlockAttrs": data = attrs.get(body.id) ?? {}; break;
            case "/api/attr/batchGetBlockAttrs": data = Object.fromEntries(body.ids.map((id) => [id, attrs.get(id) ?? {}])); break;
            case "/api/attr/setBlockAttrs": attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs }); data = null; break;
            case "/api/export/exportHTML": data = { content: "<html>正文</html>", name: "article" }; break;
            case "/api/export/exportMdContent": data = { content: "真实正文" }; break;
            case "/api/inbox/removeShorthands":
            case "/api/file/putFile": data = null; break;
            default: throw new Error(`未模拟端点：${route}`);
        }
        return { code: 0, data };
    };
    return { attrs, files, calls, responses, plugin };
}

test("云端删除异常保留真实本地收录，返回 cloudRemoved=false", async () => {
    const context = serviceHarness();
    context.responses.set("/api/inbox/removeShorthands", {});
    const result = await migrateShorthand(context.plugin, cloudItem, { notebookId: "box" });
    assert.equal(result.docId, "new-doc");
    assert.equal(result.cloudRemoved, false);
    assert.equal(context.attrs.get("new-doc")["custom-clip-status"], "inbox");
    assert.equal(context.attrs.get("new-doc")["custom-clip-url"], cloudItem.shorthandURL);
});

test("本地属性收录失败时不调用云端删除", async () => {
    const context = serviceHarness();
    context.responses.set("/api/attr/setBlockAttrs", { code: -1, msg: "permission denied" });
    await assert.rejects(migrateShorthand(context.plugin, cloudItem, { notebookId: "box" }), /permission denied/);
    assert.equal(context.calls.some((call) => call.route === "/api/inbox/removeShorthands"), false);
});

test("收录未执行成功时不删除云条目或伪报迁入", async () => {
    const context = serviceHarness();
    context.responses.set("/api/attr/getBlockAttrs", { code: 0, data: { "custom-clip-status": "later" } });
    await assert.rejects(migrateShorthand(context.plugin, cloudItem, { notebookId: "box" }), /未完成收录/);
    assert.equal(context.calls.some((call) => call.route === "/api/inbox/removeShorthands"), false);
});

test("快照非文本导出不写资产或快照属性", async () => {
    for (const content of [42, {}, [], null]) {
        const context = serviceHarness();
        context.responses.set("/api/export/exportHTML", { code: 0, data: { name: "article", content } });
        await assert.rejects(snapshotClip(context.plugin, "article"), /缺少 HTML 正文/);
        assert.equal(context.calls.some((call) => call.route === "/api/file/putFile"), false);
        assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    }
});

test("快照资产异常时原快照和文章属性保持不变", async () => {
    for (const response of [{}, { code: -1 }, new TypeError("offline")]) {
        const context = serviceHarness();
        context.attrs.set("article", { "custom-clip-status": "done", "custom-clip-snapshot": "assets/old.html", tags: "保留" });
        const before = structuredClone(context.attrs.get("article"));
        context.responses.set("/api/file/putFile", response);
        await assert.rejects(snapshotClip(context.plugin, "article"));
        assert.deepEqual(context.attrs.get("article"), before);
        assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    }
});

const captureDocId = "20261005000000-snap001";

test("自动快照关闭、缺失或非法开关时仅完成收录", async () => {
    for (const settings of [normalizeSettings({}), undefined, {}, { snapshotOnCapture: "true" }, { snapshotOnCapture: 1 }]) {
        const context = serviceHarness();
        context.plugin.settings = settings;
        const result = await captureClip(context.plugin, captureDocId, { contentType: "local", markdown: "本地正文" });
        assert.equal(result.captured, true);
        assert.equal(result.attrs.snapshot, undefined);
        assert.equal(context.calls.some((call) => ["/api/export/exportHTML", "/api/file/putFile"].includes(call.route)), false);
    }
});

test("插件缓存未就绪时从 settings.json 读取自动快照开关", async () => {
    const context = serviceHarness();
    context.plugin.settings = undefined;
    context.files.set("settings.json", normalizeSettings({ snapshotOnCapture: true }));
    const result = await captureClip(context.plugin, captureDocId, { contentType: "local", markdown: "本地正文" });
    assert.equal(result.captured, true);
    assert.match(result.attrs.snapshot, /^\/box\/assets\/glean-20261005000000-snap001-\d{14}\.html$/);
});

test("自动快照在收录写入与索引成功后生成，返回与派生索引包含快照路径", async () => {
    const context = serviceHarness();
    context.plugin.settings.snapshotOnCapture = true;
    context.attrs.set(captureDocId, { "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "用户标签" });
    const result = await captureDocument(context.plugin, captureDocId, { contentType: "local" });
    assert.equal(result.captured, true);
    assert.equal(result.attrs.status, "inbox");
    assert.match(result.attrs.snapshot, /^\/box\/assets\/glean-20261005000000-snap001-\d{14}\.html$/);
    const put = context.calls.find((call) => call.route === "/api/file/putFile");
    assert.equal(put.body.get("path"), result.attrs.snapshot);
    assert.equal(await put.body.get("file").text(), "<html>正文</html>");
    const writes = context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs");
    assert.equal(writes.length, 2);
    assert.equal(writes[0].body.attrs["custom-clip-status"], "inbox");
    assert.deepEqual(writes[1].body.attrs, { "custom-clip-snapshot": result.attrs.snapshot });
    assert.ok(context.calls.indexOf(writes[0]) < context.calls.findIndex((call) => call.route === "/api/export/exportHTML"));
    const attrs = context.attrs.get(captureDocId);
    assert.equal(attrs["custom-clip-priority"], "5");
    assert.equal(attrs["custom-clip-rating"], "4");
    assert.equal(attrs.tags, "用户标签");
    assert.equal(context.files.get("glean-index.json").clips[captureDocId].snapshot, result.attrs.snapshot);
    const duplicate = await captureClip(context.plugin, captureDocId);
    assert.equal(duplicate.captured, false);
    assert.equal(context.calls.filter((call) => call.route === "/api/export/exportHTML").length, 1);
});

test("首次收录已有快照时保留路径，不自动导出或写盘", async () => {
    const context = serviceHarness();
    context.plugin.settings.snapshotOnCapture = true;
    context.attrs.set(captureDocId, { "custom-clip-snapshot": "assets/original.html" });
    const result = await captureClip(context.plugin, captureDocId, { contentType: "local" });
    assert.equal(result.captured, true);
    assert.equal(result.attrs.snapshot, "assets/original.html");
    assert.equal(context.calls.some((call) => ["/api/export/exportHTML", "/api/file/putFile"].includes(call.route)), false);
});

for (const stage of ["export", "emptyExport", "asset", "attribute", "snapshotIndex"]) {
    test(`自动快照 ${stage} 失败不回滚真实收录，警告不包含原始异常`, async (testContext) => {
        const warning = testContext.mock.method(console, "warn", () => {});
        const context = serviceHarness();
        context.plugin.settings.snapshotOnCapture = true;
        context.attrs.set(captureDocId, { "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "保留" });
        const privateError = new Error("PRIVATE-CONTENT-URL-TITLE");
        if (stage === "export") context.responses.set("/api/export/exportHTML", privateError);
        if (stage === "emptyExport") context.responses.set("/api/export/exportHTML", { code: 0, data: { content: "", name: "article" } });
        if (stage === "asset") context.responses.set("/api/file/putFile", privateError);
        if (stage === "attribute") context.responses.set("/api/attr/setBlockAttrs", (body) => body.attrs["custom-clip-snapshot"] ? privateError : undefined);
        if (stage === "snapshotIndex") {
            const save = context.plugin.saveData;
            context.plugin.saveData = async (name, value) => {
                if (name === "glean-index.json" && value.clips[captureDocId]?.snapshot) throw privateError;
                return save(name, value);
            };
        }
        const result = await captureClip(context.plugin, captureDocId, { contentType: "local", markdown: "正文" });
        assert.equal(result.captured, true);
        assert.equal(result.attrs.status, "inbox");
        const attrs = context.attrs.get(captureDocId);
        assert.equal(attrs["custom-clip-status"], "inbox");
        assert.equal(attrs["custom-clip-priority"], "5");
        assert.equal(attrs["custom-clip-rating"], "4");
        assert.equal(attrs.tags, "保留");
        if (stage !== "snapshotIndex") assert.equal(attrs["custom-clip-snapshot"], undefined);
        else assert.ok(attrs["custom-clip-snapshot"]);
        assert.equal(context.files.get("glean-index.json").clips[captureDocId].status, "inbox");
        assert.equal(warning.mock.calls.length, 1);
        assert.deepEqual(warning.mock.calls[0].arguments, ["[glean] automatic snapshot failed"]);
        assert.equal((await captureClip(context.plugin, captureDocId)).captured, false);
        assert.equal(warning.mock.calls.length, 1);
    });
}

test("收录属性或收录索引失败时不尝试快照", async () => {
    for (const stage of ["attribute", "index"]) {
        const context = serviceHarness();
        context.plugin.settings.snapshotOnCapture = true;
        if (stage === "attribute") context.responses.set("/api/attr/setBlockAttrs", new Error("capture failed"));
        else context.plugin.saveData = async () => { throw new Error("capture failed"); };
        await assert.rejects(captureClip(context.plugin, captureDocId, { contentType: "local" }), /capture failed/);
        assert.equal(context.calls.some((call) => ["/api/export/exportHTML", "/api/file/putFile"].includes(call.route)), false);
    }
});

test("URL 冲突和已有有效状态不会触发自动快照", async () => {
    for (const scenario of ["conflict", "captured"]) {
        const context = serviceHarness();
        context.plugin.settings.snapshotOnCapture = true;
        if (scenario === "captured") context.attrs.set(captureDocId, { "custom-clip-status": "done" });
        else context.attrs.set("20261005000001-snap002", { "custom-clip-status": "inbox", "custom-clip-url": "https://example.test/article" });
        const result = await captureClip(context.plugin, captureDocId, { url: "https://example.test/article" });
        assert.equal(result.captured, false);
        if (scenario === "conflict") assert.equal(result.conflict.id, "20261005000001-snap002");
        assert.equal(context.calls.some((call) => ["/api/export/exportHTML", "/api/file/putFile", "/api/attr/setBlockAttrs"].includes(call.route)), false);
    }
});

test("自动快照回写核对期间新增的手动快照路径，不覆盖或回滚收录", async (testContext) => {
    testContext.mock.method(console, "warn", () => {});
    const context = serviceHarness();
    context.plugin.settings.snapshotOnCapture = true;
    context.responses.set("/api/file/putFile", () => {
        context.attrs.get(captureDocId)["custom-clip-snapshot"] = "assets/manual.html";
        return { code: 0, data: null };
    });
    const result = await captureClip(context.plugin, captureDocId, { contentType: "local" });
    assert.equal(result.captured, true);
    assert.equal(context.attrs.get(captureDocId)["custom-clip-status"], "inbox");
    assert.equal(context.attrs.get(captureDocId)["custom-clip-snapshot"], "assets/manual.html");
    assert.equal(context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length, 1);
});

test("收集箱共享收录管线生成快照，快照失败仍允许真实本地迁入和云端删除", async (testContext) => {
    testContext.mock.method(console, "warn", () => {});
    for (const failed of [false, true]) {
        const context = serviceHarness();
        context.plugin.settings.snapshotOnCapture = true;
        if (failed) context.responses.set("/api/export/exportHTML", new Error("snapshot failed"));
        const result = await migrateShorthand(context.plugin, cloudItem, { notebookId: "box" });
        assert.equal(result.docId, "new-doc");
        assert.equal(result.cloudRemoved, true);
        assert.equal(context.attrs.get("new-doc")["custom-clip-status"], "inbox");
        assert.equal(context.attrs.get("new-doc")["custom-clip-url"], cloudItem.shorthandURL);
        assert.equal(Boolean(context.attrs.get("new-doc")["custom-clip-snapshot"]), !failed);
        assert.equal(context.calls.filter((call) => call.route === "/api/export/exportHTML").length, 1);
    }
});

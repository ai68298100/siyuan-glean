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
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanExternalPost = async (route, body) => {
        calls.push({ route, body });
        if (responses.has(route)) {
            const response = responses.get(route);
            if (response instanceof Error) throw response;
            return response;
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

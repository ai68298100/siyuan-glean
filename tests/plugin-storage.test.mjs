import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "data:text/javascript,export{}", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
});

const { readPluginJsonFile, PLUGIN_JSON_READ_TIMEOUT_MS } = await import("../src/api/plugin-storage.ts");
const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
const filename = "import-progress.json";
const read = () => readPluginJsonFile("siyuan-glean", filename);
const raw = (status, value) => new Response(JSON.stringify(value), { status });

test("私有JSON读取使用同源无缓存POST，返回200原值而非code信封data", async () => {
    const value = { version: 1, code: 0, data: "not-an-envelope" };
    globalThis.fetch = async (route, options) => {
        assert.equal(route, "/api/file/getFile");
        assert.equal(options.method, "POST");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.cache, "no-store");
        assert.deepEqual(JSON.parse(options.body), { path: `/data/storage/petal/siyuan-glean/${filename}` });
        return raw(200, value);
    };
    assert.deepEqual(await read(), value);
});

test("私有JSON仅将202和404/null完整形状确认为缺失，JSON null保持原值", async () => {
    globalThis.fetch = async () => raw(202, { code: 404, msg: "missing", data: null });
    assert.equal(await read(), null);
    globalThis.fetch = async () => raw(200, null);
    assert.equal(await read(), null);
    globalThis.fetch = async () => raw(200, "");
    assert.equal(await read(), "");
});

test("缺失形状不完整、不同HTTP状态、空文件和坏JSON均拒绝", async () => {
    for (const [status, text] of [
        [202, '{"code":404}'], [202, '{"code":404,"data":{}}'],
        [404, '{"code":404,"data":null}'], [202, "invalid"], [200, ""], [200, "{bad"],
    ]) {
        globalThis.fetch = async () => new Response(text, { status });
        await assert.rejects(read(), (error) => ["protocol", "kernel"].includes(error.kind));
    }
    globalThis.fetch = async () => raw(200, { code: 404, data: null });
    assert.deepEqual(await read(), { code: 404, data: null });
});

test("权限拒绝保留permission分类且不泄露私有响应、不重试", async () => {
    for (const [status, text] of [[401, '{"code":-1,"msg":"private-secret"}'], [403, "private-secret"], [202, '{"code":-403,"data":null}']]) {
        let calls = 0;
        globalThis.fetch = async () => { calls += 1; return new Response(text, { status }); };
        await assert.rejects(read(), (error) => error.kind === "permission" && !error.message.includes("private-secret"));
        assert.equal(calls, 1);
    }
});

test("网络失败与内核错误不会成为无任务，也不包含原始异常", async () => {
    globalThis.fetch = async () => { throw new Error("private-path-and-token"); };
    await assert.rejects(read(), (error) => error.kind === "network" && !error.message.includes("private-path-and-token"));
    globalThis.fetch = async () => raw(503, { code: 503, data: null });
    await assert.rejects(read(), { kind: "kernel", code: 503 });
});

test("私有JSON读取10秒超时覆盖正文读取并中止请求", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let signal;
    globalThis.fetch = async (_route, options) => {
        signal = options.signal;
        return { status: 200, text: () => new Promise(() => {}) };
    };
    const request = read();
    const rejected = assert.rejects(request, { kind: "timeout" });
    context.mock.timers.tick(PLUGIN_JSON_READ_TIMEOUT_MS);
    await rejected;
    assert.equal(signal.aborted, true);
});

test("插件与文件名单片段校验阻止路径穿越，请求尚未发出", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return raw(200, null); };
    for (const [pluginName, file] of [
        ["../other", filename], ["siyuan-glean", "../import-progress.json"],
        ["a/b", filename], ["a\\b", filename], ["%2e%2e", filename],
        ["siyuan-glean", "%2e%2e.json"], ["siyuan-glean", "a/record.json"],
        ["siyuan-glean", "a..json"], ["siyuan-glean", "record.txt"],
    ]) await assert.rejects(readPluginJsonFile(pluginName, file), { kind: "protocol" });
    assert.equal(calls, 0);
});

/** kernelPost 超时机制单测（T-1967）：stub fetchPost，验证超时 reject、迟到响应丢弃、正常路径。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-test:siyuan-timeout", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-test:siyuan-timeout") {
            return {
                format: "module",
                source: `
                    export const fetchSyncPost = (...args) => {
                        if (typeof globalThis.__gleanTimeoutFetchSyncPost === "function") return globalThis.__gleanTimeoutFetchSyncPost(...args);
                        return new Promise((resolve, reject) => globalThis.__gleanTimeoutFetchPost(...args, resolve, reject));
                    };
                    export const fetchPost = (...args) => globalThis.__gleanTimeoutFetchPost(...args);
                `,
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { kernelPost, isKernelRequestError, getBlockAttrs, setBlockAttrs, querySql, createDocWithMd } = await import("../src/api/client.ts");
const { exportDocHtml } = await import("../src/api/assets.ts");

function hang() { /* 永不回调 */ }
const flushRequests = () => new Promise((resolve) => setImmediate(resolve));

test("kernelPost：超时 reject 且错误信息含路由与秒数（T-1967）", async () => {
    globalThis.__gleanTimeoutFetchPost = hang;
    await assert.rejects(
        kernelPost("/api/test/none", {}, { timeoutMs: 30 }),
        /\/api\/test\/none 请求超时（0s 无响应）|请求超时/
    );
});

test("kernelPost：超时后迟到的成功响应被丢弃", async () => {
    let captured;
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => { captured = cb; };
    const pending = kernelPost("/api/test/late", {}, { timeoutMs: 30 });
    await assert.rejects(pending, /请求超时/);
    // 迟到的成功响应不得改变已 settle 的 Promise（也不得抛 unhandled）
    captured?.({ code: 0, data: "late" });
});

test("kernelPost：正常响应不受超时机制影响", async () => {
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => cb({ code: 0, data: { ok: true } });
    assert.deepEqual(await kernelPost("/api/test/ok", {}), { ok: true });
});

test("kernelPost：宿主同时提供两种接口时优先使用 Promise 接口", async () => {
    let syncCalls = 0;
    let callbackCalls = 0;
    globalThis.__gleanTimeoutFetchSyncPost = async () => {
        syncCalls += 1;
        return { code: 0, data: "promise" };
    };
    globalThis.__gleanTimeoutFetchPost = () => { callbackCalls += 1; };
    try {
        assert.equal(await kernelPost("/api/test/transport-preference"), "promise");
        assert.equal(syncCalls, 1);
        assert.equal(callbackCalls, 0);
    } finally {
        delete globalThis.__gleanTimeoutFetchSyncPost;
    }
});

test("kernelPost：AbortSignal 取消后拒绝并忽略迟到响应", async () => {
    let captured;
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => { captured = cb; };
    const controller = new AbortController();
    const pending = kernelPost("/api/test/abort", {}, { timeoutMs: 500, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => isKernelRequestError(error) && error.kind === "aborted");
    captured?.({ code: 0, data: "late" });
});

test("kernelPost：显式 requestKey 合并并发读取，默认不合并", async () => {
    let calls = 0;
    let captured;
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => { calls += 1; captured = cb; };
    const first = kernelPost("/api/test/dedupe", { id: 1 }, { requestKey: "doc-1" });
    const second = kernelPost("/api/test/dedupe", { id: 1 }, { requestKey: "doc-1" });
    await flushRequests();
    assert.equal(calls, 1);
    captured({ code: 0, data: { ok: true } });
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);

    calls = 0;
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => { calls += 1; cb({ code: 0, data: calls }); };
    assert.deepEqual(await Promise.all([
        kernelPost("/api/test/no-dedupe", {}),
        kernelPost("/api/test/no-dedupe", {}),
    ]), [1, 2]);
    assert.equal(calls, 2);
});

test("kernelPost：仅显式 retry 才重试可恢复网络错误，权限错误不重试", async () => {
    let calls = 0;
    globalThis.__gleanTimeoutFetchPost = (route, body, ok, fail) => {
        calls += 1;
        if (calls < 3) fail?.({ reason: "offline" });
        else ok({ code: 0, data: "ok" });
    };
    assert.equal(await kernelPost("/api/test/retry", {}, { retryable: true, retry: { attempts: 3, delayMs: 0 } }), "ok");
    assert.equal(calls, 3);

    calls = 0;
    globalThis.__gleanTimeoutFetchPost = (route, body, ok) => { calls += 1; ok({ code: 403, msg: "forbidden" }); };
    await assert.rejects(
        kernelPost("/api/test/permission", {}, { retryable: true, retry: { attempts: 3, delayMs: 0 } }),
        (error) => isKernelRequestError(error) && error.kind === "permission" && error.retryable === false,
    );
    assert.equal(calls, 1);
});

test("kernelPost：retry 配置不能单独触发重试，必须显式标记 retryable", async () => {
    let calls = 0;
    globalThis.__gleanTimeoutFetchPost = (route, body, ok, fail) => { calls += 1; fail?.({ reason: "offline" }); };
    await assert.rejects(kernelPost("/api/test/no-retry", {}, { retry: { attempts: 3, delayMs: 0 } }));
    assert.equal(calls, 1);
});

test("kernelPost：显式 latestKey 让旧响应失效并只交付最新结果", async () => {
    const callbacks = [];
    globalThis.__gleanTimeoutFetchPost = (route, body, cb) => { callbacks.push(cb); };
    const oldRequest = kernelPost("/api/test/latest", { q: "old" }, { latestKey: "search" });
    const newRequest = kernelPost("/api/test/latest", { q: "new" }, { latestKey: "search" });
    await flushRequests();
    callbacks[0]({ code: 0, data: "old" });
    await assert.rejects(oldRequest, (error) => isKernelRequestError(error) && error.kind === "superseded");
    callbacks[1]({ code: 0, data: "new" });
    assert.equal(await newRequest, "new");
});

test("属性写入失效后的旧读取在后续读取完成后仍不能复活", async () => {
    const callbacks = [];
    globalThis.__gleanTimeoutFetchPost = (route, body, callback) => {
        if (route === "/api/attr/getBlockAttrs") callbacks.push(callback);
        else callback({ code: 0, data: null });
    };

    const staleRead = getBlockAttrs("doc-latest-reset");
    await setBlockAttrs("doc-latest-reset", { "custom-clip-status": "done" });

    const freshRead = getBlockAttrs("doc-latest-reset");
    await flushRequests();
    callbacks[1]({ code: 0, data: { "custom-clip-status": "done" } });
    assert.deepEqual(await freshRead, { "custom-clip-status": "done" });
    await new Promise((resolve) => setImmediate(resolve));

    const newestRead = getBlockAttrs("doc-latest-reset");
    await flushRequests();
    callbacks[0]({ code: 0, data: { "custom-clip-status": "inbox" } });
    await assert.rejects(staleRead, (error) => isKernelRequestError(error) && error.kind === "superseded");

    callbacks[2]({ code: 0, data: { "custom-clip-status": "done" } });
    assert.deepEqual(await newestRead, { "custom-clip-status": "done" });
});

test("快照 HTML 导出合并同文并发只读请求", async () => {
    let calls = 0;
    let captured;
    globalThis.__gleanTimeoutFetchPost = (route, body, callback) => {
        assert.equal(route, "/api/export/exportHTML");
        calls += 1;
        captured = callback;
    };
    const first = exportDocHtml("doc-html-dedupe");
    const second = exportDocHtml("doc-html-dedupe");
    await flushRequests();
    assert.equal(calls, 1);
    captured({ code: 0, data: { name: "article", content: "<html></html>" } });
    assert.deepEqual(await Promise.all([first, second]), [
        { name: "article", content: "<html></html>" },
        { name: "article", content: "<html></html>" },
    ]);
});

test("文档创建成功后淘汰旧 SQL 读取，避免新列表复用旧响应", async () => {
    const sqlCallbacks = [];
    globalThis.__gleanTimeoutFetchPost = (route, body, callback) => {
        if (route === "/api/query/sql") sqlCallbacks.push(callback);
        else if (route === "/api/filetree/createDocWithMd") callback({ code: 0, data: "20261014120000-abcdefg" });
        else callback({ code: 0, data: null });
    };
    const stmt = "SELECT id FROM blocks WHERE type = 'd'";
    const staleRead = querySql(stmt);
    await flushRequests();
    await createDocWithMd("notebook", "/new", "# New");

    const freshRead = querySql(stmt);
    await flushRequests();
    assert.equal(sqlCallbacks.length, 2);
    sqlCallbacks[1]({ code: 0, data: [{ id: "new-doc" }] });
    assert.deepEqual(await freshRead, [{ id: "new-doc" }]);
    sqlCallbacks[0]({ code: 0, data: [] });
    await assert.rejects(staleRead, (error) => isKernelRequestError(error) && error.kind === "superseded");
});

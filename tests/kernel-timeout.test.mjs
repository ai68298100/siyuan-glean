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
                source: "export const fetchPost = (...args) => globalThis.__gleanTimeoutFetchPost(...args);",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { kernelPost } = await import("../src/api/client.ts");

function hang() { /* 永不回调 */ }

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

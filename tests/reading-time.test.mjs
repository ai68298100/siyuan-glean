/** 阅读计时纯计算单测（T-1747） */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-test:siyuan-time", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-test:siyuan-time") {
            return {
                format: "module",
                source: "export const fetchPost = (...args) => { throw new Error('not used'); };",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { sessionMinutes } = await import("../src/services/reading-time.ts");

test("sessionMinutes：向下取整，不足 1 分钟为 0", () => {
    const start = 1_700_000_000_000;
    assert.equal(sessionMinutes(start, start + 59_999), 0);
    assert.equal(sessionMinutes(start, start + 60_000), 1);
    assert.equal(sessionMinutes(start, start + 125 * 60_000), 125);
});

test("sessionMinutes：非法起点返回 0", () => {
    assert.equal(sessionMinutes(0, Date.now()), 0);
    assert.equal(sessionMinutes(-5, Date.now()), 0);
    assert.equal(sessionMinutes(Number.NaN, Date.now()), 0);
});

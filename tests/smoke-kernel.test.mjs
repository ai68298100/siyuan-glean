import assert from "node:assert/strict";
import test from "node:test";
import {
    SCRATCH_PREFIXES,
    assertAiAllowed,
    cleanupScratch,
    guardScratch,
    isAiEnabled,
    isScratchName,
    prepareWriteSmoke,
    resolveTarget,
    sweepOrphans,
} from "../scripts/lib/smoke-kernel.mjs";

function notebookApi(initial) {
    const notebooks = initial.map((item) => ({ ...item }));
    const calls = [];
    const api = async (route, body = {}) => {
        calls.push({ route, body });
        if (route === "/api/notebook/lsNotebooks") return { code: 0, data: { notebooks } };
        if (route === "/api/notebook/removeNotebook") {
            const index = notebooks.findIndex((item) => item.id === body.notebook);
            if (index >= 0) notebooks.splice(index, 1);
            return { code: 0, data: null };
        }
        throw new Error(`unexpected route ${route}`);
    };
    return { api, notebooks, calls };
}

test("resolveTarget uses argv before environment and never invents token", () => {
    assert.deepEqual(resolveTarget({
        argv: ["--base-url", "http://127.0.0.1:6807", "--token", "argv-token"],
        env: { SIYUAN_BASE_URL: "http://127.0.0.1:6806", SIYUAN_TOKEN: "env-token" },
    }), { base: "http://127.0.0.1:6807", token: "argv-token" });
    assert.throws(() => resolveTarget({ env: {}, requireToken: true }), /缺少思源 token/);
});

test("write targets are restricted to loopback", () => {
    assert.throws(() => resolveTarget({ baseArg: "https://example.com", tokenArg: "x" }), /只允许回环地址/);
});

test("sweepOrphans removes only registered scratch prefixes", async () => {
    const harness = notebookApi([
        { id: "scratch", name: "siyuan-glean-smoke-123" },
        { id: "foreign", name: "我的真实笔记" },
    ]);
    await sweepOrphans(harness.api, { log: () => {} });
    assert.deepEqual(harness.notebooks.map((item) => item.id), ["foreign"]);
    assert.equal(harness.calls.filter((call) => call.route.endsWith("removeNotebook")).length, 1);
});

test("guardScratch rejects a shared workspace and explicit escape hatch is visible", async () => {
    const harness = notebookApi([{ id: "foreign", name: "我的真实笔记" }]);
    await assert.rejects(guardScratch(harness.api, { base: "http://127.0.0.1:6806", log: {} }), /不是隔离靶场/);
    const result = await guardScratch(harness.api, { allowShared: true, log: {} });
    assert.equal(result.allowed, true);
});

test("prepareWriteSmoke sweeps before guarding", async () => {
    const harness = notebookApi([
        { id: "scratch", name: "siyuan-glean-smoke-old" },
    ]);
    const result = await prepareWriteSmoke(harness.api, { log: {} });
    assert.equal(result.swept.length, 1);
    assert.equal(result.foreign.length, 0);
    assert.equal(harness.calls[0].route, "/api/notebook/lsNotebooks");
});

test("cleanupScratch removes owned notebooks at shutdown and preserves foreign data", async () => {
    const harness = notebookApi([
        { id: "owned", name: "siyuan-glean-smoke-current" },
        { id: "foreign", name: "真实笔记" },
    ]);
    const removed = await cleanupScratch(harness.api, { log: () => {} });
    assert.deepEqual(removed.map((item) => item.id), ["owned"]);
    assert.deepEqual(harness.notebooks.map((item) => item.id), ["foreign"]);
});

test("AI checks stay disabled unless explicitly enabled", () => {
    const messages = [];
    assert.equal(isAiEnabled({}), false);
    assert.equal(assertAiAllowed({ env: {}, log: (message) => messages.push(message) }), false);
    assert.equal(messages.length, 1);
    assert.equal(assertAiAllowed({ env: { SIYUAN_E2E_AI: "1" }, log: () => {} }), true);
    assert.ok(isScratchName("siyuan-glean-smoke-x", SCRATCH_PREFIXES));
});

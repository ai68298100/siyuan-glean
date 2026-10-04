import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stub = `
export const readClip = (...args) => globalThis.__previewApi.readClip(...args);
export const writeClip = (...args) => globalThis.__previewApi.writeClip(...args);
export const batchSetStatus = (...args) => globalThis.__previewApi.batchSetStatus(...args);
export const captureDocument = (...args) => globalThis.__previewApi.captureDocument(...args);
export const findClipUrlConflict = (...args) => globalThis.__previewApi.findClipUrlConflict(...args);
`;
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "./clip-store" && context.parentURL?.endsWith("/workbench-preview.ts")) {
        return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    if (context.parentURL?.endsWith("/workbench-preview.ts")) {
        if (specifier === "../api/client") return { url: "data:text/javascript,export const getHighlightBlocks = (...args) => globalThis.__previewApi.getHighlightBlocks(...args);", shortCircuit: true };
        if (specifier === "./excerpt-service") return { url: "data:text/javascript,export const insertQuoteExcerpt = (...args) => globalThis.__previewApi.insertQuoteExcerpt(...args);", shortCircuit: true };
    }
    return nextResolve(specifier, context);
} });

const { setPreviewStatus, confirmPreviewCandidate, excludePreviewCandidate, savePreviewCandidateUrl, quotePreviewExcerpt } = await import("../src/services/workbench-preview.ts");

function harness(attrs = {}) {
    const calls = [];
    const api = {
        async readClip() { calls.push(["read"]); return { ...attrs }; },
        async writeClip(...args) { calls.push(["write", ...args]); return {}; },
        async batchSetStatus(...args) { calls.push(["status", ...args]); return 1; },
        async captureDocument(...args) { calls.push(["capture", ...args]); return { captured: true, attrs: {} }; },
        async findClipUrlConflict() { calls.push(["conflict"]); return null; },
    };
    globalThis.__previewApi = api;
    return { api, calls, writes() { return calls.filter((call) => ["write", "status", "capture"].includes(call[0])); } };
}

test("预览改状态仅允许当前已收录非internal文档，失败不冒充成功", async () => {
    for (const attrs of [{}, { internal: true, status: "inbox" }]) {
        const current = harness(attrs);
        await assert.rejects(setPreviewStatus({}, "doc", "done"), { reason: "changed" });
        assert.equal(current.writes().length, 0);
    }
    const current = harness({ status: "later" });
    await setPreviewStatus({}, "doc", "done");
    assert.deepEqual(current.writes(), [["status", {}, ["doc"], "done"]]);
    current.api.batchSetStatus = async () => 0;
    await assert.rejects(setPreviewStatus({}, "doc", "done"), { reason: "failed" });
});

test("预览确认候选复查资格，已有手填来源优先，冲突不推进", async () => {
    for (const attrs of [{ status: "inbox" }, { excluded: true }, { internal: true }]) {
        const current = harness(attrs);
        await assert.rejects(confirmPreviewCandidate({}, "doc", "https://old.example/a"), { reason: "changed" });
        await assert.rejects(excludePreviewCandidate({}, "doc"), { reason: "changed" });
        assert.equal(current.writes().length, 0);
    }
    const current = harness({ url: "https://manual.example/a" });
    await confirmPreviewCandidate({}, "doc", "https://cache.example/a");
    assert.deepEqual(current.writes(), [["capture", {}, "doc", { url: "https://manual.example/a" }]]);
    current.api.captureDocument = async () => ({ captured: false, conflict: { title: "Existing" } });
    await assert.rejects(confirmPreviewCandidate({}, "doc", "https://cache.example/a"), { reason: "conflict", detail: "Existing" });
});

test("无来源候选可明确转本地，非法来源不能确认或静默丢来源", async () => {
    const current = harness();
    await confirmPreviewCandidate({}, "doc", "", true);
    assert.deepEqual(current.writes(), [["capture", {}, "doc", { contentType: "local" }]]);
    const invalid = harness({ url: "javascript:alert(1)" });
    await assert.rejects(confirmPreviewCandidate({}, "doc", ""), { reason: "invalidUrl" });
    await assert.rejects(confirmPreviewCandidate({}, "doc", "", true), { reason: "changed" });
    assert.equal(invalid.writes().length, 0);
});

test("补来源：非法草稿、用户中途修改或查重冲突均拒绝覆盖", async () => {
    const invalid = harness();
    await assert.rejects(savePreviewCandidateUrl({}, "doc", "", "not-url"), { reason: "invalidUrl" });
    assert.equal(invalid.calls.length, 0);
    const changed = harness({ url: "https://manual.example" });
    await assert.rejects(savePreviewCandidateUrl({}, "doc", "", "https://new.example"), { reason: "changed" });
    assert.equal(changed.writes().length, 0);
    const conflict = harness();
    conflict.api.findClipUrlConflict = async () => ({ hpath: "/existing" });
    await assert.rejects(savePreviewCandidateUrl({}, "doc", "", "https://new.example"), { reason: "conflict" });
    assert.equal(conflict.writes().length, 0);
    const raced = harness();
    let reads = 0;
    raced.api.readClip = async () => (++reads === 1 ? {} : { url: "https://manual.example" });
    await assert.rejects(savePreviewCandidateUrl({}, "doc", "", "https://new.example"), { reason: "changed" });
    assert.equal(raced.writes().length, 0);
});

test("补来源成功经统一写服务显式force，网络失败不自动重发", async () => {
    const current = harness();
    await savePreviewCandidateUrl({}, "doc", "", " https://new.example/a ");
    assert.deepEqual(current.writes(), [["write", {}, "doc", { url: "https://new.example/a" }, { force: true }]]);
    let attempts = 0;
    current.api.writeClip = async () => { attempts += 1; throw new Error("response lost"); };
    await assert.rejects(savePreviewCandidateUrl({}, "doc", "", "https://new.example/a"), /response lost/);
    assert.equal(attempts, 1);
});

test("预览摘录复查文章资格与原块归属，删除/移文/错误响应不能插入", async () => {
    for (const attrs of [{}, { status: "done", internal: true }]) {
        harness(attrs);
        await assert.rejects(quotePreviewExcerpt("doc", "block", "selected"), { reason: "changed" });
    }
    const current = harness({ status: "later" });
    let inserted = 0;
    current.api.insertQuoteExcerpt = async () => { inserted += 1; };
    for (const blocks of [[], [{ id: "block", root_id: "other", type: "p" }], [{ id: "other", root_id: "doc", type: "p" }], [{ id: "block", root_id: "doc", type: "d" }]]) {
        current.api.getHighlightBlocks = async () => blocks;
        await assert.rejects(quotePreviewExcerpt("doc", "block", "selected"), { reason: "changed" });
    }
    assert.equal(inserted, 0);
    current.api.getHighlightBlocks = async () => [{ id: "block", root_id: "doc", type: "p" }];
    await quotePreviewExcerpt("doc", "block", "selected");
    assert.equal(inserted, 1);
});

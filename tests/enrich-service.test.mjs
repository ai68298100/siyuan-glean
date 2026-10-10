/** AI 富化服务集成测试：模拟思源端点，保留真实队列、属性服务与索引同步。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node 测试环境没有思源运行时；仅在本测试进程为端点传输提供替身。
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-test:siyuan") {
            return {
                format: "module",
                source: "export const fetchSyncPost = (route, body) => new Promise((resolve) => globalThis.__gleanTestFetchPost(route, body, resolve)); export const getFrontend = () => 'desktop';",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { autoEnrich, enrichClip, findDuplicates, findRelated, findRelatedOutcome, usageToday } = await import("../src/services/enrich-service.ts");

function harness() {
    const attrs = new Map();
    const files = new Map();
    const calls = [];
    const answers = [];
    const documents = new Map();
    const hits = [];
    const failures = { export: false, write: false, attrs: false, metadata: false, embedding: false, search: false };
    let embeddingEnabled = true;
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanTestFetchPost = (route, body, callback) => {
        calls.push({ route, body });
        const id = body.id;
        let data;
        switch (route) {
            case "/api/export/exportMdContent":
                if (failures.export) {
                    callback({ code: 1, msg: "private export details" });
                    return;
                }
                data = { hPath: "/测试", content: documents.get(id)?.markdown ?? `# 测试文章\n\n这是 ${id} 的正文。` };
                break;
            case "/api/ai/chatGPT": {
                const answer = answers.length ? answers.shift() : JSON.stringify({ summary: `摘要 ${id}`, tags: ["阅读"] });
                if (answer instanceof Error) {
                    callback({ code: 1, msg: answer.message });
                    return;
                }
                data = answer;
                break;
            }
            case "/api/attr/getBlockAttrs":
                data = { "custom-clip-status": "inbox", ...attrs.get(id) };
                break;
            case "/api/attr/setBlockAttrs":
                if (failures.write) {
                    callback({ code: 1, msg: "private attribute details" });
                    return;
                }
                attrs.set(id, { "custom-clip-status": "inbox", ...attrs.get(id), ...body.attrs });
                data = null;
                break;
            case "/api/attr/batchGetBlockAttrs":
                if (failures.attrs) {
                    callback({ code: 1, msg: "private attribute details" });
                    return;
                }
                data = Object.fromEntries(body.ids.filter((docId) => attrs.has(docId)).map((docId) => [docId, attrs.get(docId)]));
                break;
            case "/api/query/sql": {
                if (failures.metadata) {
                    callback({ code: 1, msg: "private metadata details" });
                    return;
                }
                if (body.stmt.includes("id IN (")) {
                    const ids = [...body.stmt.matchAll(/'([^']+)'/g)].map((match) => match[1]);
                    data = ids.map((docId) => documents.get(docId)).filter((doc) => doc?.type === "d");
                    break;
                }
                const docId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                data = docId ? [{ id: docId, content: `标题 ${docId}`, hpath: "/测试", box: "test-box", updated: "20260929000000" }] : [];
                break;
            }
            case "/api/ai/embeddingStat":
                if (failures.embedding) {
                    callback({ code: 1, msg: "private embedding details" });
                    return;
                }
                data = { enabled: embeddingEnabled };
                break;
            case "/api/search/semanticSearchBlock":
                if (failures.search) {
                    callback({ code: 1, msg: "private search details" });
                    return;
                }
                data = { blocks: hits };
                break;
            default:
                throw new Error(`未模拟端点：${route}`);
        }
        callback({ code: 0, data });
    };
    const settings = (enrichMode, enrichDailyCap = 20) => ({
        ai: { enrichMode, enrichDailyCap, dedupOnEnrich: false, relatedWhileReading: true, channel: "siyuan" },
    });
    return { attrs, files, calls, answers, documents, hits, failures, plugin, settings, setEmbeddingEnabled(value) { embeddingEnabled = value; } };
}

async function within(promise, milliseconds = 1500) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("富化队列未完成")), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test("off 关闭手动与自动富化，manual 只响应手动触发", async () => {
    const h = harness();
    autoEnrich(h.plugin, "off-auto", h.settings("off"));
    assert.deepEqual(await enrichClip(h.plugin, "off-manual", h.settings("off")), {
        ok: false, duplicates: [], skipped: "off",
    });
    autoEnrich(h.plugin, "manual-auto", h.settings("manual"));
    assert.equal(h.calls.length, 0);

    const outcome = await within(enrichClip(h.plugin, "manual", h.settings("manual")));
    assert.equal(outcome.ok, true);
    assert.equal(h.attrs.get("manual")["custom-clip-summary"].length > 0, true);
    assert.equal(h.files.get("glean-index.json").clips.manual.summary, h.attrs.get("manual")["custom-clip-summary"]);
    assert.equal(await usageToday(h.plugin), 1);
});

test("手动和自动共享每日上限，超过上限不再调用模型", async () => {
    const h = harness();
    const settings = h.settings("manual", 1);
    assert.equal((await enrichClip(h.plugin, "first", settings)).ok, true);
    assert.equal((await enrichClip(h.plugin, "second", settings)).skipped, "cap");
    autoEnrich(h.plugin, "third", h.settings("auto", 1));
    // 队列屏障：排在自动任务后面的调用返回时，自动任务也已结束。
    assert.equal((await within(enrichClip(h.plugin, "fourth", settings))).skipped, "cap");
    assert.equal(h.calls.filter((call) => call.route === "/api/ai/chatGPT").length, 1);
    assert.equal(h.attrs.has("third"), false);
    assert.equal(await usageToday(h.plugin), 1);
});

test("真实模型失败不占成功额度，恢复后仍可调用且日志脱敏", async () => {
    const fixture = harness();
    fixture.answers.push(new Error("private model details sk-secret"), JSON.stringify({ summary: "恢复后的摘要", tags: ["主题"] }));
    const settings = fixture.settings("manual", 1);
    assert.equal((await enrichClip(fixture.plugin, "llm-error", settings)).skipped, "error");
    assert.equal(await usageToday(fixture.plugin), 0);
    assert.equal((await within(enrichClip(fixture.plugin, "good", settings))).ok, true);
    assert.equal(fixture.attrs.get("good")["custom-clip-summary"], "恢复后的摘要");
    assert.deepEqual(fixture.files.get("ai-log.json").map((entry) => entry.stage), ["llm"]);
    assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private|sk-secret/);
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("auto 富化只入队一次，两篇完成后队列仍可处理后续手动任务", async () => {
    const h = harness();
    autoEnrich(h.plugin, "auto-one", h.settings("auto"));
    autoEnrich(h.plugin, "auto-two", h.settings("auto"));
    const outcome = await within(enrichClip(h.plugin, "manual-after-auto", h.settings("manual")));
    assert.equal(outcome.ok, true);
    for (const id of ["auto-one", "auto-two", "manual-after-auto"]) {
        assert.equal(typeof h.attrs.get(id)?.["custom-clip-summary"], "string");
    }
    assert.equal(await usageToday(h.plugin), 3);
});

for (const answer of ["无法解析 private model output", "", " \n ", undefined, null, { summary: "invalid transport shape" }]) {
    test(`成功响应 ${JSON.stringify(answer)} 解析失败仍扣额度，后续请求受限`, async () => {
        const fixture = harness();
        fixture.answers.push(answer);
        const settings = fixture.settings("manual", 1);
        assert.deepEqual(await enrichClip(fixture.plugin, "bad", settings), { ok: false, duplicates: [], skipped: "parse" });
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.equal(fixture.attrs.has("bad"), false);
        assert.deepEqual(await within(enrichClip(fixture.plugin, "next", settings)), { ok: false, duplicates: [], skipped: "cap" });
        assert.equal(fixture.calls.filter((call) => call.route === "/api/ai/chatGPT").length, 1);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private model output|invalid transport shape/);
    });
}

test("属性保存失败不退模型额度，队列继续按上限拒绝后续调用", async () => {
    const fixture = harness();
    fixture.failures.write = true;
    const settings = fixture.settings("manual", 1);
    assert.deepEqual(await enrichClip(fixture.plugin, "write-error", settings), { ok: false, duplicates: [], skipped: "error" });
    assert.equal(await usageToday(fixture.plugin), 1);
    fixture.failures.write = false;
    assert.equal((await within(enrichClip(fixture.plugin, "next", settings))).skipped, "cap");
    assert.equal(fixture.calls.filter((call) => call.route === "/api/ai/chatGPT").length, 1);
    assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private attribute details/);
});

for (const markdown of ["", " \n\t ", "![image](assets/test.png)\n\n```js\nignored code\n```\n{: id=\"empty\"}"]) {
    test(`空正文 ${JSON.stringify(markdown)} 不调用模型、不记额度且如实失败`, async () => {
        const fixture = harness();
        fixture.documents.set("empty", { markdown });
        assert.deepEqual(await enrichClip(fixture.plugin, "empty", fixture.settings("manual")), { ok: false, duplicates: [], skipped: "error" });
        assert.equal(await usageToday(fixture.plugin), 0);
        assert.equal(fixture.calls.some((call) => call.route === "/api/ai/chatGPT"), false);
        assert.equal(fixture.attrs.has("empty"), false);
    });
}

test("正文读取失败不占额度且不记录端点返回的私密内容", async () => {
    const fixture = harness();
    fixture.failures.export = true;
    assert.equal((await enrichClip(fixture.plugin, "export-error", fixture.settings("manual"))).skipped, "error");
    assert.equal(await usageToday(fixture.plugin), 0);
    assert.equal(fixture.calls.some((call) => call.route === "/api/ai/chatGPT"), false);
    assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private export details/);
});

function semanticFixture() {
    const fixture = harness();
    const query = "测试文章的核心观点";
    const ids = Object.fromEntries(["self", "confirmed", "candidate", "ordinary", "invalid", "internal", "legacy", "child", "missing", "excluded", "other"].map((name, index) => [name, `20261004120000-${String(index).padStart(7, "0")}`]));
    for (const id of Object.values(ids)) {
        fixture.hits.push({ id, content: query });
        fixture.documents.set(id, { id, content: query, hpath: `/文章/${query}`, type: "d" });
        fixture.attrs.set(id, { "custom-clip-status": "inbox" });
    }
    fixture.hits.push({ id: ids.confirmed, content: query }, { id: "bad'ID", content: query });
    fixture.attrs.set(ids.candidate, { "custom-clip-url": "https://example.test/article", tags: "剪藏" });
    fixture.attrs.set(ids.ordinary, {});
    fixture.attrs.set(ids.invalid, { "custom-clip-status": "wrong" });
    fixture.attrs.get(ids.internal)["custom-clip-internal"] = "TRUE";
    fixture.documents.get(ids.legacy).hpath = "/读库周报/2026-10-04";
    fixture.documents.get(ids.child).type = "p";
    fixture.documents.delete(ids.missing);
    fixture.attrs.get(ids.excluded)["custom-clip-excluded"] = "true";
    fixture.documents.get(ids.other).content = "完全不同的文档标题";
    fixture.files.set("glean-index.json", { clips: Object.fromEntries(Object.values(ids).map((id) => [id, { id, status: "inbox" }])), candidates: {} });
    return { ...fixture, ids, query };
}

test("语义查重仅返回真实属性确认的非内部文档，候选、普通笔记和子块均排除", async () => {
    const fixture = semanticFixture();
    assert.deepEqual(await findDuplicates(fixture.plugin, fixture.ids.self, fixture.query), [{ id: fixture.ids.confirmed, title: fixture.query }]);
    assert.equal(fixture.calls.some((call) => call.route === "/api/attr/getBlockAttrs"), false);
    assert.equal(fixture.calls.some((call) => call.route === "/api/attr/batchGetBlockAttrs"), true);
    assert.equal(await usageToday(fixture.plugin), 0);
});

test("相关旧文缺上下文、关闭模式、关闭功能或空查询时不发任何请求", async () => {
    const fixture = semanticFixture();
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query), []);
    for (const [mode, relatedWhileReading, query] of [["off", true, fixture.query], ["manual", false, fixture.query], ["manual", true, " \n "]]) {
        const settings = fixture.settings(mode);
        settings.ai.relatedWhileReading = relatedWhileReading;
        assert.deepEqual(await findRelated(fixture.ids.self, query, [], { plugin: fixture.plugin, settings }), []);
    }
    assert.equal(fixture.calls.length, 0);
});

test("相关旧文结果区分关闭、嵌入未启用、无命中和请求失败", async () => {
    const fixture = semanticFixture();
    const context = { plugin: fixture.plugin, settings: fixture.settings("manual") };
    assert.equal((await findRelatedOutcome(fixture.ids.self, fixture.query)).reason, "disabled");
    fixture.setEmbeddingEnabled(false);
    assert.equal((await findRelatedOutcome(fixture.ids.self, fixture.query, [], context)).reason, "embedding-disabled");
    fixture.setEmbeddingEnabled(true);
    fixture.hits.length = 0;
    assert.equal((await findRelatedOutcome(fixture.ids.self, fixture.query, [], context)).reason, "no-hits");
    fixture.failures.search = true;
    assert.equal((await findRelatedOutcome(fixture.ids.self, fixture.query, [], context)).reason, "error");
});

test("相关旧文只保留已确认文章、遵守排除列表并去重，不信任旧索引", async () => {
    const fixture = semanticFixture();
    const context = { plugin: fixture.plugin, settings: fixture.settings("manual") };
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [fixture.ids.other], context), [{ id: fixture.ids.confirmed, title: fixture.query }]);
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [], context), [
        { id: fixture.ids.confirmed, title: fixture.query },
        { id: fixture.ids.other, title: "完全不同的文档标题" },
    ]);
    fixture.attrs.get(fixture.ids.confirmed)["custom-clip-status"] = "invalidated";
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [fixture.ids.other], context), []);
    assert.equal(fixture.calls.some((call) => call.route === "/api/attr/getBlockAttrs"), false);
});

test("嵌入未启用或无命中时不读取候选属性与元数据", async () => {
    const fixture = semanticFixture();
    const context = { plugin: fixture.plugin, settings: fixture.settings("manual") };
    fixture.setEmbeddingEnabled(false);
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [], context), []);
    assert.deepEqual(await findDuplicates(fixture.plugin, fixture.ids.self, fixture.query), []);
    assert.equal(fixture.calls.some((call) => call.route === "/api/search/semanticSearchBlock"), false);
    fixture.setEmbeddingEnabled(true);
    fixture.hits.length = 0;
    assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [], context), []);
    assert.equal(fixture.calls.some((call) => call.route === "/api/attr/batchGetBlockAttrs" || call.route === "/api/query/sql"), false);
});

for (const stage of ["embedding", "search", "attrs", "metadata"]) {
    test(`语义 ${stage} 失败时相关与查重均静默降级、日志脱敏`, async () => {
        const fixture = semanticFixture();
        fixture.failures[stage] = true;
        const context = { plugin: fixture.plugin, settings: fixture.settings("manual") };
        assert.deepEqual(await findRelated(fixture.ids.self, fixture.query, [], context), []);
        assert.deepEqual(await findDuplicates(fixture.plugin, fixture.ids.self, fixture.query), []);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private .* details/);
    });
}

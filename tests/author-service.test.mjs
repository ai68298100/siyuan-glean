import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-author:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-author:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanAuthorPost(...args); export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { authorSuggestionEnabled, suggestClipAuthor } = await import("../src/services/author-service.ts");
const { enqueueEnrich, usageToday } = await import("../src/services/enrich-service.ts");
const { readerTranslate } = await import("../src/services/reader-ai.ts");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../src/services/settings.ts");
const { todayStamp } = await import("../src/domain/resurface.ts");
const docId = "20261004120000-aaaaaaa";
const suggestion = { author: "小驴频道", evidence: "作者：小驴频道" };

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function harness(markdown = "作者：小驴频道\n\n正文。") {
    const source = { markdown };
    const calls = [];
    const files = new Map();
    const attributes = { "custom-clip-status": "later", "custom-clip-author": "现有手填署名", "custom-clip-url": "https://private.test/source", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "用户标签" };
    const modelStarted = deferred();
    const exportStarted = deferred();
    const quotaStarted = deferred();
    const quotaSaved = deferred();
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, authorSuggestionEnabled: true } });
    const failure = { read: false, model: false, usage: false, attr: false, missing: false };
    const holds = { model: Promise.resolve(), export: Promise.resolve(), quota: Promise.resolve(), usage: Promise.resolve() };
    const answers = [];
    let activeModels = 0;
    let peakModels = 0;
    const plugin = {
        settings,
        async loadData(name) {
            if (name === "ai-usage.json") { quotaStarted.resolve(); await holds.quota; }
            return structuredClone(files.get(name));
        },
        async saveData(name, value) {
            if (name === "ai-usage.json") {
                quotaSaved.resolve();
                await holds.usage;
                if (failure.usage) throw new Error("private usage error");
            }
            files.set(name, structuredClone(value));
        },
    };
    globalThis.__gleanAuthorPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        switch (route) {
            case "/api/query/sql": return { code: 0, data: failure.missing ? [] : [{ id: docId, content: "private title", box: "private-box", hpath: "/private-path", updated: "20261004120000", type: "d" }] };
            case "/api/attr/getBlockAttrs": return failure.attr ? { code: 1, msg: "private attribute error" } : { code: 0, data: { ...attributes } };
            case "/api/export/exportMdContent":
                exportStarted.resolve();
                await holds.export;
                return failure.read ? { code: 1, msg: "private export error" } : { code: 0, data: { content: source.markdown, hPath: "/private-path" } };
            case "/api/ai/chatGPT": {
                activeModels += 1;
                peakModels = Math.max(peakModels, activeModels);
                modelStarted.resolve();
                try {
                    await holds.model;
                    return failure.model ? { code: 1, msg: "private model sk-secret" } : { code: 0, data: answers.length ? answers.shift() : JSON.stringify(suggestion) };
                } finally { activeModels -= 1; }
            }
            default: throw new Error(`Unexpected endpoint: ${route}`);
        }
    };
    return { calls, files, attributes, source, settings, plugin, failure, holds, answers, modelStarted, exportStarted, quotaStarted, quotaSaved, peakModels: () => peakModels, modelCalls: () => calls.filter((call) => call.route === "/api/ai/chatGPT").length };
}

function request(fixture, options = {}, settings = fixture.settings) {
    return suggestClipAuthor(fixture.plugin, docId, settings, { expectedAuthor: "现有手填署名", ...options });
}

async function within(promise) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Author service timeout")), 2500); })]);
    } finally { clearTimeout(timer); }
}

test("作者建议只读当前文章，不修改任何原属性或派生索引，成功调用共享计量", async () => {
    const fixture = harness("作者：**小驴频道**\nhttps://private.test/path\n![img](assets/private.png)\n正文。");
    const initial = structuredClone(fixture.attributes);
    assert.equal(authorSuggestionEnabled(fixture.settings), true);
    assert.deepEqual(await request(fixture), { ok: true, suggestion });
    assert.deepEqual(fixture.attributes, initial);
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.deepEqual([...fixture.files.keys()], ["ai-usage.json"]);
    assert.ok(fixture.calls.every((call) => ["/api/query/sql", "/api/attr/getBlockAttrs", "/api/export/exportMdContent", "/api/ai/chatGPT"].includes(call.route)));
    assert.deepEqual(fixture.calls.find((call) => call.route === "/api/export/exportMdContent").body, { id: docId, yfm: false, addTitle: false, refMode: 2 });
    const prompt = fixture.calls.find((call) => call.route === "/api/ai/chatGPT").body.msg;
    assert.doesNotMatch(prompt, /private|assets|现有手填署名|用户标签|https?:/);
    assert.match(prompt, /作者：小驴频道/);
});

test("默认关闭和off总模式不读取文章，不调用模型", async () => {
    const fixture = harness();
    for (const settings of [DEFAULT_SETTINGS, normalizeSettings({ ai: { authorSuggestionEnabled: true, enrichMode: "off" } }), normalizeSettings({ ai: { authorSuggestionEnabled: "true" } })]) {
        fixture.plugin.settings = settings;
        assert.equal(authorSuggestionEnabled(settings), false);
        assert.deepEqual(await request(fixture), { ok: false, reason: "off" });
    }
    assert.equal(fixture.calls.length, 0);
});

for (const change of ["author", "status", "internal", "missing"]) {
    test(`当前 ${change} 不符时拒绝建议，禁止读取正文或请求模型`, async () => {
        const fixture = harness();
        if (change === "author") fixture.attributes["custom-clip-author"] = "别人已编辑";
        if (change === "status") fixture.attributes["custom-clip-status"] = "invalid";
        if (change === "internal") fixture.attributes["custom-clip-internal"] = "true";
        if (change === "missing") fixture.failure.missing = true;
        assert.deepEqual(await request(fixture), { ok: false, reason: "changed" });
        assert.equal(fixture.modelCalls(), 0);
        assert.equal(fixture.calls.some((call) => call.route === "/api/export/exportMdContent"), false);
    });
}

test("非法ID不进入SQL或正文读取", async () => {
    const fixture = harness();
    assert.deepEqual(await suggestClipAuthor(fixture.plugin, "bad' OR 1", fixture.settings, { expectedAuthor: "" }), { ok: false, reason: "changed" });
    assert.equal(fixture.calls.length, 0);
});

test("排队后的作者动作与翻译共享最后额度，且模型始终串行", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichDailyCap = 1;
    const outcomes = await within(Promise.all([request(fixture), readerTranslate(fixture.plugin, docId, "选区", fixture.settings), request(fixture)]));
    assert.deepEqual(outcomes, [{ ok: true, suggestion }, { ok: false, skipped: "cap" }, { ok: false, reason: "cap" }]);
    assert.equal(fixture.modelCalls(), 1);
    assert.equal(fixture.peakModels(), 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const change of ["off", "authorOff", "cap", "cancelled"]) {
    test(`共享队列等待中 ${change} 时重新检查，旧设置引用不绕过`, async () => {
        const fixture = harness();
        const gate = deferred();
        const started = deferred();
        const blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
        await within(started.promise);
        let active = true;
        const pending = request(fixture, { isCurrent: () => active });
        if (change === "off") fixture.plugin.settings = normalizeSettings({ ai: { ...fixture.settings.ai, enrichMode: "off" } });
        if (change === "authorOff") fixture.plugin.settings = normalizeSettings({ ai: { ...fixture.settings.ai, authorSuggestionEnabled: false } });
        if (change === "cap") {
            fixture.plugin.settings = normalizeSettings({ ai: { ...fixture.settings.ai, enrichDailyCap: 1 } });
            fixture.files.set("ai-usage.json", { date: todayStamp(), count: 1 });
        }
        if (change === "cancelled") active = false;
        gate.resolve();
        await within(blocker);
        assert.deepEqual(await within(pending), { ok: false, reason: change === "authorOff" ? "off" : change });
        assert.equal(fixture.calls.length, 0);
    });
}

for (const stage of ["quota", "export", "model", "usage"]) {
    test(`${stage} await期间用新对象关闭作者开关，旧结果不可采纳`, async () => {
        const fixture = harness();
        const gate = deferred();
        fixture.holds[stage] = gate.promise;
        const started = stage === "quota" ? fixture.quotaStarted : stage === "export" ? fixture.exportStarted : stage === "model" ? fixture.modelStarted : fixture.quotaSaved;
        const pending = request(fixture);
        try {
            await within(started.promise);
            fixture.plugin.settings = normalizeSettings({ ai: { ...fixture.settings.ai, authorSuggestionEnabled: false } });
        } finally { gate.resolve(); }
        assert.deepEqual(await within(pending), { ok: false, reason: "off" });
        assert.equal(fixture.modelCalls(), stage === "model" || stage === "usage" ? 1 : 0);
        assert.equal(await usageToday(fixture.plugin), stage === "model" || stage === "usage" ? 1 : 0);
    });
}

for (const change of ["author", "status", "internal", "cancelled"]) {
    test(`读取正文期间 ${change} 拒绝继续模型调用`, async () => {
        const fixture = harness();
        const gate = deferred();
        fixture.holds.export = gate.promise;
        let active = true;
        const pending = request(fixture, { isCurrent: () => active });
        try {
            await within(fixture.exportStarted.promise);
            if (change === "author") fixture.attributes["custom-clip-author"] = "新作者";
            if (change === "status") delete fixture.attributes["custom-clip-status"];
            if (change === "internal") fixture.attributes["custom-clip-internal"] = "true";
            if (change === "cancelled") active = false;
        } finally { gate.resolve(); }
        assert.deepEqual(await within(pending), { ok: false, reason: change === "cancelled" ? "cancelled" : "changed" });
        assert.equal(fixture.modelCalls(), 0);
    });
}

test("模型处理中切文或销毁编辑会话时仍计成功调用，但不交付旧建议", async () => {
    const fixture = harness();
    const gate = deferred();
    fixture.holds.model = gate.promise;
    let active = true;
    const pending = request(fixture, { isCurrent: () => active });
    try { await within(fixture.modelStarted.promise); active = false; } finally { gate.resolve(); }
    assert.deepEqual(await within(pending), { ok: false, reason: "cancelled" });
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("模型过程中作者变化不能返回可用建议，成功调用仍计量", async () => {
    const fixture = harness();
    const gate = deferred();
    fixture.holds.model = gate.promise;
    const pending = request(fixture);
    try { await within(fixture.modelStarted.promise); fixture.attributes["custom-clip-author"] = "外部新署名"; } finally { gate.resolve(); }
    assert.deepEqual(await within(pending), { ok: false, reason: "changed" });
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const markdown of ["正文被编辑，署名已删除。", "作者：小驴频道\n\n正文有新增段落。", ""]) {
    test(`模型处理中正文改为 ${JSON.stringify(markdown)} 丢弃旧证据，成功调用仍计量`, async () => {
        const fixture = harness();
        const gate = deferred();
        fixture.holds.model = gate.promise;
        const pending = request(fixture);
        try { await within(fixture.modelStarted.promise); fixture.source.markdown = markdown; } finally { gate.resolve(); }
        assert.deepEqual(await within(pending), { ok: false, reason: "changed" });
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.equal(fixture.modelCalls(), 1);
        assert.equal(fixture.calls.filter((call) => call.route === "/api/export/exportMdContent").length, 2);
    });
}

test("模型后核对正文失败不交付旧建议，成功调用仍计量", async () => {
    const fixture = harness();
    const gate = deferred();
    fixture.holds.model = gate.promise;
    const pending = request(fixture);
    try { await within(fixture.modelStarted.promise); fixture.failure.read = true; } finally { gate.resolve(); }
    assert.deepEqual(await within(pending), { ok: false, reason: "error" });
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const answer of [undefined, null, "", "private malformed sk-secret", { author: "小驴频道" }, '{"author":"猜测作者","evidence":"作者：小驴频道"}', '{"author":"小驴频道","evidence":"虚构的小驴频道署名"}']) {
    test(`成功调用但响应 ${JSON.stringify(answer)} 无证据时拒绝，计量且日志不存响应`, async () => {
        const fixture = harness();
        fixture.answers.push(answer);
        assert.deepEqual(await request(fixture), { ok: false, reason: "invalid" });
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private|sk-secret|猜测作者|虚构/);
    });
}

test("空正文和读取/模型/计量异常不返回建议，保留原作者且不泄露私密细节", async () => {
    for (const reason of ["empty", "read", "attr", "model", "usage"]) {
        const fixture = harness(reason === "empty" ? "![img](assets/photo.png)" : undefined);
        if (reason !== "empty") fixture.failure[reason] = true;
        const initial = structuredClone(fixture.attributes);
        assert.deepEqual(await request(fixture), { ok: false, reason: reason === "empty" ? "empty" : "error" });
        assert.deepEqual(fixture.attributes, initial);
        if (reason === "usage") {
            await assert.rejects(() => usageToday(fixture.plugin));
            const modelCalls = fixture.modelCalls();
            assert.deepEqual(await request(fixture), { ok: false, reason: "error" });
            assert.equal(fixture.modelCalls(), modelCalls);
            assert.deepEqual(fixture.attributes, initial);
        } else {
            assert.equal(await usageToday(fixture.plugin), 0);
        }
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")) ?? "", /private|sk-secret/);
    }
});

test("没有宿主settings时兼容fallback，新对象getter在读取后仍有效", async () => {
    const fixture = harness();
    delete fixture.plugin.settings;
    assert.deepEqual(await request(fixture), { ok: true, suggestion });
    let settings = fixture.settings;
    const gate = deferred();
    fixture.holds.export = gate.promise;
    const pending = request(fixture, {}, () => settings);
    settings = normalizeSettings({ ai: { ...fixture.settings.ai, authorSuggestionEnabled: false } });
    gate.resolve();
    assert.deepEqual(await within(pending), { ok: false, reason: "off" });
});

test("正文读取后切换通道使用当前模型和密钥设置，旧通道不被调用", async () => {
    const fixture = harness();
    const gate = deferred();
    fixture.holds.export = gate.promise;
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    fixture.plugin.getSecret = (name) => name === "author-secret" ? "sk-private" : "";
    globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
        const pending = request(fixture);
        await within(fixture.exportStarted.promise);
        fixture.plugin.settings = normalizeSettings({ ai: { ...fixture.settings.ai, channel: "custom", customBaseUrl: "https://model.test/v1", customModel: "author-model", customSecretName: "author-secret" } });
        gate.resolve();
        assert.deepEqual(await within(pending), { ok: true, suggestion });
        assert.equal(fixture.modelCalls(), 0);
        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0].url, "https://model.test/v1/chat/completions");
        const payload = JSON.parse(fetchCalls[0].options.body);
        assert.equal(payload.model, "author-model");
        assert.doesNotMatch(fetchCalls[0].options.body, /sk-private|author-secret|private title|private-path|private\.test/);
        assert.equal(await usageToday(fixture.plugin), 1);
    } finally {
        gate.resolve();
        globalThis.fetch = originalFetch;
    }
});

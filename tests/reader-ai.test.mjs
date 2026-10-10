import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-reader:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-reader:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanReaderPost(...args); export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { clearReaderMarkdownCache, readerArticleQuestion, readerSummarize, readerTranslate, saveReaderSummary } = await import("../src/services/reader-ai.ts");
const { enrichClip, enqueueEnrich, usageToday } = await import("../src/services/enrich-service.ts");
const { loadFormattingSession, planAiFormatting } = await import("../src/services/formatting-service.ts");
const { DEFAULT_SETTINGS } = await import("../src/services/settings.ts");
const { todayStamp } = await import("../src/domain/resurface.ts");
const docId = "20261004120000-aaaaaaa";
const selectionBlockId = "20261004120001-bbbbbbb";

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function harness(markdown = "# 测试文章\n\n正文的核心观点。") {
    const calls = [];
    const answers = [];
    const files = new Map();
    const attrs = new Map([[docId, {
        "custom-clip-status": "later",
        "custom-clip-url": "https://example.test/article",
        "custom-clip-priority": "5",
        "custom-clip-rating": "4",
        tags: "用户标签",
    }]]);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ai.dedupOnEnrich = false;
    settings.ai.formattingEnabled = true;
    const failures = { export: false, model: false, write: false, usageRead: false, usageSave: false, usageResponseLost: false, usageReadback: false };
    const modelStarted = deferred();
    const exportStarted = deferred();
    let aiHold = Promise.resolve();
    let exportHold = Promise.resolve();
    let selectionBlockRoot = docId;
    let selectionBlockExists = true;
    let activeCalls = 0;
    let peakCalls = 0;
    const plugin = {
        async loadData(name) {
            if (name === "ai-usage.json" && (failures.usageRead || (failures.usageReadback && files.has(name)))) throw new Error("private usage read details");
            return structuredClone(files.get(name));
        },
        async saveData(name, value) {
            if (name === "ai-usage.json" && failures.usageSave) throw new Error("private usage save details");
            files.set(name, structuredClone(value));
            if (name === "ai-usage.json" && failures.usageResponseLost) throw new Error("private usage response lost");
        },
    };
    globalThis.__gleanReaderPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        switch (route) {
            case "/api/export/exportMdContent":
                exportStarted.resolve();
                await exportHold;
                return failures.export ? { code: 1, msg: "private export details" } : { code: 0, data: { content: markdown, hPath: "/测试文章" } };
            case "/api/ai/chatGPT": {
                activeCalls += 1;
                peakCalls = Math.max(peakCalls, activeCalls);
                modelStarted.resolve();
                const answer = answers.length ? answers.shift() : "测试结果";
                try {
                    await aiHold;
                    if (failures.model) return { code: 1, msg: "private model details sk-secret" };
                    if (answer instanceof Error) throw answer;
                    return { code: 0, data: answer };
                } finally {
                    activeCalls -= 1;
                }
            }
            case "/api/attr/getBlockAttrs": return { code: 0, data: { ...attrs.get(body.id) } };
            case "/api/attr/setBlockAttrs":
                if (failures.write) return { code: 1, msg: "private attribute details" };
                attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs });
                return { code: 0, data: null };
            case "/api/query/sql": {
                const blockMatch = body.stmt.match(/SELECT id, root_id FROM blocks WHERE id = '([^']+)' LIMIT 1/);
                if (blockMatch) return { code: 0, data: selectionBlockExists && blockMatch[1] === selectionBlockId ? [{ id: selectionBlockId, root_id: selectionBlockRoot }] : [] };
                return { code: 0, data: [{ id: docId, content: "测试文章", title: "测试文章", hpath: "/测试文章", box: "test-box", updated: "20261004120000", type: "d" }] };
            }
            default: throw new Error(`未模拟端点：${route}`);
        }
    };
    return {
        calls, answers, files, attrs, settings, failures, plugin, modelStarted, exportStarted,
        holdAi(promise) { aiHold = promise; },
        holdExport(promise) { exportHold = promise; },
        setSelectionBlockRoot(root) { selectionBlockRoot = root; },
        setSelectionBlockExists(exists) { selectionBlockExists = exists; },
        peakCalls() { return peakCalls; },
        modelCalls() { return calls.filter((call) => call.route === "/api/ai/chatGPT").length; },
    };
}

async function within(promise, milliseconds = 2500) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("共享 AI 队列未完成")), milliseconds); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test("富化、总结、翻译、排版并发时共享同一串行队列，全部完成且没有二次排队", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(docId);
    fixture.answers.push('{"summary":"富化摘要","tags":["阅读"]}', "  总结结果  ", "  Translation  ", '{"headings":[],"cleanup":[]}');
    const gate = deferred();
    fixture.holdAi(gate.promise);
    const pending = [
        enrichClip(fixture.plugin, docId, fixture.settings),
        readerSummarize(fixture.plugin, docId, fixture.settings),
        readerTranslate(fixture.plugin, docId, "翻译选区", fixture.settings),
        planAiFormatting(fixture.plugin, session, fixture.settings),
    ];
    try {
        await within(fixture.modelStarted.promise);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(fixture.modelCalls(), 1);
        assert.equal(fixture.peakCalls(), 1);
    } finally {
        gate.resolve();
    }
    const outcomes = await within(Promise.all(pending));
    assert.deepEqual(outcomes, [
        { ok: true, duplicates: [] },
        { ok: true, text: "总结结果" },
        { ok: true, text: "Translation" },
        { ok: true },
    ]);
    assert.equal(fixture.modelCalls(), 4);
    assert.equal(fixture.peakCalls(), 1);
    assert.equal(await usageToday(fixture.plugin), 4);
});

test("阅读先占每日最后额度时，后续富化、翻译和排版均不请求模型", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichDailyCap = 1;
    const session = await loadFormattingSession(docId);
    const outcomes = await within(Promise.all([
        readerSummarize(fixture.plugin, docId, fixture.settings),
        enrichClip(fixture.plugin, docId, fixture.settings),
        readerTranslate(fixture.plugin, docId, "翻译选区", fixture.settings),
        planAiFormatting(fixture.plugin, session, fixture.settings),
    ]));
    assert.deepEqual(outcomes, [
        { ok: true, text: "测试结果" },
        { ok: false, duplicates: [], skipped: "cap" },
        { ok: false, skipped: "cap" },
        { ok: false, reason: "cap" },
    ]);
    assert.equal(fixture.modelCalls(), 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const change of ["off", "cap"]) {
    test(`排队期间改为 ${change}，四种动作执行时重新检查设置与额度`, async () => {
        const fixture = harness();
        const session = await loadFormattingSession(docId);
        fixture.calls.length = 0;
        fixture.files.set("ai-usage.json", { date: todayStamp(), count: 2 });
        const gate = deferred();
        const started = deferred();
        const blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
        await within(started.promise);
        const pending = [
            readerSummarize(fixture.plugin, docId, fixture.settings),
            readerTranslate(fixture.plugin, docId, "翻译选区", fixture.settings),
            enrichClip(fixture.plugin, docId, fixture.settings),
            planAiFormatting(fixture.plugin, session, fixture.settings),
        ];
        if (change === "off") fixture.settings.ai.enrichMode = "off";
        else fixture.settings.ai.enrichDailyCap = 1;
        gate.resolve();
        await within(blocker);
        assert.deepEqual(await within(Promise.all(pending)), [
            { ok: false, skipped: change },
            { ok: false, skipped: change },
            { ok: false, duplicates: [], skipped: change },
            { ok: false, reason: change },
        ]);
        assert.equal(fixture.calls.length, 0);
        assert.equal(await usageToday(fixture.plugin), 2);
    });
}

test("off 模式立即禁止总结与翻译，不读取正文、不请求模型", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichMode = "off";
    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: false, skipped: "off" });
    assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "off" });
    assert.equal(fixture.calls.length, 0);
    assert.equal(await usageToday(fixture.plugin), 0);
});

for (const change of ["off", "cap"]) {
    test(`保存设置替换整个对象为 ${change}，旧引用上的排队动作不得继续`, async () => {
        const fixture = harness();
        fixture.plugin.settings = fixture.settings;
        const session = await loadFormattingSession(docId);
        fixture.calls.length = 0;
        fixture.files.set("ai-usage.json", { date: todayStamp(), count: 2 });
        const gate = deferred();
        const started = deferred();
        const blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
        await within(started.promise);
        const pending = [
            readerSummarize(fixture.plugin, docId, fixture.settings),
            readerTranslate(fixture.plugin, docId, "选区", fixture.settings),
            enrichClip(fixture.plugin, docId, fixture.settings),
            planAiFormatting(fixture.plugin, session, fixture.settings),
        ];
        const saved = structuredClone(fixture.settings);
        if (change === "off") saved.ai.enrichMode = "off";
        else saved.ai.enrichDailyCap = 1;
        fixture.plugin.settings = saved;
        gate.resolve();
        await within(blocker);
        assert.deepEqual(await within(Promise.all(pending)), [
            { ok: false, skipped: change }, { ok: false, skipped: change },
            { ok: false, duplicates: [], skipped: change }, { ok: false, reason: change },
        ]);
        assert.equal(fixture.calls.length, 0);
        assert.equal(fixture.settings.ai.enrichMode, "manual");
        assert.equal(await usageToday(fixture.plugin), 2);
    });
}

test("正文读取中替换保存设置为关闭，不调用模型且旧引用保持开启", async () => {
    const fixture = harness();
    fixture.plugin.settings = fixture.settings;
    const gate = deferred();
    fixture.holdExport(gate.promise);
    const pending = readerSummarize(fixture.plugin, docId, fixture.settings);
    try {
        await within(fixture.exportStarted.promise);
        fixture.plugin.settings = { ...fixture.settings, ai: { ...fixture.settings.ai, enrichMode: "off" } };
    } finally { gate.resolve(); }
    assert.deepEqual(await within(pending), { ok: false, skipped: "off" });
    assert.equal(fixture.modelCalls(), 0);
    assert.equal(fixture.settings.ai.enrichMode, "manual");
});

test("排队期间替换通道对象，执行使用当前通道而非旧自定义配置", async () => {
    const fixture = harness();
    fixture.settings.ai.channel = "custom";
    fixture.settings.ai.customBaseUrl = "https://invalid.example/v1";
    fixture.plugin.settings = fixture.settings;
    const gate = deferred();
    const started = deferred();
    const blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
    await within(started.promise);
    const pending = readerTranslate(fixture.plugin, docId, "选区", fixture.settings);
    fixture.plugin.settings = { ...fixture.settings, ai: { ...fixture.settings.ai, channel: "siyuan" } };
    gate.resolve();
    await within(blocker);
    assert.deepEqual(await within(pending), { ok: true, text: "测试结果" });
    assert.equal(fixture.modelCalls(), 1);
    assert.equal(fixture.settings.ai.channel, "custom");
});

for (const action of ["enrich", "summarize", "formatting"]) {
    test(`${action} 调用已发送后保存关闭设置，仍计用量但不自动应用迟到结果`, async () => {
        const fixture = harness();
        fixture.plugin.settings = fixture.settings;
        const before = structuredClone(fixture.attrs.get(docId));
        const session = action === "formatting" ? await loadFormattingSession(docId) : null;
        fixture.answers.push(action === "enrich" ? '{"summary":"迟到摘要","tags":["标签"]}' : action === "formatting" ? '{"headings":[],"cleanup":[]}' : "迟到总结");
        const gate = deferred();
        fixture.holdAi(gate.promise);
        const pending = action === "enrich" ? enrichClip(fixture.plugin, docId, fixture.settings)
            : action === "formatting" ? planAiFormatting(fixture.plugin, session, fixture.settings)
            : readerSummarize(fixture.plugin, docId, fixture.settings);
        try {
            await within(fixture.modelStarted.promise);
            fixture.plugin.settings = { ...fixture.settings, ai: { ...fixture.settings.ai, enrichMode: "off" } };
        } finally { gate.resolve(); }
        const result = await within(pending);
        assert.equal(result.ok, false);
        assert.equal(result.skipped ?? result.reason, "off");
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.deepEqual(fixture.attrs.get(docId), before);
        assert.equal(fixture.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
        if (session) assert.deepEqual(session.plan, { headings: [], cleanup: [] });
    });
}

test("读取正文期间关闭 AI，执行中的总结也不调用模型", async () => {
    const fixture = harness();
    const gate = deferred();
    fixture.holdExport(gate.promise);
    const pending = readerSummarize(fixture.plugin, docId, fixture.settings);
    try {
        await within(fixture.exportStarted.promise);
        fixture.settings.ai.enrichMode = "off";
    } finally {
        gate.resolve();
    }
    assert.deepEqual(await within(pending), { ok: false, skipped: "off" });
    assert.equal(fixture.modelCalls(), 0);
    assert.equal(await usageToday(fixture.plugin), 0);
});

for (const markdown of ["", " \n\t ", "![image](assets/test.png)\n\n```js\nignored code\n```\n{: id=\"empty\"}"]) {
    test(`总结空文本 ${JSON.stringify(markdown)} 如实失败且不调用模型`, async () => {
        const fixture = harness(markdown);
        assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 0);
        assert.equal(await usageToday(fixture.plugin), 0);
    });
}

test("翻译空白选区如实失败且不调用模型", async () => {
    const fixture = harness();
    assert.deepEqual(await readerTranslate(fixture.plugin, docId, " \n\t ", fixture.settings), { ok: false, skipped: "error" });
    assert.equal(fixture.modelCalls(), 0);
    assert.equal(await usageToday(fixture.plugin), 0);
});

for (const action of ["summarize", "translate"]) {
    for (const answer of ["", " \n ", undefined, null, { text: "private malformed output" }]) {
        test(`${action} 成功返回 ${JSON.stringify(answer)} 时扣额度但不报告成功`, async () => {
            const fixture = harness();
            fixture.settings.ai.enrichDailyCap = 1;
            fixture.answers.push(answer);
            const outcome = action === "summarize"
                ? await readerSummarize(fixture.plugin, docId, fixture.settings)
                : await readerTranslate(fixture.plugin, docId, "选区", fixture.settings);
            assert.deepEqual(outcome, { ok: false, skipped: "error" });
            assert.equal(await usageToday(fixture.plugin), 1);
            assert.deepEqual(await within(readerTranslate(fixture.plugin, docId, "下一个选区", fixture.settings)), { ok: false, skipped: "cap" });
            assert.equal(fixture.modelCalls(), 1);
            assert.equal(fixture.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
            assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private malformed output/);
        });
    }

    test(`${action} 真实模型失败不计额度，恢复后可继续执行且日志脱敏`, async () => {
        const fixture = harness();
        fixture.settings.ai.enrichDailyCap = 1;
        fixture.failures.model = true;
        const run = () => action === "summarize"
            ? readerSummarize(fixture.plugin, docId, fixture.settings)
            : readerTranslate(fixture.plugin, docId, "选区", fixture.settings);
        assert.deepEqual(await run(), { ok: false, skipped: "error" });
        assert.equal(await usageToday(fixture.plugin), 0);
        fixture.failures.model = false;
        assert.deepEqual(await within(run()), { ok: true, text: "测试结果" });
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private|sk-secret/);
    });
}

test("正文读取异常或传输抛错时静默失败，后续队列可用且不记录私密错误", async () => {
    const fixture = harness();
    fixture.failures.export = true;
    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: false, skipped: "error" });
    assert.equal(fixture.modelCalls(), 0);
    assert.equal(await usageToday(fixture.plugin), 0);
    fixture.failures.export = false;
    fixture.answers.push(new Error("private transport details sk-secret"));
    assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "error" });
    assert.equal(await usageToday(fixture.plugin), 0);
    assert.deepEqual(await within(readerSummarize(fixture.plugin, docId, fixture.settings)), { ok: true, text: "测试结果" });
    assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private|sk-secret/);
});

test("阅读结果默认只在内存，显式保存摘要保持用户字段不变且不再计额度", async () => {
    const fixture = harness();
    const before = structuredClone(fixture.attrs.get(docId));
    const outcome = await readerSummarize(fixture.plugin, docId, fixture.settings);
    assert.deepEqual(outcome, { ok: true, text: "测试结果" });
    assert.deepEqual(fixture.attrs.get(docId), before);
    await saveReaderSummary(fixture.plugin, docId, outcome.text);
    assert.deepEqual(fixture.attrs.get(docId), { ...before, "custom-clip-summary": "测试结果" });
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("本文问答选区须属于当前正文并核验块根归属，成功调用后再次检查归属", async () => {
    const fixture = harness("# 测试文章\n\n选区中的核心结论。\n\n其他段落。");
    fixture.settings.ai.articleQuestionEnabled = true;
    const evidence = "选区中的核心结论。";
    fixture.answers.push(JSON.stringify({ answer: "核心结论", evidence: [evidence], insufficient: false }));
    const result = await readerArticleQuestion(fixture.plugin, docId, "结论是什么？", fixture.settings, evidence, selectionBlockId);
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.evidence, [evidence]);
    assert.equal(fixture.calls.filter((call) => call.route === "/api/query/sql" && call.body.stmt.includes(selectionBlockId)).length, 2);
    assert.equal(fixture.modelCalls(), 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("同一阅读会话内总结与本文问答复用正文导出，正文变化后可清除缓存", async () => {
    const fixture = harness("# 测试文章\n\n正文的核心观点。");
    fixture.settings.ai.articleQuestionEnabled = true;
    fixture.answers.push("总结结果", JSON.stringify({ answer: "核心观点", evidence: ["正文的核心观点。"], insufficient: false }), "再次总结");

    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: true, text: "总结结果" });
    assert.deepEqual(await readerArticleQuestion(fixture.plugin, docId, "核心观点是什么？", fixture.settings), {
        ok: true,
        result: { answer: "核心观点", evidence: ["正文的核心观点。"], insufficient: false },
        truncated: false,
    });
    assert.equal(fixture.calls.filter((call) => call.route === "/api/export/exportMdContent").length, 1);

    clearReaderMarkdownCache(fixture.plugin, docId);
    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: true, text: "再次总结" });
    assert.equal(fixture.calls.filter((call) => call.route === "/api/export/exportMdContent").length, 2);
});

test("正文导出进行中失效缓存时，迟到结果不会重新写入旧缓存", async () => {
    const fixture = harness();
    fixture.answers.push("第一次总结", "第二次总结");
    const gate = deferred();
    fixture.holdExport(gate.promise);
    const pending = readerSummarize(fixture.plugin, docId, fixture.settings);
    await within(fixture.exportStarted.promise);
    clearReaderMarkdownCache(fixture.plugin, docId);
    gate.resolve();
    assert.deepEqual(await within(pending), { ok: true, text: "第一次总结" });
    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: true, text: "第二次总结" });
    assert.equal(fixture.calls.filter((call) => call.route === "/api/export/exportMdContent").length, 2);
});

test("本文问答拒绝外部块、失效块、正文不含的选区和超长选区", async () => {
    const fixture = harness("# 测试文章\n\n正文内容。");
    fixture.settings.ai.articleQuestionEnabled = true;
    fixture.setSelectionBlockRoot("20261004120000-otherdoc");
    assert.deepEqual(await readerArticleQuestion(fixture.plugin, docId, "问题", fixture.settings, "正文内容。", selectionBlockId), { ok: false, skipped: "invalid" });
    fixture.setSelectionBlockRoot(docId);
    fixture.setSelectionBlockExists(false);
    assert.deepEqual(await readerArticleQuestion(fixture.plugin, docId, "问题", fixture.settings, "正文内容。", selectionBlockId), { ok: false, skipped: "invalid" });
    fixture.setSelectionBlockExists(true);
    assert.deepEqual(await readerArticleQuestion(fixture.plugin, docId, "问题", fixture.settings, "不存在的选区", selectionBlockId), { ok: false, skipped: "invalid" });
    assert.deepEqual(await readerArticleQuestion(fixture.plugin, docId, "问题", fixture.settings, "x".repeat(16001), selectionBlockId), { ok: false, skipped: "invalid" });
    assert.equal(fixture.modelCalls(), 0);
});

test("本文问答模型执行期间选区块移出文章，结果丢弃但成功调用仍计量", async () => {
    const fixture = harness("# 测试文章\n\n选区中的核心结论。");
    fixture.settings.ai.articleQuestionEnabled = true;
    fixture.answers.push(JSON.stringify({ answer: "核心结论", evidence: ["选区中的核心结论。"], insufficient: false }));
    const gate = deferred();
    fixture.holdAi(gate.promise);
    const pending = readerArticleQuestion(fixture.plugin, docId, "问题", fixture.settings, "选区中的核心结论。", selectionBlockId);
    try {
        await within(fixture.modelStarted.promise);
        fixture.setSelectionBlockRoot("20261004120000-otherdoc");
    } finally { gate.resolve(); }
    assert.deepEqual(await within(pending), { ok: false, skipped: "changed" });
    assert.equal(fixture.modelCalls(), 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const count of ["1", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`非法用量 ${String(count)} 不得当作0调用模型`, async () => {
        const fixture = harness();
        fixture.files.set("ai-usage.json", { date: todayStamp(), count });
        assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 0);
        assert.equal(fixture.files.get("ai-usage.json").count, count);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private/);
    });
}

for (const record of [[], {}, { date: "20260230", count: 0 }, { date: "20261301", count: 0 }, { date: "", count: 0 }]) {
    test(`非法用量结构 ${JSON.stringify(record)} 拒绝调用且不覆盖记录`, async () => {
        const fixture = harness();
        fixture.files.set("ai-usage.json", record);
        assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 0);
        assert.deepEqual(fixture.files.get("ai-usage.json"), record);
    });
}

for (const cap of [0, 1]) {
    test(`上限${cap}时读取用量失败阻止请求，恢复读取后仍可继续`, async () => {
        const fixture = harness();
        fixture.settings.ai.enrichDailyCap = cap;
        fixture.failures.usageRead = true;
        assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 0);
        fixture.failures.usageRead = false;
        assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: true, text: "测试结果" });
        assert.equal(await usageToday(fixture.plugin), 1);
    });
}

test("计量保存响应丢失但读回正确，只记录一次并正常受额度限制", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichDailyCap = 1;
    fixture.failures.usageResponseLost = true;
    assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: true, text: "测试结果" });
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "cap" });
    assert.equal(fixture.modelCalls(), 1);
});

for (const failure of ["usageSave", "usageReadback"]) {
    test(`成功模型调用后${failure}使计量未知，当前实例不得继续调用`, async () => {
        const fixture = harness();
        fixture.settings.ai.enrichDailyCap = 0;
        fixture.failures[failure] = true;
        assert.deepEqual(await readerSummarize(fixture.plugin, docId, fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 1);
        fixture.failures[failure] = false;
        await assert.rejects(usageToday(fixture.plugin), /unavailable/);
        assert.deepEqual(await readerTranslate(fixture.plugin, docId, "选区", fixture.settings), { ok: false, skipped: "error" });
        assert.equal(fixture.modelCalls(), 1);
        assert.doesNotMatch(JSON.stringify(fixture.files.get("ai-log.json")), /private/);
    });
}

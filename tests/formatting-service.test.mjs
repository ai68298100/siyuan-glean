import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-formatting:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-formatting:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanFormattingPost(...args); export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { loadFormattingSession, planAiFormatting, saveFormattingDraft } = await import("../src/services/formatting-service.ts");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../src/services/settings.ts");
const { usageToday } = await import("../src/services/enrich-service.ts");
const { renderFormatting } = await import("../src/domain/formatting.ts");
const originalId = "20261004120000-aaaaaaa";
const draftId = "20261004120000-bbbbbbb";
const labels = { suffix: "阅读整理", original: "原文", source: "来源" };

function harness(markdown = "小节标题\n\n正文原句。\n\n请关注我们的公众号") {
    const documents = new Map([[originalId, { id: originalId, content: "原文标题", hpath: "/folder/原文标题", box: "box-1", updated: "20261004120000", markdown }]]);
    const attributes = new Map([[originalId, { "custom-clip-url": "https://example.test/article", "custom-clip-status": "later", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "user-tag" }]]);
    const calls = [];
    const files = new Map();
    const failure = { read: false, mark: false, index: false, create: false, invalidId: false, ai: false, quotaRead: false, usage: false };
    let answer = '{"headings":[{"id":"p1","level":2}],"cleanup":[{"id":"p3"}]}';
    let hold;
    let heldAi;
    const plugin = {
        async loadData(name) {
            if (name === "ai-usage.json" && failure.quotaRead) throw new Error("quota read failure");
            return structuredClone(files.get(name));
        },
        async saveData(name, value) {
            if (name === "glean-index.json" && failure.index || name === "ai-usage.json" && failure.usage) throw new Error("save failed");
            files.set(name, structuredClone(value));
        },
    };
    globalThis.__gleanFormattingPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        if (hold && route === "/api/export/exportMdContent") await hold;
        if (heldAi && route === "/api/ai/chatGPT") await heldAi;
        if (failure.read && route === "/api/export/exportMdContent") return { code: 1, msg: "read failed" };
        switch (route) {
            case "/api/export/exportMdContent": return { code: 0, data: { content: documents.get(body.id)?.markdown, hPath: documents.get(body.id)?.hpath } };
            case "/api/attr/getBlockAttrs": return { code: 0, data: { ...attributes.get(body.id) } };
            case "/api/attr/setBlockAttrs": {
                if (failure.mark) return { code: 1, msg: "mark failed" };
                attributes.set(body.id, { ...attributes.get(body.id), ...body.attrs });
                return { code: 0, data: null };
            }
            case "/api/query/sql": {
                const id = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                const row = documents.get(id);
                const result = row ? { ...row } : undefined;
                if (result && /content AS title/.test(body.stmt)) {
                    result.title = result.content;
                    delete result.content;
                }
                return { code: 0, data: result ? [result] : [] };
            }
            case "/api/filetree/createDocWithMd": {
                documents.set(draftId, { id: draftId, content: "阅读整理", hpath: body.path, box: body.notebook, updated: "20261004120000", markdown: body.markdown });
                if (failure.create) throw new Error("response lost");
                return { code: 0, data: failure.invalidId ? "" : draftId };
            }
            case "/api/ai/chatGPT": return failure.ai ? { code: 1, msg: "model failed" } : { code: 0, data: answer };
            default: throw new Error(`Unexpected endpoint ${route}`);
        }
    };
    return { documents, attributes, calls, files, failure, plugin, settings: normalizeSettings({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, formattingEnabled: true } }), setAnswer(value) { answer = value; }, holdRead(value) { hold = value; }, holdAi(value) { heldAi = value; }, countCreates() { return calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length; } };
}

test("排版预览只读，保存独立文档仅写 internal，原文和手填属性不变", async () => {
    const fixture = harness();
    const before = structuredClone(fixture.attributes.get(originalId));
    const original = fixture.documents.get(originalId).markdown;
    const session = await loadFormattingSession(originalId);
    assert.equal(session.source.title, "原文标题");
    const exportCall = fixture.calls.find((call) => call.route === "/api/export/exportMdContent");
    assert.deepEqual(exportCall.body, { id: originalId, yfm: false, addTitle: false, refMode: 2 });
    assert.equal(fixture.countCreates(), 0);
    assert.equal(fixture.files.size, 0);
    const outcome = await saveFormattingDraft(fixture.plugin, session, ["p3"], labels);
    assert.deepEqual(outcome, { ok: true, docId: draftId });
    assert.equal(fixture.countCreates(), 1);
    assert.deepEqual(fixture.attributes.get(originalId), before);
    assert.equal(fixture.documents.get(originalId).markdown, original);
    assert.deepEqual(fixture.attributes.get(draftId), { "custom-clip-internal": "true" });
    const draft = fixture.documents.get(draftId);
    assert.equal(draft.box, "box-1");
    assert.match(draft.hpath, /^\/folder\/原文标题 · 阅读整理 /);
    assert.ok(draft.markdown.includes(`siyuan://blocks/${originalId}`));
    assert.ok(draft.markdown.includes("https://example.test/article"));
    assert.ok(!draft.markdown.includes("请关注"));
    assert.equal(fixture.files.get("glean-index.json").clips[draftId], undefined);
    assert.equal(fixture.files.get("glean-index.json").candidates[draftId], undefined);
    assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), outcome);
    assert.equal(fixture.countCreates(), 1);
});

for (const field of ["markdown", "content", "hpath", "box", "url"]) {
    test(`保存前 ${field} 变化阻止旧预览创建`, async () => {
        const fixture = harness();
        const session = await loadFormattingSession(originalId);
        if (field === "url") fixture.attributes.get(originalId)["custom-clip-url"] = "https://changed.test/";
        else fixture.documents.get(originalId)[field] += "changed";
        assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, reason: "changed" });
        assert.equal(fixture.countCreates(), 0);
    });
}

test("原文不可读取或已删除时不创建；连接恢复可重试", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    fixture.failure.read = true;
    assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, reason: "readFailed" });
    assert.equal(fixture.countCreates(), 0);
    fixture.failure.read = false;
    assert.equal((await saveFormattingDraft(fixture.plugin, session, [], labels)).ok, true);
});

for (const stage of ["mark", "index"]) {
    test(`建稿后 ${stage} 失败保留 ID，原文变化后恢复仍只完成旧整理稿`, async () => {
        const fixture = harness();
        const session = await loadFormattingSession(originalId);
        fixture.failure[stage] = true;
        assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, docId: draftId, reason: "markFailed" });
        assert.equal(session.state, "created");
        assert.equal(session.createdDocId, draftId);
        fixture.documents.get(originalId).markdown += "\n\nchanged";
        fixture.failure[stage] = false;
        assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: true, docId: draftId });
        assert.equal(fixture.countCreates(), 1);
    });
}

for (const stage of ["create", "invalidId"]) {
    test(`创建 ${stage} 结果不确定时禁止重试创建`, async () => {
        const fixture = harness();
        const session = await loadFormattingSession(originalId);
        fixture.failure[stage] = true;
        assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, reason: "createUnknown" });
        fixture.failure[stage] = false;
        assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, reason: "createUnknown" });
        assert.equal(fixture.countCreates(), 1);
    });
}

test("保存重入不重复建稿", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    let release;
    fixture.holdRead(new Promise((resolve) => { release = resolve; }));
    const saving = saveFormattingDraft(fixture.plugin, session, [], labels);
    assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, [], labels), { ok: false, reason: "busy" });
    release();
    assert.equal((await saving).ok, true);
    assert.equal(fixture.countCreates(), 1);
});

test("空稿或非法选择不创建文档", async () => {
    const fixture = harness("请关注公众号");
    const session = await loadFormattingSession(originalId);
    assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, ["p1"], labels), { ok: false, reason: "empty" });
    assert.deepEqual(await saveFormattingDraft(fixture.plugin, session, ["other"], labels), { ok: false, reason: "invalid" });
    assert.equal(fixture.countCreates(), 0);
});

test("AI 功能默认关且非法布尔值回退关，总开关 off 不请求模型", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    assert.equal(DEFAULT_SETTINGS.ai.formattingEnabled, false);
    assert.equal(normalizeSettings({ ai: { formattingEnabled: "true" } }).ai.formattingEnabled, false);
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, DEFAULT_SETTINGS), { ok: false, reason: "off" });
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, { ...fixture.settings, ai: { ...fixture.settings.ai, enrichMode: "off" } }), { ok: false, reason: "off" });
    assert.equal(fixture.calls.some((call) => call.route === "/api/ai/chatGPT"), false);
});

test("AI 成功只更新内存计划、计共享额度，不建稿不改正文", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, fixture.settings), { ok: true });
    assert.ok(renderFormatting(session.analysis, session.plan).startsWith("## 小节标题"));
    assert.ok(renderFormatting(session.analysis, session.plan).includes("请关注"));
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.equal(fixture.countCreates(), 0);
    assert.equal(fixture.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
});

test("AI 非法输出整体拒绝且成功调用计额度，日志不泄漏模型输出", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    fixture.setAnswer('{"headings":[],"cleanup":[],"markdown":"private article contents"}');
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, fixture.settings), { ok: false, reason: "invalid" });
    assert.deepEqual(session.plan, { headings: [], cleanup: [] });
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.ok(!JSON.stringify(fixture.files.get("ai-log.json")).includes("private article contents"));
});

test("模型失败不扣额度，额度达到上限不调用模型", async () => {
    const fixture = harness();
    const session = await loadFormattingSession(originalId);
    fixture.failure.ai = true;
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, fixture.settings), { ok: false, reason: "error" });
    assert.equal(await usageToday(fixture.plugin), 0);
    fixture.failure.ai = false;
    fixture.settings.ai.enrichDailyCap = 1;
    assert.equal((await planAiFormatting(fixture.plugin, session, fixture.settings)).ok, true);
    const count = fixture.calls.length;
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, fixture.settings), { ok: false, reason: "cap" });
    assert.equal(fixture.calls.length, count);
});

test("超长文章不发模型且正文完整保留", async () => {
    const fixture = harness("文".repeat(24001));
    const session = await loadFormattingSession(originalId);
    assert.deepEqual(await planAiFormatting(fixture.plugin, session, fixture.settings), { ok: false, reason: "tooLong" });
    assert.equal(renderFormatting(session.analysis).length, 24001);
    assert.equal(fixture.calls.some((call) => call.route === "/api/ai/chatGPT"), false);
});

test("多个排版弹窗共享串行 AI 队列，不能并发越过每日额度", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichDailyCap = 1;
    const first = await loadFormattingSession(originalId);
    const second = await loadFormattingSession(originalId);
    let release;
    fixture.holdAi(new Promise((resolve) => { release = resolve; }));
    const firstRequest = planAiFormatting(fixture.plugin, first, fixture.settings);
    const secondRequest = planAiFormatting(fixture.plugin, second, fixture.settings);
    release();
    assert.deepEqual(await firstRequest, { ok: true });
    assert.deepEqual(await secondRequest, { ok: false, reason: "cap" });
    assert.equal(fixture.calls.filter((call) => call.route === "/api/ai/chatGPT").length, 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("无效 ID、内部文档及无有效状态文档拒绝排版", async () => {
    const fixture = harness();
    await assert.rejects(loadFormattingSession("bad'ID"));
    fixture.attributes.get(originalId)["custom-clip-internal"] = "true";
    await assert.rejects(loadFormattingSession(originalId));
    delete fixture.attributes.get(originalId)["custom-clip-internal"];
    delete fixture.attributes.get(originalId)["custom-clip-status"];
    await assert.rejects(loadFormattingSession(originalId));
    assert.equal(fixture.countCreates(), 0);
});

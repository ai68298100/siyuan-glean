import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-flashcard:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-flashcard:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanFlashcardPost(...args); export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { createFlashcardSession, cancelFlashcardSession, confirmFlashcard, draftQuestionCard, questionCardEnabled, ensureFlashcardDeck, loadFlashcardRecovery, resumeFlashcardRecovery, saveFlashcardRecovery, clearFlashcardRecovery } = await import("../src/services/flashcard-service.ts");
const { createFlashcardRecovery } = await import("../src/domain/flashcard-recovery.ts");
const { DEFAULT_SETTINGS } = await import("../src/services/settings.ts");
const { enqueueEnrich, usageToday } = await import("../src/services/enrich-service.ts");
const { readerTranslate } = await import("../src/services/reader-ai.ts");
const { todayStamp } = await import("../src/domain/resurface.ts");
const docId = "20261004120000-aaaaaaa";
const blockId = "20261004120000-bbbbbbb";
const hostId = "20261004120000-ccccccc";
const source = { title: "来源文章", quote: "证据来自这段引文。", docId, blockId };

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function harness() {
    const calls = [];
    const files = new Map();
    const attrs = new Map([[docId, { "custom-clip-status": "later", "custom-clip-author": "手填作者", "custom-clip-url": "https://example.test", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "用户标签" }], [hostId, { "custom-clip-status": "reading", "custom-clip-author": "用户" }]]);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.anchorNotebooks = ["test-box"];
    settings.ai.questionCardEnabled = true;
    const state = {
        hostExists: true, decks: [{ id: "test-deck", name: "拾遗卡片" }], recoveryCardId: "20261004120000-eeeeeee", recoveryCardExists: true,
        sourceExists: true, sourceType: "d", blockExists: true, blockRoot: docId,
        deckFailure: false, insertFailure: false, emptyTransaction: false, riffFailure: false, modelFailure: false,
        answer: '{"front":"这段引文的证据是什么？","back":"证据来自这段引文。"}',
    };
    const hooks = {};
    const plugin = {
        settings,
        async removeData(name) { await hooks.removeData?.(name); files.delete(name); },
        async loadData(name) { await hooks.loadData?.(name); return structuredClone(files.get(name)); },
        async saveData(name, value) { await hooks.saveData?.(name, value); files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanFlashcardPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        await hooks[route]?.(body);
        switch (route) {
            case "/api/query/sql": {
                if (/content='拾遗卡片'/.test(body.stmt)) return { code: 0, data: state.hostExists ? [{ id: hostId }] : [] };
                if (/SELECT id, root_id, type FROM blocks WHERE id=/.test(body.stmt)) return { code: 0, data: state.recoveryCardExists ? [{ id: state.recoveryCardId, root_id: hostId, type: "i" }] : [] };
                if (body.stmt.includes(`id='${blockId}'`)) return { code: 0, data: state.blockExists ? [{ id: blockId, root_id: state.blockRoot }] : [] };
                const id = body.stmt.includes(hostId) ? hostId : docId;
                return { code: 0, data: id === docId && !state.sourceExists ? [] : [{ id, type: id === docId ? state.sourceType : "d", title: "来源文章", content: "来源文章", box: "test-box", hpath: "/来源文章", updated: "20261004120000" }] };
            }
            case "/api/riff/getRiffDecks": return state.deckFailure ? { code: 1, msg: "private deck error" } : { code: 0, data: [...state.decks] };
            case "/api/riff/createRiffDeck": {
                const deck = { id: "created-deck", name: body.name };
                state.decks.push(deck);
                return { code: 0, data: deck };
            }
            case "/api/filetree/createDocWithMd": state.hostExists = true; attrs.set(hostId, {}); return { code: 0, data: hostId };
            case "/api/attr/getBlockAttrs": return { code: 0, data: { ...attrs.get(body.id) } };
            case "/api/attr/setBlockAttrs": attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs }); return { code: 0, data: null };
            case "/api/block/insertBlock":
                if (state.insertFailure) throw new Error("private transport error sk-secret");
                return { code: 0, data: state.emptyTransaction ? [] : [{ doOperations: [{ id: "20261004120000-ddddddd" }] }] };
            case "/api/riff/addRiffCards": return state.riffFailure ? { code: 1, msg: "private riff error sk-secret" } : { code: 0, data: { id: body.deckID, name: "拾遗卡片" } };
            case "/api/ai/chatGPT": return state.modelFailure ? { code: 1, msg: "private model error sk-secret" } : { code: 0, data: state.answer };
            default: throw new Error(`未模拟端点：${route}`);
        }
    };
    return { calls, files, attrs, settings, plugin, state, hooks, count: (route) => calls.filter((call) => call.route === route).length };
}

const inserts = "/api/block/insertBlock";
const registrations = "/api/riff/addRiffCards";
const models = "/api/ai/chatGPT";

test("预览创建与取消完全本地，源信息冻结且取消后不能写入", async () => {
    const fixture = harness();
    const input = { ...source };
    const session = createFlashcardSession(input);
    input.title = "被修改的标题";
    assert.equal(session.source.title, source.title);
    assert.equal(Object.isFrozen(session.source), true);
    cancelFlashcardSession(session);
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "cancelled" });
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "cancelled" });
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.files.size, 0);
});

for (const [content, reason] of [
    [{ front: " \n", back: "答案" }, "emptyFront"],
    [{ front: "问题", back: "\t" }, "emptyBack"],
    [{ front: "问".repeat(2001), back: "答案" }, "frontTooLong"],
    [{ front: "问题", back: "答".repeat(12001) }, "backTooLong"],
]) {
    test(`确认校验 ${reason} 在准备牌组前失败且无写入`, async () => {
        const fixture = harness();
        const session = createFlashcardSession(source);
        assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, content), { ok: false, reason });
        assert.equal(fixture.calls.length, 0);
        assert.equal(session.state, "ready");
    });
}

test("明确确认仅保存已编辑卡面，确切列表项 ID 登记，源属性与同名用户文档均不改", async () => {
    const fixture = harness();
    const before = structuredClone([...fixture.attrs]);
    const session = createFlashcardSession(source);
    const result = await confirmFlashcard(fixture.plugin, session, fixture.settings, { front: "编辑问题 <script>", back: '编辑答案 "quoted"\n第二行' });
    assert.equal(result.ok, true);
    assert.equal(session.state, "saved");
    assert.match(result.cardBlockId, /^\d{14}-[a-z0-9]{7}$/);
    const insert = fixture.calls.find((call) => call.route === inserts);
    assert.match(insert.body.data, /编辑问题 &lt;script&gt;/);
    assert.match(insert.body.data, /编辑答案 &quot;quoted&quot;<br\/>第二行/);
    assert.equal(insert.body.parentID, hostId);
    assert.ok(insert.body.data.includes(`data-node-id="${result.cardBlockId}"`));
    assert.deepEqual(fixture.calls.find((call) => call.route === registrations).body, { deckID: "test-deck", blockIDs: [result.cardBlockId] });
    assert.equal(fixture.count(inserts), 1);
    assert.deepEqual([...fixture.attrs], before);
    assert.equal(fixture.count("/api/attr/setBlockAttrs"), 0);
    assert.equal(fixture.calls.some((call) => /ORDER BY sort DESC/.test(call.body.stmt ?? "")), false);
    assert.equal(fixture.files.size, 0);
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), result);
    assert.equal(fixture.count(inserts), 1);
    assert.equal(fixture.count(registrations), 1);
});

test("riff 登记失败后只重试已知 ID，编辑不会再次插入，不泄露私密异常", async () => {
    const fixture = harness();
    fixture.state.riffFailure = true;
    const session = createFlashcardSession(source);
    const result = await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft);
    assert.equal(result.reason, "registerFailed");
    assert.equal(session.state, "inserted");
    assert.equal(result.cardBlockId, session.cardBlockId);
    assert.doesNotMatch(JSON.stringify(result), /private|sk-secret/);
    assert.equal(fixture.count(registrations), 1);
    fixture.state.riffFailure = false;
    const registered = await confirmFlashcard(fixture.plugin, session, fixture.settings, { front: "", back: "" });
    assert.equal(registered.ok, true);
    assert.equal(registered.cardBlockId, result.cardBlockId);
    assert.equal(fixture.count(inserts), 1);
    const attempts = fixture.calls.filter((call) => call.route === registrations);
    assert.deepEqual(attempts[0].body, attempts[1].body);
});

test("跨重载只核对检查点中的确切卡片块并恢复登记", async () => {
    const fixture = harness();
    const recovery = createFlashcardRecovery("test-deck", hostId, fixture.state.recoveryCardId, new Date("2026-10-05T08:00:00.000Z"));
    await saveFlashcardRecovery(fixture.plugin, recovery);
    const result = await resumeFlashcardRecovery(fixture.plugin);
    assert.equal(result.ok, true);
    assert.equal(result.registered, true);
    assert.equal(await loadFlashcardRecovery(fixture.plugin), null);
    assert.deepEqual(fixture.calls.filter((call) => call.route === registrations).map((call) => call.body), [{ deckID: "test-deck", blockIDs: [fixture.state.recoveryCardId] }]);
    assert.equal(fixture.calls.some((call) => call.route === inserts), false);
});

test("跨重载找不到确切卡片时不登记，用户可明确清理检查点", async () => {
    const fixture = harness();
    fixture.state.recoveryCardExists = false;
    const recovery = createFlashcardRecovery("test-deck", hostId, fixture.state.recoveryCardId);
    await saveFlashcardRecovery(fixture.plugin, recovery);
    const result = await resumeFlashcardRecovery(fixture.plugin);
    assert.deepEqual(result.reason, "missing");
    assert.equal(fixture.count(registrations), 0);
    assert.ok(await loadFlashcardRecovery(fixture.plugin));
    await clearFlashcardRecovery(fixture.plugin, true);
    assert.equal(await loadFlashcardRecovery(fixture.plugin), null);
});

for (const failure of ["insertFailure", "emptyTransaction"]) {
    test(`${failure} 视为未知插入结果，禁止再发或猜最新卡块`, async () => {
        const fixture = harness();
        fixture.state[failure] = true;
        const session = createFlashcardSession(source);
        assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "insertUnknown", hostDocId: hostId });
        assert.equal(session.state, "unknown");
        fixture.state[failure] = false;
        assert.equal((await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft)).reason, "insertUnknown");
        assert.equal(fixture.count(inserts), 1);
        assert.equal(fixture.count(registrations), 0);
        assert.equal(fixture.calls.some((call) => /ORDER BY sort DESC|type='i'/.test(call.body.stmt ?? "")), false);
    });
}

for (const change of ["deletedDoc", "wrongDocType", "deletedBlock", "movedBlock", "invalidId", "orphanBlock"]) {
    test(`来源 ${change} 阻止确认和 AI 请求，不准备牌组、不写源文章`, async () => {
        const fixture = harness();
        const changedSource = { ...source };
        if (change === "deletedDoc") fixture.state.sourceExists = false;
        if (change === "wrongDocType") fixture.state.sourceType = "p";
        if (change === "deletedBlock") fixture.state.blockExists = false;
        if (change === "movedBlock") fixture.state.blockRoot = hostId;
        if (change === "invalidId") changedSource.docId = "bad' OR 1=1";
        if (change === "orphanBlock") delete changedSource.docId;
        const session = createFlashcardSession(changedSource);
        assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "sourceChanged" });
        assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "sourceChanged" });
        assert.equal(fixture.count(inserts), 0);
        assert.equal(fixture.count(models), 0);
        assert.equal(fixture.count("/api/riff/getRiffDecks"), 0);
    });
}

test("准备牌组期间来源块移走，插入前再次核对归属", async () => {
    const fixture = harness();
    fixture.hooks["/api/riff/getRiffDecks"] = () => { fixture.state.blockRoot = hostId; };
    const session = createFlashcardSession(source);
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "sourceChanged" });
    assert.equal(fixture.count(inserts), 0);
});

test("来源读取失败关闭写入，牌组准备失败后保留草稿可人工重试", async () => {
    const fixture = harness();
    fixture.hooks["/api/query/sql"] = () => { throw new Error("private read error sk-secret"); };
    const session = createFlashcardSession(source);
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "readFailed" });
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "readFailed" });
    delete fixture.hooks["/api/query/sql"];
    fixture.state.deckFailure = true;
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "setupFailed" });
    assert.equal(session.state, "ready");
    assert.equal(fixture.count(inserts), 0);
    fixture.state.deckFailure = false;
    assert.equal((await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft)).ok, true);
});

test("新建宿主仅通过 clip-store 标记 internal，同会话并发准备不重复建宿主和牌组", async () => {
    const fixture = harness();
    fixture.state.hostExists = false;
    fixture.state.decks = [];
    const before = structuredClone(fixture.attrs.get(docId));
    const results = await Promise.all([ensureFlashcardDeck(fixture.settings, fixture.plugin), ensureFlashcardDeck(fixture.settings, fixture.plugin)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(fixture.count("/api/riff/createRiffDeck"), 1);
    assert.equal(fixture.count("/api/filetree/createDocWithMd"), 1);
    assert.equal(fixture.attrs.get(hostId)["custom-clip-internal"], "true");
    assert.deepEqual(fixture.attrs.get(docId), before);
    assert.deepEqual(fixture.calls.find((call) => call.route === "/api/attr/setBlockAttrs").body, { id: hostId, attrs: { "custom-clip-internal": "true" } });
});

test("双击确认返回 busy；已明确确认的插入完成后关闭预览仍完成登记且不回滚", async () => {
    const fixture = harness();
    const gate = deferred();
    const started = deferred();
    fixture.hooks[inserts] = async () => { started.resolve(); await gate.promise; };
    const session = createFlashcardSession(source);
    const pending = confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft);
    await started.promise;
    try {
        assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "busy" });
        cancelFlashcardSession(session);
    } finally {
        gate.resolve();
    }
    assert.equal((await pending).ok, true);
    assert.equal(fixture.count(inserts), 1);
    assert.equal(fixture.count(registrations), 1);
    assert.equal(fixture.calls.some((call) => /deleteBlock/.test(call.route)), false);
});

test("确认还在核对来源时取消，不准备牌组、不创建卡片", async () => {
    const fixture = harness();
    fixture.hooks["/api/query/sql"] = () => cancelFlashcardSession(session);
    const session = createFlashcardSession(source);
    assert.deepEqual(await confirmFlashcard(fixture.plugin, session, fixture.settings, session.draft), { ok: false, reason: "cancelled" });
    assert.equal(fixture.count("/api/riff/getRiffDecks"), 0);
    assert.equal(fixture.count(inserts), 0);
});

test("AI 问句默认严格关闭，总开关关闭也不读来源或调用模型", async () => {
    assert.equal(questionCardEnabled(DEFAULT_SETTINGS), false);
    const fixture = harness();
    const session = createFlashcardSession(source);
    for (const value of [false, "true", 1, undefined]) {
        fixture.plugin.settings.ai.questionCardEnabled = value;
        assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "off" });
    }
    fixture.plugin.settings.ai.questionCardEnabled = true;
    fixture.plugin.settings.ai.enrichMode = "off";
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "off" });
    assert.equal(fixture.calls.length, 0);
});

test("AI 成功只填可编辑草稿并附已知来源，不写正文属性或制卡", async () => {
    const fixture = harness();
    const before = structuredClone([...fixture.attrs]);
    const session = createFlashcardSession(source);
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: true });
    assert.equal(session.state, "ready");
    assert.equal(session.draft.front, "这段引文的证据是什么？");
    assert.match(session.draft.back, /《来源文章》/);
    assert.ok(session.draft.back.includes(`siyuan://blocks/${docId}`));
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.deepEqual([...fixture.attrs], before);
    assert.equal(fixture.count(inserts), 0);
    assert.equal(fixture.count(registrations), 0);
    assert.equal(fixture.count("/api/riff/getRiffDecks"), 0);
    assert.equal(fixture.count("/api/attr/setBlockAttrs"), 0);
});

test("未定位来源保留未知来源，不推断文档、不将模型文本当来源", async () => {
    const fixture = harness();
    const session = createFlashcardSession({ title: "", quote: "证据来自这段引文。" });
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: true });
    assert.equal(session.draft.back, "证据来自这段引文。");
    assert.equal(fixture.count("/api/query/sql"), 0);
});

for (const answer of [undefined, null, {}, "", " \n", '{"front":"问","back":"答","source":"猜来源"}', '```json\n{"front":"问","back":"答"}\n```', '{"front":"问","back":"答"}suffix']) {
    test(`模型成功返回 ${JSON.stringify(answer)} 先计量后校验，保留原草稿`, async () => {
        const fixture = harness();
        fixture.state.answer = answer;
        fixture.settings.ai.enrichDailyCap = 1;
        const session = createFlashcardSession(source);
        const before = structuredClone(session.draft);
        assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "invalid" });
        assert.equal(await usageToday(fixture.plugin), 1);
        assert.deepEqual(session.draft, before);
        assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "cap" });
        assert.equal(fixture.count(models), 1);
    });
}

test("模型失败不扣额度，队列可以继续使用且结果不泄露异常", async () => {
    const fixture = harness();
    const session = createFlashcardSession(source);
    fixture.state.modelFailure = true;
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "error" });
    assert.equal(await usageToday(fixture.plugin), 0);
    fixture.state.modelFailure = false;
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: true });
    assert.equal(await usageToday(fixture.plugin), 1);
});

test("共享队列串行执行，问答先用最后额度时后续阅读动作不调用模型", async () => {
    const fixture = harness();
    fixture.settings.ai.enrichDailyCap = 1;
    const gate = deferred();
    const started = deferred();
    fixture.hooks[models] = async () => { started.resolve(); await gate.promise; };
    const session = createFlashcardSession(source);
    const question = draftQuestionCard(fixture.plugin, session, fixture.settings);
    const translation = readerTranslate(fixture.plugin, docId, "选区", fixture.settings);
    await started.promise;
    assert.equal(fixture.count(models), 1);
    gate.resolve();
    assert.deepEqual(await question, { ok: true });
    assert.deepEqual(await translation, { ok: false, skipped: "cap" });
    assert.equal(fixture.count(models), 1);
    assert.equal(await usageToday(fixture.plugin), 1);
});

for (const phase of ["beforeStart", "queued", "sourceRead", "quotaRead", "modelReturn", "usageSaved"]) {
    for (const setting of ["questionCardEnabled", "enrichMode"]) {
        test(`设置对象在 ${phase} 被替换关闭 ${setting}，不返回可采纳草稿`, async () => {
            const fixture = harness();
            const session = createFlashcardSession(source);
            const original = structuredClone(session.draft);
            const replace = () => {
                const next = structuredClone(fixture.plugin.settings);
                next.ai[setting] = setting === "questionCardEnabled" ? false : "off";
                fixture.plugin.settings = next;
            };
            let blocker;
            let gate;
            if (phase === "beforeStart") replace();
            if (phase === "queued") {
                gate = deferred();
                const started = deferred();
                blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
                await started.promise;
            }
            if (phase === "sourceRead") fixture.hooks["/api/query/sql"] = replace;
            if (phase === "quotaRead") fixture.hooks.loadData = (name) => { if (name === "ai-usage.json") replace(); };
            if (phase === "modelReturn") fixture.hooks[models] = replace;
            if (phase === "usageSaved") fixture.hooks.saveData = (name) => { if (name === "ai-usage.json") replace(); };
            const pending = draftQuestionCard(fixture.plugin, session, fixture.settings);
            if (phase === "queued") { replace(); gate.resolve(); await blocker; }
            assert.deepEqual(await pending, { ok: false, reason: "off" });
            assert.deepEqual(session.draft, original);
            const modelWasCalled = phase === "modelReturn" || phase === "usageSaved";
            assert.equal(fixture.count(models), modelWasCalled ? 1 : 0);
            delete fixture.hooks.loadData;
            assert.equal(await usageToday(fixture.plugin), modelWasCalled ? 1 : 0);
            assert.equal(fixture.count(inserts), 0);
        });
    }
}

test("排队期间更换通道，执行时读取最新思源通道而非旧 custom 配置", async () => {
    const fixture = harness();
    fixture.settings.ai.channel = "custom";
    fixture.settings.ai.customBaseUrl = "https://private.invalid/v1";
    const session = createFlashcardSession(source);
    const gate = deferred();
    const started = deferred();
    const blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
    await started.promise;
    const pending = draftQuestionCard(fixture.plugin, session, fixture.settings);
    fixture.plugin.settings = structuredClone(fixture.settings);
    fixture.plugin.settings.ai.channel = "siyuan";
    gate.resolve();
    await blocker;
    assert.deepEqual(await pending, { ok: true });
    assert.equal(fixture.count(models), 1);
});

test("模型执行期间来源归属变化，成功调用仍计量但不替换草稿", async () => {
    const fixture = harness();
    fixture.hooks[models] = () => { fixture.state.blockRoot = hostId; };
    const session = createFlashcardSession(source);
    const original = structuredClone(session.draft);
    assert.deepEqual(await draftQuestionCard(fixture.plugin, session, fixture.settings), { ok: false, reason: "sourceChanged" });
    assert.equal(await usageToday(fixture.plugin), 1);
    assert.deepEqual(session.draft, original);
});

for (const phase of ["queued", "modelReturn"]) {
    test(`AI 在 ${phase} 取消，丢弃结果且不会制卡`, async () => {
        const fixture = harness();
        const session = createFlashcardSession(source);
        const original = structuredClone(session.draft);
        const gate = deferred();
        const started = deferred();
        let blocker;
        if (phase === "queued") {
            blocker = enqueueEnrich(async () => { started.resolve(); await gate.promise; });
            await started.promise;
        } else {
            fixture.hooks[models] = async () => { started.resolve(); await gate.promise; };
        }
        const pending = draftQuestionCard(fixture.plugin, session, fixture.settings);
        if (phase === "modelReturn") await started.promise;
        cancelFlashcardSession(session);
        gate.resolve();
        if (blocker) await blocker;
        assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
        assert.deepEqual(session.draft, original);
        assert.equal(await usageToday(fixture.plugin), phase === "queued" ? 0 : 1);
        assert.equal(fixture.count(inserts), 0);
    });
}

test("预览组件无编译警告，所有 UI 制卡入口统一进入预览，复用现有模态焦点", () => {
    const dialog = readFileSync(new URL("../src/ui/FlashcardDialog.svelte", import.meta.url), "utf8");
    assert.deepEqual(compile(dialog, { filename: "FlashcardDialog.svelte", generate: "client" }).warnings, []);
    assert.match(dialog, /bind:value=\{front\}/);
    assert.match(dialog, /bind:value=\{back\}/);
    assert.doesNotMatch(dialog, /\{@html/);
    const opener = readFileSync(new URL("../src/ui/flashcard-dialog.ts", import.meta.url), "utf8");
    assert.match(opener, /svelteDialog/);
    for (const path of ["../src/ui/ReaderTab.svelte", "../src/ui/HighlightView.svelte", "../src/index.ts"]) {
        const entry = readFileSync(new URL(path, import.meta.url), "utf8");
        assert.match(entry, /makeQuoteCardPreview\(/);
        assert.doesNotMatch(entry, /import \{ makeQuoteCard \}.*flashcard-service/);
    }
});

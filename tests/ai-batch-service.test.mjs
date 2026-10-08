import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-ai-batch:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-ai-batch:siyuan") return { format: "module", source: "export const fetchSyncPost = (route, body) => globalThis.__gleanAiBatchPost(route, body); export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { AI_BATCH_FILE, discardAiBatch, loadAiBatch, previewAiBatchResume, previewNewAiBatch, runAiBatch, stopAiBatchAfterCurrent, subscribeAiBatch } = await import("../src/services/ai-batch-service.ts");
const { normalizeSettings } = await import("../src/services/settings.ts");
const { todayStamp } = await import("../src/domain/resurface.ts");
const { ATTR } = await import("../src/domain/schema.ts");
const { enqueueEnrich, recordAiUsage } = await import("../src/services/enrich-service.ts");
const firstId = "20261004000000-first01";
const secondId = "20261004000000-second1";
const thirdId = "20261004000000-third01";
const fourthId = "20261004000000-fourth1";
const settings = () => normalizeSettings({ ai: { enrichMode: "manual", enrichDailyCap: 20 } });
const journal = (rows) => ({ version: 1, taskId: "batch-seeded", createdAt: "2026-10-04T00:00:00.000Z", rows });
const pending = (docId) => ({ docId, stage: "pending", attempt: 0, reason: "" });
const successAnswer = JSON.stringify({ summary: "模型生成的摘要", tags: ["模型标签", "阅读"] });
const rejectsReason = (promise, reason) => assert.rejects(promise, (error) => error.reason === reason);
function discardOptions(plugin, confirmed = true) {
    let signature;
    const unsubscribe = subscribeAiBatch(plugin, (state) => { signature = state.journalSignature; });
    unsubscribe();
    return { confirmed, expectedSignature: signature ?? "" };
}

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function harness(ids = [firstId, secondId]) {
    const files = new Map();
    const docs = new Map();
    const attrs = new Map();
    const events = [];
    const controls = { failJournalRead: false, failUsageRead: false, failUsageSave: false, failIndexSave: false, failJournalSave: null, skipJournalWrite: null, failAttrsRead: null, writeMode: "", onSave: null, onAi: null, onExport: null, answer: successAnswer };
    let journalSaves = 0;
    for (const id of ids) {
        docs.set(id, { id, content: `标题 ${id}`, hpath: `/读库/${id}`, box: "20261004000000-box0001", updated: "20261004000000" });
        attrs.set(id, { [ATTR.status]: "inbox", [ATTR.url]: `https://example.org/${id}`, [ATTR.summary]: "旧摘要", [ATTR.aiTags]: "旧标签", [ATTR.author]: "手填作者", [ATTR.priority]: "1", [ATTR.rating]: "5", tags: "用户标签" });
    }
    const plugin = {
        async loadData(name) {
            events.push({ kind: "load", name });
            if ((name === AI_BATCH_FILE && controls.failJournalRead) || (name === "ai-usage.json" && controls.failUsageRead)) throw new Error("private read failure");
            return structuredClone(files.get(name));
        },
        async saveData(name, value) {
            const copied = structuredClone(value);
            events.push({ kind: "save", name, value: copied });
            if (name === AI_BATCH_FILE) journalSaves += 1;
            if (controls.onSave) await controls.onSave(name, copied);
            if (name === "ai-usage.json" && controls.failUsageSave) throw new Error("private usage save failure");
            if (name === "glean-index.json" && controls.failIndexSave) throw new Error("private index save failure");
            const fail = name === AI_BATCH_FILE && controls.failJournalSave?.(copied, journalSaves);
            if (fail === "after") { files.set(name, copied); throw new Error("save response lost"); }
            if (fail === "code") return { code: 1, msg: "save rejected" };
            if (fail) throw new Error("private journal save failure");
            if (name === AI_BATCH_FILE && controls.skipJournalWrite?.(copied)) return undefined;
            files.set(name, copied);
            return undefined;
        },
    };
    globalThis.__gleanAiBatchPost = async (route, body) => {
        events.push({ kind: "route", route, body: structuredClone(body) });
        if (route === "/api/query/sql") {
            const id = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
            return { code: 0, data: docs.has(id) ? [structuredClone(docs.get(id))] : [] };
        }
        if (route === "/api/attr/getBlockAttrs") {
            if (controls.failAttrsRead?.(body.id)) return { code: 1, msg: "private attrs read failure" };
            return { code: 0, data: structuredClone(attrs.get(body.id) ?? {}) };
        }
        if (route === "/api/attr/setBlockAttrs") {
            if (controls.writeMode === "reject") return { code: 1, msg: "private write failure" };
            const current = attrs.get(body.id);
            for (const [key, value] of Object.entries(body.attrs)) { if (value === null) delete current[key]; else current[key] = value; }
            if (controls.writeMode === "lost") return { code: 1, msg: "write response lost" };
            return { code: 0, data: null };
        }
        if (route === "/api/export/exportMdContent") {
            await controls.onExport?.(body.id);
            return { code: 0, data: { content: `# ${docs.get(body.id)?.content}\n\n这是真实管线消费的模拟文章正文 ${body.id}。` } };
        }
        if (route === "/api/ai/chatGPT") {
            const saved = files.get(AI_BATCH_FILE);
            assert.equal(saved.rows.filter((row) => row.stage === "running").length, 1, "模型调用必须有且只有一个持久 running 检查点");
            return controls.onAi ? await controls.onAi(body) : { code: 0, data: controls.answer };
        }
        throw new Error(`Unexpected route ${route}`);
    };
    return { plugin, files, docs, attrs, events, controls, aiCalls: () => events.filter((event) => event.route === "/api/ai/chatGPT"), writes: () => events.filter((event) => event.route === "/api/attr/setBlockAttrs"), saved: () => files.get(AI_BATCH_FILE) };
}

test("多选预览只回读已收录资格，列已有摘要/标签覆盖、共享额度和当前通道，不写文件或调用模型", async () => {
    const current = harness([firstId, secondId, thirdId, fourthId]);
    delete current.attrs.get(thirdId)[ATTR.status];
    current.attrs.get(fourthId)[ATTR.internal] = "true";
    current.files.set("ai-usage.json", { date: todayStamp(), count: 3 });
    current.plugin.settings = normalizeSettings({ ai: { channel: "custom", customModel: "current-model", enrichDailyCap: 10 } });
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId, thirdId, fourthId], settings());
    assert.equal(preview.rows.length, 4);
    assert.deepEqual(preview.replacements, { summaries: 2, aiTags: 2 });
    assert.deepEqual(preview.quota, { used: 3, cap: 10, remaining: 7 });
    assert.deepEqual(preview.channel, { kind: "custom", model: "current-model" });
    assert.equal(preview.rows[0].document.summary, "旧摘要");
    assert.equal(preview.rows[0].document.aiTagCount, 1);
    assert.equal(preview.rows[2].reason, "ineligible");
    assert.equal(preview.rows[3].reason, "ineligible");
    assert.equal(current.events.filter((event) => event.kind === "save").length, 0);
    assert.equal(current.aiCalls().length, 0);
});

test("空选择、非法/重复 ID、只有候选和读取失败均不能创建可执行任务", async () => {
    const current = harness();
    for (const ids of [[], ["invalid"], [firstId, firstId]]) await rejectsReason(previewNewAiBatch(current.plugin, ids, settings()), "selection");
    delete current.attrs.get(firstId)[ATTR.status];
    await rejectsReason(previewNewAiBatch(current.plugin, [firstId], settings()), "empty");
    current.controls.failAttrsRead = () => true;
    await rejectsReason(previewNewAiBatch(current.plugin, [secondId], settings()), "empty");
    assert.equal(current.aiCalls().length, 0);
    assert.equal(current.saved(), undefined);
});

test("确认后逐篇真实富化、索引同步、用量计量，持久日志不含标题/正文/URL/摘要/标签/密钥", async () => {
    const current = harness();
    const before = structuredClone([...current.attrs.entries()]);
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: false }), "confirmation");
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    assert.deepEqual(current.saved().rows.map((row) => [row.stage, row.attempt]), [["succeeded", 1], ["succeeded", 1]]);
    assert.equal(current.aiCalls().length, 2);
    assert.equal(current.files.get("ai-usage.json").count, 2);
    for (const [id, previous] of before) {
        const after = current.attrs.get(id);
        for (const key of [ATTR.url, ATTR.status, ATTR.author, ATTR.priority, ATTR.rating, "tags"]) assert.equal(after[key], previous[key]);
        assert.equal(after[ATTR.summary], "模型生成的摘要");
        assert.equal(after[ATTR.aiTags], "模型标签,阅读");
        assert.equal(current.files.get("glean-index.json").clips[id].summary, "模型生成的摘要");
    }
    for (const saved of current.events.filter((event) => event.kind === "save" && event.name === AI_BATCH_FILE)) {
        assert.deepEqual(Object.keys(saved.value), ["version", "taskId", "createdAt", "rows"]);
        for (const row of saved.value.rows) assert.deepEqual(Object.keys(row), ["docId", "stage", "attempt", "reason"]);
        assert.doesNotMatch(JSON.stringify(saved.value), /旧摘要|模型生成|旧标签|模型标签|手填作者|https:|文章正文|标题/);
    }
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "stale");
});

test("资格、位置、来源、状态、摘要或标签在预览后变化，跳过且不调用模型", async () => {
    for (const kind of ["status", "url", "summary", "tags", "internal", "excluded", "moved", "deleted"]) {
        const current = harness([firstId]);
        const preview = await previewNewAiBatch(current.plugin, [firstId], settings());
        if (kind === "status") current.attrs.get(firstId)[ATTR.status] = "done";
        if (kind === "url") current.attrs.get(firstId)[ATTR.url] = "https://other.org";
        if (kind === "summary") current.attrs.get(firstId)[ATTR.summary] = "用户新摘要";
        if (kind === "tags") current.attrs.get(firstId)[ATTR.aiTags] = "用户新AI标签";
        if (kind === "internal") current.attrs.get(firstId)[ATTR.internal] = "true";
        if (kind === "excluded") current.attrs.get(firstId)[ATTR.excluded] = "true";
        if (kind === "moved") current.docs.get(firstId).hpath = "/另一个位置";
        if (kind === "deleted") current.docs.delete(firstId);
        await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
        assert.equal(current.saved().rows[0].stage, "skipped", kind);
        assert.equal(current.aiCalls().length, 0, kind);
        assert.equal(current.writes().length, 0, kind);
    }
});

test("写入点再次比较预览属性/位置：模型期间被用户修改不能覆盖，结果保守记 unknown", async () => {
    for (const kind of ["summary", "tags", "url", "status", "location", "internal"]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        current.controls.onAi = async () => {
            if (kind === "location") current.docs.get(firstId).hpath = "/已移动";
            else current.attrs.get(firstId)[{ summary: ATTR.summary, tags: ATTR.aiTags, url: ATTR.url, status: ATTR.status, internal: ATTR.internal }[kind]] = { summary: "用户新摘要", tags: "用户标签", url: "https://changed.org", status: "done", internal: "true" }[kind];
            return { code: 0, data: successAnswer };
        };
        await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
        assert.equal(current.saved().rows[0].stage, "unknown", kind);
        assert.equal(current.saved().rows[1].stage, "pending", kind);
        assert.equal(current.writes().length, 0, kind);
        assert.equal(current.aiCalls().length, 1, kind);
    }
});

test("running 检查点保存失败或返回非零 code，不能发出模型调用", async () => {
    for (const failure of [true, "code", "after"]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        current.controls.failJournalSave = (value) => value?.rows.some((row) => row.stage === "running") ? failure : false;
        await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "journalSave");
        assert.equal(current.aiCalls().length, 0);
        assert.equal(current.writes().length, 0);
        current.controls.failJournalSave = null;
        const loaded = await loadAiBatch(current.plugin);
        assert.equal(loaded.rows[0].stage, failure === "after" ? "unknown" : "pending");
        assert.equal(current.aiCalls().length, 0);
    }
});

test("成功结果检查点保存失败立即停止，磁盘留 running，重载 unknown 且不重复调用", async () => {
    const current = harness();
    const states = [];
    const unsubscribe = subscribeAiBatch(current.plugin, (state) => states.push(state));
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    current.controls.failJournalSave = (value) => value?.rows.some((row) => row.stage === "succeeded");
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "journalSave");
    assert.equal(current.saved().rows[0].stage, "running");
    assert.equal(states.at(-1).journal.rows[0].stage, "unknown");
    assert.equal(current.attrs.get(firstId)[ATTR.summary], "模型生成的摘要");
    assert.equal(current.aiCalls().length, 1);
    current.controls.failJournalSave = null;
    const loaded = await loadAiBatch(current.plugin);
    assert.equal(loaded.rows[0].stage, "unknown");
    assert.equal(loaded.rows[1].stage, "pending");
    assert.equal(current.aiCalls().length, 1);
    unsubscribe();
});

test("成功结果已持久但保存响应丢失：停止后重读保留 succeeded，恢复入口拒绝重跑", async () => {
    const current = harness();
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    current.controls.failJournalSave = (value) => value?.rows.some((row) => row.stage === "succeeded") ? "after" : false;
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "journalSave");
    assert.equal(current.saved().rows[0].stage, "succeeded");
    current.controls.failJournalSave = null;
    assert.equal((await loadAiBatch(current.plugin)).rows[0].stage, "succeeded");
    await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings()), "selection");
    assert.equal(current.aiCalls().length, 1);
});

test("模型网络错误不假称未消费，属性写入失败/响应丢失/索引失败均 unknown 且停止后续", async () => {
    for (const kind of ["network", "writeReject", "writeLost", "index", "usage"]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        if (kind === "network") current.controls.onAi = async () => ({ code: 1, msg: "response lost after remote processing" });
        if (kind === "writeReject") current.controls.writeMode = "reject";
        if (kind === "writeLost") current.controls.writeMode = "lost";
        if (kind === "index") current.controls.failIndexSave = true;
        if (kind === "usage") current.controls.failUsageSave = true;
        await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
        assert.equal(current.saved().rows[0].stage, "unknown", kind);
        assert.equal(current.saved().rows[0].reason, "error", kind);
        assert.equal(current.saved().rows[1].stage, "pending", kind);
        assert.equal(current.aiCalls().length, 1, kind);
        if (kind === "writeLost" || kind === "index") assert.equal(current.attrs.get(firstId)[ATTR.summary], "模型生成的摘要");
        else assert.equal(current.attrs.get(firstId)[ATTR.summary], "旧摘要");
        await loadAiBatch(current.plugin);
        await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings()), "unknownAuthorization");
        assert.equal(current.aiCalls().length, 1);
    }
});

test("执行后读回失败即 unknown，包括模型失败而无法确认属性是否变化", async () => {
    for (const modelSuccess of [true, false]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        current.controls.onAi = async () => {
            if (!modelSuccess) current.controls.failAttrsRead = () => true;
            return modelSuccess ? { code: 0, data: successAnswer } : { code: 1, msg: "response lost" };
        };
        if (modelSuccess) current.controls.failAttrsRead = () => current.writes().length > 0;
        await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
        assert.equal(current.saved().rows[0].stage, "unknown");
        assert.equal(current.saved().rows[0].reason, "readback");
        assert.equal(current.aiCalls().length, 1);
    }
});

test("已计量的解析失败保存 failed，不自动重试，恢复必须新预览再确认费用", async () => {
    const current = harness([firstId]);
    current.controls.answer = "not model JSON";
    const preview = await previewNewAiBatch(current.plugin, [firstId], settings());
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].stage, "failed");
    assert.equal(current.saved().rows[0].reason, "parse");
    assert.equal(current.files.get("ai-usage.json").count, 1);
    assert.equal(current.attrs.get(firstId)[ATTR.summary], "旧摘要");
    await loadAiBatch(current.plugin);
    assert.equal(current.aiCalls().length, 1);
    current.attrs.get(firstId)[ATTR.summary] = "恢复前用户摘要";
    const resumed = await previewAiBatchResume(current.plugin, [firstId], settings());
    assert.equal(resumed.rows[0].document.summary, "恢复前用户摘要");
    assert.equal(resumed.quota.used, 1);
    await rejectsReason(runAiBatch(current.plugin, resumed, settings(), { confirmed: false }), "confirmation");
    current.controls.answer = successAnswer;
    await runAiBatch(current.plugin, resumed, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].stage, "succeeded");
    assert.equal(current.saved().rows[0].attempt, 2);
    assert.equal(current.files.get("ai-usage.json").count, 2);
});

test("额度满和总模式关闭保留 pending 并暂停，不给未调用的项目伪造成功", async () => {
    for (const mode of ["cap", "off", "queuedCap", "queuedOff"]) {
        const current = harness();
        const configured = settings();
        if (mode === "off") configured.ai.enrichMode = "off";
        if (mode === "cap") current.files.set("ai-usage.json", { date: todayStamp(), count: 20 });
        if (mode === "queuedCap") current.controls.onExport = async () => current.files.set("ai-usage.json", { date: todayStamp(), count: 20 });
        if (mode === "queuedOff") current.controls.onExport = async () => { current.plugin.settings = normalizeSettings({ ai: { enrichMode: "off" } }); };
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], configured);
        await runAiBatch(current.plugin, preview, configured, { confirmed: true });
        assert.equal(current.saved().rows[0].stage, "pending", mode);
        assert.equal(current.saved().rows[0].reason, mode.toLowerCase().includes("off") ? "off" : "cap", mode);
        assert.equal(current.saved().rows[1].stage, "pending", mode);
        assert.equal(current.aiCalls().length, 0, mode);
    }
});

test("暂停/关闭等待当前请求完成且不回滚，同插件其他窗口不能创建、执行或丢弃重入", async () => {
    const current = harness();
    const started = deferred();
    const response = deferred();
    const stateFromOtherWindow = [];
    const unsubscribe = subscribeAiBatch(current.plugin, (state) => stateFromOtherWindow.push(state));
    current.controls.onAi = async () => { started.resolve(); return response.promise; };
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    const controller = new AbortController();
    const running = runAiBatch(current.plugin, preview, settings(), { confirmed: true, signal: controller.signal });
    await started.promise;
    await rejectsReason(previewNewAiBatch(current.plugin, [secondId], settings()), "busy");
    await rejectsReason(previewAiBatchResume(current.plugin, [secondId], settings()), "busy");
    await rejectsReason(discardAiBatch(current.plugin, discardOptions(current.plugin)), "busy");
    await rejectsReason(loadAiBatch(current.plugin), "busy");
    controller.abort();
    stopAiBatchAfterCurrent(current.plugin);
    response.resolve({ code: 0, data: successAnswer });
    await running;
    assert.deepEqual(current.saved().rows.map((row) => row.stage), ["succeeded", "pending"]);
    assert.equal(current.attrs.get(firstId)[ATTR.summary], "模型生成的摘要");
    assert.equal(current.aiCalls().length, 1);
    assert.equal(stateFromOtherWindow.at(-1).busy, "");
    await loadAiBatch(current.plugin);
    assert.equal(current.aiCalls().length, 1);
    unsubscribe();
});

test("running 保存期间取消但尚未调用时恢复原阶段/次数，不发请求", async () => {
    const current = harness();
    const controller = new AbortController();
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    current.controls.onSave = async (name, value) => { if (name === AI_BATCH_FILE && value?.rows.some((row) => row.stage === "running")) controller.abort(); };
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true, signal: controller.signal });
    assert.equal(current.saved().rows[0].stage, "pending");
    assert.equal(current.saved().rows[0].attempt, 0);
    assert.equal(current.aiCalls().length, 0);
});

test("新任务不能覆盖未完成旧记录；显式放弃只丢日志，不写文章/索引/用量", async () => {
    for (const row of [pending(firstId), { docId: firstId, stage: "failed", attempt: 1, reason: "parse" }, { docId: firstId, stage: "unknown", attempt: 1, reason: "error" }]) {
        const current = harness();
        current.files.set(AI_BATCH_FILE, journal([row]));
        const previous = structuredClone(current.saved());
        const attrsBefore = structuredClone([...current.attrs.entries()]);
        await rejectsReason(previewNewAiBatch(current.plugin, [secondId], settings()), "oldTask");
        assert.deepEqual(current.saved(), previous);
        await rejectsReason(discardAiBatch(current.plugin, discardOptions(current.plugin, false)), "confirmation");
        await discardAiBatch(current.plugin, discardOptions(current.plugin));
        assert.equal(current.saved(), null);
        assert.deepEqual([...current.attrs.entries()], attrsBefore);
        assert.equal(current.writes().length, 0);
        assert.equal(current.files.has("glean-index.json"), false);
        assert.equal(current.files.has("ai-usage.json"), false);
        assert.equal((await previewNewAiBatch(current.plugin, [secondId], settings())).rows.length, 1);
    }
});

test("读取异常/非法版本 fail closed，绝不默认覆盖；格式损坏只能显式丢弃", async () => {
    const current = harness();
    const bad = { version: 999, body: "不可丢弃的旧日志" };
    current.files.set(AI_BATCH_FILE, bad);
    await rejectsReason(loadAiBatch(current.plugin), "journalInvalid");
    await rejectsReason(previewNewAiBatch(current.plugin, [firstId], settings()), "journalInvalid");
    assert.deepEqual(current.saved(), bad);
    assert.equal(current.events.filter((event) => event.kind === "save").length, 0);
    current.controls.failJournalRead = true;
    await rejectsReason(loadAiBatch(current.plugin), "journalRead");
    await rejectsReason(discardAiBatch(current.plugin, discardOptions(current.plugin)), "journalRead");
    assert.deepEqual(current.saved(), bad);
    current.controls.failJournalRead = false;
    await rejectsReason(loadAiBatch(current.plugin), "journalInvalid");
    await discardAiBatch(current.plugin, discardOptions(current.plugin));
    assert.equal(current.saved(), null);
});

test("重启 running 变 unknown，没有自动调用，必须逐篇查看和再次授权恢复", async () => {
    const current = harness();
    current.files.set(AI_BATCH_FILE, journal([{ docId: firstId, stage: "running", attempt: 1, reason: "" }, pending(secondId)]));
    const loaded = await loadAiBatch(current.plugin);
    assert.equal(loaded.rows[0].stage, "unknown");
    assert.equal(current.saved().rows[0].stage, "running", "读取不改写日志");
    assert.equal(current.aiCalls().length, 0);
    await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings()), "unknownAuthorization");
    await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings(), { reviewedUnknownIds: [firstId] }), "unknownAuthorization");
    await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings(), { authorizedUnknownIds: [firstId] }), "unknownAuthorization");
    const resumed = await previewAiBatchResume(current.plugin, [firstId], settings(), { reviewedUnknownIds: [firstId], authorizedUnknownIds: [firstId] });
    await runAiBatch(current.plugin, resumed, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].stage, "succeeded");
    assert.equal(current.saved().rows[0].attempt, 2);
    assert.equal(current.saved().rows[1].stage, "pending");
    assert.equal(current.aiCalls().length, 1);
});

test("saved successful 不重跑，仅显式选中的 pending/failed 可以恢复；每次重读位置与属性", async () => {
    const current = harness([firstId, secondId, thirdId]);
    current.files.set(AI_BATCH_FILE, journal([{ docId: firstId, stage: "succeeded", attempt: 1, reason: "" }, pending(secondId), { docId: thirdId, stage: "failed", attempt: 1, reason: "parse" }]));
    await rejectsReason(previewAiBatchResume(current.plugin, [], settings()), "selection");
    await rejectsReason(previewAiBatchResume(current.plugin, [firstId], settings()), "selection");
    current.docs.get(secondId).hpath = "/新的位置";
    current.attrs.get(secondId)[ATTR.summary] = "新的手填摘要";
    const preview = await previewAiBatchResume(current.plugin, [secondId], settings());
    assert.equal(preview.rows[0].document.expectedLocation.hpath, "/新的位置");
    assert.equal(preview.rows[0].document.summary, "新的手填摘要");
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    assert.deepEqual(current.saved().rows.map((row) => row.stage), ["succeeded", "succeeded", "failed"]);
    assert.equal(current.saved().rows[0].attempt, 1);
    assert.equal(current.saved().rows[2].attempt, 1);
    assert.equal(current.aiCalls().length, 1);
});

test("两个窗口的新预览只能执行当前令牌；复制/伪造或篡改预览不能绕过快照", async () => {
    const current = harness();
    const first = await previewNewAiBatch(current.plugin, [firstId], settings());
    const second = await previewNewAiBatch(current.plugin, [secondId], settings());
    await rejectsReason(runAiBatch(current.plugin, first, settings(), { confirmed: true }), "stale");
    await rejectsReason(runAiBatch(current.plugin, structuredClone(second), settings(), { confirmed: true }), "stale");
    second.rows[0].document.expectedAttrs[ATTR.summary] = "伪造比较值";
    second.rows[0].docId = firstId;
    await runAiBatch(current.plugin, second, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].docId, secondId);
    assert.equal(current.saved().rows[0].stage, "succeeded");
    assert.equal(current.attrs.get(firstId)[ATTR.summary], "旧摘要");
});

test("预览后当前保存设置替换会阻止旧授权；保存 running 时换通道也不调用", async () => {
    for (const stage of ["before", "checkpoint"]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        const change = () => { current.plugin.settings = normalizeSettings({ ai: { channel: "custom", customModel: "different-model" } }); };
        if (stage === "before") change();
        else current.controls.onSave = async (name, value) => { if (name === AI_BATCH_FILE && value?.rows.some((row) => row.stage === "running")) change(); };
        await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "settingsChanged");
        assert.equal(current.aiCalls().length, 0);
        if (stage === "checkpoint") assert.deepEqual(current.saved().rows[0], pending(firstId));
    }
});

test("已有共享队列时只排一次不死锁，与其他 AI 动作继续串行", async () => {
    const current = harness([firstId]);
    const blocker = deferred();
    const queuedStarted = deferred();
    const other = enqueueEnrich(async () => { queuedStarted.resolve(); await blocker.promise; });
    await queuedStarted.promise;
    const preview = await previewNewAiBatch(current.plugin, [firstId], settings());
    const running = runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current.aiCalls().length, 0);
    blocker.resolve();
    await other;
    await running;
    assert.equal(current.aiCalls().length, 1);
    assert.equal(current.saved().rows[0].stage, "succeeded");
});

test("共享用量读取异常、损坏不装作零；执行前额度读失败不调用", async () => {
    const current = harness();
    current.controls.failUsageRead = true;
    await rejectsReason(previewNewAiBatch(current.plugin, [firstId], settings()), "previewRead");
    current.controls.failUsageRead = false;
    current.files.set("ai-usage.json", { date: todayStamp(), count: -1 });
    await rejectsReason(previewNewAiBatch(current.plugin, [firstId], settings()), "previewRead");
    current.files.delete("ai-usage.json");
    const preview = await previewNewAiBatch(current.plugin, [firstId], settings());
    current.controls.failUsageRead = true;
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "previewRead");
    assert.equal(current.aiCalls().length, 0);
    assert.equal(current.saved().rows[0].stage, "pending");
});

test("观察者异常不损坏保存/执行，同一插件预览读取期间也禁止另一个窗口重入", async () => {
    const current = harness();
    let firstNotification = true;
    const unsubscribe = subscribeAiBatch(current.plugin, () => { if (firstNotification) { firstNotification = false; return; } throw new Error("observer error"); });
    const blocked = deferred();
    const started = deferred();
    const originalLoad = current.plugin.loadData;
    current.plugin.loadData = async (name) => { if (name === AI_BATCH_FILE) { started.resolve(); await blocked.promise; } return originalLoad(name); };
    const preparing = previewNewAiBatch(current.plugin, [firstId], settings());
    await started.promise;
    await rejectsReason(previewNewAiBatch(current.plugin, [secondId], settings()), "busy");
    blocked.resolve();
    const preview = await preparing;
    current.plugin.loadData = originalLoad;
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].stage, "succeeded");
    unsubscribe();
});

test("SDK 返回保存成功但 running 未落盘时，读回不一致阻止模型调用", async () => {
    const current = harness();
    const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
    current.controls.skipJournalWrite = (value) => value?.rows.some((row) => row.stage === "running");
    await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "journalSave");
    assert.equal(current.saved().rows[0].stage, "pending");
    assert.equal(current.aiCalls().length, 0);
    assert.equal(current.writes().length, 0);
});

test("SDK 假成功或成功后的日志读回失败立即停止，磁盘留 running 时重载 unknown", async () => {
    for (const kind of ["noWrite", "readFailed"]) {
        const current = harness();
        const preview = await previewNewAiBatch(current.plugin, [firstId, secondId], settings());
        if (kind === "noWrite") current.controls.skipJournalWrite = (value) => value?.rows.some((row) => row.stage === "succeeded");
        else current.controls.onSave = async (name, value) => { if (name === AI_BATCH_FILE && value?.rows.some((row) => row.stage === "succeeded")) current.controls.failJournalRead = true; };
        await rejectsReason(runAiBatch(current.plugin, preview, settings(), { confirmed: true }), "journalSave");
        assert.equal(current.aiCalls().length, 1);
        assert.equal(current.attrs.get(firstId)[ATTR.summary], "模型生成的摘要");
        current.controls.failJournalRead = false;
        const loaded = await loadAiBatch(current.plugin);
        assert.equal(loaded.rows[0].stage, kind === "noWrite" ? "unknown" : "succeeded");
        assert.equal(current.aiCalls().length, 1);
    }
});

test("放弃前外部客户端换任务会拒绝旧确认；放弃保存读回失败不假称日志已丢弃", async () => {
    const current = harness();
    current.files.set(AI_BATCH_FILE, journal([pending(firstId)]));
    await loadAiBatch(current.plugin);
    const originalConfirmation = discardOptions(current.plugin);
    const replacement = { ...journal([pending(secondId)]), taskId: "batch-external" };
    current.files.set(AI_BATCH_FILE, replacement);
    await rejectsReason(discardAiBatch(current.plugin, originalConfirmation), "stale");
    assert.deepEqual(current.saved(), replacement);
    await loadAiBatch(current.plugin);
    current.controls.skipJournalWrite = (value) => value === null;
    await rejectsReason(discardAiBatch(current.plugin, discardOptions(current.plugin)), "journalSave");
    assert.deepEqual(current.saved(), replacement);
    current.controls.skipJournalWrite = null;
    await loadAiBatch(current.plugin);
    await discardAiBatch(current.plugin, discardOptions(current.plugin));
    assert.equal(current.saved(), null);
    assert.equal(current.writes().length, 0);
});

test("共享额度的运行时未知状态使预览不可用，不能绕过为零或再发一次模型", async () => {
    const current = harness();
    current.controls.failUsageSave = true;
    await assert.rejects(recordAiUsage(current.plugin));
    current.controls.failUsageSave = false;
    current.files.set("ai-usage.json", { date: todayStamp(), count: 1 });
    await rejectsReason(previewNewAiBatch(current.plugin, [firstId], settings()), "previewRead");
    assert.equal(current.aiCalls().length, 0);
    assert.equal(current.saved(), undefined);
});

test("有效状态的同名用户文章按明确属性处理，不因内部名称/路径自动修改资格", async () => {
    const current = harness([firstId]);
    current.docs.get(firstId).content = "读库数据库";
    current.docs.get(firstId).hpath = "/读库周报/读库数据库";
    const preview = await previewNewAiBatch(current.plugin, [firstId], settings());
    assert.equal(preview.rows[0].document.eligible, true);
    await runAiBatch(current.plugin, preview, settings(), { confirmed: true });
    assert.equal(current.saved().rows[0].stage, "succeeded");
    assert.equal(current.attrs.get(firstId)[ATTR.internal], undefined);
    assert.equal(current.attrs.get(firstId)[ATTR.status], "inbox");
});

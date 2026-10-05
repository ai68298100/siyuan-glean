/** 导入服务回归：真实串起新建文档、统一属性写入和派生索引。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-import-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-import-test:siyuan") {
            return {
                format: "module",
                source: "export const fetchSyncPost = (route, body) => new Promise((resolve) => globalThis.__gleanImportFetchPost(route, body, resolve));",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { previewImport, runImport, summarizeImportStatuses } = await import("../src/services/import-service.ts");
const { discardImportProgress, fingerprintImportSource, loadImportProgress, readImportProgress, saveImportProgress } = await import("../src/services/import-progress.ts");
const { IMPORT_PROGRESS_FILE } = await import("../src/domain/import-progress.ts");
const notebookId = "20261004110000-nnnnnnn";
const documentId = (index) => `20261004120000-${String(index).padStart(7, "0")}`;
const importOptions = { fingerprint: "a".repeat(64), notebookId, folder: "导入", format: "pocket-csv" };

function harness({ createEmpty = false, cacheFallback = false } = {}) {
    const attrs = new Map();
    const documents = new Map();
    const files = new Map();
    const calls = [];
    const journalSaves = [];
    const failures = { writeIds: new Set(), saveIndex: false, query: false, loadProgress: false, saveProgressAt: 0, saveProgressCodeAt: 0, dropProgressAt: 0, loseCreateResponse: false, createReply: undefined, beforeReadAttrs: null, holdCreate: null };
    let journalSaveCount = 0;
    let createCount = 0;
    const plugin = {
        data: {},
        async loadData(name) {
            if (name === IMPORT_PROGRESS_FILE && failures.loadProgress) {
                if (cacheFallback) return "";
                throw new Error("progress read failed");
            }
            const value = structuredClone(files.get(name));
            plugin.data[name] = value;
            return value;
        },
        async saveData(name, value) {
            if (name === "glean-index.json" && failures.saveIndex) throw new Error("index save failed");
            if (name === IMPORT_PROGRESS_FILE) {
                journalSaveCount += 1;
                if (journalSaveCount === failures.saveProgressAt) throw new Error("progress save failed");
                if (journalSaveCount === failures.saveProgressCodeAt) return { code: -1, msg: "save rejected" };
                if (journalSaveCount === failures.dropProgressAt) {
                    plugin.data[name] = structuredClone(value);
                    return { code: 0 };
                }
                journalSaves.push(structuredClone(value));
            }
            files.set(name, structuredClone(value));
            plugin.data[name] = structuredClone(value);
            return { code: 0 };
        },
        async removeData(name) {
            files.delete(name);
            delete plugin.data[name];
            return { code: 0 };
        },
    };
    globalThis.__gleanImportFetchPost = (route, body, callback) => {
        calls.push({ route, body });
        let data;
        switch (route) {
            case "/api/filetree/createDocWithMd": {
                assert.equal(files.get(IMPORT_PROGRESS_FILE).rows.find((row) => row.hpath === body.path && row.state === "creating")?.docId, "");
                createCount += 1;
                const id = documentId(createCount);
                attrs.set(id, body.tags ? { tags: body.tags } : {});
                documents.set(id, { id, content: body.path.split("/").at(-1), hpath: body.path, box: body.notebook, updated: "20261004120000" });
                data = createEmpty ? "" : failures.createReply ?? id;
                if (failures.holdCreate) { failures.holdCreate(() => callback({ code: 0, data })); return; }
                if (failures.loseCreateResponse) { callback({ code: -1, msg: "response lost after creating" }); return; }
                break;
            }
            case "/api/attr/getBlockAttrs":
                failures.beforeReadAttrs?.(body.id);
                data = attrs.get(body.id) ?? {};
                break;
            case "/api/attr/setBlockAttrs":
                if (failures.writeIds.has(body.id)) {
                    callback({ code: -1, msg: "attribute write failed" });
                    return;
                }
                attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs });
                data = null;
                break;
            case "/api/attr/batchGetBlockAttrs":
                data = Object.fromEntries(body.ids.filter((id) => attrs.has(id)).map((id) => [id, attrs.get(id)]));
                break;
            case "/api/query/sql": {
                if (failures.query) {
                    callback({ code: -1, msg: "query failed" });
                    return;
                }
                const docId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                const limit = Number(/LIMIT\s+(\d+)/i.exec(body.stmt)?.[1] ?? attrs.size);
                const offset = Number(/OFFSET\s+(\d+)/i.exec(body.stmt)?.[1] ?? 0);
                const clipIds = [...attrs.keys()].filter((id) => attrs.get(id)["custom-clip-url"] || attrs.get(id)["custom-clip-status"]);
                const ids = docId ? [docId] : clipIds.slice(offset, offset + limit);
                data = ids.filter((id) => attrs.has(id)).map((id) => documents.get(id) ?? { id, content: id, hpath: `/导入/${id}`, box: notebookId, updated: "20260929000000" });
                break;
            }
            default:
                throw new Error(`未模拟端点：${route}`);
        }
        callback({ code: 0, data: structuredClone(data) });
    };
    return { attrs, documents, files, calls, plugin, failures, journalSaves };
}

test("导入预览状态汇总只统计未重复条目，并按目标读库状态稳定排序", () => {
    const summary = summarizeImportStatuses([
        { title: "a", url: "https://example.com/a", site: "example.com", time: "", doneTime: "", tags: [], status: "done", duplicate: false },
        { title: "b", url: "https://example.com/b", site: "example.com", time: "", doneTime: "", tags: [], status: "inbox", duplicate: false },
        { title: "c", url: "https://example.com/c", site: "example.com", time: "", doneTime: "", tags: [], status: "archived", duplicate: false },
        { title: "d", url: "https://example.com/d", site: "example.com", time: "", doneTime: "", tags: [], status: "done", duplicate: true },
    ]);
    assert.deepEqual(summary, [
        { status: "inbox", count: 1 },
        { status: "done", count: 1 },
        { status: "archived", count: 1 },
    ]);
});

test("外部导入在建文档时带入 tags，首次收录写来源时间与状态并同步索引", async () => {
    const h = harness();
    const summary = await runImport(h.plugin, [{
        title: "旧文", url: "https://example.com/old", site: "example.com",
        time: "20200102030405", tags: ["稍后读", "技术"], status: "done", duplicate: false,
    }], importOptions);

    assert.deepEqual({ imported: summary.imported, failed: summary.failed, docIds: summary.docIds }, {
        imported: 1, failed: 0, docIds: [documentId(1)],
    });
    assert.equal(h.calls.find((call) => call.route === "/api/filetree/createDocWithMd").body.tags, "稍后读,技术");
    assert.deepEqual({
        tags: h.attrs.get(documentId(1)).tags,
        url: h.attrs.get(documentId(1))["custom-clip-url"],
        time: h.attrs.get(documentId(1))["custom-clip-time"],
        status: h.attrs.get(documentId(1))["custom-clip-status"],
    }, { tags: "稍后读,技术", url: "https://example.com/old", time: "20200102030405", status: "done" });
    assert.equal(h.files.get("glean-index.json").clips[documentId(1)].status, "done");
    assert.equal(h.calls.some((call) => call.route === "/api/attr/batchSetBlockAttrs"), false);

    // 模拟预览后重复点击导入：旧 duplicate=false 不能绕过执行期查重。
    const stalePreview = [{
        title: "旧文", url: "https://example.com/old", site: "example.com",
        time: "20200102030405", tags: ["技术"], status: "done", duplicate: false,
    }];
    const repeated = await runImport(h.plugin, stalePreview, importOptions);
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.skippedDuplicate, 1);
    assert.equal(h.attrs.size, 1);

    const preview = await previewImport("title,url,time_added,status,tags\n旧文,https://example.com/old,1577934245,read,技术", "pocket-csv");
    assert.equal(preview.duplicateCount, 1);
    assert.equal(preview.rows[0].duplicate, true);
});

test("导入查重读完 500 条后的下一页，避免创建重复 URL", async () => {
    const h = harness();
    for (let index = 0; index < 501; index += 1) {
        h.attrs.set(`existing-${index}`, { "custom-clip-url": `https://example.com/${index}` });
    }
    const row = {
        title: "跨页旧文", url: "https://example.com/500#fragment", site: "example.com",
        time: "", tags: [], status: "inbox", duplicate: false,
    };
    const preview = await previewImport("title,url,time_added,status,tags\n跨页旧文,https://example.com/500#fragment,,unread,", "pocket-csv");
    assert.equal(preview.rows[0].duplicate, true);
    const summary = await runImport(h.plugin, [row], importOptions);
    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.imported, 0);
    assert.equal(h.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
    assert.ok(h.calls.some((call) => call.route === "/api/query/sql" && /OFFSET 500/.test(call.body.stmt)));
});

test("建文档返回空 ID 时保留真实创建为未知并推进进度", async () => {
    const h = harness({ createEmpty: true });
    const progress = [];
    const summary = await runImport(h.plugin, [{
        title: "失败项", url: "https://example.com/fail", site: "example.com",
        time: "", tags: [], status: "inbox", duplicate: false,
    }], {
        ...importOptions,
        onProgress: (done, total) => progress.push([done, total]),
    });
    assert.equal(summary.failed, 0);
    assert.equal(summary.unknown, 1);
    assert.equal(h.attrs.size, 1);
    assert.equal(h.files.get(IMPORT_PROGRESS_FILE).rows[0].state, "unknown");
    assert.deepEqual(progress, [[1, 1]]);
});

const importRow = (suffix) => ({
    title: suffix, url: `https://example.com/${suffix}`, site: "example.com",
    time: "20200102030405", doneTime: "20200103030405", tags: ["技术"], status: "done", duplicate: false,
});

test("收录属性失败后只重试失败行并复用已建文档", async () => {
    const context = harness();
    context.failures.writeIds.add(documentId(1));
    const rows = [importRow("failed"), importRow("success")];
    const first = await runImport(context.plugin, rows, importOptions);
    assert.equal(first.imported, 1);
    assert.deepEqual(first.failedItems, [{ url: rows[0].url, docId: documentId(1) }]);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], undefined);
    context.failures.writeIds.clear();
    const retry = await runImport(context.plugin, rows, {
        ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems,
    });
    assert.equal(retry.imported, 1);
    assert.equal(retry.failed, 0);
    assert.deepEqual(retry.docIds, [documentId(1)]);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 2);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], "done");
    assert.equal(context.attrs.get(documentId(2))["custom-clip-url"], rows[1].url);
});

test("索引保存失败后重试只修复缓存并保留用户修改和完成时间", async () => {
    const context = harness();
    const row = importRow("index");
    context.failures.saveIndex = true;
    const first = await runImport(context.plugin, [row], importOptions);
    assert.equal(first.failed, 1);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], "done");
    Object.assign(context.attrs.get(documentId(1)), {
        "custom-clip-status": "later", "custom-clip-priority": "5",
        "custom-clip-rating": "4", "custom-clip-done-time": "20200203040506", tags: "用户标签",
    });
    const before = structuredClone(context.attrs.get(documentId(1)));
    const writeCount = context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length;
    context.failures.saveIndex = false;
    const retry = await runImport(context.plugin, [{ ...row, duplicate: true }], { ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems });
    assert.equal(retry.imported, 1);
    assert.equal(retry.skippedDuplicate, 0);
    assert.equal(retry.failed, 0);
    assert.deepEqual(context.attrs.get(documentId(1)), before);
    assert.equal(context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length, writeCount);
    assert.equal(context.files.get("glean-index.json").clips[documentId(1)].status, "later");
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
});

test("重复恢复失败继续保留原文档 ID，第三次可恢复", async () => {
    const context = harness();
    const row = importRow("repeat");
    context.failures.writeIds.add(documentId(1));
    const first = await runImport(context.plugin, [row], importOptions);
    const second = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems });
    assert.deepEqual(second.failedItems, first.failedItems);
    context.failures.writeIds.clear();
    const third = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: second.taskId, retryFailures: second.failedItems });
    assert.equal(third.imported, 1);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
});

test("恢复期间来源手改、移动、删除、internal或excluded时保留失败，不另建文档", async () => {
    for (const change of ["source", "move", "delete", "internal", "excluded"]) {
        const context = harness();
        const row = importRow(change);
        context.failures.writeIds.add(documentId(1));
        const first = await runImport(context.plugin, [row], importOptions);
        context.failures.writeIds.clear();
        if (change === "source") context.attrs.get(documentId(1))["custom-clip-url"] = "https://example.com/user-edited";
        if (change === "move") context.documents.get(documentId(1)).hpath = `/其他目录/${change}`;
        if (change === "delete") context.attrs.delete(documentId(1));
        if (change === "internal") context.attrs.get(documentId(1))["custom-clip-internal"] = "true";
        if (change === "excluded") context.attrs.get(documentId(1))["custom-clip-excluded"] = "true";
        const before = structuredClone([...context.attrs]);
        const retry = await runImport(context.plugin, [{ ...row, duplicate: true }], { ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems });
        assert.equal(retry.failed, 1);
        assert.equal(retry.imported, 0);
        assert.deepEqual(retry.failedItems, first.failedItems);
        assert.deepEqual([...context.attrs], before);
        assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
    }
});

test("恢复查重排除自身，其他同来源文章仍跳过", async () => {
    const context = harness();
    const row = importRow("conflict");
    context.failures.writeIds.add(documentId(1));
    const first = await runImport(context.plugin, [row], importOptions);
    context.failures.writeIds.clear();
    context.attrs.set("external", { "custom-clip-url": row.url, "custom-clip-status": "inbox" });
    const retry = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems });
    assert.equal(retry.skippedDuplicate, 0);
    assert.equal(retry.failed, 1);
    assert.equal(retry.imported, 0);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], undefined);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
});

test("完整查重失败在任何建文档和属性写入前终止", async () => {
    const context = harness();
    context.failures.query = true;
    await assert.rejects(runImport(context.plugin, [importRow("query")], importOptions), /query failed/);
    assert.equal(context.attrs.size, 0);
    assert.equal(context.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
    assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
});

test("导入取消在当前行后生效，不额外执行同批的下一行", async () => {
    const context = harness();
    const signal = { aborted: false };
    const result = await runImport(context.plugin, [importRow("one"), importRow("two")], {
        ...importOptions, signal, onProgress: () => { signal.aborted = true; },
    });
    assert.equal(result.imported, 1);
    assert.equal(context.attrs.size, 1);
    assert.equal(result.failed, 0);
});

test("源文件指纹使用原始字节SHA256，合法百分号标题原样传内核", async () => {
    assert.equal(await fingerprintImportSource(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const context = harness();
    const result = await runImport(context.plugin, [{ ...importRow("percent"), title: "100%正确" }], { ...importOptions, folder: "/导入/100%目录" });
    assert.equal(result.imported, 1);
    assert.equal(context.calls.find((call) => call.route === "/api/filetree/createDocWithMd").body.path, "/导入/100%目录/100%正确");
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).rows[0].hpath, "/导入/100%目录/100%正确");
});

test("创建响应丢失、非法ID及重载creating意图均unknown，恢复绝不另建或按标题认领", async () => {
    for (const mode of ["lost", "invalid", "creating"]) {
        const context = harness();
        const row = importRow(mode);
        if (mode === "lost") context.failures.loseCreateResponse = true;
        if (mode === "invalid") context.failures.createReply = { id: documentId(1) };
        const first = await runImport(context.plugin, [row], importOptions);
        if (mode === "creating") {
            const record = context.files.get(IMPORT_PROGRESS_FILE);
            record.state = "running";
            Object.assign(record.rows[0], { state: "creating", docId: "", reason: "" });
        }
        const before = context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length;
        const resumed = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: first.taskId });
        assert.equal(resumed.unknown, 1);
        assert.equal(resumed.imported, 0);
        assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, before);
        assert.equal((await loadImportProgress(context.plugin)).rows[0].state, "unknown");
    }
});

test("创建前日志失败、内核错误码或写后不匹配阻止任何创建", async () => {
    for (const failure of ["saveProgressAt", "saveProgressCodeAt", "dropProgressAt"]) {
        for (const checkpoint of [1, 2]) {
            const context = harness();
            context.failures[failure] = checkpoint;
            await assert.rejects(runImport(context.plugin, [importRow("save")], importOptions), { reason: "save" });
            assert.equal(context.attrs.size, 0);
            assert.equal(context.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
        }
    }
});

test("精确ID落盘失败立即停止，重载只保留unknown，不补建遗失ID的文档", async () => {
    const context = harness();
    const rows = [importRow("known"), importRow("next")];
    context.failures.saveProgressAt = 3;
    let failure;
    try { await runImport(context.plugin, rows, importOptions); } catch (error) { failure = error; }
    assert.equal(failure.reason, "save");
    assert.equal(failure.summary.stopped, true);
    assert.equal(context.attrs.size, 1);
    assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    const recovered = await loadImportProgress(context.plugin);
    assert.deepEqual(recovered.rows.map((row) => row.state), ["unknown", "pending"]);
    const resumed = await runImport(context.plugin, rows, { ...importOptions, resumeTaskId: recovered.taskId });
    assert.equal(resumed.unknown, 1);
    assert.equal(resumed.imported, 1);
    assert.equal(context.attrs.size, 2);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], undefined);
});

test("完成阶段日志失败后精确ID仍可恢复，valid状态仅修索引，完成行不重写", async () => {
    const context = harness();
    const row = importRow("applied");
    context.failures.saveProgressAt = 4;
    await assert.rejects(runImport(context.plugin, [row], importOptions), { reason: "save" });
    const record = await readImportProgress(context.plugin);
    assert.equal(record.rows[0].state, "created");
    assert.equal(record.rows[0].docId, documentId(1));
    Object.assign(context.attrs.get(documentId(1)), { "custom-clip-status": "archived", "custom-clip-author": "用户作者", tags: "用户标签" });
    const before = structuredClone(context.attrs.get(documentId(1)));
    const writes = context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length;
    const resumed = await runImport(context.plugin, [{ ...row, duplicate: true }], { ...importOptions, resumeTaskId: record.taskId });
    assert.equal(resumed.imported, 1);
    assert.deepEqual(context.attrs.get(documentId(1)), before);
    assert.equal(context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length, writes);
    assert.equal(context.files.get("glean-index.json").clips[documentId(1)].status, "archived");
});

test("日志读取失败、缓存回退空串及未知版本都拒绝继续，不覆写原日志", async () => {
    for (const mode of ["reject", "cache", "version"]) {
        const context = harness({ cacheFallback: mode === "cache" });
        const signal = { aborted: true };
        await runImport(context.plugin, [importRow("read")], { ...importOptions, signal });
        if (mode === "version") context.files.get(IMPORT_PROGRESS_FILE).version = 999;
        else context.failures.loadProgress = true;
        const before = structuredClone(context.files.get(IMPORT_PROGRESS_FILE));
        await assert.rejects(runImport(context.plugin, [importRow("read")], importOptions), { reason: mode === "version" ? "invalid" : "read" });
        assert.deepEqual(context.files.get(IMPORT_PROGRESS_FILE), before);
        assert.equal(context.attrs.size, 0);
    }
});

test("替换源文件、格式、行内容、目标或截断预览均拒绝恢复；只有明确放弃才能新建", async () => {
    const context = harness();
    const rows = [importRow("first"), importRow("second")];
    const initial = await runImport(context.plugin, rows, { ...importOptions, signal: { aborted: true } });
    const before = structuredClone(context.files.get(IMPORT_PROGRESS_FILE));
    const source = "title,url,status\nfirst,https://example.com/first,read\n";
    const replacement = await fingerprintImportSource(new TextEncoder().encode(source + "\n"));
    for (const options of [
        { fingerprint: replacement }, { format: "wallabag-json" }, { folder: "/其他" }, { notebookId: "20261004110000-mmmmmmm" },
    ]) await assert.rejects(runImport(context.plugin, rows, { ...importOptions, resumeTaskId: initial.taskId, ...options }));
    await assert.rejects(runImport(context.plugin, rows.slice(0, 1), { ...importOptions, resumeTaskId: initial.taskId }), { reason: "file" });
    await assert.rejects(runImport(context.plugin, [{ ...rows[0], title: "替换行" }, rows[1]], { ...importOptions, resumeTaskId: initial.taskId }), { reason: "file" });
    await assert.rejects(runImport(context.plugin, rows, importOptions), { reason: "unfinished" });
    await assert.rejects(discardImportProgress(context.plugin, initial.taskId, false), { reason: "confirmation" });
    assert.deepEqual(context.files.get(IMPORT_PROGRESS_FILE), before);
    await discardImportProgress(context.plugin, initial.taskId, true);
    assert.equal(await readImportProgress(context.plugin), null);
    const next = await runImport(context.plugin, rows, importOptions);
    assert.notEqual(next.taskId, initial.taskId);
    assert.equal(next.imported, 2);
});

test("单插件多窗口锁阻止第二次创建及放弃，关闭只停止下一行", async () => {
    const context = harness();
    const started = Promise.withResolvers();
    let complete;
    context.failures.holdCreate = (callback) => { complete = callback; started.resolve(); };
    const controller = new AbortController();
    const rows = [importRow("window"), importRow("next")];
    const running = runImport(context.plugin, rows, { ...importOptions, signal: controller.signal });
    await started.promise;
    await assert.rejects(runImport(context.plugin, rows, importOptions), { reason: "busy" });
    await assert.rejects(discardImportProgress(context.plugin, context.files.get(IMPORT_PROGRESS_FILE).taskId, true), { reason: "busy" });
    controller.abort();
    complete();
    const result = await running;
    assert.equal(result.imported, 1);
    assert.equal(result.stopped, true);
    assert.deepEqual(context.files.get(IMPORT_PROGRESS_FILE).rows.map((row) => row.state), ["applied", "pending"]);
    context.failures.holdCreate = null;
    const resumed = await runImport(context.plugin, rows, { ...importOptions, resumeTaskId: result.taskId });
    assert.equal(resumed.imported, 1);
    assert.equal(context.attrs.size, 2);
});

test("同任务文件被另一客户端替换时，精确版本比较阻止写回", async () => {
    const context = harness();
    const initial = await runImport(context.plugin, [importRow("version")], { ...importOptions, signal: { aborted: true } });
    const expected = await readImportProgress(context.plugin);
    const next = structuredClone(expected);
    next.state = "running";
    // Keep the replacement timestamp valid even when the test runs after the
    // hard-coded historical date; the parser must reach the version mismatch
    // guard rather than reject the record as chronologically invalid.
    const replacementUpdatedAt = new Date(Date.parse(expected.createdAt) + 1000).toISOString();
    context.files.get(IMPORT_PROGRESS_FILE).updatedAt = replacementUpdatedAt;
    await assert.rejects(saveImportProgress(context.plugin, next, expected), { reason: "changed" });
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).taskId, initial.taskId);
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).updatedAt, replacementUpdatedAt);
});

test("半成品检查后、写入前的用户status/url/internal/excluded更改受写入点守门保护", async () => {
    for (const [key, value] of [
        ["custom-clip-status", "later"], ["custom-clip-url", "https://example.com/user"],
        ["custom-clip-internal", "true"], ["custom-clip-excluded", "true"],
    ]) {
        const context = harness();
        let reads = 0;
        context.failures.beforeReadAttrs = (id) => {
            reads += 1;
            if (reads === 3) context.attrs.get(id)[key] = value;
        };
        const result = await runImport(context.plugin, [importRow("race")], importOptions);
        assert.equal(result.imported, 0);
        assert.equal(result.failed, 1);
        assert.equal(context.attrs.get(documentId(1))[key], value);
        assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    }
});

test("有效状态文章即使与内部宿主同名，精确ID恢复仍仅修索引而不按标题拒绝", async () => {
    const context = harness();
    context.failures.saveIndex = true;
    const row = importRow("same-name");
    const initial = await runImport(context.plugin, [row], importOptions);
    context.failures.saveIndex = false;
    const record = context.files.get(IMPORT_PROGRESS_FILE);
    record.rows[0].hpath = "/导入/拾遗卡片";
    Object.assign(context.documents.get(documentId(1)), { content: "拾遗卡片", hpath: record.rows[0].hpath });
    const before = structuredClone(context.attrs.get(documentId(1)));
    const resumed = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: initial.taskId });
    assert.equal(resumed.imported, 1);
    assert.deepEqual(context.attrs.get(documentId(1)), before);
});

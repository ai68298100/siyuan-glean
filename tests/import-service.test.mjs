/** 导入服务回归：真实串起新建文档、统一属性写入和派生索引。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

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

const { previewImport, runImport, summarizeImportStatuses, ImportExecutionError } = await import("../src/services/import-service.ts");
const { discardImportProgress, fingerprintImportSource, loadImportProgress, readImportProgress, saveImportProgress } = await import("../src/services/import-progress.ts");
const { IMPORT_PROGRESS_FILE, ImportProgressError, summarizeImportProgress } = await import("../src/domain/import-progress.ts");
const notebookId = "20261004110000-nnnnnnn";
const documentId = (index) => `20261004120000-${String(index).padStart(7, "0")}`;
const importOptions = { fingerprint: "a".repeat(64), notebookId, folder: "导入", format: "pocket-csv" };

function harness({ createEmpty = false, cacheFallback = false } = {}) {
    const attrs = new Map();
    const documents = new Map();
    const files = new Map();
    const calls = [];
    const journalSaves = [];
    const failures = { writeIds: new Set(), saveIndex: false, query: false, loadProgress: false, saveProgressAt: 0, saveProgressCodeAt: 0, dropProgressAt: 0, loseCreateResponse: false, createReply: undefined, beforeReadAttrs: null, readMeta: null, holdCreate: null };
    let journalSaveCount = 0;
    let createCount = 0;
    const plugin = {
        name: "siyuan-glean",
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
    globalThis.fetch = async (route, options) => {
        assert.equal(route, "/api/file/getFile");
        const filePath = JSON.parse(options.body).path;
        assert.equal(filePath, `/data/storage/petal/${plugin.name}/${IMPORT_PROGRESS_FILE}`);
        if (failures.loadProgress) throw new Error("progress read failed");
        return files.has(IMPORT_PROGRESS_FILE)
            ? new Response(JSON.stringify(files.get(IMPORT_PROGRESS_FILE)), { status: 200 })
            : new Response(JSON.stringify({ code: 404, data: null }), { status: 202 });
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
                if (docId && failures.readMeta) {
                    const response = failures.readMeta(docId);
                    if (response !== undefined) { callback(response); return; }
                }
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

test("导入元数据写入 Markdown 时保持纯文本结构并校验来源 URL", async () => {
    const h = harness();
    await runImport(h.plugin, [{
        title: "正常\n\n# ![信标](https://attacker.example/pixel) <img src=x onerror=alert(1)>",
        url: "https://example.com/title?q=a%29b", site: "example.com\n\n![来源](https://attacker.example/site)",
        time: "", doneTime: "", tags: ["技术\n![标签](https://attacker.example/tag)"], status: "inbox", duplicate: false,
    }], importOptions);
    const markdown = h.calls.find((call) => call.route === "/api/filetree/createDocWithMd").body.markdown;
    assert.equal(markdown.split("\n")[0], "# 正常 \\# \\!\\[信标\\]\\(https://attacker\\.example/pixel\\) &lt;img src=x onerror=alert\\(1\\)&gt;");
    assert.ok(markdown.includes("- 来源：example\\.com \\!\\[来源\\]\\(https://attacker\\.example/site\\)"));
    assert.ok(markdown.includes("- 标签：#技术 \\!\\[标签\\]\\(https://attacker\\.example/tag\\)"));
    assert.ok(markdown.includes("- [https://example\\.com/title?q=a%29b](<https://example.com/title?q=a%29b>)"));
    assert.doesNotMatch(markdown, /<(?:script|img|svg|iframe)\b/i);
    assert.doesNotMatch(markdown, /^# 注入|^# !\[|^!\[来源\]|^!\[标签\]/m);

    const invalid = harness();
    await assert.rejects(runImport(invalid.plugin, [{
        title: "不安全链接", url: "javascript:alert(1)", site: "example.com",
        time: "", doneTime: "", tags: [], status: "inbox", duplicate: false,
    }], importOptions), (error) => error.reason === "file");
    assert.equal(invalid.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
});

test("导入预览无有效链接时说明文件原因，不访问内核查重或写入", async () => {
    const h = harness();
    h.failures.query = true;
    for (const [content, format, issue] of [
        ["\uFEFF \r\n", "auto", "empty"],
        ["这是说明文件，不是文章导出", "auto", "unrecognized"],
        ['{"entries":', "wallabag-json", "invalid"],
        ["[]", "omnivore-json", "no-items"],
        ['title,url,time_added\n无效,javascript:alert(1),', "pocket-csv", "no-items"],
    ]) {
        const result = await previewImport(content, format);
        assert.equal(result.issue, issue);
        assert.equal(result.rows.length, 0);
        assert.equal(result.duplicateCount, 0);
        if (issue === "unrecognized") assert.equal(result.format, null);
    }
    assert.deepEqual(h.calls, []);
    assert.equal(h.files.size, 0);
});

test("有效导入预览必须完成查重，不把查重故障伪装成全部重复或文件空态", async () => {
    const h = harness();
    h.failures.query = true;
    await assert.rejects(previewImport("title,url,time_added\n文章,https://example.com/valid,", "pocket-csv"));
    assert.ok(h.calls.some((call) => call.route === "/api/query/sql"));
    assert.equal(h.files.size, 0);
});

test("全部重复预览保留具体条目及真实查重数量，不产生恢复检查点", async () => {
    const h = harness();
    h.attrs.set(documentId(1), { "custom-clip-url": "https://example.com/duplicate", "custom-clip-status": "later" });
    const result = await previewImport("title,url,time_added\n已有文章,https://example.com/duplicate/#section,", "pocket-csv");
    assert.equal(result.issue, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].title, "已有文章");
    assert.equal(result.rows[0].duplicate, true);
    assert.equal(result.duplicateCount, 1);
    assert.equal(h.files.size, 0);
    assert.equal(h.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
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

function fastIndexWaits(context) {
    const nativeSetTimeout = globalThis.setTimeout;
    const delays = [];
    context.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
        if (delay > 0 && delay <= 2000) {
            delays.push(delay);
            return nativeSetTimeout(callback, 0, ...args);
        }
        return nativeSetTimeout(callback, delay, ...args);
    });
    return delays;
}

test("新建确切ID先落检查点，SQL延迟可见时有限等候后仅收录原文档", async (testContext) => {
    const delays = fastIndexWaits(testContext);
    const context = harness();
    let reads = 0;
    context.failures.readMeta = (id) => {
        assert.equal(context.files.get(IMPORT_PROGRESS_FILE).rows[0].docId, id);
        if (++reads <= 2) return { code: 0, data: [] };
    };
    const result = await runImport(context.plugin, [importRow("delayed")], importOptions);
    assert.equal(result.imported, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.docIds, [documentId(1)]);
    assert.equal(delays.length, 2);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], "done");
});

test("新建SQL始终不可见在有限等候后保留ID；恢复缺失不再等待或重建", async (testContext) => {
    const delays = fastIndexWaits(testContext);
    const context = harness();
    const row = importRow("missing-index");
    let reads = 0;
    context.failures.readMeta = () => { reads += 1; return { code: 0, data: [] }; };
    const first = await runImport(context.plugin, [row], importOptions);
    assert.equal(first.failed, 1);
    assert.equal(reads, 7);
    assert.equal(delays.length, 6);
    assert.equal(delays.reduce((sum, value) => sum + value, 0), 5000);
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).rows[0].reason, "missing");
    assert.deepEqual(first.failedItems, [{ url: row.url, docId: documentId(1) }]);
    const second = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: first.taskId, retryFailures: first.failedItems });
    assert.equal(second.failed, 1);
    assert.equal(reads, 8);
    assert.equal(delays.length, 6);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
    assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    context.failures.readMeta = null;
    const third = await runImport(context.plugin, [row], { ...importOptions, resumeTaskId: first.taskId, retryFailures: second.failedItems });
    assert.equal(third.imported, 1);
    assert.deepEqual(third.docIds, [documentId(1)]);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
});

test("新建等候期间读取失败或可见后的资格变化立即停止，不重试掩盖", async (testContext) => {
    const delays = fastIndexWaits(testContext);
    for (const change of ["read", "move", "source", "internal", "excluded"]) {
        const context = harness();
        let reads = 0;
        context.failures.readMeta = (id) => {
            reads += 1;
            if (reads === 1) return { code: 0, data: [] };
            if (change === "read") return { code: -1, msg: "read failed" };
            if (change === "move") context.documents.get(id).hpath = "/用户移动";
            if (change === "source") context.attrs.get(id)["custom-clip-url"] = "https://example.com/changed";
            if (change === "internal") context.attrs.get(id)["custom-clip-internal"] = "true";
            if (change === "excluded") context.attrs.get(id)["custom-clip-excluded"] = "true";
        };
        const waitsBefore = delays.length;
        const result = await runImport(context.plugin, [importRow(change)], importOptions);
        assert.equal(result.failed, 1, change);
        assert.equal(reads, 2, change);
        assert.equal(delays.length - waitsBefore, 1, change);
        assert.equal(context.files.get(IMPORT_PROGRESS_FILE).rows[0].reason, change === "read" ? "read" : change === "internal" ? "internal" : "changed", change);
        assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1, change);
        assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false, change);
    }
});

test("新建等候后已存在有效状态只修索引，保留等待期间用户手填及暂停语义", async (testContext) => {
    const delays = fastIndexWaits(testContext);
    const context = harness();
    const row = importRow("user-edited-during-indexing");
    const signal = { aborted: false };
    let reads = 0;
    context.failures.readMeta = (id) => {
        if (++reads === 1) {
            signal.aborted = true;
            return { code: 0, data: [] };
        }
        Object.assign(context.attrs.get(id), { "custom-clip-url": row.url, "custom-clip-status": "later", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "用户标签" });
    };
    const result = await runImport(context.plugin, [row, importRow("not-started")], { ...importOptions, signal });
    assert.equal(result.imported, 1);
    assert.equal(result.stopped, true);
    assert.equal(delays.length, 1);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], "later");
    assert.equal(context.attrs.get(documentId(1))["custom-clip-priority"], "5");
    assert.equal(context.attrs.get(documentId(1))["custom-clip-rating"], "4");
    assert.equal(context.attrs.get(documentId(1)).tags, "用户标签");
    assert.equal(context.calls.some((call) => call.route === "/api/attr/setBlockAttrs"), false);
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
    assert.deepEqual(context.files.get(IMPORT_PROGRESS_FILE).rows.map((entry) => entry.state), ["applied", "pending"]);
});

test("新建属性写后文档不可见保留失败与已写事实，不套用首建等候或重发写入", async (testContext) => {
    const delays = fastIndexWaits(testContext);
    const context = harness();
    context.failures.readMeta = () => {
        if (context.calls.some((call) => call.route === "/api/attr/setBlockAttrs")) return { code: 0, data: [] };
    };
    const result = await runImport(context.plugin, [importRow("disappeared-after-write")], importOptions);
    assert.equal(result.failed, 1);
    assert.equal(result.imported, 0);
    assert.equal(delays.length, 0);
    assert.equal(context.attrs.get(documentId(1))["custom-clip-status"], "done");
    assert.equal(context.calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
    assert.equal(context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length, 1);
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).rows[0].reason, "missing");
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

test("首次缺失检查点通过原始响应确认为空，SDK空串缓存不阻断导入和清理", async () => {
    const context = harness();
    context.plugin.data[IMPORT_PROGRESS_FILE] = "";
    const loadData = context.plugin.loadData;
    context.plugin.loadData = async (name) => {
        assert.notEqual(name, IMPORT_PROGRESS_FILE, "checkpoint reads must not use SDK cache fallback");
        return loadData(name);
    };
    assert.equal(await readImportProgress(context.plugin), null);
    const result = await runImport(context.plugin, [importRow("fresh-install")], importOptions);
    assert.equal(result.imported, 1);
    assert.equal((await readImportProgress(context.plugin)).taskId, result.taskId);
    await discardImportProgress(context.plugin, result.taskId, true);
    assert.equal(await readImportProgress(context.plugin), null);
});

test("存在但内容为空串的JSON检查点仍是损坏记录，不能当首次缺失覆盖", async () => {
    const context = harness();
    context.files.set(IMPORT_PROGRESS_FILE, "");
    await assert.rejects(readImportProgress(context.plugin), { reason: "invalid" });
    await assert.rejects(runImport(context.plugin, [importRow("invalid-string")], importOptions), { reason: "invalid" });
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE), "");
    assert.equal(context.attrs.size, 0);
});

test("实际读取到JSON null沿用无任务语义，允许新导入且不预写空检查点", async () => {
    const context = harness();
    context.files.set(IMPORT_PROGRESS_FILE, null);
    assert.equal(await readImportProgress(context.plugin), null);
    const result = await runImport(context.plugin, [importRow("cleared-task")], importOptions);
    assert.equal(result.imported, 1);
    assert.equal((await readImportProgress(context.plugin)).taskId, result.taskId);
    assert.equal(context.files.get(IMPORT_PROGRESS_FILE).version, 1);
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

// 执行真实弹窗的收尾函数，并接上上面的真实导入服务/检查点替身；不复制回执合并逻辑。
const dialogScript = readFileSync(new URL("../src/ui/ImportDialog.svelte", import.meta.url), "utf8").match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const dialogAst = ts.createSourceFile("ImportDialog.ts", dialogScript, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
const dialogFunctions = new Set(["progressFailure", "refreshProgress", "mergeSummaries", "progressEntryTitle", "startImport", "onFileChosen"]);
const dialogDerived = new Set(["unfinished", "resumable", "targetAvailable"]);
const dialogFlow = [];
for (const statement of dialogAst.statements) {
    if (ts.isFunctionDeclaration(statement) && dialogFunctions.has(statement.name?.text)) dialogFlow.push(statement.getText(dialogAst));
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
        if (!dialogDerived.has(declaration.name.getText(dialogAst))) continue;
        const expression = declaration.initializer.arguments[0].getText(dialogAst);
        dialogFlow.push(`Object.defineProperty(globalThis, ${JSON.stringify(declaration.name.getText(dialogAst))}, { get() { return ${expression}; } });`);
    }
}
const dialogFlowSource = ts.transpileModule(dialogFlow.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;

function dialogPreview(rows, fingerprint = importOptions.fingerprint) {
    return { rows, fingerprint, format: importOptions.format, duplicateCount: rows.filter((row) => row.duplicate).length };
}

async function dialogHarness(context, rows, { fingerprint = importOptions.fingerprint, afterRun } = {}) {
    const results = [];
    const notifications = [];
    const state = createContext({
        facade: { pluginInstance: context.plugin, notifyDataChanged: () => notifications.push("changed") },
        i18n: {}, t: (_i18n, key) => key, showMessage: () => {},
        loadImportProgress, summarizeImportProgress, ImportExecutionError, ImportProgressError, AbortController,
        previewImport, fingerprintImportSource, TextDecoder, MAX_IMPORT_BYTES: 32 * 1024 * 1024,
        runImport: async (...args) => {
            const result = await runImport(...args);
            results.push(result);
            await afterRun?.(result);
            return result;
        },
        preview: dialogPreview(rows, fingerprint),
        progressRecord: await loadImportProgress(context.plugin),
        notebooks: [{ id: notebookId, name: "读库" }], notebookId, folder: "/导入", format: importOptions.format,
        mounted: true, busy: false, notebookLoading: false, notebookError: false,
        progressLoaded: true, progressReadFailed: false, progressLoading: false, progressError: "",
        importConfirmed: true, resumeConfirmed: true, forceResetConfirmed: false,
        sourceFileName: "", previewPage: 1,
        phase: "preview", progress: 0, stopping: false, controller: null, summary: null, retryRows: [],
    });
    runInContext(dialogFlowSource, state);
    return { state, results, notifications };
}

function chosenFileEvent(content, { failRead = false } = {}) {
    const bytes = new TextEncoder().encode(content);
    return { target: { value: "selected-file", files: [{ name: "test-export.csv", size: bytes.byteLength, arrayBuffer: async () => {
        if (failRead) throw new Error("file permission denied");
        return bytes.buffer;
    } }] } };
}

test("导入弹窗空文件可预览原因，读取文件与查重失败分别反馈", async () => {
    for (const scenario of ["empty", "read", "duplicates", "progress"]) {
        const h = harness();
        const dialog = await dialogHarness(h, []);
        if (scenario === "duplicates") h.failures.query = true;
        if (scenario === "progress") h.failures.loadProgress = true;
        const event = chosenFileEvent(scenario === "empty" ? "" : "title,url,time_added\n文章,https://example.com/a,", { failRead: scenario === "read" });
        await dialog.state.onFileChosen(event);
        assert.equal(dialog.state.busy, false);
        assert.equal(event.target.value, "");
        assert.equal(dialog.state.sourceFileName, "test-export.csv");
        if (scenario === "empty") {
            assert.equal(dialog.state.phase, "preview");
            assert.equal(dialog.state.preview.issue, "empty");
            assert.equal(dialog.state.progressError, "");
            assert.equal(h.calls.length, 0);
        } else {
            assert.equal(dialog.state.phase, "pick");
            assert.equal(dialog.state.preview, null);
            assert.equal(dialog.state.progressError, scenario === "read" ? "import.fileReadFailed" : scenario === "duplicates" ? "import.previewFailed" : "import.progress.error.read");
            assert.equal(dialog.state.progressReadFailed, scenario === "progress");
        }
        assert.equal(h.files.size, 0);
    }
});

test("导入弹窗恢复先核对原文件，不能用空文件提示覆盖任务身份不符", async () => {
    const h = harness();
    const rows = [importRow("pending-original")];
    await runImport(h.plugin, rows, { ...importOptions, signal: { aborted: true } });
    const previous = structuredClone(h.files.get(IMPORT_PROGRESS_FILE));
    const dialog = await dialogHarness(h, rows);
    await dialog.state.onFileChosen(chosenFileEvent(""));
    assert.equal(dialog.state.phase, "pick");
    assert.equal(dialog.state.progressError, "import.progress.error.file");
    assert.equal(dialog.state.progressReadFailed, false);
    assert.equal(dialog.state.preview, null);
    assert.equal(dialog.state.progressRecord.taskId, previous.taskId);
    assert.deepEqual(h.files.get(IMPORT_PROGRESS_FILE), previous);
});

test("导入弹窗首次完成后先读回检查点，再显示本任务真实回执", async () => {
    const context = harness();
    const dialog = await dialogHarness(context, [importRow("first-a"), importRow("first-b")]);
    await dialog.state.startImport();
    assert.equal(dialog.state.phase, "done");
    assert.equal(dialog.state.summary.imported, 2);
    assert.equal(dialog.state.summary.failed, 0);
    assert.equal(dialog.state.summary.taskId, dialog.state.progressRecord.taskId);
    assert.equal(dialog.state.progressRecord.state, "finished");
    assert.equal(dialog.state.progressError, "");
    assert.equal(dialog.state.busy, false);
});

test("导入弹窗恢复后显示包含先前成功行的最新累计结果", async () => {
    const context = harness();
    const rows = [importRow("resume-a"), importRow("resume-b"), importRow("resume-c")];
    const controller = new AbortController();
    await runImport(context.plugin, rows, { ...importOptions, signal: controller.signal, onProgress: () => controller.abort() });
    const dialog = await dialogHarness(context, rows);
    assert.equal(summarizeImportProgress(dialog.state.progressRecord).applied, 1);
    await dialog.state.startImport();
    assert.equal(dialog.results[0].imported, 2);
    assert.equal(dialog.state.summary.imported, 3);
    assert.equal(dialog.state.summary.failed, 0);
    assert.equal(dialog.state.progressRecord.state, "finished");
    assert.equal(context.attrs.size, 3);
});

test("导入弹窗失败重试使用本轮失败ID，完成后移除旧失败反馈", async () => {
    const context = harness();
    const rows = [importRow("retry-a"), importRow("retry-b")];
    context.failures.writeIds.add(documentId(2));
    const dialog = await dialogHarness(context, rows);
    await dialog.state.startImport();
    assert.equal(dialog.state.summary.imported, 1);
    assert.equal(dialog.state.summary.failed, 1);
    assert.equal(dialog.state.retryRows[0].url, rows[1].url);
    context.failures.writeIds.clear();
    dialog.state.resumeConfirmed = true;
    await dialog.state.startImport(dialog.state.retryRows);
    assert.equal(dialog.results[1].imported, 1);
    assert.equal(dialog.state.summary.imported, 2);
    assert.equal(dialog.state.summary.failed, 0);
    assert.equal(dialog.state.summary.failedItems.length, 0);
    assert.equal(dialog.state.retryRows.length, 0);
    assert.equal(context.attrs.size, 2);
});

test("导入弹窗连续导入两个文件时不会显示上一任务计数", async () => {
    const context = harness();
    const dialog = await dialogHarness(context, [importRow("file-a1"), importRow("file-a2")]);
    await dialog.state.startImport();
    const firstTaskId = dialog.state.summary.taskId;
    dialog.state.preview = dialogPreview([importRow("file-b")], "b".repeat(64));
    dialog.state.importConfirmed = true;
    dialog.state.phase = "preview";
    await dialog.state.startImport();
    assert.notEqual(dialog.state.summary.taskId, firstTaskId);
    assert.equal(dialog.state.summary.imported, 1);
    assert.equal(dialog.state.summary.docIds.length, 1);
    assert.equal(dialog.state.summary.taskId, dialog.state.progressRecord.taskId);
    assert.equal(context.attrs.size, 3);
});

test("导入弹窗执行后检查点读回失败保留本轮回执，并明确阻止继续", async () => {
    const context = harness();
    await runImport(context.plugin, [importRow("previous-a"), importRow("previous-b")], importOptions);
    context.failures.writeIds.add(documentId(4));
    const rows = [importRow("readback-a"), importRow("readback-b")];
    const dialog = await dialogHarness(context, rows, {
        fingerprint: "b".repeat(64), afterRun: () => { context.failures.loadProgress = true; },
    });
    await dialog.state.startImport();
    assert.equal(dialog.state.phase, "done");
    assert.equal(dialog.state.summary.imported, 1);
    assert.equal(dialog.state.summary.failed, 1);
    assert.equal(dialog.state.summary.failedItems[0].docId, documentId(4));
    assert.equal(dialog.state.retryRows[0].url, rows[1].url);
    assert.equal(dialog.state.summary.taskId, dialog.results[0].taskId);
    assert.equal(dialog.state.progressReadFailed, true);
    assert.equal(dialog.state.progressLoaded, false);
    assert.equal(dialog.state.progressError, "import.progress.error.read");
    assert.equal(dialog.state.busy, false);
    const calls = context.calls.length;
    await dialog.state.startImport();
    assert.equal(context.calls.length, calls);
});

test("导入弹窗检查点被另一任务替换时不混入其结果，也不重试另一任务", async () => {
    const context = harness();
    context.failures.writeIds.add(documentId(2));
    const dialog = await dialogHarness(context, [importRow("changed-a"), importRow("changed-b")], {
        afterRun: () => {
            const replacement = structuredClone(context.files.get(IMPORT_PROGRESS_FILE));
            replacement.taskId = "20261016120000-zzzzzzz";
            replacement.fingerprint = "b".repeat(64);
            replacement.rows = replacement.rows.slice(0, 1);
            replacement.rows[0].hpath = "/导入/另一文件";
            replacement.state = "finished";
            context.files.set(IMPORT_PROGRESS_FILE, replacement);
        },
    });
    await dialog.state.startImport();
    assert.notEqual(dialog.state.summary.taskId, dialog.state.progressRecord.taskId);
    assert.equal(dialog.state.summary.failed, 1);
    assert.equal(dialog.state.retryRows.length, 1);
    assert.equal(dialog.state.progressError, "import.progress.error.changed");
    assert.equal(dialog.state.progressEntryTitle(dialog.state.progressRecord.rows[0], 0), "/导入/另一文件");
    dialog.state.importConfirmed = true;
    dialog.state.resumeConfirmed = true;
    const calls = context.calls.length;
    await dialog.state.startImport(dialog.state.retryRows);
    assert.equal(context.calls.length, calls);
});

test("导入检查点行只在指纹与格式都匹配时使用当前文件标题", async () => {
    const context = harness();
    const rows = [importRow("preview-title")];
    await runImport(context.plugin, rows, importOptions);
    const dialog = await dialogHarness(context, rows);
    const entry = dialog.state.progressRecord.rows[0];
    entry.hpath = "/导入/检查点路径";
    assert.equal(dialog.state.progressEntryTitle(entry, 0), "preview-title");
    dialog.state.preview.fingerprint = "b".repeat(64);
    assert.equal(dialog.state.progressEntryTitle(entry, 0), entry.hpath);
    dialog.state.preview.fingerprint = importOptions.fingerprint;
    dialog.state.preview.format = "wallabag-json";
    assert.equal(dialog.state.progressEntryTitle(entry, 0), entry.hpath);
    dialog.state.preview = null;
    assert.equal(dialog.state.progressEntryTitle(entry, 0), entry.hpath);
});

test("导入弹窗保存阶段失败时保留服务确认结果与错误，不被滞后检查点覆盖", async () => {
    const context = harness();
    context.failures.saveProgressAt = 4;
    const dialog = await dialogHarness(context, [importRow("save-failed")]);
    await dialog.state.startImport();
    assert.equal(dialog.state.phase, "done");
    assert.equal(dialog.state.summary.imported, 1);
    assert.equal(dialog.state.progressRecord.rows[0].state, "created");
    assert.equal(dialog.state.progressError, "import.progress.error.save");
});

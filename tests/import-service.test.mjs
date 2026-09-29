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
                source: "export const fetchPost = (...args) => globalThis.__gleanImportFetchPost(...args);",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { previewImport, runImport } = await import("../src/services/import-service.ts");

function harness({ createEmpty = false } = {}) {
    const attrs = new Map();
    const files = new Map();
    const calls = [];
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanImportFetchPost = (route, body, callback) => {
        calls.push({ route, body });
        let data;
        switch (route) {
            case "/api/filetree/createDocWithMd": {
                if (createEmpty) {
                    data = "";
                    break;
                }
                const id = `doc-${attrs.size + 1}`;
                attrs.set(id, body.tags ? { tags: body.tags } : {});
                data = id;
                break;
            }
            case "/api/attr/getBlockAttrs":
                data = attrs.get(body.id) ?? {};
                break;
            case "/api/attr/setBlockAttrs":
                attrs.set(body.id, { ...attrs.get(body.id), ...body.attrs });
                data = null;
                break;
            case "/api/attr/batchGetBlockAttrs":
                data = Object.fromEntries(body.ids.map((id) => [id, attrs.get(id) ?? {}]));
                break;
            case "/api/query/sql": {
                const docId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                const limit = Number(/LIMIT\s+(\d+)/i.exec(body.stmt)?.[1] ?? attrs.size);
                const offset = Number(/OFFSET\s+(\d+)/i.exec(body.stmt)?.[1] ?? 0);
                const ids = docId ? [docId] : [...attrs.keys()].slice(offset, offset + limit);
                data = ids.map((id) => ({ id, content: id, hpath: `/导入/${id}`, box: "box", updated: "20260929000000" }));
                break;
            }
            default:
                throw new Error(`未模拟端点：${route}`);
        }
        callback({ code: 0, data });
    };
    return { attrs, files, calls, plugin };
}

test("外部导入在建文档时带入 tags，首次收录写来源时间与状态并同步索引", async () => {
    const h = harness();
    const summary = await runImport(h.plugin, [{
        title: "旧文", url: "https://example.com/old", site: "example.com",
        time: "20200102030405", tags: ["稍后读", "技术"], status: "done", duplicate: false,
    }], { notebookId: "box", folder: "导入", format: "pocket-csv" });

    assert.deepEqual({ imported: summary.imported, failed: summary.failed, docIds: summary.docIds }, {
        imported: 1, failed: 0, docIds: ["doc-1"],
    });
    assert.equal(h.calls.find((call) => call.route === "/api/filetree/createDocWithMd").body.tags, "稍后读,技术");
    assert.deepEqual({
        tags: h.attrs.get("doc-1").tags,
        url: h.attrs.get("doc-1")["custom-clip-url"],
        time: h.attrs.get("doc-1")["custom-clip-time"],
        status: h.attrs.get("doc-1")["custom-clip-status"],
    }, { tags: "稍后读,技术", url: "https://example.com/old", time: "20200102030405", status: "done" });
    assert.equal(h.files.get("glean-index.json").clips["doc-1"].status, "done");
    assert.equal(h.calls.some((call) => call.route === "/api/attr/batchSetBlockAttrs"), false);

    // 模拟预览后重复点击导入：旧 duplicate=false 不能绕过执行期查重。
    const stalePreview = [{
        title: "旧文", url: "https://example.com/old", site: "example.com",
        time: "20200102030405", tags: ["技术"], status: "done", duplicate: false,
    }];
    const repeated = await runImport(h.plugin, stalePreview, { notebookId: "box", folder: "导入", format: "pocket-csv" });
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.skippedDuplicate, 1);
    assert.equal([...h.attrs.keys()].filter((id) => id.startsWith("doc-")).length, 1);

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
    const summary = await runImport(h.plugin, [row], { notebookId: "box", folder: "导入", format: "pocket-csv" });
    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.imported, 0);
    assert.equal(h.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), false);
    assert.ok(h.calls.some((call) => call.route === "/api/query/sql" && /OFFSET 500/.test(call.body.stmt)));
});

test("建文档返回空 ID 时计失败并推进进度", async () => {
    const h = harness({ createEmpty: true });
    const progress = [];
    const summary = await runImport(h.plugin, [{
        title: "失败项", url: "https://example.com/fail", site: "example.com",
        time: "", tags: [], status: "inbox", duplicate: false,
    }], {
        notebookId: "box", folder: "导入", format: "pocket-csv",
        onProgress: (done, total) => progress.push([done, total]),
    });
    assert.equal(summary.failed, 1);
    assert.deepEqual(progress, [[1, 1]]);
});

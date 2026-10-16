/** clip-store 服务级回归：用假的内核属性与插件 saveData 验证真实写入路径。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const apiStub = `
export const getBlockAttrs = (...args) => globalThis.__gleanTestApi.getBlockAttrs(...args);
export const batchGetBlockAttrs = (...args) => globalThis.__gleanTestApi.batchGetBlockAttrs(...args);
export const setBlockAttrs = (...args) => globalThis.__gleanTestApi.setBlockAttrs(...args);
export const querySql = (...args) => globalThis.__gleanTestApi.querySql(...args);
export const exportMdContent = (...args) => globalThis.__gleanTestApi.exportMdContent(...args);
export const kernelErrorKind = (error) => {
    const kind = error && error.kind;
    return ["permission", "network", "timeout", "protocol", "kernel", "aborted", "superseded"].includes(kind) ? kind : "kernel";
};
`;
const apiUrl = `data:text/javascript,${encodeURIComponent(apiStub)}`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "../api/client" && context.parentURL?.endsWith("/services/clip-store.ts")) {
            return { url: apiUrl, shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});

const { batchSetStatus, batchSetStatusDetailed, captureClip, captureDocument, findClipUrlConflict, listAnchorDocs, listClipDocs, listDocsByIds, measureClipBody, readClipContext, rebuildIndex, reconcileIndex, scanDocScopes, scanPreview, writeClip } = await import(
    "../src/services/clip-store.ts"
);
const { readClipAuthor, saveClipAuthor } = await import("../src/services/clip-store.ts");

interface FakeDoc {
    id: string;
    content: string;
    hpath: string;
    box: string;
    updated: string;
    tag?: string;
}

function sortDocs(a: FakeDoc, b: FakeDoc): number {
    return b.updated.localeCompare(a.updated) || b.id.localeCompare(a.id);
}

function harness() {
    const docs = new Map<string, FakeDoc>();
    const attrs = new Map<string, Record<string, string>>();
    const markdowns = new Map<string, string>();
    const saved = new Map<string, unknown>();
    const queries: string[] = [];
    const writes: { id: string; attrs: Record<string, string | null> }[] = [];
    let activeMarkdownExports = 0;
    let maxMarkdownExports = 0;
    let failAnchorQuery = false;
    let failSaveIndex = false;
    let failLoadIndex = false;
    let failPageOffset: number | null = null;
    let getAttrsGate: { remaining: number; entered: ReturnType<typeof Promise.withResolvers<void>>; released: ReturnType<typeof Promise.withResolvers<void>> } | null = null;
    const failWriteIds = new Set<string>();

    const plugin = {
        async loadData(name: string) {
            if (name === "glean-index.json" && failLoadIndex) throw new Error("index read failed");
            return structuredClone(saved.get(name) ?? null);
        },
        async saveData(name: string, value: unknown) {
            if (name === "glean-index.json" && failSaveIndex) throw new Error("index save failed");
            saved.set(name, structuredClone(value));
        },
    };
    (globalThis as Record<string, unknown>).__gleanTestApi = {
        async getBlockAttrs(id: string) {
            const gate = getAttrsGate;
            if (gate && gate.remaining > 0) {
                gate.remaining -= 1;
                if (gate.remaining === 0) gate.entered.resolve();
                await gate.released.promise;
            }
            return { ...(attrs.get(id) ?? {}) };
        },
        async batchGetBlockAttrs(ids: string[]) {
            return ids.filter((id) => docs.has(id)).map((id) => ({ id, attrs: { ...(attrs.get(id) ?? {}) } }));
        },
        async exportMdContent(id: string) {
            activeMarkdownExports += 1;
            maxMarkdownExports = Math.max(maxMarkdownExports, activeMarkdownExports);
            await Promise.resolve();
            activeMarkdownExports -= 1;
            return { content: markdowns.get(id) ?? "" };
        },
        async setBlockAttrs(id: string, patch: Record<string, string | null>) {
            if (failWriteIds.has(id)) throw new Error("write failed");
            writes.push({ id, attrs: { ...patch } });
            const next = { ...(attrs.get(id) ?? {}) };
            for (const [key, value] of Object.entries(patch)) {
                if (value === null) delete next[key];
                else next[key] = value;
            }
            attrs.set(id, next);
        },
        async querySql(sql: string) {
            queries.push(sql);
            if (failAnchorQuery && sql.includes("box IN")) throw new Error("SQL failed");
            const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? 0);
            const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 500);
            if (failPageOffset === offset && sql.includes("box IN")) throw new Error("page failed");
            const byId = sql.match(/WHERE id = '([^']+)'/);
            if (byId) return docs.has(byId[1]) ? [docs.get(byId[1])] : [];
            const byIds = sql.match(/id IN \(([^)]+)\)/);
            if (byIds) {
                const ids = [...byIds[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
                return ids.filter((id) => docs.has(id)).map((id) => docs.get(id));
            }
            if (sql.includes("box IN")) {
                const boxes = [...(sql.match(/box IN \(([^)]+)\)/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map((m) => m[1]);
                return [...docs.values()].filter((doc) => boxes.includes(doc.box)).sort(sortDocs).slice(offset, offset + limit);
            }
            if (sql.includes("tag LIKE")) return [...docs.values()].filter((doc) => Boolean(doc.tag?.includes("剪藏") || attrs.get(doc.id)?.tags?.includes("剪藏"))).sort(sortDocs).slice(offset, offset + limit);
            if (sql.includes("custom-clip-status")) {
                return [...docs.values()].filter((doc) => {
                    const ial = attrs.get(doc.id) ?? {};
                    return Boolean(ial["custom-clip-status"] || (sql.includes("custom-clip-url") && ial["custom-clip-url"]));
                }).sort(sortDocs).slice(offset, offset + limit);
            }
            return [];
        },
    };
    const add = (id: string, box: string, ial: Record<string, string> = {}, markdown = "", tag = "") => {
        docs.set(id, { id, content: id, hpath: `/${id}`, box, updated: "20260929120000", tag });
        attrs.set(id, ial);
        markdowns.set(id, markdown);
    };
    return {
        plugin, docs, attrs, saved, queries, writes, add, failWriteIds,
        maxMarkdownExports: () => maxMarkdownExports,
        setFailAnchorQuery: (value: boolean) => { failAnchorQuery = value; },
        setFailSaveIndex: (value: boolean) => { failSaveIndex = value; },
        setFailLoadIndex: (value: boolean) => { failLoadIndex = value; },
        setFailPageOffset: (value: number | null) => { failPageOffset = value; },
        holdNextTwoAttributeReads: () => {
            const entered = Promise.withResolvers<void>();
            const released = Promise.withResolvers<void>();
            getAttrsGate = { remaining: 2, entered, released };
            return { entered: entered.promise, release: () => released.resolve() };
        },
    };
}

interface IndexTestApi {
    querySql: (sql: string) => Promise<FakeDoc[]>;
    batchGetBlockAttrs: (ids: string[]) => Promise<Array<{ id: string; attrs: Record<string, string> }>>;
    exportMdContent: (id: string) => Promise<{ content: string }>;
}

/** 模拟范围 SQL 的 IAL/tag 索引落后于确切 ID 元数据与实时属性。 */
function delayScopeDiscovery(): IndexTestApi {
    const api = (globalThis as Record<string, unknown>).__gleanTestApi as IndexTestApi;
    const query = api.querySql;
    api.querySql = (sql) => sql.includes("ORDER BY") ? Promise.resolve([]) : query(sql);
    return api;
}

test("作者自动写入保护已有值及清空，显式作者编辑只改署名并读回", async () => {
    const current = harness();
    current.add("author-clip", "box-1", { "custom-clip-status": "later", "custom-clip-author": "手填公众号", "custom-clip-url": "https://source.example/a", "custom-clip-rating": "5" });
    for (const author of ["自动推断", ""]) {
        const result = await writeClip(current.plugin as never, "author-clip", { author, summary: "摘要" });
        assert.deepEqual(result.skippedKeys, ["custom-clip-author"]);
        assert.equal(result.attrs.author, "手填公众号");
    }
    const saved = await saveClipAuthor(current.plugin as never, "author-clip", "手填公众号", "  新署名  ");
    assert.deepEqual(saved, { snapshot: { raw: "新署名", author: "新署名" }, indexSyncFailed: false });
    assert.equal((await readClipContext("author-clip"))?.author, "新署名");
    assert.equal(current.attrs.get("author-clip")?.["custom-clip-status"], "later");
    assert.equal(current.attrs.get("author-clip")?.["custom-clip-rating"], "5");
    assert.equal(current.attrs.get("author-clip")?.["custom-clip-url"], "https://source.example/a");
    await saveClipAuthor(current.plugin as never, "author-clip", "新署名", "");
    assert.equal(current.attrs.get("author-clip")?.["custom-clip-author"], undefined);
    assert.equal((await readClipAuthor("author-clip")).author, "");
});

test("作者属性写入成功但索引保存失败时保留成功事实并返回待同步标记", async () => {
    const current = harness();
    current.add("author-index-pending", "box-1", { "custom-clip-status": "inbox", "custom-clip-author": "原作者" });
    current.setFailSaveIndex(true);
    const result = await saveClipAuthor(current.plugin as never, "author-index-pending", "原作者", "新作者");
    assert.deepEqual(result, { snapshot: { raw: "新作者", author: "新作者" }, indexSyncFailed: true });
    assert.equal(current.attrs.get("author-index-pending")?.["custom-clip-author"], "新作者");
    current.setFailSaveIndex(false);
    await reconcileIndex(current.plugin as never, { anchorNotebooks: ["box-1"] } as never);
});

test("按恢复检查点精确 ID 批量读取文档元数据并拒绝非法 ID", async () => {
    const current = harness();
    const first = "20261014000000-abcdefg";
    const second = "20261014000001-bcdefgh";
    current.add(first, "box-1");
    current.add(second, "box-2");
    const rows = await listDocsByIds([first, second, first]);
    assert.deepEqual(rows.map((row) => row.id).sort(), [first, second]);
    assert.match(current.queries.at(-1) ?? "", /id IN \('20261014000000-abcdefg','20261014000001-bcdefgh'\)/);
    const before = current.queries.length;
    await assert.rejects(listDocsByIds(["not-an-id"]));
    assert.equal(current.queries.length, before);
});

test("非法旧署名保持原属性，修正需原始值核对；非法输入不写入", async () => {
    const current = harness();
    current.add("legacy-author", "box-1", { "custom-clip-status": "inbox", "custom-clip-author": "旧\n署名" });
    assert.deepEqual(await readClipAuthor("legacy-author"), { raw: "旧\n署名", author: "" });
    await writeClip(current.plugin as never, "legacy-author", { author: "" });
    assert.equal(current.attrs.get("legacy-author")?.["custom-clip-author"], "旧\n署名");
    const count = current.writes.length;
    for (const author of ["x".repeat(121), "末尾\n", "隐形\u202E字符"]) {
        await assert.rejects(saveClipAuthor(current.plugin as never, "legacy-author", "旧\n署名", author), { reason: "invalid" });
    }
    assert.equal(current.writes.length, count);
    await assert.rejects(saveClipAuthor(current.plugin as never, "legacy-author", "", "合法"), { reason: "changed" });
    await saveClipAuthor(current.plugin as never, "legacy-author", "旧\n署名", "合法");
    assert.equal(current.attrs.get("legacy-author")?.["custom-clip-author"], "合法");
});

test("作者编辑在写入点复查来源手填与资格，不用早期读值覆盖", async () => {
    for (const change of [{ "custom-clip-author": "其他窗口手填" }, { "custom-clip-status": "" }, { "custom-clip-internal": "true" }]) {
        const current = harness();
        current.add("author-race", "box-1", { "custom-clip-status": "inbox", "custom-clip-author": "原值" });
        const api = (globalThis as Record<string, unknown>).__gleanTestApi as { getBlockAttrs: (id: string) => Promise<Record<string, string>> };
        const originalRead = api.getBlockAttrs;
        let reads = 0;
        api.getBlockAttrs = async (id) => {
            if (++reads === 2) Object.assign(current.attrs.get(id)!, change);
            return originalRead(id);
        };
        await assert.rejects(saveClipAuthor(current.plugin as never, "author-race", "原值", "新值"), { reason: "changed" });
        assert.equal(current.writes.length, 0);
    }
    const deleted = harness();
    deleted.add("deleted-author", "box-1", { "custom-clip-status": "inbox" });
    deleted.docs.delete("deleted-author");
    await assert.rejects(saveClipAuthor(deleted.plugin as never, "deleted-author", "", "新值"), { reason: "changed" });
    assert.equal(deleted.writes.length, 0);
});

test("作者派生投影可重建，只有署名的普通笔记不成为候选", async () => {
    const current = harness();
    current.add("author-article", "box-1", { "custom-clip-status": "reading", "custom-clip-author": "专栏名" });
    current.add("author-note", "box-1", { "custom-clip-author": "同名" });
    await saveClipAuthor(current.plugin as never, "author-article", "专栏名", "新专栏");
    current.saved.clear();
    const rebuilt = await reconcileIndex(current.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(rebuilt.clips["author-article"].author, "新专栏");
    assert.equal(rebuilt.clips["author-note"], undefined);
    assert.equal(rebuilt.candidates["author-note"], undefined);
});

test("同一文档多入口作者编辑串行核对，失败后队列仍可重试", async () => {
    const current = harness();
    current.add("parallel-author", "box-1", { "custom-clip-status": "inbox", "custom-clip-author": "原值" });
    const results = await Promise.allSettled([
        saveClipAuthor(current.plugin as never, "parallel-author", "原值", "第一入口"),
        saveClipAuthor(current.plugin as never, "parallel-author", "原值", "第二入口"),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(current.writes.length, 1);
    assert.equal(current.attrs.get("parallel-author")?.["custom-clip-author"], "第一入口");
    await saveClipAuthor(current.plugin as never, "parallel-author", "第一入口", "重新确认");
    assert.equal(current.attrs.get("parallel-author")?.["custom-clip-author"], "重新确认");
});

test("作者保存失败或读回发现外部修改时不冒充成功", async () => {
    const current = harness();
    current.add("failed-author", "box-1", { "custom-clip-status": "inbox", "custom-clip-author": "原值" });
    current.failWriteIds.add("failed-author");
    await assert.rejects(saveClipAuthor(current.plugin as never, "failed-author", "原值", "新值"), /write failed/);
    assert.equal(current.attrs.get("failed-author")?.["custom-clip-author"], "原值");
    current.failWriteIds.clear();
    const api = (globalThis as Record<string, unknown>).__gleanTestApi as { getBlockAttrs: (id: string) => Promise<Record<string, string>> };
    const originalRead = api.getBlockAttrs;
    let reads = 0;
    api.getBlockAttrs = async (id) => {
        if (++reads === 3) current.attrs.get(id)!["custom-clip-author"] = "外部变化";
        return originalRead(id);
    };
    await assert.rejects(saveClipAuthor(current.plugin as never, "failed-author", "原值", "新值"), { reason: "changed" });
    assert.equal(current.attrs.get("failed-author")?.["custom-clip-author"], "外部变化");
    assert.equal(current.writes.length, 1);
});

test("锚点笔记本 ID 正确加 SQL 字符串引号，URL-only 文档可被次锚点发现", async () => {
    const h = harness();
    h.add("url-only", "box-1", { "custom-clip-url": "https://example.com/a" });
    assert.deepEqual((await listAnchorDocs(["box-1", "box-2"])).map((doc) => doc.id), ["url-only"]);
    assert.match(h.queries[0], /box IN \('box-1','box-2'\)/);
    assert.deepEqual((await listClipDocs()).map((doc) => doc.id), ["url-only"]);
});

test("显式批量改状态覆盖旧值，持久索引与文档属性一致", async () => {
    const h = harness();
    h.add("clip-1", "box-1", { "custom-clip-status": "inbox", "custom-clip-priority": "5" });
    const changed = await batchSetStatus(h.plugin as never, ["clip-1"], "reading");
    assert.equal(changed, 1);
    assert.equal(h.attrs.get("clip-1")?.["custom-clip-status"], "reading");
    assert.equal(h.attrs.get("clip-1")?.["custom-clip-priority"], "5");
    const index = h.saved.get("glean-index.json") as { clips: Record<string, { status: string }> };
    assert.equal(index.clips["clip-1"].status, "reading");
});

test("属性写入成功但索引 saveData 失败时返回可恢复的索引同步结果", async () => {
    const h = harness();
    h.add("index-save-failure", "box-1", { "custom-clip-status": "inbox" });
    h.setFailSaveIndex(true);
    const result = await writeClip(h.plugin as never, "index-save-failure", { status: "reading" }, { forceStatus: true });
    assert.equal(result.attrs.status, "reading");
    assert.equal(result.indexSyncFailed, true);
    assert.equal(h.attrs.get("index-save-failure")?.["custom-clip-status"], "reading");
    assert.equal(h.saved.has("glean-index.json"), false);
});

test("索引损坏保护不会伪装增量同步成功，完整重建后恢复落盘", async () => {
    const h = harness();
    h.add("index-corrupt", "box-1", { "custom-clip-status": "inbox" });
    h.setFailLoadIndex(true);
    const result = await writeClip(h.plugin as never, "index-corrupt", { status: "done" }, { forceStatus: true });
    assert.equal(result.attrs.status, "done");
    assert.equal(result.indexSyncFailed, true);
    h.setFailLoadIndex(false);
    const rebuilt = await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(rebuilt.clips["index-corrupt"].status, "done");
    assert.equal((h.saved.get("glean-index.json") as { clips: Record<string, { status: string }> }).clips["index-corrupt"].status, "done");
    h.setFailSaveIndex(false);
});

test("批量状态动作只报告真正写成功的文档 ID，供打卡桥避免误报", async () => {
    const h = harness();
    h.add("first", "box-1", { "custom-clip-status": "reading" });
    h.add("failure", "box-1", { "custom-clip-status": "reading" });
    h.add("last", "box-1", { "custom-clip-status": "reading" });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    h.failWriteIds.add("failure");
    const result = await batchSetStatusDetailed(h.plugin as never, ["first", "failure", "last"], "done");
    assert.deepEqual(result, { ok: 2, succeeded: ["first", "last"] });
    assert.deepEqual(result.failures, [{ id: "failure", kind: "kernel" }]);
    assert.deepEqual(result.indexSyncFailed, []);
    assert.equal(h.attrs.get("first")?.["custom-clip-status"], "done");
    assert.equal(h.attrs.get("failure")?.["custom-clip-status"], "reading");
    assert.equal(h.attrs.get("last")?.["custom-clip-status"], "done");
    const index = h.saved.get("glean-index.json") as { clips: Record<string, { status: string }> };
    assert.equal(index.clips.first.status, "done");
    assert.equal(index.clips.failure.status, "reading");
    assert.equal(index.clips.last.status, "done");
});

test("编辑器上下文只显示已收录文档，并在属性被外部修改后读到新状态", async () => {
    const h = harness();
    h.add("normal", "box-1", {});
    h.add("clip", "box-1", { "custom-clip-status": "reading", "custom-clip-content-type": "fulltext", "custom-clip-url": "https://example.com/a" });
    assert.equal(await readClipContext("normal"), null);
    const first = await readClipContext("clip");
    assert.equal(first?.title, "clip");
    assert.equal(first?.status, "reading");
    assert.equal(first?.url, "https://example.com/a");
    h.attrs.get("clip")!["custom-clip-status"] = "done";
    assert.equal((await readClipContext("clip"))?.status, "done");
    assert.equal(h.saved.has("glean-index.json"), false);
});

test("仅授权覆盖状态时仍保护已有 URL 和优先级", async () => {
    const h = harness();
    h.add("clip-1", "box-1", {
        "custom-clip-status": "inbox", "custom-clip-url": "https://original.example", "custom-clip-priority": "5",
    });
    const result = await writeClip(h.plugin as never, "clip-1", {
        status: "later", url: "https://different.example", priority: 1,
    }, { forceStatus: true });
    assert.equal(result.attrs.status, "later");
    assert.equal(result.attrs.url, "https://original.example");
    assert.equal(result.attrs.priority, 5);
    assert.deepEqual(result.skippedKeys, ["custom-clip-url", "custom-clip-priority"]);
});

test("URL-only 文档首次收录补状态并保留来源 URL、时间和优先级", async () => {
    const h = harness();
    h.add("url-only", "box-1", {
        "custom-clip-url": "https://original.example/a",
        "custom-clip-time": "20240102030405",
        "custom-clip-priority": "4",
    });
    const result = await captureClip(h.plugin as never, "url-only", { url: "https://other.example/a" });
    assert.equal(result.captured, true);
    assert.equal(result.attrs.status, "inbox");
    assert.equal(result.attrs.url, "https://original.example/a");
    assert.equal(result.attrs.time, "20240102030405");
    assert.equal(result.attrs.priority, 4);
    assert.equal((h.saved.get("glean-index.json") as { clips: Record<string, unknown> }).clips["url-only"] !== undefined, true);
});

test("查重补查派生索引已知ID的真实属性，不依赖SQL IAL及时更新", async () => {
    const h = harness();
    const id = "20261004120000-aaaaaaa";
    h.add(id, "box-1", { "custom-clip-url": "https://example.com/new", "custom-clip-status": "done" });
    await writeClip(h.plugin as never, id, {});
    const api = (globalThis as Record<string, any>).__gleanTestApi;
    const query = api.querySql;
    api.querySql = (sql: string) => sql.includes("ial LIKE") ? Promise.resolve([]) : query(sql);
    const found = await findClipUrlConflict("https://example.com/new", undefined, h.plugin as never);
    assert.equal(found?.id, id);
    h.attrs.get(id)!["custom-clip-url"] = "https://manual.example/changed";
    assert.equal(await findClipUrlConflict("https://example.com/new", undefined, h.plugin as never), null);
    assert.equal((await findClipUrlConflict("https://manual.example/changed", undefined, h.plugin as never))?.id, id);
    assert.equal(await findClipUrlConflict("https://manual.example/changed", id, h.plugin as never), null);
});

test("查重已知ID全部覆盖SQL首个满页时仍读取后续分页，读取失败拒绝无冲突", async () => {
    const h = harness();
    const ids = Array.from({ length: 500 }, (_value, index) => `20261004120000-${index.toString(36).padStart(7, "0")}`);
    ids.forEach((id) => h.add(id, "box-1", { "custom-clip-status": "inbox", "custom-clip-url": `https://example.com/${id}` }));
    await reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    h.add("00000000000000-zzzzzzz", "box-1", { "custom-clip-status": "inbox", "custom-clip-url": "https://later.example/target" });
    assert.equal((await findClipUrlConflict("https://later.example/target", undefined, h.plugin as never))?.id, "00000000000000-zzzzzzz");
    assert.ok(h.queries.some((sql) => sql.includes("OFFSET 500")));
    await assert.rejects(findClipUrlConflict("https://none.example", undefined, { async loadData() { throw new Error("index read failed"); } } as never), /index read failed/);
    const api = (globalThis as Record<string, any>).__gleanTestApi;
    api.batchGetBlockAttrs = async () => { throw new Error("attribute read failed"); };
    await assert.rejects(findClipUrlConflict("https://none.example", undefined, h.plugin as never), /attribute read failed/);
});

test("显式收录发现同 URL 时返回冲突并保留第二份需显式允许", async () => {
    const h = harness();
    h.add("existing", "box-1", { "custom-clip-status": "done", "custom-clip-url": "https://example.com/a" });
    h.add("incoming", "box-1", {}, "# Incoming\n\n正文");
    const conflict = await findClipUrlConflict("HTTPS://EXAMPLE.COM/a#part", "incoming");
    assert.equal(conflict?.id, "existing");
    const blocked = await captureClip(h.plugin as never, "incoming", { url: "https://example.com/a" });
    assert.equal(blocked.captured, false);
    assert.equal(blocked.conflict?.id, "existing");
    assert.equal(h.attrs.get("incoming")?.["custom-clip-status"], undefined);
    const kept = await captureClip(h.plugin as never, "incoming", { url: "https://example.com/a", allowDuplicate: true });
    assert.equal(kept.captured, true);
    assert.equal(h.attrs.get("incoming")?.["custom-clip-status"], "inbox");
});

test("URL-only 全库扫描先进入待确认候选，显式收录后进入 inbox 队列", async () => {
    const h = harness();
    h.add("url-only", "outside-anchor", { "custom-clip-url": "https://example.com/old" });
    const before = await reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    assert.ok(before.candidates["url-only"]);
    assert.equal(before.clips["url-only"], undefined);

    const result = await captureClip(h.plugin as never, "url-only");
    assert.equal(result.captured, true);
    const after = h.saved.get("glean-index.json") as {
        candidates: Record<string, unknown>; clips: Record<string, { status: string; url: string }>;
    };
    assert.equal(after.candidates["url-only"], undefined);
    assert.equal(after.clips["url-only"].status, "inbox");
    assert.equal(after.clips["url-only"].url, "https://example.com/old");
});

test("新建导入文档的首次收录保留来源状态和时间，再次收录幂等", async () => {
    const h = harness();
    h.add("imported", "box-1");
    const first = await captureClip(h.plugin as never, "imported", {
        url: "https://example.com/imported", time: "20200102030405", status: "done", src: "import-pocket",
    });
    assert.equal(first.captured, true);
    assert.equal(first.attrs.time, "20200102030405");
    assert.equal(first.attrs.status, "done");
    const second = await captureClip(h.plugin as never, "imported", { status: "inbox" });
    assert.equal(second.captured, false);
    assert.equal(h.attrs.get("imported")?.["custom-clip-status"], "done");
    assert.equal(h.writes.length, 1);
});

test("并发首次收录基于相同旧属性快照时第二个状态写入被拒绝", async () => {
    const h = harness();
    h.add("capture-race", "box-1");
    const gate = h.holdNextTwoAttributeReads();
    const first = captureClip(h.plugin as never, "capture-race", { status: "done", src: "import-pocket" });
    const second = captureClip(h.plugin as never, "capture-race", { status: "later", src: "import-raindrop" });
    await gate.entered;
    gate.release();

    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal((rejected as PromiseRejectedResult).reason.reason, "changed");
    assert.equal(h.attrs.get("capture-race")?.["custom-clip-status"], "done");
    assert.equal(h.writes.length, 1);
});

test("对账 SQL 失败必须向上抛出且不保存不完整的索引", async () => {
    const h = harness();
    h.add("clip-1", "box-1", { "custom-clip-status": "inbox" });
    h.setFailAnchorQuery(true);
    await assert.rejects(reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never), /SQL failed/);
    assert.equal(h.saved.has("glean-index.json"), false);
});

test("同一插件并发打开读库只执行一次完整对账", async () => {
    const h = harness();
    h.add("concurrent-clip", "box-1", { "custom-clip-status": "inbox" });
    const [first, second] = await Promise.all([
        reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never),
        reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never),
    ]);
    assert.deepEqual(first, second);
    assert.equal(h.queries.length, 3);
});

for (const [name, scan] of [["面板对账", reconcileIndex], ["扫描预览", scanPreview], ["完整重建", rebuildIndex]] as const) {
    test(`${name}在 SQL IAL 延迟时补查已知 ID，完全使用实时属性和元数据`, async () => {
        const h = harness();
        const id = "20261016001000-abcdefg";
        h.add(id, "old-box", { "custom-clip-status": "inbox", "custom-clip-url": "https://old.example/article" });
        await writeClip(h.plugin as never, id, {});
        h.docs.get(id)!.content = "实时文章标题";
        h.docs.get(id)!.hpath = "/新目录/实时文章标题";
        h.docs.get(id)!.box = "moved-box";
        h.attrs.set(id, { "custom-clip-status": "reading", "custom-clip-url": "https://live.example/article", "custom-clip-rating": "5" });
        delayScopeDiscovery();
        const writesBefore = h.writes.length;

        const result = await scan(h.plugin as never, { anchorNotebooks: [] } as never);
        const index = h.saved.get("glean-index.json") as { clips: Record<string, { title: string; box: string; hpath: string; status: string; url: string; rating: number }> };
        assert.deepEqual(
            { title: index.clips[id].title, hpath: index.clips[id].hpath, box: index.clips[id].box, status: index.clips[id].status, url: index.clips[id].url, rating: index.clips[id].rating },
            { title: "实时文章标题", hpath: "/新目录/实时文章标题", box: "moved-box", status: "reading", url: "https://live.example/article", rating: 5 },
        );
        if (name === "扫描预览") {
            assert.equal((result as { total: number }).total, 1);
            assert.equal((result as { confirmed: number }).confirmed, 1);
        }
        assert.equal(h.writes.length, writesBefore);
    });
}

test("扫描期间已完成的增量写入使用锁内最新 ID 补查，不被旧扫描覆盖", async () => {
    const h = harness();
    const api = delayScopeDiscovery();
    const query = api.querySql;
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    api.querySql = async (sql) => {
        if (sql.includes("ORDER BY") && sql.includes("custom-clip-status")) {
            entered.resolve();
            await released.promise;
        }
        return query(sql);
    };
    const scanning = reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    await entered.promise;
    const id = "20261016001001-bcdefgh";
    h.add(id, "outside", { "custom-clip-status": "later", "custom-clip-url": "https://new.example/article" });
    const written = await writeClip(h.plugin as never, id, {});
    assert.equal(written.indexSyncFailed, undefined);
    released.resolve();
    const index = await scanning;
    assert.equal(index.clips[id].status, "later");
    assert.equal(index.clips[id].url, "https://new.example/article");
});

test("已知 ID 补查清理删除与失效候选，范围由 live IAL 键和标签决定", async () => {
    const h = harness();
    const ids = {
        deleted: "20261016002000-aaaaaaa", bodyMoved: "20261016002001-bbbbbbb", cleared: "20261016002002-ccccccc",
        staleTag: "20261016002003-ddddddd", liveTag: "20261016002004-eeeeeee", urlOnly: "20261016002005-fffffff",
        emptyUrlKey: "20261016002006-ggggggg", excluded: "20261016002007-hhhhhhh", internal: "20261016002008-iiiiiii",
        validInternal: "20261016002009-jjjjjjj",
    };
    const source = "https://body.example/source";
    for (const id of Object.values(ids)) h.add(id, "anchor", {}, source);
    h.attrs.set(ids.deleted, { "custom-clip-status": "inbox" });
    h.attrs.set(ids.cleared, { "custom-clip-status": "later" });
    h.attrs.set(ids.staleTag, { tags: "剪藏" });
    h.docs.get(ids.staleTag)!.tag = "#剪藏#";
    h.attrs.set(ids.liveTag, { tags: "剪藏" });
    h.docs.get(ids.liveTag)!.tag = "#旧标签#";
    h.attrs.set(ids.urlOnly, { "custom-clip-url": "https://live.example/only" });
    h.attrs.set(ids.emptyUrlKey, { "custom-clip-url": "" });
    h.attrs.set(ids.excluded, { "custom-clip-url": "https://live.example/excluded" });
    h.attrs.set(ids.internal, { "custom-clip-url": "https://live.example/internal" });
    h.attrs.set(ids.validInternal, { "custom-clip-status": "done" });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["anchor"] } as never);

    h.docs.delete(ids.deleted);
    for (const doc of h.docs.values()) doc.box = "outside";
    h.attrs.set(ids.cleared, {});
    h.attrs.set(ids.staleTag, { tags: "普通标签" });
    h.attrs.get(ids.excluded)!["custom-clip-excluded"] = "true";
    h.attrs.get(ids.internal)!["custom-clip-internal"] = "true";
    h.attrs.get(ids.validInternal)!["custom-clip-internal"] = "true";
    delayScopeDiscovery();
    const writesBefore = h.writes.length;
    const index = await reconcileIndex(h.plugin as never, { anchorNotebooks: ["anchor"] } as never);
    assert.deepEqual(Object.keys(index.clips), [ids.validInternal]);
    assert.deepEqual(Object.keys(index.candidates).sort(), [ids.liveTag, ids.urlOnly, ids.emptyUrlKey].sort());
    assert.ok(index.candidates[ids.liveTag].evidence.includes("clip-tag"));
    assert.ok(index.candidates[ids.emptyUrlKey].evidence.includes("source-line"));
    assert.equal(index.clips[ids.validInternal].internal, true);
    assert.equal(h.writes.length, writesBefore);
});

for (const failure of ["metadata", "attrs", "omitted-attrs", "body"] as const) {
    test(`已知 ID 补查 ${failure} 失败保留旧索引，不把不完整结果落盘`, async () => {
        const h = harness();
        const id = "20261016003000-abcdefg";
        h.add(id, "outside", failure === "body" ? { tags: "剪藏" } : { "custom-clip-status": "later" }, "https://body.example/article");
        await writeClip(h.plugin as never, id, {});
        const before = structuredClone(h.saved.get("glean-index.json"));
        const api = delayScopeDiscovery();
        const query = api.querySql;
        if (failure === "metadata") api.querySql = (sql) => sql.includes("id IN") ? Promise.reject(new Error("metadata failed")) : query(sql);
        if (failure === "attrs") api.batchGetBlockAttrs = async () => { throw new Error("attrs failed"); };
        if (failure === "omitted-attrs") api.batchGetBlockAttrs = async () => [];
        if (failure === "body") api.exportMdContent = async () => { throw new Error("body failed"); };
        await assert.rejects(reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never), failure === "omitted-attrs" ? /无法读取文档/ : /failed/);
        assert.deepEqual(h.saved.get("glean-index.json"), before);
    });
}

test("补查属性响应省略 ID 时复查已删除文档，可安全清理而不冒充读取失败", async () => {
    const h = harness();
    const id = "20261016004000-abcdefg";
    h.add(id, "outside", { "custom-clip-status": "inbox" });
    await writeClip(h.plugin as never, id, {});
    const api = delayScopeDiscovery();
    api.batchGetBlockAttrs = async () => {
        h.docs.delete(id);
        return [];
    };
    const index = await reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    assert.deepEqual(index.clips, {});
    assert.deepEqual(index.candidates, {});
});

test("补查期间出现更新一代扫描时旧任务不落盘，新任务可继续补查", async () => {
    const h = harness();
    const id = "20261016005000-abcdefg";
    h.add(id, "outside", { "custom-clip-status": "inbox" });
    await writeClip(h.plugin as never, id, {});
    const api = delayScopeDiscovery();
    const readAttrs = api.batchGetBlockAttrs;
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    let held = false;
    api.batchGetBlockAttrs = async (ids) => {
        if (ids.includes(id) && !held) {
            held = true;
            entered.resolve();
            await released.promise;
        }
        return readAttrs(ids);
    };
    const scanning = reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    const rejected = assert.rejects(scanning, /superseded/);
    await entered.promise;
    const newer = rebuildIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    released.resolve();
    await rejected;
    assert.equal((await newer).clips[id].status, "inbox");
});

test("派生缓存读取失败仍允许用完整扫描修复重建，不要求缓存先恢复可读", async () => {
    const h = harness();
    const id = "20261016006000-abcdefg";
    h.add(id, "anchor", { "custom-clip-status": "reading" });
    h.setFailLoadIndex(true);
    const index = await rebuildIndex(h.plugin as never, { anchorNotebooks: ["anchor"] } as never);
    assert.equal(index.clips[id].status, "reading");
    assert.equal((h.saved.get("glean-index.json") as { clips: Record<string, { status: string }> }).clips[id].status, "reading");
    h.setFailLoadIndex(false);
    const written = await writeClip(h.plugin as never, id, { status: "done" }, { forceStatus: true });
    assert.equal(written.indexSyncFailed, undefined);
});

test("大量普通笔记模板检查最多并发四篇，不退化为串行导出", async () => {
    const h = harness();
    for (let index = 0; index < 12; index += 1) h.add(`ordinary-${index}`, "box-1", {}, `普通笔记 ${index}`);
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(h.maxMarkdownExports(), 4);
});

test("扫描读取全部分页并按 ID 去重，跨笔记本标签也在范围中", async () => {
    const h = harness();
    h.add("anchor-a", "box-1", {}, "# 标题\n- [https://example.com/a](https://example.com/a)\n正文");
    h.add("anchor-b", "box-1", { "custom-clip-url": "https://example.com/b" });
    h.add("tagged", "box-outside", { tags: "剪藏" }, "", "#剪藏#");
    h.add("clip-outside", "box-outside", { "custom-clip-status": "later" });
    const scopes = await scanDocScopes({ anchorNotebooks: ["box-1"] } as never, 1);
    assert.equal(scopes.all.length, 4);
    assert.equal(scopes.all.filter((doc) => doc.id === "anchor-b").length, 1);
    assert.ok(scopes.tagged.some((doc) => doc.id === "tagged"));
    assert.ok(h.queries.some((sql) => sql.includes("OFFSET 1")));
    assert.ok(h.queries.every((sql) => !sql.includes("FROM blocks") || sql.includes("ORDER BY updated DESC, id DESC")));
});

test("完整对账清掉幽灵候选，已收录文章移出锚点仍由状态次锚点保留", async () => {
    const h = harness();
    h.add("old-candidate", "box-1", { "custom-clip-url": "https://example.com/candidate" });
    h.add("kept-clip", "box-1", { "custom-clip-status": "later", "custom-clip-url": "https://example.com/kept" });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    h.docs.delete("old-candidate");
    const kept = h.docs.get("kept-clip")!;
    kept.box = "box-outside";
    const after = await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(after.candidates["old-candidate"], undefined);
    assert.equal(after.clips["kept-clip"].box, "box-outside");
});

test("模板候选会由正文证据出现，普通笔记和模糊标签不成为候选", async () => {
    const h = harness();
    h.add("article", "box-1", {}, "# 文章\n- [https://example.com/article](https://example.com/article)\n正文");
    h.add("normal", "box-1", {}, "# 普通笔记\n参考 [网页](https://example.com/incidental)");
    h.add("fuzzy-tag", "box-outside", { tags: "剪藏技巧" }, "# 普通笔记", "#剪藏技巧#");
    const index = await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(index.candidates.article.url, "https://example.com/article");
    assert.ok(index.candidates.article.evidence.includes("clipper-template"));
    assert.equal(index.candidates.normal, undefined);
    assert.equal(index.candidates["fuzzy-tag"], undefined);
});

test("首启扫描预览区分已确认读库、候选、缺来源和普通笔记，且不写文章属性", async () => {
    const h = harness();
    h.add("confirmed", "box-1", { "custom-clip-status": "later", "custom-clip-url": "https://example.com/confirmed" });
    h.add("candidate", "box-1", { "custom-clip-url": "https://example.com/candidate" });
    h.add("missing-url", "box-1", { tags: "剪藏" }, "", "#剪藏#");
    h.add("ordinary", "box-1", {}, "# 普通笔记\n没有来源证据");

    const preview = await scanPreview(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);

    assert.deepEqual(
        {
            total: preview.total,
            confirmed: preview.confirmed,
            candidates: preview.candidates,
            candidatesMissingUrl: preview.candidatesMissingUrl,
            ordinary: preview.ordinary,
        },
        { total: 4, confirmed: 1, candidates: 2, candidatesMissingUrl: 1, ordinary: 1 },
    );
    assert.ok(preview.examples.confirmed.some((item) => item.id === "confirmed"));
    assert.ok(preview.examples.candidates.some((item) => item.id === "candidate"));
    assert.ok(preview.examples.candidates.some((item) => item.id === "missing-url"));
    assert.ok(preview.examples.ordinary.some((item) => item.id === "ordinary"));
    assert.equal(h.writes.length, 0);
    assert.ok(h.saved.has("glean-index.json"));
});

test("精确剪藏标签仍会读取正文模板，补出候选来源 URL", async () => {
    const h = harness();
    h.add(
        "tagged-template",
        "box-outside",
        { tags: "剪藏" },
        "---\ntitle: saved\n---\n# 标题\n- [https://example.com/tagged](https://example.com/tagged)\n正文",
        "#剪藏#",
    );
    const index = await reconcileIndex(h.plugin as never, { anchorNotebooks: [] } as never);
    assert.equal(index.candidates["tagged-template"].url, "https://example.com/tagged");
});

test("显式收录会解除此前的误报标记", async () => {
    const h = harness();
    h.add("restored", "box-1", { "custom-clip-excluded": "true" }, "# 标题\n\n本地正文");
    const result = await captureDocument(h.plugin as never, "restored");
    assert.equal(result.captured, true);
    assert.equal(h.attrs.get("restored")?.["custom-clip-excluded"], undefined);
    assert.equal(result.attrs.excluded, undefined);
});

test("后续分页失败会保留旧索引", async () => {
    const h = harness();
    h.add("seed", "box-1", { "custom-clip-status": "later" });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    const before = structuredClone(h.saved.get("glean-index.json"));
    for (let i = 0; i < 500; i += 1) h.add(`new-${String(i).padStart(3, "0")}`, "box-1", {}, "普通笔记");
    h.setFailPageOffset(500);
    await assert.rejects(reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never), /page failed/);
    assert.deepEqual(h.saved.get("glean-index.json"), before);
});

test("清空派生索引后仍能从文章属性重建", async () => {
    const h = harness();
    h.add("sovereign", "box-1", {
        "custom-clip-status": "later",
        "custom-clip-url": "https://example.com/sovereign",
    });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    h.saved.delete("glean-index.json");
    const rebuilt = await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    assert.equal(rebuilt.clips.sovereign.status, "later");
    assert.equal(rebuilt.clips.sovereign.url, "https://example.com/sovereign");
});

test("显式标记读完写入完成时间；归档与恢复不抹除（D-0028）", async () => {
    const h = harness();
    h.add("clip-1", "box-1", { "custom-clip-status": "reading" });
    await batchSetStatusDetailed(h.plugin as never, ["clip-1"], "done");
    const doneAt = h.attrs.get("clip-1")?.["custom-clip-done-time"];
    assert.match(doneAt ?? "", /^\d{14}$/);
    const index = h.saved.get("glean-index.json") as { clips: Record<string, { doneTime: string }> };
    assert.equal(index.clips["clip-1"].doneTime, doneAt);
    await batchSetStatus(h.plugin as never, ["clip-1"], "archived");
    assert.equal(h.attrs.get("clip-1")?.["custom-clip-done-time"], doneAt);
    await batchSetStatus(h.plugin as never, ["clip-1"], "later");
    assert.equal(h.attrs.get("clip-1")?.["custom-clip-done-time"], doneAt);
    await batchSetStatus(h.plugin as never, ["clip-1"], "done");
    assert.notEqual(h.attrs.get("clip-1")?.["custom-clip-done-time"], undefined);
});

test("正文测量显式触发：重算字数写回属性，空正文报告 missing（T-1727）", async () => {
    const h = harness();
    h.add("empty-body", "box-1", {
        "custom-clip-status": "inbox", "custom-clip-content-type": "fulltext",
        "custom-clip-url": "https://example.com/empty",
    }, "# 空正文\n- [https://example.com/empty](https://example.com/empty)");
    h.add("good-body", "box-1", {
        "custom-clip-status": "later", "custom-clip-content-type": "fulltext",
        "custom-clip-url": "https://example.com/good", "custom-clip-words": "7",
    }, "# 好正文\n- [https://example.com/good](https://example.com/good)\n正文内容 Hello world。");
    const empty = await measureClipBody(h.plugin as never, "empty-body");
    assert.equal(empty.missing, true);
    assert.equal(empty.words, 0);
    assert.equal(h.attrs.get("empty-body")?.["custom-clip-words"], "0");
    const good = await measureClipBody(h.plugin as never, "good-body");
    assert.equal(good.missing, false);
    assert.equal(good.words, 6);
    assert.equal(h.attrs.get("good-body")?.["custom-clip-words"], "6");
    const writesAfter = h.writes.filter((write) => write.id === "good-body").length;
    const rerun = await measureClipBody(h.plugin as never, "good-body");
    assert.equal(rerun.words, 6);
    assert.equal(h.writes.filter((write) => write.id === "good-body").length, writesAfter);
});

test("首次导入收录写入导出文件的可靠已读时间，无时间不伪造（D-0028）", async () => {
    const h = harness();
    h.add("with-read", "box-1");
    h.add("without-read", "box-1");
    const read = await captureClip(h.plugin as never, "with-read", {
        url: "https://example.com/read", status: "done", src: "import-pocket",
        time: "20200102030405", doneTime: "20200103040506", contentType: "link",
    });
    assert.equal(read.attrs.doneTime, "20200103040506");
    const unknown = await captureClip(h.plugin as never, "without-read", {
        url: "https://example.com/unknown", status: "done", src: "import-pocket",
        time: "20200102030405", contentType: "link",
    });
    assert.equal(unknown.attrs.doneTime, undefined);
});

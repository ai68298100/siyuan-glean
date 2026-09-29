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

const { batchSetStatus, batchSetStatusDetailed, captureClip, captureDocument, findClipUrlConflict, listAnchorDocs, listClipDocs, measureClipBody, readClipContext, reconcileIndex, scanDocScopes, writeClip } = await import(
    "../src/services/clip-store.ts"
);

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
    let failAnchorQuery = false;
    let failPageOffset: number | null = null;
    const failWriteIds = new Set<string>();

    const plugin = {
        async loadData(name: string) { return structuredClone(saved.get(name) ?? null); },
        async saveData(name: string, value: unknown) { saved.set(name, structuredClone(value)); },
    };
    (globalThis as Record<string, unknown>).__gleanTestApi = {
        async getBlockAttrs(id: string) { return { ...(attrs.get(id) ?? {}) }; },
        async batchGetBlockAttrs(ids: string[]) {
            return ids.filter((id) => docs.has(id)).map((id) => ({ id, attrs: { ...(attrs.get(id) ?? {}) } }));
        },
        async exportMdContent(id: string) { return { content: markdowns.get(id) ?? "" }; },
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
    return { plugin, docs, attrs, saved, queries, writes, add, failWriteIds, setFailAnchorQuery: (value: boolean) => { failAnchorQuery = value; }, setFailPageOffset: (value: number | null) => { failPageOffset = value; } };
}

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

test("批量状态动作只报告真正写成功的文档 ID，供打卡桥避免误报", async () => {
    const h = harness();
    h.add("first", "box-1", { "custom-clip-status": "reading" });
    h.add("failure", "box-1", { "custom-clip-status": "reading" });
    h.add("last", "box-1", { "custom-clip-status": "reading" });
    await reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never);
    h.failWriteIds.add("failure");
    const result = await batchSetStatusDetailed(h.plugin as never, ["first", "failure", "last"], "done");
    assert.deepEqual(result, { ok: 2, succeeded: ["first", "last"] });
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

test("对账 SQL 失败必须向上抛出且不保存不完整的索引", async () => {
    const h = harness();
    h.add("clip-1", "box-1", { "custom-clip-status": "inbox" });
    h.setFailAnchorQuery(true);
    await assert.rejects(reconcileIndex(h.plugin as never, { anchorNotebooks: ["box-1"] } as never), /SQL failed/);
    assert.equal(h.saved.has("glean-index.json"), false);
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

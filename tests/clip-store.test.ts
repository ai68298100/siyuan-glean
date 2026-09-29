/** clip-store 服务级回归：用假的内核属性与插件 saveData 验证真实写入路径。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const apiStub = `
export const getBlockAttrs = (...args) => globalThis.__gleanTestApi.getBlockAttrs(...args);
export const batchGetBlockAttrs = (...args) => globalThis.__gleanTestApi.batchGetBlockAttrs(...args);
export const setBlockAttrs = (...args) => globalThis.__gleanTestApi.setBlockAttrs(...args);
export const querySql = (...args) => globalThis.__gleanTestApi.querySql(...args);
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

const { batchSetStatus, captureClip, listAnchorDocs, listClipDocs, reconcileIndex, writeClip } = await import(
    "../src/services/clip-store.ts"
);

interface FakeDoc {
    id: string;
    content: string;
    hpath: string;
    box: string;
    updated: string;
}

function harness() {
    const docs = new Map<string, FakeDoc>();
    const attrs = new Map<string, Record<string, string>>();
    const saved = new Map<string, unknown>();
    const queries: string[] = [];
    const writes: { id: string; attrs: Record<string, string | null> }[] = [];
    let failAnchorQuery = false;

    const plugin = {
        async loadData(name: string) { return structuredClone(saved.get(name) ?? null); },
        async saveData(name: string, value: unknown) { saved.set(name, structuredClone(value)); },
    };
    (globalThis as Record<string, unknown>).__gleanTestApi = {
        async getBlockAttrs(id: string) { return { ...(attrs.get(id) ?? {}) }; },
        async batchGetBlockAttrs(ids: string[]) {
            return ids.map((id) => ({ id, attrs: { ...(attrs.get(id) ?? {}) } }));
        },
        async setBlockAttrs(id: string, patch: Record<string, string | null>) {
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
            const byId = sql.match(/WHERE id = '([^']+)'/);
            if (byId) return docs.has(byId[1]) ? [docs.get(byId[1])] : [];
            if (sql.includes("box IN")) {
                const boxes = [...(sql.match(/box IN \(([^)]+)\)/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map((m) => m[1]);
                return [...docs.values()].filter((doc) => boxes.includes(doc.box));
            }
            if (sql.includes("tag LIKE")) return [];
            if (sql.includes("custom-clip-status")) {
                return [...docs.values()].filter((doc) => {
                    const ial = attrs.get(doc.id) ?? {};
                    return Boolean(ial["custom-clip-status"] || (sql.includes("custom-clip-url") && ial["custom-clip-url"]));
                });
            }
            return [];
        },
    };
    const add = (id: string, box: string, ial: Record<string, string> = {}) => {
        docs.set(id, { id, content: id, hpath: `/${id}`, box, updated: "20260929120000" });
        attrs.set(id, ial);
    };
    return { plugin, docs, attrs, saved, queries, writes, add, setFailAnchorQuery: (value: boolean) => { failAnchorQuery = value; } };
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

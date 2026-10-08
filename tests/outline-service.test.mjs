import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-outline-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-outline-test:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanOutlineTestPost(...args);", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { loadReadingOutline } = await import("../src/services/outline-service.ts");
const { listChildBlocks } = await import("../src/api/client.ts");
const root = "20261004110000-root001";
const heading = (suffix, title, level = "h2", sort = 5) => ({ id: `20261004110000-${suffix}`, root_id: root, content: title, type: "h", subtype: level, sort });
const first = heading("zzzzzzz", "第一章", "h1");
const second = heading("aaaaaaa", "第二章");
const nested = heading("nnnnnnn", "引述标题", "h3");
const quoteId = "20261004110000-quote01";
const asChild = (row) => ({ id: row.id, type: row.type, subType: row.subtype, content: row.content });

function harness() {
    const queries = [];
    const childrenCalls = [];
    const children = new Map([
        [root, [asChild(first), { id: quoteId, type: "b" }, asChild(second)]],
        [quoteId, [asChild(nested)]],
    ]);
    let rows = [second, nested, first];
    let fail = "";
    globalThis.__gleanOutlineTestPost = async (route, body) => {
        if (route === fail) return { code: 1, msg: "probe failure" };
        if (route === "/api/query/sql") {
            queries.push(body.stmt);
            return { code: 0, data: rows };
        }
        if (route === "/api/block/getChildBlocks") {
            childrenCalls.push(body.id);
            return { code: 0, data: children.has(body.id) ? children.get(body.id) : [] };
        }
        throw new Error(`Unexpected route ${route}`);
    };
    return { queries, childrenCalls, children, setRows(value) { rows = value; }, fail(route) { fail = route; } };
}

test("大纲顺序来自原生子块，SQL 同 sort/随机 ID 不乱序，标题不再次遍历逻辑子块", async () => {
    const current = harness();
    const outline = await loadReadingOutline(root);
    assert.deepEqual(outline.map((item) => item.title), ["第一章", "引述标题", "第二章"]);
    assert.deepEqual(outline.map((item) => item.level), [1, 3, 2]);
    assert.deepEqual(current.childrenCalls, [root, quoteId]);
    assert.match(current.queries[0], /root_id = '20261004110000-root001'/);
});

test("大纲缺项、循环、跨根和源变化拒绝部分结果", async () => {
    for (const kind of ["missing", "cycle", "outside", "changed", "duplicate", "unknown-container"]) {
        const current = harness();
        if (kind === "missing") current.children.set(quoteId, []);
        if (kind === "cycle") current.children.set(quoteId, [{ id: root, type: "b" }]);
        if (kind === "outside") current.setRows([first, { ...nested, root_id: "20261004110000-other01" }, second]);
        if (kind === "changed") current.children.set(quoteId, [{ ...asChild(nested), content: "用户修改后的标题" }]);
        if (kind === "duplicate") current.children.set(quoteId, [asChild(first)]);
        if (kind === "unknown-container") current.children.set(root, [asChild(first), { id: quoteId, type: "unknown" }, asChild(second)]);
        await assert.rejects(loadReadingOutline(root), /Outline|outline|Invalid/);
    }
});

test("大纲请求失败、非法子块数组和重复 ID 正常拒绝", async () => {
    for (const route of ["/api/query/sql", "/api/block/getChildBlocks"]) {
        const current = harness();
        current.fail(route);
        await assert.rejects(loadReadingOutline(root), /probe failure/);
    }
    for (const response of [null, {}, [{ id: "bad", type: "h" }], [asChild(first), asChild(first)]]) {
        const current = harness();
        current.children.set(root, response);
        await assert.rejects(listChildBlocks(root), /Invalid child block/);
    }
    await assert.rejects(listChildBlocks("bad"), /parent ID/);
});

test("大纲满页游标重复拒绝，遍历深度超限不返回成功的截断结果", async () => {
    const current = harness();
    current.setRows(Array.from({ length: 500 }, (_, index) => heading(index.toString(36).padStart(7, "0"), "heading", "h2", index)));
    await assert.rejects(loadReadingOutline(root), /cursor did not advance/);
    assert.equal(current.childrenCalls.length, 0);
    const deep = harness();
    let parent = root;
    for (let index = 0; index < 130; index += 1) {
        const id = `20261004120000-${index.toString(36).padStart(7, "0")}`;
        deep.children.set(parent, [{ id, type: "b" }]);
        parent = id;
    }
    await assert.rejects(loadReadingOutline(root), /budget/);
});

test("大纲切文中断：当前响应完成后不继续请求旧文章容器", async () => {
    const current = harness();
    let active = true;
    const transport = globalThis.__gleanOutlineTestPost;
    globalThis.__gleanOutlineTestPost = async (...args) => {
        const response = await transport(...args);
        if (args[0] === "/api/block/getChildBlocks") active = false;
        return response;
    };
    await assert.rejects(loadReadingOutline(root, () => active), /superseded/);
    assert.deepEqual(current.childrenCalls, [root]);
});

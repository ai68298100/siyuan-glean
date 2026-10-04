import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    waitForBoot,
    shutdownKernel,
} from "./kernel-harness.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "127.0.0.1";
const MARKER = "glean-t3220-transaction-spike.json";
const CREATED_BY = "siyuan-glean-t3220-transaction-spike";
const WORKSPACE = path.join(os.tmpdir(), `siyuan-glean-t3220-${Date.now()}-${process.pid}`);
const SESSION = `glean-t3220-${process.pid}-${Date.now()}`;
const APP = "siyuan";
const PROBE_ASSET = "assets/t3220-real.png";
let nextRequestId = Date.now();

function probePng(red, green, blue) {
    const chunk = (type, data) => {
        const name = Buffer.from(type);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const checksum = Buffer.alloc(4);
        checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
        return Buffer.concat([length, name, data, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.from([0, red, green, blue, 255]))), chunk("IEND", Buffer.alloc(0)),
    ]);
}

function sqlQuote(value) {
    return String(value).replaceAll("'", "''");
}

function prepareProbeAsset() {
    const assetsDir = path.join(WORKSPACE, "data", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "t3220-real.png"), probePng(255, 0, 0));
}

async function choosePort() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const port = 30000 + Math.floor(Math.random() * 25000);
        try {
            await assertTestPortAvailable(HOST, port);
            return port;
        } catch (error) {
            if (attempt === 29) throw error;
        }
    }
    throw new Error("没有可用的回环测试端口");
}

async function dropHttpResponse(targetBase, route, payload, token) {
    const proxyPort = await choosePort();
    const body = JSON.stringify(payload);
    let upstreamDoneResolve;
    let upstreamDoneReject;
    const upstreamDone = new Promise((resolve, reject) => {
        upstreamDoneResolve = resolve;
        upstreamDoneReject = reject;
    });
    void upstreamDone.catch(() => undefined);
    const timeout = setTimeout(() => upstreamDoneReject(new Error("响应丢失代理未等到上游请求结束")), 20000);
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
            try {
                const upstream = await fetch(`${targetBase}${route}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": String(Buffer.byteLength(Buffer.concat(chunks))),
                        ...(token ? { Authorization: `Token ${token}` } : {}),
                    },
                    body: Buffer.concat(chunks),
                    signal: AbortSignal.timeout(20000),
                });
                assert.equal(upstream.ok, true, `上游 HTTP 状态 ${upstream.status}`);
                await upstream.arrayBuffer();
                upstreamDoneResolve();
                response.destroy();
            } catch (error) {
                upstreamDoneReject(error);
                response.destroy(error);
            }
        });
        request.on("error", (error) => upstreamDoneReject(error));
    });
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(proxyPort, HOST, resolve);
        });
        let receivedResponse = false;
        await fetch(`http://${HOST}:${proxyPort}${route}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": String(Buffer.byteLength(body)),
            },
            body,
            signal: AbortSignal.timeout(20000),
        }).then(() => { receivedResponse = true; }).catch(() => undefined);
        await upstreamDone;
        return !receivedResponse;
    } finally {
        clearTimeout(timeout);
        server.closeAllConnections();
        if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
}

async function putWorkspaceFile(base, token, filePath, bytes, filename, mime = "application/octet-stream") {
    const form = new FormData();
    form.append("path", filePath);
    form.append("file", new Blob([bytes], { type: mime }), filename);
    const response = await fetch(`${base}/api/file/putFile`, {
        method: "POST",
        headers: token ? { Authorization: `Token ${token}` } : {},
        body: form,
        signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.ok, true, `putFile HTTP ${response.status}`);
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`/api/file/putFile 非 JSON 响应: ${text.slice(0, 200)}`);
    }
    return payload;
}

async function getWorkspaceFile(base, token, filePath) {
    const response = await fetch(`${base}/api/file/getFile`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ path: filePath }),
        signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.ok, true, `getFile HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

async function until(label, check, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const value = await check();
            if (value) return value;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${label} 未在 ${timeoutMs}ms 内满足${lastError ? `：${lastError.message}` : ""}`);
}

async function sql(client, statement) {
    const response = await client.api("/api/query/sql", { stmt: statement });
    assert.equal(response.code, 0, `SQL 查询失败: ${JSON.stringify(response)}`);
    assert.ok(Array.isArray(response.data), `SQL 查询未返回数组: ${JSON.stringify(response)}`);
    for (const row of response.data) {
        assert.equal(typeof row.id, "string", `SQL 查询缺少块身份: ${JSON.stringify(row)}`);
    }
    return response.data;
}

async function readBlockDom(client, id) {
    const data = await client.apiChecked("/api/block/getBlockDOM", { id });
    const dom = typeof data === "string" ? data : data?.dom;
    if (typeof dom !== "string" || !dom) throw new Error(`/api/block/getBlockDOM 未返回 dom: ${JSON.stringify(data)}`);
    return dom;
}

async function readBlockKramdown(client, id) {
    const data = await client.apiChecked("/api/block/getBlockKramdown", { id });
    const kramdown = typeof data === "string" ? data : data?.kramdown;
    if (typeof kramdown !== "string") throw new Error(`/api/block/getBlockKramdown 未返回 kramdown: ${JSON.stringify(data)}`);
    return kramdown;
}

async function readBlockDomWithEmbed(client, id) {
    const data = await client.apiChecked("/api/block/getBlockDOMWithEmbed", { id });
    const dom = typeof data === "string" ? data : data?.dom;
    if (typeof dom !== "string" || !dom) throw new Error(`/api/block/getBlockDOMWithEmbed 未返回 dom: ${JSON.stringify(data)}`);
    return dom;
}

function readNativeRelations(root, rootId) {
    assert.match(root.box, /^\d{14}-[0-9a-z]{7}$/);
    assert.equal(typeof root.path, "string");
    const dataDirectory = path.resolve(WORKSPACE, "data");
    const filename = path.resolve(dataDirectory, root.box, `.${root.path}`);
    const relative = path.relative(dataDirectory, filename);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "原生树路径越出隔离工作区");
    const tree = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(tree.ID, rootId, "原生树根身份与索引不一致");
    const relations = new Map();
    function visit(node, parent, previous = "", next = "") {
        if (node.ID) {
            assert.equal(relations.has(node.ID), false, `原生树存在重复 ID ${node.ID}`);
            relations.set(node.ID, { native_parent: parent, native_previous: previous, native_next: next });
        }
        const children = (node.Children ?? []).filter((child) => child.ID);
        for (const child of node.Children ?? []) {
            const position = children.indexOf(child);
            visit(child, node.ID || parent, children[position - 1]?.ID || "", children[position + 1]?.ID || "");
        }
    }
    visit(tree, "");
    return relations;
}

async function readSnapshot(client, rootId) {
    const rows = await until(`文档 ${rootId} 的块索引`, async () => {
        const result = await sql(client, `SELECT id, parent_id, type, subtype, content, markdown, ial, sort, root_id, box, path FROM blocks WHERE root_id = '${sqlQuote(rootId)}' ORDER BY sort ASC, id ASC`);
        return result.length > 0 ? result : undefined;
    });
    const attrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: rootId });
    const root = rows.find((row) => row.id === rootId);
    assert.ok(root, "块索引缺少根文档");
    const native = readNativeRelations(root, rootId);
    assert.deepEqual([...native.keys()].sort(), rows.map((row) => row.id).sort(), "原生树与 SQL 块身份集合不一致");
    const enrichedRows = await Promise.all(rows.map(async (row) => {
        const sibling = await client.apiChecked("/api/block/getBlockSiblingID", { id: row.id });
        return { ...row, ...native.get(row.id), sibling_parent: sibling.parent, previous_id: sibling.previous, next_id: sibling.next };
    }));
    return {
        rows: enrichedRows,
        attrs: { ...attrs },
        ids: rows.map((row) => row.id).sort(),
    };
}

function rowById(snapshot, id) {
    const row = snapshot.rows.find((item) => item.id === id);
    assert.ok(row, `快照缺少块 ${id}`);
    return row;
}

function descendantIds(snapshot, rootId) {
    const descendants = new Set([rootId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const row of snapshot.rows) {
            if (descendants.has(row.native_parent) && !descendants.has(row.id)) {
                descendants.add(row.id);
                changed = true;
            }
        }
    }
    return descendants;
}

async function readBlockOutcome(client, id) {
    try {
        const response = await client.api("/api/block/getBlockDOM", { id });
        const dom = typeof response.data === "string" ? response.data : response.data?.dom;
        const hasContent = typeof dom === "string" && dom.length > 0;
        return {
            code: response.code ?? null,
            message: response.msg ?? null,
            hasContent,
            state: response.code === 0 ? (hasContent ? "readable" : "empty") : "rejected",
        };
    } catch (error) {
        return {
            code: null,
            message: error instanceof Error ? error.message : String(error),
            state: "transport-error",
        };
    }
}

function assertNativeStructure(before, after, label) {
    assert.deepEqual(after.ids, before.ids, `${label} 改变了块身份集合`);
    for (const row of before.rows) {
        const next = rowById(after, row.id);
        for (const key of ["native_parent", "native_previous", "native_next"]) {
            assert.equal(next[key], row[key], `${label} 改变了 ${row.id} 的 ${key}`);
        }
    }
}

function comparableIal(raw) {
    const values = {};
    for (const match of String(raw ?? "").matchAll(/([^\s=]+)="((?:\\.|[^"\\])*)"/g)) {
        if (match[1] !== "updated") values[match[1]] = match[2];
    }
    return values;
}

function mutateDom(dom, marker) {
    const escaped = marker.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const contentEditable = /(<[^>]*contenteditable=["']?true["']?[^>]*>)([\s\S]*?)(<\/[^>]+>)/i;
    if (contentEditable.test(dom)) {
        return dom.replace(contentEditable, `$1$2 ${escaped}$3`);
    }
    const closing = dom.lastIndexOf("</div>");
    if (closing < 0) throw new Error("无法在原生 BlockDOM 中定位可编辑正文");
    return `${dom.slice(0, closing)}${escaped}${dom.slice(closing)}`;
}

function transactionBody(transactions, session = SESSION) {
    return { reqId: ++nextRequestId, app: APP, session, transactions };
}

function updateOperation(id, data) {
    return { action: "update", id, data };
}

function transactionRootId(transactions) {
    for (const transaction of Array.isArray(transactions) ? transactions : [transactions]) {
        for (const operation of transaction?.doOperations || []) {
            if (typeof operation?.rootID === "string") return operation.rootID;
        }
    }
    return "";
}

async function postTransaction(client, doOperations, undoOperations, session = SESSION) {
    return postTransactions(client, [{ doOperations, undoOperations }], session);
}

async function postTransactions(client, transactions, session = SESSION) {
    return client.api("/api/transactions", transactionBody(transactions, session));
}

async function undo(client, rootId, session = SESSION) {
    const response = await client.api("/api/transactions/undo", { rootID: rootId, app: APP, session });
    assert.equal(response.code, 0, `undo 失败: ${JSON.stringify(response)}`);
    assert.notEqual(response.data?.failed, true, `undo replay 失败: ${JSON.stringify(response)}`);
    return response;
}

async function redo(client, rootId, session = SESSION) {
    const response = await client.api("/api/transactions/redo", { rootID: rootId, app: APP, session });
    assert.equal(response.code, 0, `redo 失败: ${JSON.stringify(response)}`);
    assert.notEqual(response.data?.failed, true, `redo replay 失败: ${JSON.stringify(response)}`);
    return response;
}

async function undoState(client, rootId) {
    return client.apiChecked("/api/transactions/undoState", { rootID: rootId });
}

async function createDoc(client, box, title, markdown) {
    return client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: `/T3220/${title}`,
        markdown,
    });
}

async function findLeaf(client, rootId, offset = 0, content = "") {
    return until(`文档 ${rootId} 的第 ${offset + 1} 个段落块`, async () => {
        const rows = await sql(client, `SELECT id, parent_id, type, subtype, content, markdown, ial, sort, root_id, box FROM blocks WHERE root_id = '${sqlQuote(rootId)}' AND type = 'p' ORDER BY sort ASC, id ASC`);
        return content ? rows.find((row) => row.content === content) : rows[offset];
    });
}

async function findHeading(client, rootId, offset = 0, content = "") {
    return until(`文档 ${rootId} 的第 ${offset + 1} 个标题块`, async () => {
        const rows = await sql(client, `SELECT id, parent_id, type, subtype, content, markdown, ial, sort, root_id, box FROM blocks WHERE root_id = '${sqlQuote(rootId)}' AND type = 'h' ORDER BY sort ASC, id ASC`);
        return content ? rows.find((row) => row.content === content) : rows[offset];
    });
}

async function findContainer(client, rootId) {
    return until(`文档 ${rootId} 的容器块`, async () => {
        const rows = await sql(client, `SELECT id, parent_id, type, subtype, content, markdown, ial, sort, root_id, box FROM blocks WHERE root_id = '${sqlQuote(rootId)}' ORDER BY sort ASC, id ASC`);
        return rows.find((row) => ["l", "b", "t"].includes(row.type) && rows.some((child) => child.parent_id === row.id));
    });
}

async function waitForMarker(client, id, marker, present) {
    return until(`块 ${id} ${present ? "出现" : "移除"} ${marker}`, async () => {
        const dom = await readBlockDom(client, id);
        return (dom.includes(marker) === present) ? dom : undefined;
    });
}

async function runUpdateBlockProbe(client, box) {
    const docId = await createDoc(client, box, "update-block", "# update-block\n\n原始段落，保留链接 [目标](https://example.org/update)。\n\n第二段。");
    const before = await readSnapshot(client, docId);
    const leaf = await findLeaf(client, docId);
    const beforeAttrs = { ...before.attrs };
    const beforeState = await undoState(client, docId);
    const marker = "T3220-UPDATE-BLOCK";
    const response = await client.api("/api/block/updateBlock", {
        id: leaf.id,
        dataType: "markdown",
        data: `${leaf.markdown} ${marker}`,
    });
    assert.equal(response.code, 0, `updateBlock 失败: ${JSON.stringify(response)}`);
    await until("updateBlock 写入可读回", async () => (await readBlockKramdown(client, leaf.id)).includes(marker));
    const after = await until("updateBlock 索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const afterState = await undoState(client, docId);
    assert.deepEqual(after.ids, before.ids, "updateBlock 改变了文档块 ID 集合");
    assert.deepEqual(after.attrs, beforeAttrs, "updateBlock 意外改动了根块属性");
    const targetAfter = rowById(after, leaf.id);
    assert.match(String(targetAfter.markdown), /T3220-UPDATE-BLOCK/);
    await client.apiChecked("/api/block/updateBlock", { id: leaf.id, dataType: "markdown", data: leaf.markdown });
    await until("updateBlock 清理完成", async () => !(await readBlockKramdown(client, leaf.id)).includes(marker));
    return {
        docId,
        leafId: leaf.id,
        beforeState,
        afterState,
        idsPreserved: true,
        rootAttrsPreserved: true,
        undoChanged: beforeState.canUndo !== afterState.canUndo || beforeState.canRedo !== afterState.canRedo,
    };
}

async function runTransactionUndoRedoProbe(client, box) {
    const targetId = await createDoc(client, box, "transaction-target", "# transaction-target\n\n被引用的目标块。");
    const complexMarkdown = [
        "# transaction-undo",
        "",
        "根段落，包含 [目标链接](https://example.org/transaction)。",
        "",
        "## 复杂结构",
        "",
        "- 外层列表",
        "  - 嵌套列表",
        "",
        "> 块引用内容",
        "",
        "```js",
        "const probe = true;",
        "```",
        "",
        "$$",
        "x^2 + y^2 = z^2",
        "$$",
        "",
        "| 列一 | 列二 |",
        "| --- | --- |",
        "| A | B |",
        "",
        "![测试图片](assets/t3220-missing.png)",
        "",
        `(( ${targetId} "跨文档引用" ))`,
        "",
        "普通叶段落。",
        "",
        "另一个段落。",
    ].join("\n");
    const docId = await createDoc(client, box, "transaction-undo", complexMarkdown);
    await client.apiChecked("/api/attr/setBlockAttrs", {
        id: docId,
        attrs: {
            "custom-clip-url": "https://example.org/t3220",
            "custom-clip-status": "later",
            "custom-probe-root": "keep",
        },
    });
    const leaf = await findLeaf(client, docId, 0, "普通叶段落。");
    await client.apiChecked("/api/attr/setBlockAttrs", {
        id: leaf.id,
        attrs: { "custom-probe-leaf": "keep", memo: "probe memo" },
    });
    const attributedBefore = await until("叶块 IAL 索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).ial).includes("custom-probe-leaf=\"keep\"") ? snapshot : undefined;
    });
    const beforeDom = await readBlockDom(client, leaf.id);
    const marker = "T3220-TRANSACTION";
    const changedDom = mutateDom(beforeDom, marker);
    const beforeState = await undoState(client, docId);
    const response = await postTransaction(client, [updateOperation(leaf.id, changedDom)], [updateOperation(leaf.id, beforeDom)]);
    assert.equal(response.code, 0, `transactions 写入失败: ${JSON.stringify(response)}`);
    await waitForMarker(client, leaf.id, marker, true);
    const afterApply = await until("事务索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const stateAfterApply = await undoState(client, docId);
    assert.deepEqual(afterApply.ids, attributedBefore.ids, "事务更新改变了复杂文档块 ID 集合");
    assertNativeStructure(attributedBefore, afterApply, "复杂文档叶块更新");
    assert.deepEqual(afterApply.attrs, attributedBefore.attrs, "事务更新改变了根块属性");
    assert.deepEqual(comparableIal(rowById(afterApply, leaf.id).ial), comparableIal(rowById(attributedBefore, leaf.id).ial), "事务更新改变了叶块用户 IAL");
    const undoResponse = await undo(client, docId);
    assert.equal(undoResponse.code, 0, `transactions/undo 外层失败: ${JSON.stringify(undoResponse)}`);
    assert.equal(undoResponse.data?.failed, undefined, `transactions/undo 内层失败: ${JSON.stringify(undoResponse)}`);
    await waitForMarker(client, leaf.id, marker, false);
    const afterUndo = await readSnapshot(client, docId);
    const stateAfterUndo = await undoState(client, docId);
    assert.deepEqual(afterUndo.ids, attributedBefore.ids, "undo 改变了复杂文档块 ID 集合");
    assertNativeStructure(attributedBefore, afterUndo, "复杂文档叶块 undo");
    assert.deepEqual(afterUndo.attrs, attributedBefore.attrs, "undo 改变了根块属性");
    const redoResponse = await redo(client, docId);
    assert.equal(redoResponse.code, 0, `transactions/redo 外层失败: ${JSON.stringify(redoResponse)}`);
    assert.equal(redoResponse.data?.failed, undefined, `transactions/redo 内层失败: ${JSON.stringify(redoResponse)}`);
    await waitForMarker(client, leaf.id, marker, true);
    const afterRedo = await readSnapshot(client, docId);
    assert.deepEqual(afterRedo.ids, attributedBefore.ids, "redo 改变了复杂文档块 ID 集合");
    assertNativeStructure(attributedBefore, afterRedo, "复杂文档叶块 redo");
    assert.deepEqual(afterRedo.attrs, attributedBefore.attrs, "redo 改变了根块属性");
    const undoAgain = await undo(client, docId);
    assert.equal(undoAgain.code, 0);
    assert.equal(undoAgain.data?.failed, undefined, `第二次 undo 内层失败: ${JSON.stringify(undoAgain)}`);
    await waitForMarker(client, leaf.id, marker, false);
    return {
        docId,
        targetId,
        leafId: leaf.id,
        beforeState,
        stateAfterApply,
        stateAfterUndo,
        responseData: response.data,
        idsPreserved: true,
        ialPreserved: true,
        rootAttrsPreserved: true,
        complexStructureSnapshot: attributedBefore.rows.length >= 10,
        crossDocumentReferencePreserved: attributedBefore.rows.some((row) => String(row.markdown).includes(targetId)),
        undoRedoRoundTrip: true,
    };
}

async function runContainerUpdateProbe(client, box) {
    const docId = await createDoc(client, box, "container-update", "# container-update\n\n- 外层列表\n  - 嵌套列表\n  - 第二项\n\n普通段落。");
    const container = await findContainer(client, docId);
    const child = await until("容器子块", async () => {
        const rows = await sql(client, `SELECT id, parent_id, type, subtype, content, markdown, ial, sort, root_id, box FROM blocks WHERE root_id = '${sqlQuote(docId)}' AND parent_id = '${sqlQuote(container.id)}' ORDER BY sort ASC, id ASC`);
        return rows[0];
    });
    await client.apiChecked("/api/attr/setBlockAttrs", { id: child.id, attrs: { "custom-probe-child": "keep" } });
    const before = await until("容器子块 IAL 索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, child.id).ial).includes("custom-probe-child=\"keep\"") ? snapshot : undefined;
    });
    const beforeDom = await readBlockDom(client, container.id);
    const marker = "T3220-CONTAINER";
    const changedDom = mutateDom(beforeDom, marker);
    const response = await postTransaction(client, [updateOperation(container.id, changedDom)], [updateOperation(container.id, beforeDom)]);
    assert.equal(response.code, 0, `容器事务写入失败: ${JSON.stringify(response)}`);
    await waitForMarker(client, container.id, marker, true);
    const after = await until("容器事务索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, container.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const beforeRows = new Map(before.rows.map((row) => [row.id, row]));
    const afterRows = new Map(after.rows.map((row) => [row.id, row]));
    assertNativeStructure(before, after, "容器更新");
    assert.deepEqual([...afterRows.keys()].sort(), [...beforeRows.keys()].sort(), "容器事务改变了块 ID 集合");
    for (const [id, beforeRow] of beforeRows) {
        const afterRow = afterRows.get(id);
        assert.equal(afterRow?.type, beforeRow.type, `容器事务改变了 ${id} 的块类型`);
        assert.equal(afterRow?.parent_id, beforeRow.parent_id, `容器事务改变了 ${id} 的父块`);
        assert.equal(afterRow?.previous_id, beforeRow.previous_id, `容器事务改变了 ${id} 的前邻接`);
        assert.equal(afterRow?.next_id, beforeRow.next_id, `容器事务改变了 ${id} 的后邻接`);
        assert.deepEqual(comparableIal(afterRow?.ial), comparableIal(beforeRow.ial), `容器事务改变了 ${id} 的用户 IAL`);
    }
    const undoResponse = await undo(client, docId);
    assert.equal(undoResponse.code, 0);
    assert.equal(undoResponse.data?.failed, undefined, `容器 undo 内层失败: ${JSON.stringify(undoResponse)}`);
    await waitForMarker(client, container.id, marker, false);
    const redoResponse = await redo(client, docId);
    assert.equal(redoResponse.code, 0);
    assert.equal(redoResponse.data?.failed, undefined, `容器 redo 内层失败: ${JSON.stringify(redoResponse)}`);
    await waitForMarker(client, container.id, marker, true);
    await undo(client, docId);
    await waitForMarker(client, container.id, marker, false);
    return {
        docId,
        containerId: container.id,
        childId: child.id,
        blockCount: before.rows.length,
        idsPreserved: true,
        parentLinksPreserved: true,
        ialPreserved: true,
        undoRedoRoundTrip: true,
    };
}

async function runMoveBlockProbe(client, box) {
    const docId = await createDoc(client, box, "move-block", "# move-block\n\n第一个段落。\n\n第二个段落。\n\n第三个段落。");
    const before = await readSnapshot(client, docId);
    const first = await findLeaf(client, docId, 0);
    const second = await findLeaf(client, docId, 1);
    const beforeState = await undoState(client, docId);
    const moveResponse = await client.api("/api/block/moveBlock", { id: first.id, previousID: second.id });
    assert.equal(moveResponse.code, 0, `moveBlock 重排失败: ${JSON.stringify(moveResponse)}`);
    const afterMove = await until("moveBlock 重排索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return rowById(snapshot, first.id).previous_id === second.id ? snapshot : undefined;
    });
    const afterMoveState = await undoState(client, docId);
    assert.deepEqual(afterMove.ids, before.ids, "moveBlock 改变了块 ID 集合");
    assert.deepEqual(afterMove.attrs, before.attrs, "moveBlock 意外改动了根块属性");
    assert.equal(afterMoveState.canUndo, beforeState.canUndo, "moveBlock 改变了文档 undo 栈");
    assert.equal(afterMoveState.canRedo, beforeState.canRedo, "moveBlock 改变了文档 redo 栈");
    const original = rowById(before, first.id);
    const restoreResponse = await client.api("/api/block/moveBlock", {
        id: first.id,
        parentID: original.native_parent,
        previousID: original.native_previous,
    });
    assert.equal(restoreResponse.code, 0, `moveBlock 恢复失败: ${JSON.stringify(restoreResponse)}`);
    const restored = await until("moveBlock 恢复索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        const row = rowById(snapshot, first.id);
        return row.native_previous === original.native_previous && row.native_parent === original.native_parent ? snapshot : undefined;
    });
    assert.deepEqual(restored.ids, before.ids, "moveBlock 恢复后块 ID 集合改变");
    assertNativeStructure(before, restored, "同级 moveBlock 恢复");
    return {
        docId,
        firstId: first.id,
        secondId: second.id,
        idsPreserved: true,
        rootAttrsPreserved: true,
        directMoveUndoUnchanged: true,
        restored: true,
    };
}

async function runCrossParentReorderProbe(client, box) {
    const docId = await createDoc(client, box, "cross-parent-reorder", [
        "# cross-parent-reorder",
        "",
        "- 源列表项",
        "  - 源保留项",
        "    - 源更深保留项",
        "  - 源嵌套项",
        "    - 源更深待移动",
        "- 源列表第二项",
        "",
        "分隔两个列表的普通段落。",
        "",
        "- 目标列表项",
        "  - 目标嵌套项",
        "- 目标列表第二项",
    ].join("\n"));
    const before = await readSnapshot(client, docId);
    const rootLists = before.rows.filter((row) => row.type === "l" && row.native_parent === docId);
    assert.equal(rootLists.length, 2, `跨父级重排未得到两个根列表: ${JSON.stringify(rootLists)}`);
    const sourceRootList = rootLists.find((row) => String(row.markdown).includes("源列表项"));
    const targetRootList = rootLists.find((row) => String(row.markdown).includes("目标列表项"));
    assert.ok(sourceRootList && targetRootList, `跨父级重排根列表识别失败: ${JSON.stringify(rootLists)}`);
    const sourceOuterItem = before.rows.find((row) => row.type === "i" && row.native_parent === sourceRootList.id && String(row.markdown).includes("源列表项"));
    const targetOuterItem = before.rows.find((row) => row.type === "i" && row.native_parent === targetRootList.id && String(row.markdown).includes("目标列表项"));
    assert.ok(sourceOuterItem && targetOuterItem, "跨父级重排缺少外层列表项");
    const sourceList = before.rows.find((row) => row.type === "l" && row.native_parent === sourceOuterItem.id);
    const targetList = before.rows.find((row) => row.type === "l" && row.native_parent === targetOuterItem.id);
    const sourceItem = before.rows.find((row) => row.type === "i" && row.native_parent === sourceList?.id && String(row.markdown).includes("源嵌套项"));
    const targetItem = before.rows.find((row) => row.type === "i" && row.native_parent === targetList?.id && String(row.markdown).includes("目标嵌套项"));
    assert.ok(sourceList && targetList && sourceItem && targetItem, "跨父级重排缺少嵌套列表项");
    const movedSubtreeIds = descendantIds(before, sourceItem.id);
    assert.ok(movedSubtreeIds.size >= 3, "跨父级重排深层子树样本不足");
    await client.apiChecked("/api/attr/setBlockAttrs", {
        id: sourceItem.id,
        attrs: { "custom-probe-reorder": "keep" },
    });
    const attributedBefore = await until("跨父级重排用户 IAL", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, sourceItem.id).ial).includes("custom-probe-reorder=\"keep\"") ? snapshot : undefined;
    });
    const beforeState = await undoState(client, docId);
    const moveResponse = await client.api("/api/block/moveBlock", {
        id: sourceItem.id,
        parentID: targetList.id,
        previousID: targetItem.id,
    });
    assert.equal(moveResponse.code, 0, `跨父级 moveBlock 失败: ${JSON.stringify(moveResponse)}`);
    let afterMove;
    try {
        afterMove = await until("跨父级列表项重排", async () => {
            const snapshot = await readSnapshot(client, docId);
            const moved = rowById(snapshot, sourceItem.id);
            return moved.native_parent === targetList.id && moved.native_previous === targetItem.id && moved.sibling_parent === targetOuterItem.id ? snapshot : undefined;
        });
    } catch (error) {
        const actual = await readSnapshot(client, docId);
        throw new Error(`${error.message}; moveResponse=${JSON.stringify(moveResponse)}; moved=${JSON.stringify(rowById(actual, sourceItem.id))}`);
    }
    assert.deepEqual(afterMove.ids.sort(), attributedBefore.ids.slice().sort(), "跨父级重排改变了块 ID 集合");
    assert.deepEqual(afterMove.attrs, attributedBefore.attrs, "跨父级重排改变了根块属性");
    assert.deepEqual(comparableIal(rowById(afterMove, sourceItem.id).ial), comparableIal(rowById(attributedBefore, sourceItem.id).ial), "跨父级重排改变了列表项用户 IAL");
    const afterMoveState = await undoState(client, docId);
    assert.equal(afterMoveState.canUndo, beforeState.canUndo, "跨父级 moveBlock 改变了文档 undo 栈");
    assert.equal(afterMoveState.canRedo, beforeState.canRedo, "跨父级 moveBlock 改变了文档 redo 栈");
    const original = rowById(attributedBefore, sourceItem.id);
    assert.ok(original.native_previous, "跨父级恢复样本必须有仍存在的源列表兄弟锚点");
    const restoreResponse = await client.api("/api/block/moveBlock", {
        id: sourceItem.id, parentID: original.native_parent, previousID: original.native_previous,
    });
    assert.equal(restoreResponse.code, 0, `跨父级恢复失败: ${JSON.stringify(restoreResponse)}`);
    const restored = await until("跨父级列表项恢复原位", async () => {
        const snapshot = await readSnapshot(client, docId);
        const row = rowById(snapshot, sourceItem.id);
        return row.native_parent === original.native_parent && row.native_previous === original.native_previous ? snapshot : undefined;
    });
    assert.deepEqual(restored.ids, attributedBefore.ids, "跨父级恢复改变了块 ID 集合");
    assert.deepEqual(restored.attrs, attributedBefore.attrs, "跨父级恢复改变了根属性");
    for (const id of movedSubtreeIds) {
        const beforeRow = rowById(attributedBefore, id);
        const afterMoveRow = rowById(afterMove, id);
        const restoredRow = rowById(restored, id);
        if (id !== sourceItem.id) {
            assert.equal(afterMoveRow.native_parent, beforeRow.native_parent, `深层子树移动改变了 ${id} 的原生父级`);
            assert.equal(afterMoveRow.native_previous, beforeRow.native_previous, `深层子树移动改变了 ${id} 的原生前邻接`);
            assert.equal(afterMoveRow.native_next, beforeRow.native_next, `深层子树移动改变了 ${id} 的原生后邻接`);
        }
        assert.equal(restoredRow.native_parent, beforeRow.native_parent, `深层子树恢复改变了 ${id} 的原生父级`);
        assert.equal(restoredRow.native_previous, beforeRow.native_previous, `深层子树恢复改变了 ${id} 的原生前邻接`);
        assert.equal(restoredRow.native_next, beforeRow.native_next, `深层子树恢复改变了 ${id} 的原生后邻接`);
    }
    for (const row of attributedBefore.rows) {
        const restoredRow = rowById(restored, row.id);
        for (const key of ["parent_id", "sibling_parent", "previous_id", "next_id", "native_parent", "native_previous", "native_next"]) {
            assert.equal(restoredRow[key], row[key], `跨父级恢复后 ${row.id} 的 ${key} 改变`);
        }
        assert.deepEqual(comparableIal(restoredRow.ial), comparableIal(row.ial), `跨父级恢复后 ${row.id} 用户 IAL 改变`);
    }
    return {
        docId,
        sourceListId: sourceList.id,
        targetListId: targetList.id,
        sourceItemId: sourceItem.id,
        targetItemId: targetItem.id,
        idsPreserved: true,
        rootAttrsPreserved: true,
        ialPreserved: true,
        nestedItemIdentityPreserved: true,
        deeperNestedSubtreePreserved: true,
        movedSubtreeBlockCount: movedSubtreeIds.size,
        directMoveUndoUnchanged: true,
        restored: true,
    };
}

async function runLastItemMoveProbe(client, box) {
    const docId = await createDoc(client, box, "last-item-move", "# last-item-move\n\n- 唯一列表项。\n\n源列表与目标列表之间的段落。\n\n- 目标列表项。\n- 目标列表尾项。");
    const before = await readSnapshot(client, docId);
    const rootLists = before.rows.filter((row) => row.type === "l" && row.native_parent === docId);
    const sourceList = rootLists.find((row) => String(row.markdown).includes("唯一列表项"));
    const targetList = rootLists.find((row) => String(row.markdown).includes("目标列表项"));
    const item = before.rows.find((row) => row.type === "i" && row.native_parent === sourceList?.id && String(row.markdown).includes("唯一列表项"));
    const targetItem = before.rows.find((row) => row.type === "i" && row.native_parent === targetList?.id && String(row.markdown).includes("目标列表项"));
    assert.ok(sourceList && targetList && item && targetItem, "唯一列表项探针缺少源/目标列表或列表项");
    const moveResponse = await client.api("/api/block/moveBlock", {
        id: item.id,
        parentID: targetList.id,
        previousID: targetItem.id,
    });
    assert.equal(moveResponse.code, 0, `移走唯一列表项失败: ${JSON.stringify(moveResponse)}`);
    const after = await until("唯一列表项移动索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        const moved = snapshot.rows.find((row) => row.id === item.id);
        return moved?.native_parent === targetList.id ? snapshot : undefined;
    });
    const sourceListAfter = after.rows.find((row) => row.id === sourceList.id);
    const sourceListRead = await readBlockOutcome(client, sourceList.id);
    assert.ok(after.rows.some((row) => row.id === item.id), "唯一列表项移动后块 ID 消失");
    assert.deepEqual(
        before.ids.filter((id) => id !== sourceList.id).sort(),
        after.ids.filter((id) => id !== sourceList.id).sort(),
        "唯一列表项移动改变了非空列表外的既有块 ID",
    );
    if (!sourceListAfter) assert.notEqual(sourceListRead.state, "readable", "空列表已删除但仍能读回原列表");
    return {
        docId,
        sourceListId: sourceList.id,
        itemId: item.id,
        movedItemIdPreserved: true,
        emptySourceListBehavior: sourceListAfter ? "retained" : "removed",
        sourceListReadAfterMove: sourceListRead,
        deletionReadBackClassified: true,
    };
}

async function runConcurrentClientsProbe(clientA, clientB, box) {
    const docId = await createDoc(clientA, box, "concurrent-clients", "# concurrent-clients\n\n第一个并发段落。\n\n第二个并发段落。\n\n第三个并发段落。");
    const before = await readSnapshot(clientA, docId);
    const first = await findLeaf(clientA, docId, 0, "第一个并发段落。");
    const second = await findLeaf(clientA, docId, 0, "第二个并发段落。");
    const firstDom = await readBlockDom(clientA, first.id);
    const secondDom = await readBlockDom(clientA, second.id);
    const firstMarker = "T3220-CLIENT-A";
    const secondMarker = "T3220-CLIENT-B";
    const concurrentResponses = await Promise.all([
        postTransaction(clientA, [updateOperation(first.id, mutateDom(firstDom, firstMarker))], [updateOperation(first.id, firstDom)], "glean-t3220-client-a"),
        postTransaction(clientB, [updateOperation(second.id, mutateDom(secondDom, secondMarker))], [updateOperation(second.id, secondDom)], "glean-t3220-client-b"),
    ]);
    assert.equal(concurrentResponses[0].code, 0, `客户端 A 并发事务失败: ${JSON.stringify(concurrentResponses[0])}`);
    assert.equal(concurrentResponses[1].code, 0, `客户端 B 并发事务失败: ${JSON.stringify(concurrentResponses[1])}`);
    const afterIndependent = await until("双客户端独立块并发写入", async () => {
        const snapshot = await readSnapshot(clientA, docId);
        return String(rowById(snapshot, first.id).markdown).includes(firstMarker) && String(rowById(snapshot, second.id).markdown).includes(secondMarker) ? snapshot : undefined;
    });
    assert.deepEqual(afterIndependent.ids.sort(), before.ids.slice().sort(), "双客户端并发写入改变了块 ID 集合");
    assert.deepEqual(afterIndependent.attrs, before.attrs, "双客户端并发写入改变了根块属性");
    const stateAfterIndependent = await undoState(clientA, docId);
    assert.equal(stateAfterIndependent.canUndo, true, "双客户端并发写入没有留下可读 undo 历史");
    const firstUndo = await undo(clientA, docId, "glean-t3220-client-a");
    const secondUndo = await undo(clientB, docId, "glean-t3220-client-b");
    assert.equal(firstUndo.code, 0, `双客户端第一次 undo 失败: ${JSON.stringify(firstUndo)}`);
    assert.equal(secondUndo.code, 0, `双客户端第二次 undo 失败: ${JSON.stringify(secondUndo)}`);
    await until("双客户端并发写入 undo", async () => {
        const snapshot = await readSnapshot(clientA, docId);
        return !String(rowById(snapshot, first.id).markdown).includes(firstMarker) && !String(rowById(snapshot, second.id).markdown).includes(secondMarker) ? snapshot : undefined;
    });
    const firstRedo = await redo(clientA, docId, "glean-t3220-client-a");
    const secondRedo = await redo(clientB, docId, "glean-t3220-client-b");
    assert.equal(firstRedo.code, 0, `双客户端第一次 redo 失败: ${JSON.stringify(firstRedo)}`);
    assert.equal(secondRedo.code, 0, `双客户端第二次 redo 失败: ${JSON.stringify(secondRedo)}`);
    await until("双客户端并发写入 redo", async () => {
        const snapshot = await readSnapshot(clientA, docId);
        return String(rowById(snapshot, first.id).markdown).includes(firstMarker) && String(rowById(snapshot, second.id).markdown).includes(secondMarker) ? snapshot : undefined;
    });
    await undo(clientA, docId, "glean-t3220-client-a");
    await undo(clientB, docId, "glean-t3220-client-b");

    const conflictDocId = await createDoc(clientA, box, "concurrent-conflict", "# concurrent-conflict\n\n同一块的并发编辑。");
    const conflictBefore = await readSnapshot(clientA, conflictDocId);
    const conflictLeaf = await findLeaf(clientA, conflictDocId);
    const conflictDom = await readBlockDom(clientA, conflictLeaf.id);
    const conflictA = mutateDom(conflictDom, "T3220-CONFLICT-A");
    const conflictB = mutateDom(conflictDom, "T3220-CONFLICT-B");
    const conflictResponses = await Promise.all([
        postTransaction(clientA, [updateOperation(conflictLeaf.id, conflictA)], [updateOperation(conflictLeaf.id, conflictDom)], "glean-t3220-conflict-a"),
        postTransaction(clientB, [updateOperation(conflictLeaf.id, conflictB)], [updateOperation(conflictLeaf.id, conflictDom)], "glean-t3220-conflict-b"),
    ]);
    assert.equal(conflictResponses[0].code, 0, `客户端 A 同块冲突事务失败: ${JSON.stringify(conflictResponses[0])}`);
    assert.equal(conflictResponses[1].code, 0, `客户端 B 同块冲突事务失败: ${JSON.stringify(conflictResponses[1])}`);
    const conflictAfter = await until("双客户端同块冲突读回", async () => {
        const dom = await readBlockDom(clientA, conflictLeaf.id);
        return dom.includes("T3220-CONFLICT-A") || dom.includes("T3220-CONFLICT-B") ? dom : undefined;
    });
    const conflictSnapshot = await readSnapshot(clientA, conflictDocId);
    assert.notEqual(conflictAfter.includes("T3220-CONFLICT-A"), conflictAfter.includes("T3220-CONFLICT-B"), "同块并发样本必须恰好保留一个标记");
    assert.deepEqual(conflictSnapshot.ids, conflictBefore.ids, "同块并发冲突改变了块 ID 集合");
    assert.deepEqual(conflictSnapshot.attrs, conflictBefore.attrs, "同块并发冲突改变了根属性");
    await clientA.apiChecked("/api/block/updateBlock", { id: conflictLeaf.id, dataType: "dom", data: conflictDom });
    await until("同块并发冲突清理", async () => !(await readBlockDom(clientA, conflictLeaf.id)).includes("T3220-CONFLICT-"));
    return {
        docId,
        conflictDocId,
        independentClientCount: 2,
        independentConcurrentWritesPreserved: true,
        independentUndoRedoRoundTrip: true,
        sameBlockObservedMarker: conflictAfter.includes("T3220-CONFLICT-A") ? "A" : "B",
        sameBlockRequiresReadBack: true,
        idsPreserved: true,
        rootAttrsPreserved: true,
        apiClientsAreNotEditorEvidence: true,
    };
}

async function runResourceWriteProbe(client, base, token, box) {
    const filename = `t3220-write-${process.pid}.png`;
    const filePath = `/assets/${filename}`;
    const bytes = probePng(255, 0, 0);
    const putResponse = await putWorkspaceFile(base, token, filePath, bytes, filename, "image/png");
    assert.equal(putResponse.code, 0, `资源写入失败: ${JSON.stringify(putResponse)}`);
    const roundTrip = await getWorkspaceFile(base, token, filePath);
    assert.deepEqual(roundTrip, bytes, "资源写入读回字节不一致");
    const overwrittenBytes = probePng(0, 0, 255);
    const overwriteResponse = await putWorkspaceFile(base, token, filePath, overwrittenBytes, filename, "image/png");
    assert.equal(overwriteResponse.code, 0, `资源覆盖写入失败: ${JSON.stringify(overwriteResponse)}`);
    assert.deepEqual(await getWorkspaceFile(base, token, filePath), overwrittenBytes, "资源覆盖写入读回字节不一致");
    const restoreAssetResponse = await putWorkspaceFile(base, token, filePath, bytes, filename, "image/png");
    assert.equal(restoreAssetResponse.code, 0, `资源覆盖恢复失败: ${JSON.stringify(restoreAssetResponse)}`);
    assert.deepEqual(await getWorkspaceFile(base, token, filePath), bytes, "资源覆盖恢复后字节不一致");
    const sourceDocId = await createDoc(client, box, "resource-write", `# resource-write\n\n![隔离资源](assets/${filename})`);
    const sourceAssets = await until("源笔记本资源引用刷新", async () => {
        const assets = await client.apiChecked("/api/asset/getDocAssets", { id: sourceDocId, retainQueryStr: true });
        return assets.includes(`assets/${filename}`) ? assets : undefined;
    });
    assert.ok(sourceAssets.includes(`assets/${filename}`), `源笔记本未识别写入资源: ${JSON.stringify(sourceAssets)}`);

    const otherNotebookName = `GleanT3220-ResourceOther-${process.pid}`;
    await client.apiChecked("/api/notebook/createNotebook", { name: otherNotebookName });
    const notebooks = await client.apiChecked("/api/notebook/lsNotebooks", {});
    const otherBox = notebooks.notebooks.find((item) => item.name === otherNotebookName)?.id;
    assert.match(otherBox ?? "", /^\d{14}-[0-9a-z]{7}$/);
    const otherDocId = await createDoc(client, otherBox, "resource-write-other-box", `# resource-write-other-box\n\n![同一资源](assets/${filename})`);
    const otherAssets = await until("跨笔记本资源引用刷新", async () => {
        const assets = await client.apiChecked("/api/asset/getDocAssets", { id: otherDocId, retainQueryStr: true });
        return assets.includes(`assets/${filename}`) ? assets : undefined;
    });
    assert.ok(otherAssets.includes(`assets/${filename}`), `另一笔记本未识别被引用资源: ${JSON.stringify(otherAssets)}`);
    return {
        sourceDocId,
        otherDocId,
        sourceNotebookId: box,
        otherNotebookId: otherBox,
        filePath,
        writeSucceeded: true,
        byteRoundTrip: true,
        overwriteRoundTrip: true,
        sourceReferenceListed: true,
        crossNotebookReferenceListed: true,
        noDocumentScopedIsolationClaim: true,
        resourceWriteIsNotTransactionUndo: true,
    };
}

async function runEmbedAssetProbe(client, box) {
    const targetDocId = await createDoc(client, box, "embed-target", "# embed-target\n\n嵌入目标正文。\n\n目标尾段。");
    const targetLeaf = await findLeaf(client, targetDocId, 0);
    const markdown = [
        "# embed-assets",
        "",
        "资源前的普通段落。",
        "",
        `![真实资源](${PROBE_ASSET})`,
        "",
        `(( ${targetLeaf.id} \"块引用\" ))`,
        "",
        `{{select * from blocks where id='${targetLeaf.id}'}}`,
        "",
        "资源后的普通段落。",
    ].join("\n");
    const docId = await createDoc(client, box, "embed-assets", markdown);
    const before = await readSnapshot(client, docId);
    const imageAssetsBefore = await client.apiChecked("/api/asset/getDocImageAssets", { id: docId });
    const assetsBefore = await client.apiChecked("/api/asset/getDocAssets", { id: docId, retainQueryStr: true });
    assert.ok(Array.isArray(imageAssetsBefore), `图片资源响应不是数组: ${JSON.stringify(imageAssetsBefore)}`);
    assert.ok(Array.isArray(assetsBefore), `文档资源响应不是数组: ${JSON.stringify(assetsBefore)}`);
    assert.ok(imageAssetsBefore.includes(PROBE_ASSET), `文档图片资源未被识别: ${JSON.stringify(imageAssetsBefore)}`);
    assert.ok(assetsBefore.includes(PROBE_ASSET), `文档资源未被识别: ${JSON.stringify(assetsBefore)}`);
    const assetStat = await client.apiChecked("/api/asset/statAsset", { path: PROBE_ASSET });
    assert.ok(Number(assetStat?.size) > 0, `真实资源 statAsset 未返回正大小: ${JSON.stringify(assetStat)}`);
    const domBefore = await readBlockDomWithEmbed(client, docId);
    assert.match(domBefore, /NodeBlockQueryEmbed/, "getBlockDOMWithEmbed 未返回嵌入块");
    assert.match(domBefore, new RegExp(targetLeaf.id), "嵌入 DOM 未保留目标块 ID");
    const leaf = await findLeaf(client, docId, 0, "资源后的普通段落。");
    const beforeDom = await readBlockDom(client, leaf.id);
    const marker = "T3220-EMBED-ASSET";
    const changedDom = mutateDom(beforeDom, marker);
    const response = await postTransaction(client, [updateOperation(leaf.id, changedDom)], [updateOperation(leaf.id, beforeDom)]);
    assert.equal(response.code, 0, `嵌入/资源文档事务失败: ${JSON.stringify(response)}`);
    await waitForMarker(client, leaf.id, marker, true);
    const after = await until("嵌入/资源文档事务索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const imageAssetsAfter = await client.apiChecked("/api/asset/getDocImageAssets", { id: docId });
    const assetsAfter = await client.apiChecked("/api/asset/getDocAssets", { id: docId, retainQueryStr: true });
    const domAfter = await readBlockDomWithEmbed(client, docId);
    assert.deepEqual(after.ids, before.ids, "嵌入/资源文档事务改变了块 ID 集合");
    assert.deepEqual(imageAssetsAfter, imageAssetsBefore, "事务改变了文档图片资源集合");
    assert.deepEqual(assetsAfter, assetsBefore, "事务改变了文档资源集合");
    assert.match(domAfter, /NodeBlockQueryEmbed/, "事务后嵌入 DOM 消失");
    assert.match(domAfter, new RegExp(targetLeaf.id), "事务后嵌入目标块 ID 消失");
    await undo(client, docId);
    await waitForMarker(client, leaf.id, marker, false);
    await redo(client, docId);
    await waitForMarker(client, leaf.id, marker, true);
    const domAfterRedo = await readBlockDomWithEmbed(client, docId);
    assert.match(domAfterRedo, new RegExp(targetLeaf.id), "redo 后嵌入目标块 ID 消失");
    await undo(client, docId);
    await waitForMarker(client, leaf.id, marker, false);
    return {
        docId,
        targetDocId,
        targetLeafId: targetLeaf.id,
        imageAssetsPreserved: true,
        assetsPreserved: true,
        embedRendered: true,
        idsPreserved: true,
        undoRedoRoundTrip: true,
    };
}

async function runRestartProbe(client, box, restart) {
    const docId = await createDoc(client, box, "restart", "# restart\n\n重启前的普通段落。\n\n重启后的普通段落。");
    const before = await readSnapshot(client, docId);
    const leaf = await findLeaf(client, docId, 0);
    const beforeDom = await readBlockDom(client, leaf.id);
    const marker = "T3220-RESTART";
    const changedDom = mutateDom(beforeDom, marker);
    const transactionResponse = await postTransaction(client, [updateOperation(leaf.id, changedDom)], [updateOperation(leaf.id, beforeDom)]);
    assert.equal(transactionResponse.code, 0, `重启前事务失败: ${JSON.stringify(transactionResponse)}`);
    await waitForMarker(client, leaf.id, marker, true);
    const beforeRestartState = await undoState(client, docId);
    assert.equal(beforeRestartState.canUndo, true, "重启前事务没有进入 undo 栈");
    const version = await restart();
    const afterRestart = await until("内核重启后文档恢复", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const afterRestartState = await undoState(client, docId);
    assert.deepEqual(afterRestart.ids, before.ids, "内核重启改变了文档块 ID 集合");
    assert.equal(afterRestartState.canUndo, false, "内核重启后仍保留内存 undo 栈");
    assert.equal(afterRestartState.canRedo, false, "内核重启后仍保留内存 redo 栈");
    await client.apiChecked("/api/block/updateBlock", { id: leaf.id, dataType: "dom", data: beforeDom });
    await waitForMarker(client, leaf.id, marker, false);
    return {
        docId,
        leafId: leaf.id,
        restartedVersion: version,
        contentPreserved: true,
        idsPreserved: true,
        undoHistoryCleared: true,
    };
}

async function runResponseLossProbe(client, base, token, box) {
    const docId = await createDoc(client, box, "response-loss", "# response-loss\n\n响应丢失前的普通段落。");
    const before = await readSnapshot(client, docId);
    const leaf = await findLeaf(client, docId, 0);
    const beforeDom = await readBlockDom(client, leaf.id);
    const marker = "T3220-RESPONSE-LOST";
    const changedDom = mutateDom(beforeDom, marker);
    const payload = transactionBody([{ doOperations: [updateOperation(leaf.id, changedDom)], undoOperations: [updateOperation(leaf.id, beforeDom)] }]);
    const responseLost = await dropHttpResponse(base, "/api/transactions", payload, token);
    assert.equal(responseLost, true, "响应丢失代理意外收到了 HTTP 响应");
    const after = await until("响应丢失后的真实写入读回", async () => {
        const snapshot = await readSnapshot(client, docId);
        return String(rowById(snapshot, leaf.id).markdown).includes(marker) ? snapshot : undefined;
    });
    const state = await undoState(client, docId);
    assert.equal(state.canUndo, true, "响应丢失后无法从 undo 状态确认写入已落盘");
    await undo(client, docId);
    await waitForMarker(client, leaf.id, marker, false);
    assert.deepEqual(after.ids, before.ids, "响应丢失后的写入改变了块 ID 集合");
    return {
        docId,
        leafId: leaf.id,
        transportResultLost: true,
        writeReadBackConfirmed: true,
        idsPreserved: true,
        noAutomaticRetry: true,
    };
}

async function runAtomicityProbe(client, box) {
    const docId = await createDoc(client, box, "transaction-atomicity", "# transaction-atomicity\n\n第一个普通段落。\n\n第二个普通段落。");
    const before = await readSnapshot(client, docId);
    const first = await findLeaf(client, docId, 0);
    const second = await findLeaf(client, docId, 1);
    const firstDom = await readBlockDom(client, first.id);
    const secondDom = await readBlockDom(client, second.id);
    const marker = "T3220-FIRST-OP";
    const changedFirst = mutateDom(firstDom, marker);
    const response = await postTransaction(client, [
        updateOperation(first.id, changedFirst),
        updateOperation("20260101000000-invalid", secondDom),
    ], [
        updateOperation(first.id, firstDom),
        updateOperation("20260101000000-invalid", secondDom),
    ]);
    const firstChanged = (await readBlockDom(client, first.id)).includes(marker);
    const secondStillOriginal = !(await readBlockDom(client, second.id)).includes(marker);
    const after = await readSnapshot(client, docId);
    if (firstChanged) {
        await client.apiChecked("/api/block/updateBlock", { id: first.id, dataType: "dom", data: firstDom });
        await until("原子性探针清理完成", async () => !(await readBlockDom(client, first.id)).includes(marker));
    }
    const multiDocId = await createDoc(client, box, "transaction-multi", "# transaction-multi\n\n第一个普通段落。\n\n第二个普通段落。");
    const multiBefore = await readSnapshot(client, multiDocId);
    const multiFirst = await findLeaf(client, multiDocId, 0);
    const multiSecond = await findLeaf(client, multiDocId, 1);
    const multiFirstDom = await readBlockDom(client, multiFirst.id);
    const multiSecondDom = await readBlockDom(client, multiSecond.id);
    const multiMarker = "T3220-MULTI-FIRST";
    const multiChangedFirst = mutateDom(multiFirstDom, multiMarker);
    const multiResponse = await postTransactions(client, [
        { doOperations: [updateOperation(multiFirst.id, multiChangedFirst)], undoOperations: [updateOperation(multiFirst.id, multiFirstDom)] },
        { doOperations: [updateOperation("20260101000000-invalid", multiSecondDom)], undoOperations: [updateOperation("20260101000000-invalid", multiSecondDom)] },
    ]);
    const multiFirstChanged = (await readBlockDom(client, multiFirst.id)).includes(multiMarker);
    const multiSecondStillOriginal = !(await readBlockDom(client, multiSecond.id)).includes(multiMarker);
    if (multiFirstChanged) {
        await client.apiChecked("/api/block/updateBlock", { id: multiFirst.id, dataType: "dom", data: multiFirstDom });
        await until("多事务探针清理完成", async () => !(await readBlockDom(client, multiFirst.id)).includes(multiMarker));
    }
    return {
        docId,
        responseCode: response.code,
        responseData: response.data,
        firstChanged,
        secondStillOriginal,
        idsPreservedAfterFailure: after.ids.length === before.ids.length,
        atomicityObserved: !firstChanged,
        multiTransaction: {
            responseCode: multiResponse.code,
            responseData: multiResponse.data,
            firstChanged: multiFirstChanged,
            secondStillOriginal: multiSecondStillOriginal,
            idsPreservedAfterFailure: (await readSnapshot(client, multiDocId)).ids.length === multiBefore.ids.length,
            partialCommitObserved: multiFirstChanged,
        },
    };
}

async function runInsertDeleteProbe(client, box) {
    const docId = await createDoc(client, box, "insert-delete", "# insert-delete\n\n锚点段落。\n\n尾部段落。");
    const before = await readSnapshot(client, docId);
    const anchor = await findLeaf(client, docId, 0);
    const marker = "T3220-INSERTED";
    const beforeEndpointHistory = await undoState(client, docId);
    const insertResponse = await client.api("/api/block/insertBlock", {
        dataType: "markdown",
        previousID: anchor.id,
        data: marker,
    });
    assert.equal(insertResponse.code, 0, `insertBlock 失败: ${JSON.stringify(insertResponse)}`);
    const insertRootId = transactionRootId(insertResponse.data);
    assert.equal(insertRootId, "", "insertBlock 返回了非空 rootID，需重新核对端点证据");
    const insertOperation = insertResponse.data?.[0]?.doOperations?.find((operation) => operation?.action === "insert");
    assert.ok(insertOperation?.id && insertOperation?.data, `insertBlock 未返回可复用的 insert 操作: ${JSON.stringify(insertResponse)}`);
    const afterInsert = await until("插入块索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        const row = snapshot.rows.find((item) => String(item.markdown).includes(marker));
        return row ? { snapshot, row } : undefined;
    });
    assert.ok(!before.ids.includes(afterInsert.row.id), "插入块意外复用了既有块 ID");
    assert.deepEqual(before.ids.every((id) => afterInsert.snapshot.ids.includes(id)), true, "插入块改变了既有块 ID");
    const insertedId = afterInsert.row.id;
    assert.equal(insertedId, insertOperation.id, "insertBlock 返回的操作 ID 与实际块 ID 不一致");
    const afterInsertEndpointHistory = await undoState(client, docId);

    const deleteResponse = await client.api("/api/block/deleteBlock", { id: insertedId });
    assert.equal(deleteResponse.code, 0, `deleteBlock 失败: ${JSON.stringify(deleteResponse)}`);
    await until("删除块索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.every((item) => item.id !== insertedId) ? snapshot : undefined;
    });
    const deletedBlockRead = await readBlockOutcome(client, insertedId);
    assert.notEqual(deletedBlockRead.state, "readable", `删除后的块仍可读回: ${JSON.stringify(deletedBlockRead)}`);
    const afterEndpointDelete = await readSnapshot(client, docId);
    assert.deepEqual(afterEndpointDelete.ids, before.ids, "块端点删除后未恢复原块 ID 集合");
    const afterDeleteEndpointHistory = await undoState(client, docId);
    assert.equal(afterInsertEndpointHistory.canUndo, beforeEndpointHistory.canUndo, "insertBlock 改变了文档 undo 栈");
    assert.equal(afterDeleteEndpointHistory.canUndo, beforeEndpointHistory.canUndo, "deleteBlock 改变了文档 undo 栈");

    const insertTransactionResponse = await postTransaction(client, [insertOperation], [{ action: "delete", id: insertedId }]);
    assert.equal(insertTransactionResponse.code, 0, `事务插入块失败: ${JSON.stringify(insertTransactionResponse)}`);
    await until("插入块 redo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.some((item) => item.id === insertedId) ? snapshot : undefined;
    });

    const undoInsertResponse = await undo(client, docId);
    assert.equal(undoInsertResponse.code, 0, `事务插入块 undo 失败: ${JSON.stringify(undoInsertResponse)}`);
    await until("事务插入块 undo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.every((item) => item.id !== insertedId) ? snapshot : undefined;
    });
    const redoInsertResponse = await redo(client, docId);
    assert.equal(redoInsertResponse.code, 0, `事务插入块 redo 失败: ${JSON.stringify(redoInsertResponse)}`);
    await until("事务插入块 redo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.some((item) => item.id === insertedId) ? snapshot : undefined;
    });

    const deleteTransactionResponse = await postTransaction(client, [{ action: "delete", id: insertedId }], [insertOperation]);
    assert.equal(deleteTransactionResponse.code, 0, `事务删除块失败: ${JSON.stringify(deleteTransactionResponse)}`);
    await until("事务删除块", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.every((item) => item.id !== insertedId) ? snapshot : undefined;
    });
    const undoDeleteResponse = await undo(client, docId);
    assert.equal(undoDeleteResponse.code, 0, `事务删除块 undo 失败: ${JSON.stringify(undoDeleteResponse)}`);
    await until("事务删除块 undo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.some((item) => item.id === insertedId) ? snapshot : undefined;
    });
    const redoDeleteResponse = await redo(client, docId);
    assert.equal(redoDeleteResponse.code, 0, `事务删除块 redo 失败: ${JSON.stringify(redoDeleteResponse)}`);
    await until("事务删除块 redo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return snapshot.rows.every((item) => item.id !== insertedId) ? snapshot : undefined;
    });
    return {
        docId,
        anchorId: anchor.id,
        insertedId,
        insertRootId,
        insertTransactionReturned: Array.isArray(insertResponse.data) && insertResponse.data.length > 0,
        deleteTransactionReturned: Array.isArray(deleteResponse.data) && deleteResponse.data.length > 0,
        endpointUndoUnchanged: afterDeleteEndpointHistory.canUndo === beforeEndpointHistory.canUndo,
        deletedBlockRead,
        deletionReadBackRejected: deletedBlockRead.state !== "readable",
        existingIdsPreserved: before.ids.every((id) => afterInsert.snapshot.ids.includes(id)),
        undoRedoRoundTrip: true,
    };
}

async function runHeadingConversionProbe(client, box) {
    const docId = await createDoc(client, box, "heading-conversion", "# heading-conversion\n\n## 待转换标题。\n\n尾部段落。");
    const before = await readSnapshot(client, docId);
    const heading = await findHeading(client, docId, 0, "heading-conversion");
    const transaction = await client.apiChecked("/api/block/getHeadingLevelTransaction", { id: heading.id, level: 3 });
    assert.ok(transaction?.doOperations?.length, `标题转换未返回 doOperations: ${JSON.stringify(transaction)}`);
    assert.ok(transaction?.undoOperations?.length, `标题转换未返回 undoOperations: ${JSON.stringify(transaction)}`);
    const response = await postTransactions(client, [transaction]);
    assert.equal(response.code, 0, `标题转换事务失败: ${JSON.stringify(response)}`);
    const afterApply = await until("标题转换索引刷新", async () => {
        const snapshot = await readSnapshot(client, docId);
        const row = snapshot.rows.find((item) => item.id === heading.id);
        return row?.type === "h" && row.subtype === "h3" ? snapshot : undefined;
    });
    assert.deepEqual(afterApply.ids, before.ids, "标题转换改变了块 ID 集合");
    assert.deepEqual(comparableIal(rowById(afterApply, heading.id).ial), comparableIal(rowById(before, heading.id).ial), "标题转换改变了用户 IAL");
    const undoResponse = await undo(client, docId);
    assert.equal(undoResponse.code, 0, `标题转换 undo 失败: ${JSON.stringify(undoResponse)}`);
    const afterUndo = await until("标题转换 undo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return rowById(snapshot, heading.id).subtype === "h1" ? snapshot : undefined;
    });
    assert.deepEqual(afterUndo.ids, before.ids, "标题转换 undo 改变了块 ID 集合");
    const redoResponse = await redo(client, docId);
    assert.equal(redoResponse.code, 0, `标题转换 redo 失败: ${JSON.stringify(redoResponse)}`);
    await until("标题转换 redo", async () => {
        const snapshot = await readSnapshot(client, docId);
        return rowById(snapshot, heading.id).subtype === "h3" ? snapshot : undefined;
    });
    await undo(client, docId);
    await until("标题转换清理完成", async () => {
        const snapshot = await readSnapshot(client, docId);
        return rowById(snapshot, heading.id).subtype === "h1" ? snapshot : undefined;
    });
    return {
        docId,
        headingId: heading.id,
        transactionReturned: true,
        idsPreserved: true,
        ialPreserved: true,
        typeConversionUndoRedo: true,
    };
}

async function runOwnershipProbe(client, box) {
    const docId = await createDoc(client, box, "undo-ownership", "# undo-ownership\n\n撤销归属探针。");
    const leaf = await findLeaf(client, docId);
    const original = await readBlockDom(client, leaf.id);
    const pluginMarker = "T3220-PLUGIN";
    const userMarker = "T3220-USER";
    const pluginDom = mutateDom(original, pluginMarker);
    const userDom = mutateDom(pluginDom, userMarker);
    await postTransaction(client, [updateOperation(leaf.id, pluginDom)], [updateOperation(leaf.id, original)], SESSION);
    await waitForMarker(client, leaf.id, pluginMarker, true);
    await postTransaction(client, [updateOperation(leaf.id, userDom)], [updateOperation(leaf.id, pluginDom)], `${SESSION}-other`);
    await waitForMarker(client, leaf.id, userMarker, true);
    const undoResponse = await undo(client, docId, SESSION);
    assert.equal(undoResponse.code, 0);
    assert.equal(undoResponse.data?.failed, undefined, `跨会话 undo 内层失败: ${JSON.stringify(undoResponse)}`);
    const afterOneUndo = await readBlockDom(client, leaf.id);
    const undoAgainResponse = await undo(client, docId, SESSION);
    assert.equal(undoAgainResponse.code, 0);
    assert.equal(undoAgainResponse.data?.failed, undefined, `跨会话第二次 undo 内层失败: ${JSON.stringify(undoAgainResponse)}`);
    const afterTwoUndo = await readBlockDom(client, leaf.id);
    await client.apiChecked("/api/block/updateBlock", { id: leaf.id, dataType: "dom", data: original });
    return {
        docId,
        firstUndoRestoredPlugin: afterOneUndo.includes(pluginMarker) && !afterOneUndo.includes(userMarker),
        secondUndoRestoredOriginal: !afterTwoUndo.includes(pluginMarker) && !afterTwoUndo.includes(userMarker),
        ownershipIsolated: false,
    };
}

function acceptanceResults(probes) {
    const checks = [
        ["T3220-update-block-preserves-identity", probes.updateBlock.idsPreserved && probes.updateBlock.rootAttrsPreserved],
        ["T3220-transaction-undo-redo-preserves-structure", probes.transactionUndoRedo.idsPreserved && probes.transactionUndoRedo.undoRedoRoundTrip],
        ["T3220-container-undo-redo-preserves-links", probes.containerUpdate.idsPreserved && probes.containerUpdate.undoRedoRoundTrip],
        ["T3220-same-level-move-restores-structure", probes.moveBlock.idsPreserved && probes.moveBlock.restored],
        ["T3220-cross-parent-deep-subtree-restores-structure", probes.crossParentReorder.deeperNestedSubtreePreserved && probes.crossParentReorder.restored],
        ["T3220-independent-client-writes-round-trip", probes.concurrentClients.independentConcurrentWritesPreserved && probes.concurrentClients.independentUndoRedoRoundTrip],
        ["T3220-resource-bytes-round-trip", probes.resourceWrite.byteRoundTrip && probes.resourceWrite.overwriteRoundTrip],
        ["T3220-embed-assets-survive-undo-redo", probes.embedAsset.imageAssetsPreserved && probes.embedAsset.undoRedoRoundTrip],
        ["T3220-same-transaction-failure-has-no-partial-write", probes.sameTransactionFailure.atomicityObserved],
        ["T3220-insert-delete-undo-redo-round-trip", probes.insertDelete.insertTransactionReturned && probes.insertDelete.undoRedoRoundTrip],
        ["T3220-deleted-block-readback-rejected", probes.insertDelete.deletionReadBackRejected],
        ["T3220-heading-transaction-undo-redo-round-trip", probes.headingConversion.typeConversionUndoRedo],
        ["T3220-response-loss-requires-readback", probes.responseLoss.transportResultLost && probes.responseLoss.writeReadBackConfirmed],
        ["T3220-restart-preserves-content-clears-history", probes.restart.contentPreserved && probes.restart.undoHistoryCleared],
        ["T3220-last-item-move-readback-classified", probes.lastItemMove.movedItemIdPreserved && probes.lastItemMove.deletionReadBackClassified],
    ];
    return checks.map(([name, ok]) => ({ name, ok: Boolean(ok), detail: "隔离服务 API 读回证据，不能替代真实宿主验收" }));
}

async function main() {
    process.chdir(REPO);
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(WORKSPACE, MARKER, CREATED_BY);
    prepareProbeAsset();
    const port = await choosePort();
    const base = `http://${HOST}:${port}`;
    const client = createApiClient(base);
    const clientB = createApiClient(base);
    const lifecycle = startKernel(kernel, appDir, WORKSPACE, port);
    client.onGuard(() => {
        if (lifecycle.child.exitCode !== null || lifecycle.child.signalCode !== null) throw new Error("测试内核已退出");
    });
    try {
        const version = await waitForBoot(base, lifecycle.lines, () => {
            if (lifecycle.child.exitCode !== null || lifecycle.child.signalCode !== null) throw new Error("测试内核已退出");
        }, client);
        const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
        client.setToken(conf.accessAuthCode || "");
        clientB.setToken(conf.accessAuthCode || "");
        await client.apiChecked("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        const notebookName = `GleanT3220-${process.pid}`;
        await client.apiChecked("/api/notebook/createNotebook", { name: notebookName });
        const listing = await client.apiChecked("/api/notebook/lsNotebooks", {});
        const box = listing.notebooks.find((item) => item.name === notebookName)?.id;
        assert.match(box ?? "", /^\d{14}-[0-9a-z]{7}$/);
        const pluginVersion = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
        console.log(`T-3220 事务探针：内核 ${JSON.stringify(version)}，端口 ${port}`);
        console.log(`隔离工作区：${WORKSPACE}`);
        const results = {
            updateBlock: await runUpdateBlockProbe(client, box),
            transactionUndoRedo: await runTransactionUndoRedoProbe(client, box),
            containerUpdate: await runContainerUpdateProbe(client, box),
            moveBlock: await runMoveBlockProbe(client, box),
            crossParentReorder: await runCrossParentReorderProbe(client, box),
            lastItemMove: await runLastItemMoveProbe(client, box),
            concurrentClients: await runConcurrentClientsProbe(client, clientB, box),
            resourceWrite: await runResourceWriteProbe(client, base, conf.accessAuthCode || "", box),
            embedAsset: await runEmbedAssetProbe(client, box),
            sameTransactionFailure: await runAtomicityProbe(client, box),
            insertDelete: await runInsertDeleteProbe(client, box),
            headingConversion: await runHeadingConversionProbe(client, box),
            undoOwnership: await runOwnershipProbe(client, box),
            responseLoss: await runResponseLossProbe(client, base, conf.accessAuthCode || "", box),
            restart: await runRestartProbe(client, box, async () => {
                await shutdownKernel(client, lifecycle.child);
                const restarted = startKernel(kernel, appDir, WORKSPACE, port);
                lifecycle.child = restarted.child;
                lifecycle.lines = restarted.lines;
                const restartedVersion = await waitForBoot(base, lifecycle.lines, () => {
                    if (lifecycle.child.exitCode !== null || lifecycle.child.signalCode !== null) throw new Error("重启后的测试内核已退出");
                }, client);
                client.setToken(conf.accessAuthCode || "");
                return restartedVersion;
            }),
        };
        const report = {
            reportVersion: 2,
            version,
            kernelVersion: version,
            pluginVersion,
            workspace: WORKSPACE,
            host: HOST,
            port,
            box,
            results: acceptanceResults(results),
            probes: results,
            limitations: [
                "双 Protyle、用户中间编辑和真实宿主撤销仍未验证",
                "真实网络故障、资源权限/删除和编辑器渲染仍未验证",
                "跨 session 撤销没有插件归属隔离，不能提供插件专属撤销",
            ],
        };
        fs.writeFileSync(path.join(WORKSPACE, "transaction-report.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify(report, null, 2));
        assert.equal(results.transactionUndoRedo.idsPreserved, true);
        assert.equal(results.transactionUndoRedo.ialPreserved, true);
        assert.equal(results.transactionUndoRedo.rootAttrsPreserved, true);
        assert.equal(results.transactionUndoRedo.complexStructureSnapshot, true);
        assert.equal(results.transactionUndoRedo.crossDocumentReferencePreserved, true);
        assert.equal(results.transactionUndoRedo.undoRedoRoundTrip, true);
        assert.equal(results.containerUpdate.idsPreserved, true);
        assert.equal(results.containerUpdate.parentLinksPreserved, true);
        assert.equal(results.containerUpdate.ialPreserved, true);
        assert.equal(results.containerUpdate.undoRedoRoundTrip, true);
        assert.equal(results.moveBlock.idsPreserved, true);
        assert.equal(results.moveBlock.directMoveUndoUnchanged, true);
        assert.equal(results.moveBlock.restored, true);
        assert.equal(results.crossParentReorder.idsPreserved, true);
        assert.equal(results.crossParentReorder.rootAttrsPreserved, true);
        assert.equal(results.crossParentReorder.ialPreserved, true);
        assert.equal(results.crossParentReorder.nestedItemIdentityPreserved, true);
        assert.equal(results.crossParentReorder.deeperNestedSubtreePreserved, true);
        assert.equal(results.crossParentReorder.directMoveUndoUnchanged, true);
        assert.equal(results.crossParentReorder.restored, true);
        assert.equal(results.concurrentClients.independentClientCount, 2);
        assert.equal(results.concurrentClients.independentConcurrentWritesPreserved, true);
        assert.equal(results.concurrentClients.independentUndoRedoRoundTrip, true);
        assert.equal(results.concurrentClients.sameBlockRequiresReadBack, true);
        assert.equal(results.concurrentClients.idsPreserved, true);
        assert.equal(results.concurrentClients.rootAttrsPreserved, true);
        assert.equal(results.concurrentClients.apiClientsAreNotEditorEvidence, true);
        assert.equal(results.resourceWrite.writeSucceeded, true);
        assert.equal(results.resourceWrite.byteRoundTrip, true);
        assert.equal(results.resourceWrite.overwriteRoundTrip, true);
        assert.equal(results.resourceWrite.sourceReferenceListed, true);
        assert.equal(results.resourceWrite.crossNotebookReferenceListed, true);
        assert.equal(results.resourceWrite.noDocumentScopedIsolationClaim, true);
        assert.equal(results.resourceWrite.resourceWriteIsNotTransactionUndo, true);
        assert.equal(results.embedAsset.imageAssetsPreserved, true);
        assert.equal(results.embedAsset.assetsPreserved, true);
        assert.equal(results.embedAsset.embedRendered, true);
        assert.equal(results.embedAsset.undoRedoRoundTrip, true);
        assert.equal(results.restart.contentPreserved, true);
        assert.equal(results.restart.idsPreserved, true);
        assert.equal(results.restart.undoHistoryCleared, true);
        assert.equal(results.sameTransactionFailure.atomicityObserved, true);
        assert.equal(results.insertDelete.insertTransactionReturned, true);
        assert.equal(results.insertDelete.deleteTransactionReturned, true);
        assert.equal(results.insertDelete.deletionReadBackRejected, true);
        assert.equal(results.insertDelete.existingIdsPreserved, true);
        assert.equal(results.insertDelete.undoRedoRoundTrip, true);
        assert.equal(results.headingConversion.transactionReturned, true);
        assert.equal(results.headingConversion.idsPreserved, true);
        assert.equal(results.headingConversion.ialPreserved, true);
        assert.equal(results.headingConversion.typeConversionUndoRedo, true);
        assert.equal(results.undoOwnership.ownershipIsolated, false);
        assert.equal(results.responseLoss.transportResultLost, true);
        assert.equal(results.responseLoss.writeReadBackConfirmed, true);
        assert.equal(results.responseLoss.idsPreserved, true);
        assert.equal(results.responseLoss.noAutomaticRetry, true);
        assert.equal(results.lastItemMove.movedItemIdPreserved, true);
        assert.equal(results.lastItemMove.deletionReadBackClassified, true);
        console.log("T-3220 事务探针：完成");
    } finally {
        fs.writeFileSync(path.join(WORKSPACE, "kernel-tail.log"), lifecycle.lines.join("\n") + "\n");
        await shutdownKernel(client, lifecycle.child);
    }
}

main().catch((error) => {
    console.error(`T-3220 事务探针失败：${error.stack || error}`);
    process.exitCode = 1;
});

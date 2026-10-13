/** domain/migrate 启发式单测 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import { bestUrlCandidate, extractUrlCandidates, stripMarkdown } from "../src/domain/migrate.ts";
import { DEFAULT_MIGRATE_BATCH_SIZE, MAX_MIGRATE_BATCH_SIZE } from "../src/domain/migrate-consts.ts";
import * as schema from "../src/domain/schema.ts";
import * as candidatePolicy from "../src/domain/candidate-policy.ts";
import * as content from "../src/domain/content.ts";
import * as urlDomain from "../src/domain/url.ts";

test("官方剪藏默认模板形态：第二行链接行得分最高", () => {
    const markdown = [
        "## 一篇剪藏的文章",
        "",
        "- [https://example.com/post/1](https://example.com/post/1)",
        "",
        "正文引用了 [另一个站](https://other.com/x)。",
    ].join("\n");
    const best = bestUrlCandidate(markdown);
    assert.ok(best);
    assert.equal(best.url, "https://example.com/post/1");
    assert.equal(best.reason, "clipper-template-link");
});

test("裸 URL 行识别", () => {
    const best = bestUrlCandidate("标题\n\nhttps://kernel.org/news\n\n正文");
    assert.ok(best);
    assert.equal(best.url, "https://kernel.org/news");
    assert.equal(best.reason, "bare-url-line");
});

test("无候选返回 null；非 http 链接忽略", () => {
    assert.equal(bestUrlCandidate("没有链接的一篇文档"), null);
    assert.equal(bestUrlCandidate("[本地](file:///a.md)"), null);
});

test("尾随标点被清理", () => {
    const [first] = extractUrlCandidates("https://example.com/a.");
    assert.equal(first.url, "https://example.com/a");
});

test("stripMarkdown：代码块/图片/链接/标题标记移除", () => {
    const stripped = stripMarkdown("# 标题\n\n![](img.png)\n\n[链接](https://x)\n\n```js\ncode()\n```\n\n- 列表项");
    assert.ok(!stripped.includes("code()"));
    assert.ok(!stripped.includes("img.png"));
    assert.ok(stripped.includes("链接"));
    assert.ok(stripped.includes("标题"));
});

test("批量约束：默认 25，上限 50（规划书 T-1102）", () => {
    assert.equal(DEFAULT_MIGRATE_BATCH_SIZE, 25);
    assert.equal(MAX_MIGRATE_BATCH_SIZE, 50);
});

type MigrateService = typeof import("../src/services/migrate-service.ts");
type MigrateSettings = Parameters<MigrateService["buildDryRunReport"]>[0];

/** 服务模块依赖内核和思源 Plugin，隔离替换后验证真实任务流。 */
function loadMigrateService(mocks: {
    listAnchorDocs: (notebooks: string[], limit: number) => Promise<unknown[]>;
    scanDocScopes?: (settings: MigrateSettings) => Promise<{ all: unknown[]; tagged: unknown[] }>;
    batchGetBlockAttrs: (ids: string[]) => Promise<{ id: string; attrs: Record<string, string> }[]>;
    exportMdContent: (id: string) => Promise<{ content: string }>;
    listDocsByIds?: (ids: string[]) => Promise<unknown[]>;
    newNodeId?: () => string;
    writeClip: (plugin: unknown, id: string, patch: unknown) => Promise<{ attrs: Record<string, unknown>; skippedKeys: string[] }>;
    captureClip?: (plugin: unknown, id: string, options: Record<string, unknown>) => Promise<{ captured: boolean; attrs: Record<string, unknown>; conflict?: { id: string } }>;
    findClipUrlConflict?: (url: string, exceptDocId?: string) => Promise<unknown | null>;
}): MigrateService {
    const source = readFileSync(resolve(import.meta.dirname, "../src/services/migrate-service.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const serviceModule: { exports: Record<string, unknown> } = { exports: {} };
    const dependencies: Record<string, unknown> = {
        "../api/client": {
            newNodeId: mocks.newNodeId ?? (() => "20261014000000-abcdefg"),
            exportMdContent: mocks.exportMdContent,
        },
        "../domain/candidate-policy": candidatePolicy,
        "../domain/content": content,
        "../domain/schema": schema,
        "../domain/url": urlDomain,
        "./clip-store": {
            listAnchorDocs: mocks.listAnchorDocs,
            listDocsByIds: mocks.listDocsByIds ?? (async (ids: string[]) => ids.map((id) => ({ id, content: id, hpath: `/${id}`, box: "box", updated: "", tag: "" }))),
            scanDocScopes: mocks.scanDocScopes,
            batchReadClipAttrs: mocks.batchGetBlockAttrs,
            writeClip: mocks.writeClip,
            findClipUrlConflict: mocks.findClipUrlConflict ?? (async () => null),
            captureClip: mocks.captureClip ?? (async () => ({ captured: true, attrs: {} })),
        },
    };
    const requireMock = (path: string): unknown => {
        if (!(path in dependencies)) throw new Error(`Unexpected dependency: ${path}`);
        return dependencies[path];
    };
    new Function("require", "module", "exports", compiled)(requireMock, serviceModule, serviceModule.exports);
    return serviceModule.exports as MigrateService;
}

function memoryPlugin() {
    const files = new Map<string, unknown>();
    return {
        async loadData(name: string) { return structuredClone(files.get(name)); },
        async saveData(name: string, value: unknown) { files.set(name, structuredClone(value)); },
        async removeData(name: string) { files.delete(name); },
        saved(name: string) { return structuredClone(files.get(name)); },
        seed(name: string, value: unknown) { files.set(name, structuredClone(value)); },
    };
}

const testDocId = (label: string): string => `20261013000000-${label.padEnd(7, "0").slice(0, 7)}`;
const sourceForId = (id: string): string => `https://example.com/${id.split("-")[1].replace(/0+$/, "")}`;

function validProgressFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: 1,
        rows: [{
            id: testDocId("fixture"), title: "fixture", hpath: "/fixture", box: "box", url: "https://example.com/fixture", site: "example.com",
            words: 10, minutes: 1, state: "pending",
        }],
        cursor: 0,
        finished: false,
        startedAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        ...overrides,
    };
}

test("迁移检查点读取异常向上抛出并阻止新任务覆盖", async () => {
    let writes = 0;
    const plugin = {
        async loadData() { throw new Error("storage unavailable"); },
        async saveData() { writes += 1; },
        async removeData() {},
    };
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    await assert.rejects(service.loadMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "readFailed");
    await assert.rejects(service.startMigrateProgress(plugin as never, []), (error: { reason?: string }) => error.reason === "readFailed");
    assert.equal(writes, 0);
});

test("迁移检查点损坏时不被当成空任务，也不会覆盖原记录", async () => {
    let writes = 0;
    const plugin = {
        async loadData() { return validProgressFixture({ rows: [null] }); },
        async saveData() { writes += 1; },
        async removeData() {},
    };
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    await assert.rejects(service.loadMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "invalid");
    await assert.rejects(service.startMigrateProgress(plugin as never, []), (error: { reason?: string }) => error.reason === "invalid");
    assert.equal(writes, 0);
});

test("迁移检查点游标和行状态必须有效", async () => {
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    for (const value of [validProgressFixture({ cursor: -1 }), validProgressFixture({ cursor: 2 }), validProgressFixture({ rows: [{ ...validProgressFixture().rows[0] as Record<string, unknown>, state: "unknown" }] })]) {
        const plugin = { async loadData() { return value; }, async saveData() {}, async removeData() {} };
        await assert.rejects(service.loadMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "invalid");
    }
});

test("迁移检查点的非空来源必须是 http(s) URL", async () => {
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    for (const url of ["javascript:alert(1)", "not a url", "ftp://example.com/file"]) {
        const plugin = { async loadData() { return validProgressFixture({ rows: [{ ...validProgressFixture().rows[0] as Record<string, unknown>, url }] }); }, async saveData() {}, async removeData() {} };
        await assert.rejects(service.loadMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "invalid");
    }
});

test("V1 迁移检查点先严格读取，再压缩成不含文章事实的 V2", async () => {
    const plugin = memoryPlugin();
    plugin.seed("migrate-progress.json", validProgressFixture());
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    const migrated = await service.loadMigrateProgress(plugin as never);
    assert.equal(migrated?.version, 2);
    assert.equal(migrated?.rows[0].id, testDocId("fixture"));
    assert.equal((plugin.saved("migrate-progress.json") as { version: number }).version, 2);
    const saved = plugin.saved("migrate-progress.json") as Record<string, unknown>;
    assert.deepEqual(Object.keys(saved).sort(), ["cursor", "finished", "rows", "taskId", "version"]);
    assert.deepEqual(Object.keys((saved.rows as Record<string, unknown>[])[0]).sort(), ["id", "state"]);
});

test("已有迁移检查点必须先继续或明确清理，不能直接开始新任务", async () => {
    const plugin = memoryPlugin();
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    await service.startMigrateProgress(plugin as never, [{
        id: testDocId("existing"), title: "existing", hpath: "/existing", box: "box", url: "https://example.com/existing", site: "example.com",
        words: 1, minutes: 1, state: "pending",
    }]);
    await assert.rejects(service.startMigrateProgress(plugin as never, []), (error: { reason?: string }) => error.reason === "exists");
});

test("同一插件实例的并发新任务串行检查，只有一个 dry-run 能落盘", async () => {
    let stored: unknown;
    let releaseRead!: () => void;
    let announceRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const firstRead = new Promise<void>((resolve) => { announceRead = resolve; });
    let writes = 0;
    const plugin = {
        async loadData() { announceRead(); await readGate; return structuredClone(stored); },
        async saveData(_name: string, value: unknown) { writes += 1; stored = structuredClone(value); },
        async removeData() { stored = undefined; },
    };
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    const row = {
        id: testDocId("parallel"), title: "parallel", hpath: "/parallel", box: "box", url: "https://example.com/parallel", site: "example.com",
        words: 1, minutes: 1, state: "pending" as const,
    };
    const first = service.startMigrateProgress(plugin as never, [row]);
    await firstRead;
    const second = service.startMigrateProgress(plugin as never, []);
    releaseRead();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && (result.reason as { reason?: string }).reason === "exists").length, 1);
    assert.equal(writes, 1);
    assert.equal((stored as { rows: unknown[] }).rows.length, 1);
});

test("同一插件实例的并发回填只处理一次相同批次", async () => {
    const plugin = memoryPlugin();
    let releaseWrite!: () => void;
    let announceWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const firstWrite = new Promise<void>((resolve) => { announceWrite = resolve; });
    let writes = 0;
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        writeClip: async () => { writes += 1; announceWrite(); await writeGate; return { attrs: {}, skippedKeys: [] }; },
    });
    const task = await service.startMigrateProgress(plugin as never, [{
        id: testDocId("parallel"), title: "parallel", hpath: "/parallel", box: "box", url: "https://example.com/parallel", site: "example.com",
        words: 1, minutes: 1, state: "pending",
    }]);
    const settings = { migrateBatchSize: 1 } as MigrateSettings;
    const first = service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId });
    await firstWrite;
    const second = service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId });
    releaseWrite();
    const results = await Promise.all([first, second]);
    assert.equal(writes, 1);
    assert.equal(results.filter((result) => result.finished).length, 2);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "ok");
});

test("清理损坏检查点会重新读取；读取失败或已恢复时不删除", async () => {
    let raw: unknown = validProgressFixture({ rows: [null] });
    let removals = 0;
    let readFails = false;
    const plugin = {
        async loadData() { if (readFails) throw new Error("temporarily unavailable"); return raw; },
        async saveData() {},
        async removeData() { removals += 1; raw = undefined; },
    };
    const service = loadMigrateService({ listAnchorDocs: async () => [], batchGetBlockAttrs: async () => [], exportMdContent: async () => ({ content: "" }), writeClip: async () => ({ attrs: {}, skippedKeys: [] }) });
    readFails = true;
    await assert.rejects(service.clearInvalidMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "readFailed");
    assert.equal(removals, 0);
    readFails = false;
    raw = validProgressFixture();
    await assert.rejects(service.clearInvalidMigrateProgress(plugin as never), (error: { reason?: string }) => error.reason === "changed");
    assert.equal(removals, 0);
    raw = validProgressFixture({ rows: [null] });
    await service.clearInvalidMigrateProgress(plugin as never);
    assert.equal(removals, 1);
});

test("迁移 dry-run 只预览有证据的文章，普通笔记不会被误报", async () => {
    const plugin = memoryPlugin();
    const docs = ["found", "missing", "already"].map((label) => ({ id: testDocId(label), content: label, hpath: `/${label}`, box: "box", updated: "" }));
    const service = loadMigrateService({
        listAnchorDocs: async () => docs,
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: id === testDocId("already") ? {
            "custom-clip-status": "later", "custom-clip-url": "https://example.com/already",
        } : {} })),
        exportMdContent: async (id) => ({ content: id === testDocId("found") ? "https://example.com/article\n\n正文" : "没有来源链接" }),
        writeClip: async () => ({ attrs: {}, skippedKeys: [] }),
    });
    const report = await service.buildDryRunReport({ anchorNotebooks: ["box"] } as MigrateSettings);
    assert.deepEqual(report.map((row) => row.state), ["pending", "skipped"]);
    assert.equal(await service.loadMigrateProgress(plugin as never), null);
    const task = await service.startMigrateProgress(plugin as never, report);
    assert.equal(task.rows.length, 2);
    assert.equal(task.version, 2);
    assert.deepEqual(Object.keys(plugin.saved("migrate-progress.json")).sort(), ["cursor", "finished", "rows", "taskId", "version"]);
    assert.deepEqual(Object.keys((plugin.saved("migrate-progress.json") as { rows: Record<string, unknown>[] }).rows[0]).sort(), ["id", "state"]);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].id, testDocId("found"));
});

test("迁移逐篇保存进度：暂停不完成，失败可重试且不重复已成功行", async () => {
    const plugin = memoryPlugin();
    const writes: string[] = [];
    let paused = false;
    let failSecond = true;
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        writeClip: async (_plugin, id) => {
            writes.push(id);
            if (id === testDocId("first")) paused = true;
            if (id === testDocId("second") && failSecond) throw new Error("temporary failure");
            return { attrs: {}, skippedKeys: [] };
        },
    });
    const rows = ["first", "second", "third"].map((label) => ({
        id: testDocId(label), title: label, hpath: `/${label}`, box: "box", url: `https://example.com/${label}`,
        site: "example.com", words: 10, minutes: 1, state: "pending" as const,
    }));
    const settings = { migrateBatchSize: 3 } as MigrateSettings;
    const task = await service.startMigrateProgress(plugin as never, rows);
    const signal = { get aborted() { return paused; } };
    const first = await service.runBackfillBatch(plugin as never, settings, { signal, expectedTaskId: task.taskId });
    assert.equal(first.processed, 1);
    assert.equal(first.cursor, 1);
    assert.equal(first.updatedRows[0].id, testDocId("first"));
    assert.equal(first.updatedRows[0].state, "ok");
    assert.equal(first.finished, false);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "ok");

    paused = false;
    const second = await service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId });
    assert.equal(second.finished, true);
    assert.equal(second.errors, 1);
    assert.deepEqual(writes, [testDocId("first"), testDocId("second"), testDocId("third")]);
    failSecond = false;
    const retry = await service.retryMigrateErrors(plugin as never, task.taskId);
    assert.equal(retry.cursor, 1);
    assert.equal(retry.finished, false);
    const third = await service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId });
    assert.equal(third.finished, true);
    assert.equal(third.errors, 0);
    assert.equal(third.ok, 3);
    assert.deepEqual(writes, [testDocId("first"), testDocId("second"), testDocId("third"), testDocId("second")]);
});

test("恢复时按确切 ID 重建最新元数据与来源，执行前再以当前正文为准", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("fresh");
    const patches: Array<Record<string, unknown>> = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids) => ids.map((id) => ({ id, content: "当前标题", hpath: "/当前位置", box: "current-box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async () => ({ content: "https://example.com/current\n\n当前正文" }),
        writeClip: async (_plugin, _id, patch) => { patches.push(patch as Record<string, unknown>); return { attrs: {}, skippedKeys: [] }; },
    });
    const taskId = "migrate-20261014000000-abcdefg";
    plugin.seed("migrate-progress.json", { version: 2, taskId, rows: [{ id: docId, state: "pending" }], cursor: 0, finished: false });
    const hydrated = await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: taskId });
    assert.equal(hydrated?.rows[0].title, "当前标题");
    assert.equal(hydrated?.rows[0].hpath, "/当前位置");
    assert.equal(hydrated?.rows[0].url, "https://example.com/current");
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: taskId });
    assert.equal(tick.ok, 1);
    assert.equal(patches[0].url, "https://example.com/current");
});

test("同一会话重复刷新迁移行复用已解析正文，显式刷新才重新探测", async () => {
    const plugin = memoryPlugin();
    const ids = [testDocId("hydrat1"), testDocId("hydrat2"), testDocId("hydrat3")];
    const urls = new Map([[ids[0], "https://example.com/one"], [ids[1], "https://example.com/two"], [ids[2], ""]]);
    let exports = 0;
    const taskId = "migrate-20261014000000-abcdefg";
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        listDocsByIds: async (docIds) => docIds.map((id) => ({ id, content: id, hpath: `/${id}`, box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (docIds) => docIds.map((id) => ({ id, attrs: {} })),
        exportMdContent: async (id) => { exports += 1; return { content: `${urls.get(id)}\n\n正文` }; },
        writeClip: async () => ({ attrs: {}, skippedKeys: [] }),
    });
    plugin.seed("migrate-progress.json", { version: 2, taskId, rows: ids.map((id) => ({ id, state: id === ids[2] ? "manual" : "pending" })), cursor: 0, finished: false });

    const initial = await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: taskId });
    assert.equal(initial?.rows.length, 3);
    assert.equal(initial?.rows[2].state, "manual");
    assert.equal(exports, 3);
    const repeated = await service.hydrateMigrateProgress(plugin as never, { expectedTaskId: taskId });
    assert.equal(repeated?.rows.length, 3);
    assert.equal(repeated?.rows[2].state, "manual");
    assert.equal(exports, 3);
    await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: taskId });
    assert.equal(exports, 6);
});

test("重载后未执行的手工选择不从来源猜回，保持待确认且不会写入", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("manual01");
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids) => ids.map((id) => ({ id, content: "当前文章", hpath: "/当前文章", box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async () => ({ content: "https://example.com/source\n\n正文" }),
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const taskId = "migrate-20261014000000-abcdefg";
    plugin.seed("migrate-progress.json", { version: 2, taskId, rows: [{ id: docId, state: "manual" }], cursor: 0, finished: false });
    const hydrated = await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: taskId });
    assert.equal(hydrated?.rows[0].state, "manual");
    assert.equal(hydrated?.rows[0].resolution, undefined);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: taskId });
    assert.equal(tick.manual, 1);
    assert.equal(writes.length, 0);
});

test("已确认的手工来源写入失败后仍可见且可再次确认；重载后不恢复旧手工 URL", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("manualf");
    const attrs: Record<string, string> = {};
    let fail = true;
    let captures = 0;
    const dependencies = {
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids: string[]) => ids.map((id) => ({ id, content: "需要手动补来源", hpath: "/需要手动补来源", box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids: string[]) => ids.map((id) => ({ id, attrs: { ...attrs } })),
        exportMdContent: async () => ({ content: "没有可自动识别的来源\n\n正文" }),
        captureClip: async () => {
            captures += 1;
            if (fail) throw new Error("temporary write failure");
            attrs["custom-clip-url"] = "https://manual.example/article";
            return { captured: true, attrs: { ...attrs } };
        },
        writeClip: async () => ({ attrs: { ...attrs }, skippedKeys: [] }),
    };
    const service = loadMigrateService(dependencies);
    const row = {
        id: docId, title: "需要手动补来源", hpath: "/需要手动补来源", box: "box", url: "https://manual.example/article", site: "manual.example",
        words: 0, minutes: 0, state: "pending" as const, resolution: "url" as const,
    };
    const task = await service.startMigrateProgress(plugin as never, [row]);
    const failed = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: task.taskId });
    assert.equal(failed.finished, true);
    assert.equal(failed.manual, 1);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "manual");
    const sameSession = await service.hydrateMigrateProgress(plugin as never, { expectedTaskId: task.taskId });
    assert.equal(sameSession?.rows[0].state, "manual");
    assert.equal(sameSession?.rows[0].detail, "planned-action-failed");

    const afterReload = loadMigrateService(dependencies);
    const restored = await afterReload.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: task.taskId });
    assert.equal(restored?.rows[0].state, "manual");
    assert.equal(restored?.rows[0].detail, "reconfirm-decision");
    assert.equal(restored?.rows[0].resolution, undefined);
    fail = false;
    const saved = await afterReload.resolveMigrateRow(plugin as never, restored!.rows[0], { kind: "url", url: "https://manual.example/article" }, task.taskId);
    assert.equal(saved.state, "ok");
    assert.equal(captures, 2);
});

test("写入成功但检查点保存失败时按当前属性展示已处理结果", async () => {
    const files = new Map<string, unknown>();
    let saves = 0;
    const plugin = {
        async loadData(name: string) { return structuredClone(files.get(name)); },
        async saveData(name: string, value: unknown) {
            saves += 1;
            if (saves > 1) throw new Error("checkpoint save failed");
            files.set(name, structuredClone(value));
        },
        async removeData(name: string) { files.delete(name); },
    };
    const docId = testDocId("acklost");
    const attrs: Record<string, string> = {};
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids) => ids.map((id) => ({ id, content: "已写入文档", hpath: "/已写入文档", box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: { ...attrs } })),
        exportMdContent: async () => ({ content: "正文" }),
        captureClip: async (_plugin, _id, options) => {
            attrs["custom-clip-url"] = String(options.url ?? "");
            return { captured: true, attrs: { ...attrs } };
        },
        writeClip: async () => ({ attrs: { ...attrs }, skippedKeys: [] }),
    });
    const row = { id: docId, title: "旧", hpath: "/旧", box: "box", url: "", site: "", words: 0, minutes: 0, state: "manual" as const };
    const task = await service.startMigrateProgress(plugin as never, [row]);
    await assert.rejects(service.resolveMigrateRow(plugin as never, row, { kind: "url", url: "https://manual.example/article" }, task.taskId));
    const hydrated = await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: task.taskId });
    assert.equal(hydrated?.rows[0].state, "skipped");
    assert.equal(hydrated?.rows[0].url, "https://manual.example/article");
    assert.equal(hydrated?.rows[0].detail, "already-clipped");
});

test("恢复时外部已补齐的手工行同步到检查点，续跑可以正常收尾", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("external");
    const taskId = "migrate-20261014000000-abcdefg";
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids) => ids.map((id) => ({ id, content: "已从其他入口收录", hpath: "/已收录", box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: { "custom-clip-url": "https://example.com/external" } })),
        exportMdContent: async () => ({ content: "正文" }),
        writeClip: async () => { writes.push("write"); return { attrs: {}, skippedKeys: [] }; },
    });
    plugin.seed("migrate-progress.json", { version: 2, taskId, rows: [{ id: docId, state: "manual", conflictDocId: testDocId("conflict") }], cursor: 0, finished: false });

    const hydrated = await service.hydrateMigrateProgress(plugin as never, { refresh: true, expectedTaskId: taskId });
    assert.equal(hydrated?.rows[0].state, "skipped");
    assert.equal(hydrated?.reconciled, true);
    assert.deepEqual((await service.loadMigrateProgress(plugin as never, taskId))?.rows[0], { id: docId, state: "skipped" });

    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: taskId });
    assert.equal(tick.finished, true);
    assert.equal(tick.manual, 0);
    assert.equal(tick.skipped, 1);
    assert.deepEqual(writes, ["write"]);
});

test("旧弹窗 taskId 不能清理、重试、回填或裁决后来创建的新任务", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("sameid");
    const captured: string[] = [];
    let taskNumber = 0;
    const service = loadMigrateService({
        newNodeId: () => `20261014000000-${String.fromCharCode(97 + taskNumber++).repeat(7)}`,
        listAnchorDocs: async () => [],
        listDocsByIds: async (ids) => ids.map((id) => ({ id, content: "当前文档", hpath: "/当前文档", box: "box", updated: "", tag: "" })),
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        captureClip: async (_plugin, _id, options) => { captured.push(String(options.url ?? "")); return { captured: true, attrs: {} }; },
        writeClip: async () => ({ attrs: {}, skippedKeys: [] }),
    });
    const oldTask = await service.startMigrateProgress(plugin as never, [{
        id: docId, title: "旧任务", hpath: "/旧任务", box: "box", url: "https://example.com/old", site: "example.com", words: 1, minutes: 1, state: "pending",
    }]);
    await service.clearMigrateProgress(plugin as never, oldTask.taskId);
    const newTask = await service.startMigrateProgress(plugin as never, [{
        id: docId, title: "新任务", hpath: "/新任务", box: "box", url: "https://example.com/new", site: "example.com", words: 1, minutes: 1, state: "pending", resolution: "url",
    }]);
    const changed = (error: { reason?: string }) => error.reason === "changed";
    await assert.rejects(service.clearMigrateProgress(plugin as never, oldTask.taskId), changed);
    await assert.rejects(service.retryMigrateErrors(plugin as never, oldTask.taskId), changed);
    await assert.rejects(service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: oldTask.taskId }), changed);
    await assert.rejects(service.resolveMigrateRow(plugin as never, { id: docId } as MigrateRow, { kind: "local" }, oldTask.taskId), changed);
    await assert.rejects(service.dropInterruptedMigrateDecisions(plugin as never, oldTask.taskId), changed);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.taskId, newTask.taskId);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: newTask.taskId });
    assert.equal(tick.ok, 1);
    assert.deepEqual(captured, ["https://example.com/new"]);
});

test("迁移写操作缺少有效 taskId 时失败关闭", async () => {
    const plugin = memoryPlugin();
    const docId = testDocId("missingid");
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async () => ({ content: "正文" }),
        writeClip: async () => { writes.push("write"); return { attrs: {}, skippedKeys: [] }; },
    });
    const task = await service.startMigrateProgress(plugin as never, [{
        id: docId, title: "任务", hpath: "/任务", box: "box", url: "https://example.com/missingid", site: "example.com",
        words: 1, minutes: 1, state: "pending",
    }]);
    const changed = (error: { reason?: string }) => error.reason === "changed";

    await assert.rejects(service.clearMigrateProgress(plugin as never, ""), changed);
    await assert.rejects(service.retryMigrateErrors(plugin as never, ""), changed);
    await assert.rejects(service.runBackfillBatch(plugin as never, { migrateBatchSize: 1 } as MigrateSettings, { expectedTaskId: "" }), changed);
    await assert.rejects(service.resolveMigrateRow(plugin as never, { id: docId } as MigrateRow, { kind: "local" }, ""), changed);
    await assert.rejects(service.dropInterruptedMigrateDecisions(plugin as never, ""), changed);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.taskId, task.taskId);
    assert.deepEqual(writes, []);
});

test("只有状态的旧文继续补来源，同时保护已有状态", async () => {
    const plugin = memoryPlugin();
    const patches: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: { "custom-clip-status": "reading" } })),
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        writeClip: async (_plugin, _id, patch) => { patches.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const task = await service.startMigrateProgress(plugin as never, [{
        id: testDocId("changed"), title: "changed", hpath: "/changed", box: "box", url: "https://example.com/changed",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings, { expectedTaskId: task.taskId });
    assert.equal(patches.length, 1);
    assert.equal(patches[0].url, "https://example.com/changed");
    assert.equal(patches[0].status, undefined);
    assert.equal(tick.ok, 1);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "ok");
});

test("属性已写但索引同步失败时，续跑只修复索引不覆盖属性", async () => {
    const plugin = memoryPlugin();
    const attrs: Record<string, string> = {};
    const patches: unknown[] = [];
    let failIndex = true;
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: { ...attrs } })),
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        writeClip: async (_plugin, _id, patch) => {
            patches.push(patch);
            if (failIndex) {
                attrs["custom-clip-url"] = "https://example.com/once";
                attrs["custom-clip-status"] = "inbox";
                failIndex = false;
                throw new Error("index save failed");
            }
            return { attrs: {}, skippedKeys: [] };
        },
    });
    const task = await service.startMigrateProgress(plugin as never, [{
        id: testDocId("once"), title: "once", hpath: "/once", box: "box", url: "https://example.com/once",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const settings = { migrateBatchSize: 1 } as MigrateSettings;
    assert.equal((await service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId })).errors, 1);
    await service.retryMigrateErrors(plugin as never, task.taskId);
    const tick = await service.runBackfillBatch(plugin as never, settings, { expectedTaskId: task.taskId });
    assert.equal(tick.skipped, 1);
    assert.deepEqual(patches[1], {});
    assert.equal(patches.length, 2);
});

test("手工迁移行裁决会写属性并同步保存任务，而不是伪报完成", async () => {
    const plugin = memoryPlugin();
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: testDocId("manual"), attrs: {} }],
        exportMdContent: async () => ({ content: "# 旧文\n\n正文" }),
        captureClip: async (_plugin, id, options) => {
            patches.push({ id, patch: options });
            return { captured: true, attrs: {} };
        },
        writeClip: async (_plugin, id, patch) => {
            patches.push({ id, patch: patch as Record<string, unknown> });
            return { attrs: {}, skippedKeys: [] };
        },
    });
    const row = {
        id: testDocId("manual"), title: "旧文", hpath: "/旧文", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const, missing: ["url" as const],
    };
    const task = await service.startMigrateProgress(plugin as never, [row]);
    const resolved = await service.resolveMigrateRow(plugin as never, row, { kind: "url", url: "https://example.com/old" }, task.taskId);
    assert.equal(resolved.state, "ok");
    assert.equal(resolved.url, "https://example.com/old");
    assert.equal(patches[0].patch.url, "https://example.com/old");
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "ok");
});

test("迁移 URL 冲突会保留 manual，允许第二份才继续写入", async () => {
    const plugin = memoryPlugin();
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: testDocId("dup"), attrs: {} }],
        exportMdContent: async () => ({ content: "正文" }),
        captureClip: async (_plugin, _id, options) => {
            writes.push(options);
            return { captured: true, attrs: {} };
        },
        findClipUrlConflict: async () => ({ id: testDocId("exist01"), title: "已有" }),
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const row = {
        id: testDocId("dup"), title: "重复", hpath: "/重复", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const, missing: ["url" as const],
    };
    const task = await service.startMigrateProgress(plugin as never, [row]);
    const conflict = await service.resolveMigrateRow(plugin as never, row, { kind: "url", url: "https://example.com/same" }, task.taskId);
    assert.equal(conflict.state, "manual");
    assert.equal(conflict.conflictDocId, testDocId("exist01"));
    assert.equal(writes.length, 0);
    const kept = await service.resolveMigrateRow(plugin as never, conflict, { kind: "url", url: "https://example.com/same", allowDuplicate: true }, task.taskId);
    assert.equal(kept.state, "ok");
    assert.equal(writes.length > 0, true);
});

test("预览手工裁决只改变执行计划，确认后才写文档", async () => {
    const plugin = memoryPlugin();
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: testDocId("planned"), attrs: {} }],
        exportMdContent: async () => ({ content: "# 旧文\n\n正文" }),
        captureClip: async (_plugin, _id, options) => { writes.push(options); return { captured: true, attrs: {} }; },
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const row = {
        id: testDocId("planned"), title: "旧文", hpath: "/旧文", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const,
    };
    const plan = service.planMigrateRow(row, { kind: "local" });
    assert.equal(plan.resolution, "local");
    assert.equal(writes.length, 0);
    assert.equal(await service.loadMigrateProgress(plugin as never), null);
    const task = await service.startMigrateProgress(plugin as never, [plan]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings, { expectedTaskId: task.taskId });
    assert.equal(tick.ok, 1);
    assert.equal(writes.length, 1);
});

test("执行期 URL 冲突保留 manual 任务，重开后仍可裁决", async () => {
    const plugin = memoryPlugin();
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: testDocId("pending"), attrs: {} }],
        exportMdContent: async (id) => ({ content: `${sourceForId(id)}\n\n正文` }),
        findClipUrlConflict: async () => ({ id: testDocId("exist01"), title: "已有" }),
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const task = await service.startMigrateProgress(plugin as never, [{
        id: testDocId("pending"), title: "待写", hpath: "/待写", box: "box", url: "https://example.com/same",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings, { expectedTaskId: task.taskId });
    assert.equal(tick.finished, true);
    assert.equal(tick.manual, 1);
    assert.equal(writes.length, 0);
    const saved = await service.loadMigrateProgress(plugin as never);
    assert.equal(saved?.rows[0].conflictDocId, testDocId("exist01"));
    assert.equal(saved?.rows[0].state, "manual");
});

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
            exportMdContent: mocks.exportMdContent,
        },
        "../domain/candidate-policy": candidatePolicy,
        "../domain/content": content,
        "../domain/schema": schema,
        "../domain/url": { normalizeUrl: (value: string) => value.trim().toLowerCase().replace(/#.*$/, "") },
        "./clip-store": {
            listAnchorDocs: mocks.listAnchorDocs,
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
    };
}

test("迁移 dry-run 只预览有证据的文章，普通笔记不会被误报", async () => {
    const plugin = memoryPlugin();
    const docs = ["found", "missing", "already"].map((id) => ({ id, content: id, hpath: `/${id}`, box: "box", updated: "" }));
    const service = loadMigrateService({
        listAnchorDocs: async () => docs,
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: id === "already" ? {
            "custom-clip-status": "later", "custom-clip-url": "https://example.com/already",
        } : {} })),
        exportMdContent: async (id) => ({ content: id === "found" ? "https://example.com/article\n\n正文" : "没有来源链接" }),
        writeClip: async () => ({ attrs: {}, skippedKeys: [] }),
    });
    const report = await service.buildDryRunReport({ anchorNotebooks: ["box"] } as MigrateSettings);
    assert.deepEqual(report.map((row) => row.state), ["pending", "skipped"]);
    assert.equal(await service.loadMigrateProgress(plugin as never), null);
    const task = await service.startMigrateProgress(plugin as never, report);
    assert.equal(task.rows.length, 2);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].url, "https://example.com/article");
});

test("迁移逐篇保存进度：暂停不完成，失败可重试且不重复已成功行", async () => {
    const plugin = memoryPlugin();
    const writes: string[] = [];
    let paused = false;
    let failSecond = true;
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: {} })),
        exportMdContent: async () => ({ content: "" }),
        writeClip: async (_plugin, id) => {
            writes.push(id);
            if (id === "first") paused = true;
            if (id === "second" && failSecond) throw new Error("temporary failure");
            return { attrs: {}, skippedKeys: [] };
        },
    });
    const rows = ["first", "second", "third"].map((id) => ({
        id, title: id, hpath: `/${id}`, box: "box", url: `https://example.com/${id}`,
        site: "example.com", words: 10, minutes: 1, state: "pending" as const,
    }));
    const settings = { migrateBatchSize: 3 } as MigrateSettings;
    await service.startMigrateProgress(plugin as never, rows);
    const signal = { get aborted() { return paused; } };
    const first = await service.runBackfillBatch(plugin as never, settings, { signal });
    assert.equal(first.processed, 1);
    assert.equal(first.finished, false);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[0].state, "ok");

    paused = false;
    const second = await service.runBackfillBatch(plugin as never, settings);
    assert.equal(second.finished, true);
    assert.equal(second.errors, 1);
    assert.deepEqual(writes, ["first", "second", "third"]);
    failSecond = false;
    const retry = await service.retryMigrateErrors(plugin as never);
    assert.equal(retry.cursor, 1);
    assert.equal(retry.finished, false);
    const third = await service.runBackfillBatch(plugin as never, settings);
    assert.equal(third.finished, true);
    assert.equal(third.errors, 0);
    assert.equal(third.ok, 3);
    assert.deepEqual(writes, ["first", "second", "third", "second"]);
});

test("只有状态的旧文继续补来源，同时保护已有状态", async () => {
    const plugin = memoryPlugin();
    const patches: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async (ids) => ids.map((id) => ({ id, attrs: { "custom-clip-status": "reading" } })),
        exportMdContent: async () => ({ content: "" }),
        writeClip: async (_plugin, _id, patch) => { patches.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    await service.startMigrateProgress(plugin as never, [{
        id: "changed", title: "changed", hpath: "/changed", box: "box", url: "https://example.com/changed",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings);
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
        exportMdContent: async () => ({ content: "" }),
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
    await service.startMigrateProgress(plugin as never, [{
        id: "once", title: "once", hpath: "/once", box: "box", url: "https://example.com/once",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const settings = { migrateBatchSize: 1 } as MigrateSettings;
    assert.equal((await service.runBackfillBatch(plugin as never, settings)).errors, 1);
    await service.retryMigrateErrors(plugin as never);
    const tick = await service.runBackfillBatch(plugin as never, settings);
    assert.equal(tick.skipped, 1);
    assert.deepEqual(patches[1], {});
    assert.equal(patches.length, 2);
});

test("手工迁移行裁决会写属性并同步保存任务，而不是伪报完成", async () => {
    const plugin = memoryPlugin();
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: "manual", attrs: {} }],
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
        id: "manual", title: "旧文", hpath: "/旧文", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const, missing: ["url" as const],
    };
    await service.startMigrateProgress(plugin as never, [row]);
    const resolved = await service.resolveMigrateRow(plugin as never, row, { kind: "url", url: "https://example.com/old" });
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
        batchGetBlockAttrs: async () => [{ id: "dup", attrs: {} }],
        exportMdContent: async () => ({ content: "正文" }),
        captureClip: async (_plugin, _id, options) => {
            writes.push(options);
            return { captured: true, attrs: {} };
        },
        findClipUrlConflict: async () => ({ id: "existing", title: "已有" }),
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const row = {
        id: "dup", title: "重复", hpath: "/重复", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const, missing: ["url" as const],
    };
    await service.startMigrateProgress(plugin as never, [row]);
    const conflict = await service.resolveMigrateRow(plugin as never, row, { kind: "url", url: "https://example.com/same" });
    assert.equal(conflict.state, "manual");
    assert.equal(conflict.conflictDocId, "existing");
    assert.equal(writes.length, 0);
    const kept = await service.resolveMigrateRow(plugin as never, conflict, { kind: "url", url: "https://example.com/same", allowDuplicate: true });
    assert.equal(kept.state, "ok");
    assert.equal(writes.length > 0, true);
});

test("预览手工裁决只改变执行计划，确认后才写文档", async () => {
    const plugin = memoryPlugin();
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: "planned", attrs: {} }],
        exportMdContent: async () => ({ content: "# 旧文\n\n正文" }),
        captureClip: async (_plugin, _id, options) => { writes.push(options); return { captured: true, attrs: {} }; },
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    const row = {
        id: "planned", title: "旧文", hpath: "/旧文", box: "box", url: "", site: "",
        words: 0, minutes: 0, state: "manual" as const,
    };
    const plan = service.planMigrateRow(row, { kind: "local" });
    assert.equal(plan.resolution, "local");
    assert.equal(writes.length, 0);
    assert.equal(await service.loadMigrateProgress(plugin as never), null);
    await service.startMigrateProgress(plugin as never, [plan]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings);
    assert.equal(tick.ok, 1);
    assert.equal(writes.length, 1);
});

test("执行期 URL 冲突保留 manual 任务，重开后仍可裁决", async () => {
    const plugin = memoryPlugin();
    const writes: unknown[] = [];
    const service = loadMigrateService({
        listAnchorDocs: async () => [],
        batchGetBlockAttrs: async () => [{ id: "pending", attrs: {} }],
        exportMdContent: async () => ({ content: "" }),
        findClipUrlConflict: async () => ({ id: "existing", title: "已有" }),
        writeClip: async (_plugin, _id, patch) => { writes.push(patch); return { attrs: {}, skippedKeys: [] }; },
    });
    await service.startMigrateProgress(plugin as never, [{
        id: "pending", title: "待写", hpath: "/待写", box: "box", url: "https://example.com/same",
        site: "example.com", words: 10, minutes: 1, state: "pending",
    }]);
    const tick = await service.runBackfillBatch(plugin as never, { migrateBatchSize: 10 } as MigrateSettings);
    assert.equal(tick.finished, true);
    assert.equal(tick.manual, 1);
    assert.equal(writes.length, 0);
    const saved = await service.loadMigrateProgress(plugin as never);
    assert.equal(saved?.rows[0].conflictDocId, "existing");
    assert.equal(saved?.rows[0].state, "manual");
});

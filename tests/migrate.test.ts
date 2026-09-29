/** domain/migrate 启发式单测 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import { bestUrlCandidate, extractUrlCandidates, stripMarkdown } from "../src/domain/migrate.ts";
import { DEFAULT_MIGRATE_BATCH_SIZE, MAX_MIGRATE_BATCH_SIZE } from "../src/domain/migrate-consts.ts";
import * as schema from "../src/domain/schema.ts";

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
    batchGetBlockAttrs: (ids: string[]) => Promise<{ id: string; attrs: Record<string, string> }[]>;
    exportMdContent: (id: string) => Promise<{ content: string }>;
    writeClip: (plugin: unknown, id: string, patch: unknown) => Promise<{ attrs: Record<string, unknown>; skippedKeys: string[] }>;
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
        "../domain/migrate": { bestUrlCandidate, stripMarkdown },
        "../domain/schema": schema,
        "./clip-store": { listAnchorDocs: mocks.listAnchorDocs, batchReadClipAttrs: mocks.batchGetBlockAttrs, writeClip: mocks.writeClip },
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

test("迁移 dry-run 在预览时分类无 URL，确认后才建立可续跑任务", async () => {
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
    assert.deepEqual(report.map((row) => row.state), ["pending", "manual", "skipped"]);
    assert.equal(await service.loadMigrateProgress(plugin as never), null);
    const task = await service.startMigrateProgress(plugin as never, report);
    assert.equal(task.rows.length, 3);
    assert.equal((await service.loadMigrateProgress(plugin as never))?.rows[1].state, "manual");
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

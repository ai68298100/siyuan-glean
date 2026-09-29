/*
 * S1 服务级 E2E：真实隔离内核 + 仓库服务源码，不驱动作者的思源窗口。
 * 运行：node scripts/e2e/s1-flow.mjs
 * 每次创建带专属标记的新工作区，测试数据与插件 saveData 均留在该工作区供排错。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    waitForBoot,
    shutdownKernel,
} from "../spike/kernel-harness.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "127.0.0.1";
const MARKER = "glean-s1-e2e.json";
const CREATED_BY = "siyuan-glean-s1-flow";
const WORKSPACE = path.join(os.tmpdir(), `siyuan-glean-s1-${Date.now()}-${process.pid}`);

// Node 只替换思源前端 SDK 的传输入口；业务服务、属性校验、索引和迁移逻辑均加载源码。
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-s1-e2e:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-s1-e2e:siyuan") {
            return {
                format: "module",
                source: "export const fetchPost = (...args) => globalThis.__gleanS1FetchPost(...args);",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

function pluginDataAt(workspace) {
    const dir = path.join(workspace, "glean-s1-service-data");
    fs.mkdirSync(dir, { recursive: true });
    const filename = (name) => {
        if (!/^[a-z0-9-]+\.json$/i.test(name)) throw new Error(`非法 saveData 文件名: ${name}`);
        return path.join(dir, name);
    };
    return () => ({
        async loadData(name) {
            try { return JSON.parse(fs.readFileSync(filename(name), "utf8")); }
            catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
        },
        async saveData(name, value) {
            fs.writeFileSync(filename(name), `${JSON.stringify(value, null, 2)}\n`);
        },
        async removeData(name) {
            fs.rmSync(filename(name), { force: true });
        },
    });
}

async function choosePort() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const port = 30000 + Math.floor(Math.random() * 25000);
        try { await assertTestPortAvailable(HOST, port); return port; }
        catch (error) { if (attempt === 19) throw error; }
    }
    throw new Error("没有可用的回环测试端口");
}

async function until(label, check, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const value = await check();
            if (value) return value;
        } catch (error) { lastError = error; }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`${label} 未在 ${timeoutMs}ms 内满足${lastError ? `：${lastError.message}` : ""}`);
}

function pass(label) { console.log(`✓ ${label}`); }

async function runFlow(client, workspace) {
    const clip = await import("../../src/services/clip-store.ts");
    const migrate = await import("../../src/services/migrate-service.ts");
    const importer = await import("../../src/services/import-service.ts");
    const carrier = await import("../../src/domain/carrier.ts");
    const library = await import("../../src/domain/library-view.ts");
    const newPlugin = pluginDataAt(workspace);
    const plugin = newPlugin();

    const notebookName = "GleanS1Flow";
    await client.apiChecked("/api/notebook/createNotebook", { name: notebookName });
    const listing = await client.apiChecked("/api/notebook/lsNotebooks", {});
    const box = listing.notebooks.find((item) => item.name === notebookName)?.id;
    assert.match(box ?? "", /^\d{14}-[0-9a-z]{7}$/);
    const settings = { anchorNotebooks: [box], migrateBatchSize: 1 };

    const makeDoc = (title, body, tags = "") => client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: `/S1/${title}`,
        markdown: `# ${title}\n\n${body}`,
        tags,
    });
    const ordinary = await makeDoc("待发现普通文", "这是锚点笔记本中的候选文章。");
    const urlOnly = await makeDoc("待补全来源文", "这篇文档已有来源网址，却还没有状态。");
    const oldA = await makeDoc("旧文甲", "- [https://example.org/s1-old-a](https://example.org/s1-old-a)\n\n第一篇历史正文。");
    const oldB = await makeDoc("旧文乙", "- [https://example.org/s1-old-b](https://example.org/s1-old-b)\n\n第二篇历史正文。");
    const noUrl = await makeDoc("待手填来源文", "没有链接的历史正文。", "剪藏");
    const docIds = [ordinary, urlOnly, oldA, oldB, noUrl];
    await until("锚点笔记本 SQL 索引", async () => {
        const rows = await clip.listAnchorDocs([box]);
        return docIds.every((id) => rows.some((row) => row.id === id)) && rows.every((row) => row.box === box);
    });
    const firstIndex = await clip.reconcileIndex(plugin, settings);
    assert(firstIndex.candidates[oldA] && firstIndex.candidates[oldB] && firstIndex.candidates[noUrl]);
    assert.equal(firstIndex.candidates[ordinary], undefined);
    assert.equal(firstIndex.candidates[urlOnly], undefined);
    pass("真实笔记本 ID 完整扫描；只有来源或精确标签证据成为候选");

    const sourceUrl = "https://example.org/s1-url-only";
    await clip.writeClip(plugin, urlOnly, { url: sourceUrl });
    const partial = await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly });
    assert.equal(partial["custom-clip-url"], sourceUrl);
    assert.equal(partial["custom-clip-status"], undefined);
    const partialIndex = await clip.reconcileIndex(newPlugin(), settings);
    assert(partialIndex.candidates[urlOnly]);
    const captured = await clip.captureClip(plugin, urlOnly, {
        url: "https://example.org/must-not-overwrite",
        src: "manual",
    });
    assert.equal(captured.captured, true);
    assert.equal(captured.attrs.url, sourceUrl);
    assert.equal(captured.attrs.status, "inbox");
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly }))["custom-clip-url"], sourceUrl);
    pass("URL-only 半成品仍是候选；显式收录补状态并保留原 URL");

    const report = await migrate.buildDryRunReport(settings);
    const byId = new Map(report.map((row) => [row.id, row]));
    assert.equal(byId.get(oldA)?.state, "pending");
    assert.equal(byId.get(oldB)?.state, "pending");
    assert.equal(byId.get(noUrl)?.state, "manual");
    assert.equal(byId.get(urlOnly)?.state, "skipped");
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: oldA }))["custom-clip-status"], undefined);
    await migrate.startMigrateProgress(plugin, [byId.get(oldA), byId.get(oldB), byId.get(noUrl)]);
    assert.equal((await migrate.loadMigrateProgress(newPlugin())).rows.length, 3);
    const firstTick = await migrate.runBackfillBatch(newPlugin(), settings);
    assert.equal(firstTick.processed, 1);
    assert.equal(firstTick.finished, false);
    const stopped = await migrate.runBackfillBatch(newPlugin(), settings, { signal: { aborted: true } });
    assert.equal(stopped.finished, false);
    assert.equal((await migrate.loadMigrateProgress(newPlugin())).cursor, 1);
    let progress = await migrate.loadMigrateProgress(newPlugin());
    while (!progress.finished) {
        await migrate.runBackfillBatch(newPlugin(), settings);
        progress = await migrate.loadMigrateProgress(newPlugin());
    }
    assert.deepEqual(progress.rows.map((row) => row.state), ["ok", "ok", "manual"]);
    for (const id of [oldA, oldB]) {
        const attrs = await client.apiChecked("/api/attr/getBlockAttrs", { id });
        assert.equal(attrs["custom-clip-status"], "inbox");
        assert.equal(attrs["custom-clip-src"], "migration");
        assert.match(attrs["custom-clip-time"], /^\d{14}$/);
    }
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: noUrl }))["custom-clip-status"], undefined);
    pass("dry-run 无写入；进度持久化、暂停恢复、分批回填和手填分类");

    assert.equal(await clip.batchSetStatus(newPlugin(), [urlOnly], "reading"), 1);
    assert.equal((await clip.readClip(urlOnly)).status, "reading");
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly }))["custom-clip-status"], "reading");
    assert.equal((await clip.reconcileIndex(newPlugin(), settings)).clips[urlOnly].status, "reading");
    pass("显式改状态真实落在文档属性及派生索引");

    const csv = [
        "title,url,time_added,status,tags",
        '导入旧文,https://example.org/s1-import,1577934245,read,"技术,历史"',
    ].join("\n");
    const preview = await importer.previewImport(csv, "pocket-csv");
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].duplicate, false);
    const imported = await importer.runImport(newPlugin(), preview.rows, {
        notebookId: box,
        folder: "S1导入",
        format: "pocket-csv",
    });
    assert.equal(imported.imported, 1);
    assert.equal(imported.failed, 0);
    const importedId = imported.docIds[0];
    const importedAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: importedId });
    assert.equal(importedAttrs["custom-clip-url"], preview.rows[0].url);
    assert.equal(importedAttrs["custom-clip-time"], preview.rows[0].time);
    assert.equal(importedAttrs["custom-clip-status"], "done");
    assert.equal(importedAttrs["custom-clip-src"], "import-pocket");
    const tags = Array.isArray(importedAttrs.tags) ? importedAttrs.tags.join(",") : String(importedAttrs.tags ?? "");
    assert(tags.includes("技术") && tags.includes("历史"));
    pass("Pocket CSV 导入标签、历史收藏时间与已读状态");

    const fulltext = await makeDoc("S3全文", "- [https://example.org/s3-fulltext](https://example.org/s3-fulltext)\n\n这篇剪藏有可在思源内阅读的完整正文。", "阅读,技术");
    const link = await makeDoc("S3仅链接", "- [https://example.org/s3-link](https://example.org/s3-link)");
    const local = await makeDoc("S3本地文", "这是用户明确加入读库的本地笔记，正文保留在思源中。");
    const unknown = await makeDoc("S3旧数据", "历史文档的载体未确认。");
    const fulltextCapture = await clip.captureDocument(newPlugin(), fulltext, { src: "web-clipper" });
    const linkCapture = await clip.captureDocument(newPlugin(), link, { src: "web-clipper" });
    const localCapture = await clip.captureDocument(newPlugin(), local, { src: "manual" });
    assert.equal(fulltextCapture.attrs.contentType, "fulltext");
    assert.equal(fulltextCapture.attrs.url, "https://example.org/s3-fulltext");
    assert(fulltextCapture.attrs.words > 0);
    assert.equal(linkCapture.attrs.contentType, "link");
    assert.equal(linkCapture.attrs.url, "https://example.org/s3-link");
    assert.equal(linkCapture.attrs.words, undefined);
    assert.equal(localCapture.attrs.contentType, "local");
    assert.equal(localCapture.attrs.url, undefined);
    await clip.writeClip(newPlugin(), unknown, { status: "later", url: "https://example.org/s3-unknown" });
    assert.equal((await clip.readClip(unknown)).contentType, undefined);
    assert.equal(carrier.openTargetForCarrier(fulltextCapture.attrs.contentType, fulltextCapture.attrs.url), "document");
    assert.equal(carrier.sourceUrlForCarrier(fulltextCapture.attrs.contentType, fulltextCapture.attrs.url), fulltextCapture.attrs.url);
    assert.equal(carrier.openTargetForCarrier(linkCapture.attrs.contentType, linkCapture.attrs.url), "source");
    assert.equal(carrier.openTargetForCarrier("link", "javascript:alert(1)"), "document");
    assert.equal(carrier.sourceUrlForCarrier("link", "javascript:alert(1)"), "");
    assert.equal(carrier.openTargetForCarrier(localCapture.attrs.contentType, localCapture.attrs.url), "document");
    assert.equal(carrier.sourceUrlForCarrier("local", "https://example.org/incidental"), "");
    assert.equal(carrier.openTargetForCarrier(undefined, "https://example.org/s3-unknown"), "document");
    assert.equal(carrier.sourceUrlForCarrier(undefined, "https://example.org/s3-unknown"), "");
    pass("全文、仅链接、本地与未知载体真实收录；主入口及来源动作遵守载体属性");

    const ranked = await clip.writeClip(newPlugin(), fulltext, { priority: 5, rating: 4 }, { force: true });
    assert.equal(ranked.attrs.priority, 5);
    assert.equal(ranked.attrs.rating, 4);
    const protectedWrite = await clip.writeClip(newPlugin(), fulltext, {
        url: "https://example.org/should-not-replace", status: "done", priority: 1, rating: 1,
    });
    assert.deepEqual(protectedWrite.skippedKeys, [
        "custom-clip-url", "custom-clip-status", "custom-clip-priority", "custom-clip-rating",
    ]);
    assert.equal(protectedWrite.attrs.status, "inbox");
    assert.equal(protectedWrite.attrs.priority, 5);
    assert.equal(protectedWrite.attrs.rating, 4);
    for (const status of ["later", "reading", "done", "archived", "later"]) {
        assert.equal(await clip.batchSetStatus(newPlugin(), [fulltext], status), 1);
        const attrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
        const index = await newPlugin().loadData("glean-index.json");
        assert.equal(attrs["custom-clip-status"], status);
        assert.equal(index.clips[fulltext].status, status);
        assert.equal(attrs["custom-clip-priority"], "5");
        assert.equal(attrs["custom-clip-rating"], "4");
    }
    pass("显式优先级、评分和五态动作持久化；普通补丁保留用户手填字段");

    const beforeFilter = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
    const currentIndex = await newPlugin().loadData("glean-index.json");
    const items = Object.values(currentIndex.clips).map((entry) => ({ ...entry, kind: "clip" }));
    const filtered = library.filterAndSortLibrary(items, {
        status: "later", tag: "阅读", src: "web-clipper", contentType: "fulltext", sortBy: "priority",
    });
    assert.deepEqual(filtered.map((item) => item.id), [fulltext]);
    assert(library.libraryFacets(items).tags.some((facet) => facet.value === "阅读"));
    assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext }), beforeFilter);
    pass("真实索引上的组合筛选和排序只改变视图，不改文档属性");

    const clipIds = [urlOnly, oldA, oldB, importedId, fulltext, link, local, unknown];
    await until("新收录文档 SQL 属性索引", async () => {
        const rows = await clip.listClipDocs();
        return clipIds.every((id) => rows.some((row) => row.id === id));
    });
    await plugin.removeData("glean-index.json");
    const rebuilt = await clip.rebuildIndex(newPlugin(), settings);
    assert.equal(rebuilt.clips[urlOnly].status, "reading");
    assert.equal(rebuilt.clips[oldA].status, "inbox");
    assert.equal(rebuilt.clips[oldB].status, "inbox");
    assert.equal(rebuilt.clips[importedId].status, "done");
    assert.equal(rebuilt.clips[fulltext].status, "later");
    assert.equal(rebuilt.clips[fulltext].contentType, "fulltext");
    assert.equal(rebuilt.clips[fulltext].src, "web-clipper");
    assert(rebuilt.clips[fulltext].tags.includes("阅读"));
    assert.equal(rebuilt.clips[fulltext].priority, 5);
    assert.equal(rebuilt.clips[fulltext].rating, 4);
    assert.equal(rebuilt.clips[link].contentType, "link");
    assert.equal(rebuilt.clips[local].contentType, "local");
    assert.equal(rebuilt.clips[unknown].contentType, "");
    assert(rebuilt.clips[importedId].tags.includes("技术"));
    assert(rebuilt.candidates[noUrl]);
    assert.equal(rebuilt.candidates[ordinary], undefined);
    assert.equal(rebuilt.candidates[urlOnly], undefined);
    pass("删除派生索引后从内核属性重建收录与候选一致");
}

async function main() {
    process.chdir(REPO);
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(WORKSPACE, MARKER, CREATED_BY);
    const port = await choosePort();
    const base = `http://${HOST}:${port}`;
    const client = createApiClient(base);
    const { child, lines } = startKernel(kernel, appDir, WORKSPACE, port);
    client.onGuard(() => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
    });
    try {
        const version = await waitForBoot(base, lines, () => {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
        }, client);
        const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
        client.setToken(conf.accessAuthCode || "");
        await client.apiChecked("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        globalThis.__gleanS1FetchPost = (route, body, callback) => {
            void client.api(route, body).then(callback, (error) => callback({ code: -1, msg: String(error) }));
        };
        console.log(`S1 服务级 E2E：内核 ${JSON.stringify(version)}，回环端口 ${port}`);
        console.log(`隔离工作区：${WORKSPACE}`);
        await runFlow(client, WORKSPACE);
        console.log("S1 服务级 E2E：全部通过");
    } finally {
        await shutdownKernel(client, child);
    }
}

main().catch((error) => {
    console.error(`S1 服务级 E2E 失败：${error.stack || error}`);
    process.exitCode = 1;
});

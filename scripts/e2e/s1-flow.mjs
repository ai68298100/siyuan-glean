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
    const settings = {
        anchorNotebooks: [box],
        migrateBatchSize: 1,
        resurface: { dailyCount: 2, includeDoneHighlights: false },
        staleDays: 90,
    };

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
        "title,url,time_added,time_read,status,tags",
        '导入旧文,https://example.org/s1-import,1577934245,1578020645,read,"技术,历史"',
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
    assert.match(importedAttrs["custom-clip-done-time"], /^\d{14}$/);
    const tags = Array.isArray(importedAttrs.tags) ? importedAttrs.tags.join(",") : String(importedAttrs.tags ?? "");
    assert(tags.includes("技术") && tags.includes("历史"));
    pass("Pocket CSV 导入标签、历史收藏时间、已读状态与可靠完成时间");

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

    // D-0028 完成时间：显式标记读完写入，归档/恢复保留"读过"事实。
    assert.equal(await clip.batchSetStatus(newPlugin(), [urlOnly], "done"), 1);
    const doneAt = (await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly }))["custom-clip-done-time"];
    assert.match(doneAt ?? "", /^\d{14}$/);
    await clip.batchSetStatus(newPlugin(), [urlOnly], "archived");
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly }))["custom-clip-done-time"], doneAt);
    pass("显式标记读完写入完成时间；归档保留读过事实");

    // T-1727 正文诊断：显式测量导出重算字数并写回；空正文给出 missing 结论。
    const content = await import("../../src/domain/content.ts");
    assert.equal(content.fulltextBodyState("fulltext", 120), "ok");
    assert.equal(content.fulltextBodyState("fulltext", 0), "missing");
    assert.equal(content.fulltextBodyState("fulltext", undefined), "unmeasured");
    assert.equal(content.fulltextBodyState("link", 0), "na");
    const hollow = await makeDoc("S3待检正文", "- [https://example.org/s3-hollow](https://example.org/s3-hollow)");
    const hollowCapture = await clip.captureClip(plugin, hollow, { src: "web-clipper", contentType: "fulltext" });
    assert.equal(hollowCapture.attrs.contentType, "fulltext");
    assert.equal(hollowCapture.attrs.words, undefined);
    const measured = await clip.measureClipBody(newPlugin(), hollow);
    assert.equal(measured.missing, true);
    assert.equal(measured.words, 0);
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: hollow }))["custom-clip-words"], "0");
    pass("全文待核与空正文显式测量真实写回属性，不改用户正文");

    // D-0030 摘录：引述块插在所选块之后，落入原文档并进高亮聚合（T-1730d）。
    const excerptMod = await import("../../src/services/excerpt-service.ts");
    const apiClient = await import("../../src/api/client.ts");
    const firstPara = await until("正文段落入 SQL 索引", async () => {
        const rows = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE root_id = '${fulltext}' AND type = 'p' ORDER BY sort ASC LIMIT 1`,
        });
        return rows[0]?.id ?? "";
    });
    assert.match(firstPara, /^[0-9]{14}-[0-9a-z]{7}$/);
    const quoteId = await excerptMod.insertQuoteExcerpt(firstPara, '这是 <选中> 的 "摘录" 文本\n第二段');
    assert.match(quoteId, /^[0-9]{14}-[0-9a-z]{7}$/);
    // blocks SQL 索引异步刷新（spike 已知坑），轮询等待入索引
    const quoteRow = await until("引述块入 SQL 索引", async () => {
        const quotes = await apiClient.listQuoteBlocks(fulltext);
        return quotes.find((row) => row.id === quoteId) ?? null;
    });
    assert.ok(String(quoteRow.content).includes("摘录"));
    pass("选区摘录以引述块插入所选块之后，高亮聚合可查");

    // S4/T-1710/T-1717：重浮与超龄归档在对账后的索引上投影，略过幂等，归档按显式清单。
    const resurface = await import("../../src/services/resurface-service.ts");
    const surfaceIndex = await clip.reconcileIndex(newPlugin(), settings);
    const dailyA = resurface.computeDailyFromIndex(surfaceIndex, settings);
    const dailyB = resurface.computeDailyFromIndex(surfaceIndex, settings);
    assert.deepEqual(dailyA, dailyB);
    assert(dailyA.picks.length >= 1 && dailyA.picks.length <= 2);
    for (const pick of dailyA.picks) assert(Array.isArray(pick.reasons));
    const skippedId = dailyA.picks[0].item.id;
    await resurface.actOnSurface(plugin, skippedId, "later");
    const skipFirst = (await client.apiChecked("/api/attr/getBlockAttrs", { id: skippedId }))["custom-clip-last-surfaced"];
    await resurface.actOnSurface(plugin, skippedId, "later");
    const skipSecond = (await client.apiChecked("/api/attr/getBlockAttrs", { id: skippedId }))["custom-clip-last-surfaced"];
    assert.equal(skipSecond, skipFirst);
    const afterSkipIndex = await clip.reconcileIndex(newPlugin(), settings);
    assert(!resurface.computeDailyFromIndex(afterSkipIndex, settings).picks.some((pick) => pick.item.id === skippedId));
    pass("今日拾遗同索引确定性挑选并附理由；改天幂等且当天不再出现");

    await clip.writeClip(newPlugin(), oldB, { status: "later", time: "20240101000000" });
    const staleIndex = await clip.reconcileIndex(newPlugin(), settings);
    const staleList = resurface.staleCandidatesFromIndex(staleIndex, settings);
    assert(staleList.some((item) => item.id === oldB));
    const archivedStale = await resurface.archiveStaleCandidates(plugin, [oldB]);
    assert.deepEqual(archivedStale, { ok: 1, succeeded: [oldB] });
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: oldB }))["custom-clip-status"], "archived");
    assert.equal((await client.apiChecked("/api/attr/getBlockAttrs", { id: oldA }))["custom-clip-status"], "inbox");
    pass("超龄清单来自对账索引；只归档勾选篇目并报告真实成功数");

    // T-1723 下一篇选择：显式动作，排除当前篇，不写状态。
    const next1 = await resurface.pickNextUnread(plugin, "");
    assert.match(next1, /^[0-9]{14}-[0-9a-z]{7}$/);
    const next1Status = (await client.apiChecked("/api/attr/getBlockAttrs", { id: next1 }))["custom-clip-status"];
    assert(["inbox", "later", "reading"].includes(next1Status));
    const next2 = await resurface.pickNextUnread(plugin, next1);
    if (next2) assert.notEqual(next2, next1);
    await clip.reconcileIndex(newPlugin(), settings);
    pass("下一篇从对账索引挑选并排除当前篇，不写状态");

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

    const clipIds = [urlOnly, oldA, oldB, importedId, fulltext, link, local, unknown, hollow];
    await until("新收录文档 SQL 属性索引", async () => {
        const rows = await clip.listClipDocs();
        return clipIds.every((id) => rows.some((row) => row.id === id));
    });
    await plugin.removeData("glean-index.json");
    const rebuilt = await clip.rebuildIndex(newPlugin(), settings);
    assert.equal(rebuilt.clips[urlOnly].status, "archived");
    assert.equal(rebuilt.clips[urlOnly].doneTime, doneAt);
    assert.equal(rebuilt.clips[oldA].status, "inbox");
    assert.equal(rebuilt.clips[oldB].status, "archived");
    assert.equal(rebuilt.clips[oldB].time, "20240101000000");
    assert.equal(rebuilt.clips[importedId].status, "done");
    assert.match(rebuilt.clips[importedId].doneTime, /^\d{14}$/);
    assert.equal(rebuilt.clips[fulltext].status, "later");
    assert.equal(rebuilt.clips[fulltext].contentType, "fulltext");
    assert.equal(rebuilt.clips[fulltext].src, "web-clipper");
    assert(rebuilt.clips[fulltext].tags.includes("阅读"));
    assert.equal(rebuilt.clips[fulltext].priority, 5);
    assert.equal(rebuilt.clips[fulltext].rating, 4);
    assert.equal(rebuilt.clips[hollow].contentType, "fulltext");
    assert.equal(rebuilt.clips[hollow].words, 0);
    assert.equal(rebuilt.clips[link].contentType, "link");
    assert.equal(rebuilt.clips[local].contentType, "local");
    assert.equal(rebuilt.clips[unknown].contentType, "");
    assert(rebuilt.clips[importedId].tags.includes("技术"));
    assert(rebuilt.candidates[noUrl]);
    assert.equal(rebuilt.candidates[ordinary], undefined);
    assert.equal(rebuilt.candidates[urlOnly], undefined);
    pass("删除派生索引后从内核属性重建收录与候选一致");

    // T-1108 数据主权：不经插件服务，直接经内核属性端点读取——"卸载插件"等价于只剩内核数据。
    const sovereign = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
    assert.equal(sovereign["custom-clip-status"], "later");
    assert.equal(sovereign["custom-clip-priority"], "5");
    assert.equal(sovereign["custom-clip-rating"], "4");
    assert.equal(sovereign["custom-clip-content-type"], "fulltext");
    const doneDoc = await client.apiChecked("/api/attr/getBlockAttrs", { id: urlOnly });
    assert.equal(doneDoc["custom-clip-status"], "archived");
    assert.match(doneDoc["custom-clip-done-time"] ?? "", /^\d{14}$/);
    // 清空插件 saveData（索引/设置只是缓存与偏好）后属性仍在
    for (const name of ["glean-index.json", "settings.json"]) await plugin.removeData(name);
    const afterWipe = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
    assert.equal(afterWipe["custom-clip-status"], "later");
    pass("数据主权：卸载/清空插件存储后 custom-clip-* 属性仍在内核");

    // T-1980：状态动作对未收录的普通文档是服务端空操作（兜底，不产出幽灵读库文档）。
    const plainDoc = await makeDoc("T1980 普通笔记", "从未收录的文档不得被状态命令写属性。");
    const guarded = await clip.batchSetStatusDetailed(plugin, [plainDoc], "done");
    assert.deepEqual(guarded, { ok: 0, succeeded: [] });
    const plainAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: plainDoc });
    assert.equal(plainAttrs["custom-clip-status"], undefined);
    assert.equal(plainAttrs["custom-clip-done-time"], undefined);
    pass("T-1980 状态动作跳过未收录文档，不写属性");

    // T-1987 读库宿主身份：同名用户文档不被当作宿主写入；带 internal 标记的宿主幂等复用。
    const avApi = await import("../../src/api/av.ts");
    const libraryDb = await import("../../src/services/library-db.ts");
    const userLibDoc = await makeDoc("读库数据库", "用户自己建的文档，插件不得写入。");
    const anchor1 = await libraryDb.ensureLibraryAnchor(settings, plugin);
    assert.notEqual(anchor1.hostDocId, userLibDoc);
    await until("读库宿主与同名用户文档都进入 SQL 索引", async () => {
        const rows = await avApi.findDocsByTitle(box, "读库数据库");
        return rows.length === 2 ? rows : null;
    });
    const hostAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: anchor1.hostDocId });
    assert.equal(hostAttrs["custom-clip-internal"], "true");
    const userLibAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: userLibDoc });
    assert.equal(userLibAttrs["custom-clip-internal"], undefined);
    const anchor2 = await libraryDb.ensureLibraryAnchor(settings, plugin);
    assert.equal(anchor2.hostDocId, anchor1.hostDocId);
    pass("T-1987 读库宿主复用要求 internal 身份，同名用户文档不被写入");

    // T-1987 闪卡宿主身份：同语义验证「拾遗卡片」宿主。
    const flashcards = await import("../../src/services/flashcard-service.ts");
    const userCardDoc = await makeDoc("拾遗卡片", "用户自己建的卡片文档。");
    const deck1 = await flashcards.ensureFlashcardDeck(settings, plugin);
    assert.notEqual(deck1.hostDocId, userCardDoc);
    await until("闪卡宿主进入 SQL 索引", async () => {
        const rows = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND content='拾遗卡片'`,
        });
        return rows.some((row) => row.id === deck1.hostDocId) ? rows : null;
    });
    const deck2 = await flashcards.ensureFlashcardDeck(settings, plugin);
    assert.equal(deck2.hostDocId, deck1.hostDocId);
    const userCardAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: userCardDoc });
    assert.equal(userCardAttrs["custom-clip-internal"], undefined);
    pass("T-1987 闪卡宿主复用要求 internal 身份，同名用户文档不被写入");

    // T-1958 周报幂等：同周重复生成定位同一宿主文档，不堆积同名文档。
    const stats = await import("../../src/services/stats-service.ts");
    const weeklyIndex = await clip.reconcileIndex(newPlugin(), settings);
    const weekly1 = await stats.exportWeeklyReport(weeklyIndex, settings, plugin);
    await until("周报宿主进入 SQL 索引", async () => {
        const rows = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND hpath LIKE '/读库周报/%'`,
        });
        return rows.some((row) => row.id === weekly1) ? rows : null;
    });
    const weekly2 = await stats.exportWeeklyReport(weeklyIndex, settings, plugin);
    assert.equal(weekly2, weekly1);
    const weeklyRows = await client.apiChecked("/api/query/sql", {
        stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND hpath LIKE '/读库周报/%'`,
    });
    assert.equal(weeklyRows.length, 1);
    pass("T-1958 同周重复生成周报定位同一文档，不堆积同名宿主");

    // T-1771 月度回顾：同月幂等定位（复用周报管线）。
    const monthly1 = await stats.exportMonthlyReview(weeklyIndex, settings, plugin);
    await until("月报宿主进入 SQL 索引", async () => {
        const rows = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND hpath LIKE '/读库月报/%'`,
        });
        return rows.some((row) => row.id === monthly1) ? rows : null;
    });
    const monthly2 = await stats.exportMonthlyReview(weeklyIndex, settings, plugin);
    assert.equal(monthly2, monthly1);
    pass("T-1771 同月重复生成月报定位同一文档，不堆积");

    // T-1990 损坏索引：坏文件保留、增量写不覆盖、对账重建后恢复落盘。
    const indexStore = await import("../../src/services/index-store.ts");
    const indexPath = path.join(workspace, "glean-s1-service-data", "glean-index.json");
    fs.writeFileSync(indexPath, "{broken json!!");
    const corruptedPlugin = newPlugin();
    const loadedCorrupt = await indexStore.loadIndex(corruptedPlugin);
    assert.equal(Object.keys(loadedCorrupt.clips).length, 0);
    await clip.writeClip(corruptedPlugin, fulltext, { rating: 4 });
    assert.equal(fs.readFileSync(indexPath, "utf8"), "{broken json!!", "损坏期间增量写不得覆盖原文件");
    const recovered = await clip.reconcileIndex(corruptedPlugin, settings);
    assert.equal(recovered.clips[fulltext].status, "later");
    const rawAfter = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(rawAfter.clips[fulltext].status, "later");
    pass("T-1990 损坏索引保留原文件，增量写被拦截，对账重建恢复");

    // T-1780 备份回环：导出 → 改动属性 → 恢复 → 属性回到备份点。
    const backup = await import("../../src/services/backup-service.ts");
    const backupPlugin = newPlugin();
    const pkg = await backup.buildBackupPackage(backupPlugin, settings);
    const json = backup.backupPackageJson(pkg);
    assert.ok(json.includes('"siyuan-glean"'));
    await clip.writeClip(backupPlugin, fulltext, { rating: 5, status: "done" }, { force: true, forceStatus: true });
    const changed = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
    assert.equal(changed["custom-clip-rating"], "5");
    const target = await backup.previewRestore(json);
    assert.ok(target.preview.totalClips > 0);
    assert.equal(target.preview.missing, 0);
    const restoreSummary = await backup.restoreBackup(backupPlugin, target.pkg);
    assert.ok(restoreSummary.restored > 0);
    const restored = await client.apiChecked("/api/attr/getBlockAttrs", { id: fulltext });
    assert.equal(restored["custom-clip-rating"], "4");
    assert.equal(restored["custom-clip-status"], "later");
    const afterRestoreIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(afterRestoreIndex.clips[fulltext].rating, 4);
    pass("T-1780 备份→改动→恢复回环：属性回到备份点，索引随对账一致");

    // T-1740 大纲：heading 查询（隔离内核实证 ORDER BY sort 与 subtype 形状）。
    const outline = await import("../../src/services/outline.ts");
    const headings = await outline.fetchDocOutline(fulltext);
    assert.ok(headings.length >= 1);
    assert.match(headings[0].id, /^\d{14}-[0-9a-z]{7}$/);
    assert.equal(headings[0].text.length > 0, true);
    assert.deepEqual(outline.outlineIndent(headings)[0], 0);
    pass("T-1740 大纲查询：标题按文档顺序返回且首层缩进归一");

    // T-1750/1752 地基：全库引述块分页查询（摘录宿主=fulltext，索引已就绪）。
    const highlights = await import("../../src/services/highlights.ts");
    const libraryQuotes = await highlights.listLibraryQuotes(50, 0);
    assert.ok(libraryQuotes.length >= 1);
    assert.ok(libraryQuotes.some((quote) => quote.rootId === fulltext));
    pass("T-1750/1752 地基：全库引述块查询覆盖摘录宿主文档");

    // T-1752 摘录批量导出：映射 root 元数据后落盘汇总笔记（含原文回链）。
    const quoteRoots = await highlights.listQuoteRoots(libraryQuotes.map((quote) => quote.rootId));
    const quoteEntries = libraryQuotes.map((quote) => ({
        id: quote.id,
        rootId: quote.rootId,
        text: quote.text,
        title: quoteRoots.get(quote.rootId) || "",
        site: "",
        tags: [],
        aiTags: [],
    }));
    const exportedQuoteDoc = await excerptMod.exportQuotesToDoc(quoteEntries, box);
    assert.match(exportedQuoteDoc, /^[0-9]{14}-[0-9a-z]{7}$/);
    await until("摘录导出文档进入 SQL 索引", async () => {
        const rows = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND hpath LIKE '/摘录导出/%'`,
        });
        return rows.some((row) => row.id === exportedQuoteDoc) ? rows : null;
    });
    pass("T-1752 摘录批量导出为汇总笔记并落盘");

    // T-1772 CSV：BOM + 表头 + 全量行。
    const libraryCsv = stats.buildLibraryCsv(recovered);
    assert.ok(libraryCsv.startsWith("\uFEFF"));
    assert.ok(libraryCsv.includes("title"));
    assert.ok(libraryCsv.split("\r\n").length > 2);
    pass("T-1772 CSV 构建：BOM + 表头 + 数据行");

    // T-1840 导入孤儿账本：模拟"文档已建未收录"→ 入账本 → 重试补收录 → 移出账本。
    const importSvc = await import("../../src/services/import-service.ts");
    const orphanDoc = await makeDoc("T1840 孤儿文章", "- [https://example.org/t1840](https://example.org/t1840)\n\n孤儿正文。");
    await importSvc.saveImportOrphans(plugin, [
        {
            docId: orphanDoc,
            notebookId: box,
            format: "pocket-html",
            row: {
                title: "T1840 孤儿文章",
                url: "https://example.org/t1840",
                site: "example.org",
                time: "20260930080000",
                doneTime: "",
                tags: ["技术"],
                status: "inbox",
                duplicate: false,
            },
        },
    ]);
    const orphanRetry = await importSvc.retryImportOrphans(plugin);
    assert.equal(orphanRetry.restored, 1);
    assert.equal(orphanRetry.remaining, 0);
    const orphanAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: orphanDoc });
    assert.equal(orphanAttrs["custom-clip-status"], "inbox");
    assert.equal(orphanAttrs["custom-clip-url"], "https://example.org/t1840");
    assert.deepEqual(await importSvc.loadImportOrphans(plugin), []);
    pass("T-1840 孤儿账本重试补收录：属性写全、账本清空");
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

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
const passedScenarios = [];

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
                source: "export const fetchSyncPost = (...args) => globalThis.__gleanS1FetchSyncPost(...args); export const getFrontend = () => 'desktop';",
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

function pass(label) { passedScenarios.push(label); console.log(`✓ ${label}`); }

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
        fingerprint: preview.fingerprint,
        notebookId: box,
        folder: "S1导入",
        format: "pocket-csv",
    });
    assert.equal(imported.imported, 1, JSON.stringify(imported));
    assert.equal(imported.failed, 0, JSON.stringify(imported));
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
    assert.equal(carrier.sourceUrlForCarrier(undefined, "https://example.org/s3-unknown"), "https://example.org/s3-unknown");
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
    await resurface.setSurfacePinned(plugin, skippedId, true);
    const pinnedAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: skippedId });
    assert.match(pinnedAttrs["custom-clip-pinned"] ?? "", /^\d{8}$/);
    const pinnedIndex = await clip.reconcileIndex(newPlugin(), settings);
    assert.equal(pinnedIndex.clips[skippedId]?.pinned, pinnedAttrs["custom-clip-pinned"]);
    await resurface.setSurfacePinned(plugin, skippedId, false);
    const unpinnedAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: skippedId });
    assert.equal(unpinnedAttrs["custom-clip-pinned"], undefined);
    pass("今日拾遗置顶经 clip-store 写入独立日期属性，重建索引可读回，取消时删除属性");
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

    const formatting = await import("../../src/services/formatting-service.ts");
    const formattingDomain = await import("../../src/domain/formatting.ts");
    const longFormattingUrl = `https://example.org/formatting?tracking=${"x".repeat(90)}`;
    const formattingDoc = await client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: "/排版原文",
        markdown: `# 排版原文\n\n正文原句 ${longFormattingUrl}\n\n请关注我们的公众号\n\n\`\`\`text\n代码保持 ${longFormattingUrl}\n\`\`\`\n\n> 引用保持原句\n\n| 表头 |\n| --- |\n| 原值 |\n\n![图示](assets/formatting.png)\n\n![](assets/formatting.png)`,
        tags: "用户标签",
    });
    await until("排版原文 SQL 可见", async () => (await clip.listAnchorDocs([box])).some((doc) => doc.id === formattingDoc));
    await clip.writeClip(plugin, formattingDoc, { status: "later", url: longFormattingUrl, priority: 5, rating: 4 });
    const originalFormattingAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: formattingDoc });
    const originalFormattingMd = await client.apiChecked("/api/export/exportMdContent", { id: formattingDoc });
    const formattingExportOptions = { yfm: false, addTitle: false, refMode: 2 };
    const formattingExportProbe = await client.apiChecked("/api/export/exportMdContent", { id: formattingDoc, ...formattingExportOptions });
    assert(!formattingExportProbe.content.startsWith("---"));
    assert.equal(formattingExportProbe.content.match(/^# 排版原文$/gm)?.length, 1);
    console.log("  排版导出参数 spike：yfm=false / addTitle=false 已隔离验证");
    const formattingSession = await formatting.loadFormattingSession(formattingDoc);
    assert.equal(formattingSession.source.title, "排版原文");
    assert.equal(formattingSession.source.markdown, formattingExportProbe.content);
    assert.equal(formattingSession.analysis.blocks.filter((block) => block.kind === "image").length, 2);
    assert(formattingSession.analysis.candidates.some((candidate) => candidate.reasons.includes("duplicateImage") && candidate.reasons.includes("unlabelledImage")));
    const promotion = formattingSession.analysis.candidates.find((candidate) => candidate.reasons.includes("promotion"));
    assert(promotion);
    const formattingPreview = formattingDomain.renderFormatting(formattingSession.analysis, formattingSession.plan, [promotion.id]);
    assert(formattingPreview.includes("example.org/…"));
    assert(formattingPreview.includes(`代码保持 ${longFormattingUrl}`));
    assert(!formattingPreview.includes("请关注"));
    const formattingLabels = { suffix: "阅读整理", original: "原文", source: "来源" };
    const formattingSave = await formatting.saveFormattingDraft(plugin, formattingSession, [promotion.id], formattingLabels);
    assert.equal(formattingSave.ok, true);
    assert.match(formattingSave.docId, /^\d{14}-[0-9a-z]{7}$/);
    assert.notEqual(formattingSave.docId, formattingDoc);
    assert.deepEqual(await formatting.saveFormattingDraft(plugin, formattingSession, [], formattingLabels), formattingSave);
    const formattingDraftAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: formattingSave.docId });
    assert.equal(formattingDraftAttrs["custom-clip-internal"], "true");
    for (const key of ["custom-clip-url", "custom-clip-status", "custom-clip-priority", "custom-clip-rating", "tags"]) assert.equal(formattingDraftAttrs[key], undefined);
    const formattingDraftMd = await client.apiChecked("/api/export/exportMdContent", { id: formattingSave.docId, ...formattingExportOptions });
    assert(formattingDraftMd.content.includes(`siyuan://blocks/${formattingDoc}`));
    console.log("  排版导出参数 spike：refMode=2 保留思源回链已隔离验证");
    assert(formattingDraftMd.content.includes(longFormattingUrl));
    assert(formattingDraftMd.content.includes(`代码保持 ${longFormattingUrl}`));
    assert(!formattingDraftMd.content.includes("请关注"));
    assert(!formattingDraftMd.content.includes("用户标签"));
    assert(!formattingDraftMd.content.includes("lastmod:"));
    assert.deepEqual(await client.apiChecked("/api/export/exportMdContent", { id: formattingDoc }), originalFormattingMd);
    assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: formattingDoc }), originalFormattingAttrs);
    await until("整理稿 SQL 可见", async () => (await clip.listAnchorDocs([box])).some((doc) => doc.id === formattingSave.docId));
    const formattingIndex = await clip.reconcileIndex(newPlugin(), settings);
    assert.equal(formattingIndex.clips[formattingSave.docId], undefined);
    assert.equal(formattingIndex.candidates[formattingSave.docId], undefined);
    pass("排版整理稿真实建文档、回链、复杂内容与属性主权保留；内部稿不进入读库候选");

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

    const { runLibraryExtensions } = await import("./library-extensions.mjs");
    await runLibraryExtensions({ client, plugin, box, until, pass });

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

    const previewActions = await import("../../src/services/workbench-preview.ts");
    const previewCandidate = await makeDoc("预览补来源样本", "保留这段原始正文。", "剪藏");
    const previewExcluded = await makeDoc("预览排除样本", "这是误报正文。", "剪藏");
    const previewLocal = await makeDoc("预览本地样本", "这是用户明确保留的本地正文。", "剪藏");
    await until("预览样本入SQL索引", async () => {
        const docs = await clip.listAnchorDocs([box]);
        return [previewCandidate, previewExcluded, previewLocal].every((id) => docs.some((doc) => doc.id === id));
    });
    const originalBody = await apiClient.exportMdContent(previewCandidate);
    assert.equal((await clip.readClip(previewCandidate)).status, undefined);
    await previewActions.savePreviewCandidateUrl(newPlugin(), previewCandidate, "", "https://example.org/preview-confirm");
    await previewActions.confirmPreviewCandidate(newPlugin(), previewCandidate, "https://cache.example/ignored");
    const confirmedPreview = await clip.readClip(previewCandidate);
    assert.equal(confirmedPreview.url, "https://example.org/preview-confirm");
    assert.equal(confirmedPreview.status, "inbox");
    assert.equal((await apiClient.exportMdContent(previewCandidate)).content, originalBody.content);
    await previewActions.setPreviewStatus(newPlugin(), previewCandidate, "done");
    const previewDoneTime = (await clip.readClip(previewCandidate)).doneTime;
    assert.match(previewDoneTime, /^\d{14}$/);
    await previewActions.setPreviewStatus(newPlugin(), previewCandidate, "archived");
    assert.equal((await clip.readClip(previewCandidate)).doneTime, previewDoneTime);
    await assert.rejects(previewActions.excludePreviewCandidate(newPlugin(), previewCandidate), { reason: "changed" });
    await assert.rejects(previewActions.setPreviewStatus(newPlugin(), ordinary, "done"), { reason: "changed" });
    pass("工作台预览服务：补来源/确认保留正文，完成/归档保留完成时间，资格变化拒绝写入");
    await previewActions.excludePreviewCandidate(newPlugin(), previewExcluded);
    await previewActions.confirmPreviewCandidate(newPlugin(), previewLocal, "", true);
    const previewIndex = await clip.reconcileIndex(newPlugin(), settings);
    assert.equal(previewIndex.candidates[previewExcluded], undefined);
    assert.equal(previewIndex.clips[previewExcluded], undefined);
    assert.equal(previewIndex.clips[previewLocal].contentType, "local");
    const previewLookupEvidence = {
        sqlKnown: (await clip.listClipDocs()).some((doc) => doc.id === previewCandidate),
        conflictFromKnownIds: (await clip.findClipUrlConflict("https://example.org/preview-confirm", noUrl, newPlugin()))?.id === previewCandidate,
    };
    assert.equal(previewLookupEvidence.conflictFromKnownIds, true);
    fs.writeFileSync(path.join(workspace, "preview-lookup-evidence.json"), JSON.stringify(previewLookupEvidence, null, 2));
    await assert.rejects(previewActions.savePreviewCandidateUrl(newPlugin(), noUrl, "", "https://example.org/preview-confirm"), { reason: "conflict" });
    assert.equal((await clip.readClip(noUrl)).url, undefined);
    pass("工作台预览服务：排除不计入读库，本地确认载体明确，同源冲突不写入");
    await previewActions.quotePreviewExcerpt(fulltext, firstPara, "工作台预览摘录样本");
    await until("预览引述进入原文", async () => (await apiClient.listQuoteBlocks(fulltext)).some((block) => block.content.includes("工作台预览摘录样本")));
    await assert.rejects(previewActions.quotePreviewExcerpt(previewCandidate, firstPara, "错误归属"), { reason: "changed" });
    pass("工作台预览摘录回读文章和块归属，原文引述落库，跨文档锚点被拒绝");

    const authorOriginalBody = await apiClient.exportMdContent(previewCandidate);
    await clip.saveClipAuthor(plugin, previewCandidate, "", "  公众号样本  ");
    const protectedAuthor = await clip.writeClip(plugin, previewCandidate, { author: "AI猜测" });
    assert.deepEqual(protectedAuthor.skippedKeys, ["custom-clip-author"]);
    const protectedClear = await clip.writeClip(plugin, previewCandidate, { author: "" });
    assert.deepEqual(protectedClear.skippedKeys, ["custom-clip-author"]);
    await assert.rejects(clip.saveClipAuthor(plugin, previewCandidate, "旧缓存", "错误覆盖"), { reason: "changed" });
    await assert.rejects(clip.saveClipAuthor(plugin, previewCandidate, "公众号样本", "非法\n署名"), { reason: "invalid" });
    assert.equal((await clip.readClipAuthor(previewCandidate)).author, "公众号样本");
    assert.equal((await apiClient.exportMdContent(previewCandidate)).content, authorOriginalBody.content);
    pass("来源作者：真实属性读写、自动覆盖/清空保护、过期与非法输入拒绝，正文保持");
    await until("作者文章被SQL发现", async () => (await clip.listClipDocs()).some((doc) => doc.id === previewCandidate));
    await plugin.removeData("glean-index.json");
    const authorIndex = await clip.rebuildIndex(plugin, settings);
    assert.equal(authorIndex.clips[previewCandidate].author, "公众号样本");
    const authorRows = Object.values(authorIndex.clips).map((entry) => ({ kind: "clip", ...entry }));
    assert.deepEqual(library.filterAndSortLibrary(authorRows, { status: "all", author: "公众号样本" }).map((entry) => entry.id), [previewCandidate]);
    assert.deepEqual(library.libraryFacets(authorRows).authors, [{ value: "公众号样本", count: 1 }]);
    const exportService = await import("../../src/services/library-export-service.ts");
    const authorCsv = await exportService.exportLibraryCsv(plugin, settings);
    assert(authorCsv.includes("site,author,time"));
    assert(authorCsv.includes("公众号样本"));
    const authorStatsService = await import("../../src/services/stats-service.ts");
    const authorReview = authorStatsService.buildReadingReview(authorIndex, { period: "year" });
    assert.deepEqual(authorReview.stats.periodByAuthor, [{ name: "公众号样本", count: 1 }]);
    const authorSite = authorReview.stats.periodSiteAuthors.find((group) => group.site === authorIndex.clips[previewCandidate].site);
    assert(authorSite.authors.some((group) => group.name === "公众号样本" && group.count === 1));
    assert.equal(authorSite.count, authorSite.unknownAuthorCount + authorSite.authors.reduce((total, group) => total + group.count, 0));
    await clip.writeClip(plugin, previewLocal, { internal: true, status: "done", author: "内部署名", doneTime: (await import("../../src/domain/schema.ts")).siyuanTimestamp() }, { force: true });
    const withInternal = await clip.reconcileIndex(plugin, settings);
    const internalReview = authorStatsService.buildReadingReview(withInternal, { period: "year" });
    assert.equal(internalReview.completedItems.some((entry) => entry.id === previewLocal), false);
    assert.equal(internalReview.stats.periodByAuthor.some((group) => group.name === "内部署名"), false);
    fs.writeFileSync(path.join(workspace, "author-evidence.json"), JSON.stringify({ docId: previewCandidate, author: "公众号样本", rebuild: true, filter: true, csv: true, siteDrill: true, internalExcluded: true }, null, 2));
    pass("作者统计：真实完成范围、站点作者与缺失计数对齐，有状态internal不进入回顾");
    await clip.saveClipAuthor(plugin, previewCandidate, "公众号样本", "");
    assert.equal((await clip.readClipAuthor(previewCandidate)).raw, "");
    await assert.rejects(clip.saveClipAuthor(plugin, ordinary, "", "普通笔记不能写"), { reason: "changed" });
    pass("来源作者：清空缓存后重建、全状态作者筛选、CSV列与显式删除，普通笔记拒绝编辑");

    const { runBackupFlow } = await import("./backup-flow.mjs");
    const backupEvidence = await runBackupFlow({ client, plugin, box, until, pass, workspace });
    console.log(`备份恢复证据：${backupEvidence.evidencePath}（${backupEvidence.scenarios} 条）`);

    await runAvProjectionFlow({ client, plugin, until, pass, workspace });

    const { runFlashcardFlow } = await import("./flashcard-flow.mjs");
    const flashcardEvidence = await runFlashcardFlow({ client, plugin, box, until, pass, workspace });
    console.log(`制卡确认恢复证据：${flashcardEvidence.evidencePath}（${flashcardEvidence.scenarios} 条）`);

    await runImportJournalFlow({ client, newPlugin, box, workspace });
}

async function runAvProjectionFlow({ client, plugin, until, pass, workspace }) {
    const library = await import("../../src/services/library-db.ts");
    const av = await import("../../src/api/av.ts");
    const clipStore = await import("../../src/services/clip-store.ts");
    const { normalizeSettings } = await import("../../src/services/settings.ts");
    const { siyuanTimestamp } = await import("../../src/domain/schema.ts");
    const evidenceDir = path.join(workspace, "av-flow");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const calls = [];
    let loseCellReplyFor;
    let rejectCellFor;
    const transport = globalThis.__gleanS1FetchSyncPost;
    globalThis.__gleanS1FetchSyncPost = async (route, body) => {
        const call = { route, body: structuredClone(body) };
        calls.push(call);
        if (route === "/api/av/setAttributeViewBlockAttr" && body.itemID === rejectCellFor) {
            rejectCellFor = undefined;
            call.rejectedBeforeKernel = true;
            return { code: 1, msg: "隔离测试：AV状态写入故障" };
        }
        const result = await transport(route, body);
        if (route === "/api/filetree/createDocWithMd") call.returnedDocId = result.data;
        if (route === "/api/block/insertBlock") call.returnedIds = (result.data ?? []).flatMap((transaction) => (transaction.doOperations ?? []).map((operation) => operation.id));
        if (route === "/api/av/setAttributeViewBlockAttr" && body.itemID === loseCellReplyFor && result.code === 0) {
            loseCellReplyFor = undefined;
            call.actualKernelAccepted = true;
            call.replyDiscarded = true;
            throw new Error("隔离测试：AV内核已写入，客户端丢失响应");
        }
        return result;
    };
    const evidence = { workspace, startedAt: new Date().toISOString(), completed: false, scenarios: [], calls };
    const writeEvidence = () => fs.writeFileSync(path.join(evidenceDir, "av-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    const record = (label, details) => { evidence.scenarios.push({ label, ...details }); writeEvidence(); pass(label); };
    const attrsOf = (id) => client.apiChecked("/api/attr/getBlockAttrs", { id });
    const bodyOf = async (id) => (await client.apiChecked("/api/export/exportMdContent", { id, yfm: false, addTitle: false, refMode: 2 })).content;
    const sourceAttrs = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("custom-clip-") || key === "tags"));
    try {
        const notebookName = "GleanAvProjectionFlow";
        await client.apiChecked("/api/notebook/createNotebook", { name: notebookName });
        const listing = await client.apiChecked("/api/notebook/lsNotebooks", {});
        const box = listing.notebooks.find((notebook) => notebook.name === notebookName)?.id;
        assert.match(box ?? "", /^\d{14}-[a-z0-9]{7}$/);
        const settings = normalizeSettings({ anchorNotebooks: [box] });
        const first = await client.apiChecked("/api/filetree/createDocWithMd", { notebook: box, path: "/AV第一篇", markdown: "# AV第一篇\n\nAV投影不能改变第一篇正文。", tags: "AV用户标签" });
        const second = await client.apiChecked("/api/filetree/createDocWithMd", { notebook: box, path: "/AV第二篇", markdown: "# AV第二篇\n\nAV投影不能改变第二篇正文。", tags: "AV用户标签" });
        await until("AV来源文档SQL", async () => {
            const docs = await clipStore.listAnchorDocs([box]);
            return [first, second].every((id) => docs.some((doc) => doc.id === id));
        });
        await clipStore.writeClip(plugin, first, { status: "later", author: "AV第一作者", url: "https://example.org/av-first", priority: 5, rating: 4 });
        await clipStore.writeClip(plugin, second, { status: "reading", author: "AV第二作者", url: "https://example.org/av-second", priority: 2, rating: 3 });
        const originals = await Promise.all([first, second].map(async (id) => ({ id, attrs: sourceAttrs(await attrsOf(id)), body: await bodyOf(id) })));
        const assertSourcesPreserved = async () => {
            for (const original of originals) {
                assert.deepEqual(sourceAttrs(await attrsOf(original.id)), original.attrs);
                assert.equal(await bodyOf(original.id), original.body);
            }
        };
        const setFirstStatus = async (status) => {
            await clipStore.writeClip(plugin, first, { status, ...(status === "done" ? { doneTime: siyuanTimestamp() } : {}) }, { force: true });
            originals.find((original) => original.id === first).attrs = sourceAttrs(await attrsOf(first));
        };
        const sourceIndex = await clipStore.reconcileIndex(plugin, settings);
        const sourceIds = Object.values(sourceIndex.clips).filter((entry) => entry.status && !entry.internal).map((entry) => entry.id).sort();
        const projectionOffset = calls.length;
        const projected = await library.bindAllClipsToLibrary(plugin, settings);
        assert.equal(projected.bound, sourceIds.length);
        assert.deepEqual([...projected.boundDocIds].sort(), sourceIds);
        assert.equal(projected.synced, sourceIds.length);
        assert.deepEqual(projected.failures, []);
        const setupCalls = calls.slice(projectionOffset);
        const hostCall = setupCalls.find((call) => call.route === "/api/filetree/createDocWithMd" && call.body.notebook === box && call.body.path === `/${library.LIBRARY_DOC_TITLE}`);
        assert(hostCall);
        const hostDocId = hostCall.returnedDocId;
        const avInsert = setupCalls.find((call) => call.route === "/api/block/insertBlock" && call.body.parentID === hostDocId && call.body.data.includes("NodeAttributeView"));
        assert(avInsert);
        const avId = avInsert.body.data.match(/data-av-id="(\d{14}-[a-z0-9]{7})"/)?.[1];
        const dbBlockId = avInsert.returnedIds[0];
        assert.match(avId ?? "", /^\d{14}-[a-z0-9]{7}$/);
        assert.match(dbBlockId ?? "", /^\d{14}-[a-z0-9]{7}$/);
        const rendered = await av.renderView(avId, dbBlockId);
        const statusKeyId = rendered.view.columns.find((column) => column.name === "状态")?.id;
        assert(statusKeyId);
        const mapped = await av.mapBoundDocIds(avId, sourceIds);
        assert.deepEqual(Object.keys(mapped).sort(), sourceIds);
        assert.notEqual(mapped[first], first);
        assert.notEqual(mapped[second], second);
        const statusOf = async (id) => (await av.renderView(avId, dbBlockId)).view.rows.find((row) => row.id === mapped[id])?.cells.find((cell) => cell.value.keyID === statusKeyId)?.value.mSelect?.[0]?.content;
        assert.equal(await statusOf(first), "later");
        assert.equal(await statusOf(second), "reading");
        await assertSourcesPreserved();
        record("AV真实属性对账、绑定ID映射与状态单元格读回；itemID不同于文档ID，源正文/剪藏字段/用户tags保持", { first, second, avId, dbBlockId, hostDocId, statusKeyId, projected, mapped });

        await setFirstStatus("done");
        await av.setCellSelect(avId, statusKeyId, mapped[second], "archived");
        await until("AV手动状态修改读回", async () => await statusOf(second) === "archived");
        assert.equal((await clipStore.readClip(second)).status, "reading");
        const refreshOffset = calls.length;
        const refreshed = await library.bindAllClipsToLibrary(plugin, settings);
        assert.equal(refreshed.bound, 0);
        assert.equal(refreshed.synced, sourceIds.length);
        assert.deepEqual(refreshed.failures, []);
        assert.equal(calls.slice(refreshOffset).filter((call) => call.route === "/api/av/addAttributeViewBlocks").length, 0);
        assert.equal(await statusOf(first), "done");
        assert.equal(await statusOf(second), "reading");
        assert.deepEqual(await av.mapBoundDocIds(avId, sourceIds), mapped);
        await assertSourcesPreserved();
        record("AV单向投影：改库值不反写五态，显式刷新取当前属性并复用已有行与映射，不重复绑定", { refreshed });

        await setFirstStatus("later");
        const lostOffset = calls.length;
        loseCellReplyFor = mapped[first];
        const lostReport = await library.bindAllClipsToLibrary(plugin, settings);
        assert.equal(loseCellReplyFor, undefined);
        assert.equal(lostReport.bound, 0);
        assert.equal(lostReport.synced, sourceIds.length);
        assert.deepEqual(lostReport.failures, []);
        const lostAttempts = calls.slice(lostOffset).filter((call) => call.route === "/api/av/setAttributeViewBlockAttr" && call.body.itemID === mapped[first]);
        assert.equal(lostAttempts.length, 1);
        assert.equal(lostAttempts[0].actualKernelAccepted, true);
        assert.equal(lostAttempts[0].replyDiscarded, true);
        assert.equal(await statusOf(first), "later");
        await assertSourcesPreserved();
        record("AV真实状态写入响应丢失：读回相符才计入synced，确切item仅写一次、不自动重发", { lostReport, lostAttempts });

        await setFirstStatus("reading");
        rejectCellFor = mapped[first];
        const failureReport = await library.bindAllClipsToLibrary(plugin, settings);
        assert.equal(rejectCellFor, undefined);
        assert.equal(failureReport.synced, sourceIds.length - 1);
        assert.deepEqual(failureReport.failures, [{ docId: first, reason: "write" }]);
        assert.equal(await statusOf(first), "later");
        assert.equal((await clipStore.readClip(first)).status, "reading");
        const retryReport = await library.bindAllClipsToLibrary(plugin, settings);
        assert.equal(retryReport.bound, 0);
        assert.equal(retryReport.synced, sourceIds.length);
        assert.deepEqual(retryReport.failures, []);
        assert.equal(await statusOf(first), "reading");
        assert.deepEqual(await av.mapBoundDocIds(avId, sourceIds), mapped);
        await assertSourcesPreserved();
        record("AV状态写入故障单独计数，失败不冒充对齐；再次显式刷新恢复同一行且不改来源属性/正文", { failureReport, retryReport });
        evidence.completed = true;
        evidence.completedAt = new Date().toISOString();
        writeEvidence();
        console.log(`AV投影证据：${path.join(evidenceDir, "av-evidence.json")}（${evidence.scenarios.length} 条）`);
    } catch (error) {
        evidence.failure = { message: error.message, stack: error.stack };
        writeEvidence();
        throw error;
    } finally {
        globalThis.__gleanS1FetchSyncPost = transport;
    }
}

async function runImportJournalFlow({ client, newPlugin, box, workspace }) {
    const importer = await import("../../src/services/import-service.ts");
    const journal = await import("../../src/services/import-progress.ts");
    const clipStore = await import("../../src/services/clip-store.ts");
    const evidenceDir = path.join(workspace, "import-journal-flow");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const calls = [];
    const transport = globalThis.__gleanS1FetchSyncPost;
    globalThis.__gleanS1FetchSyncPost = (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        return transport(route, body);
    };
    const evidence = { workspace, startedAt: new Date().toISOString(), completed: false, scenarios: [], calls };
    const writeEvidence = () => fs.writeFileSync(path.join(evidenceDir, "import-journal-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    const record = (label, details) => { evidence.scenarios.push({ label, ...details }); writeEvidence(); pass(label); };
    try {
        const csv = [
            "title,url,time_added,time_read,status,tags",
            '检查点第一篇,https://example.org/journal-first,1577934245,,unread,"检查点,第一篇"',
            '检查点第二篇,https://example.org/journal-second,1577934245,,unread,"检查点,第二篇"',
        ].join("\n");
        const preview = await importer.previewImport(csv, "pocket-csv");
        assert.equal(preview.rows.length, 2);
        assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
        const initialPlugin = newPlugin();
        const abort = new AbortController();
        const options = { fingerprint: preview.fingerprint, notebookId: box, folder: "/S1检查点导入", format: "pocket-csv" };
        const initial = await importer.runImport(initialPlugin, preview.rows, {
            ...options,
            signal: abort.signal,
            onProgress(done) { if (done === 1) abort.abort(); },
        });
        assert.equal(initial.imported, 1);
        assert.equal(initial.failed, 0);
        assert.equal(initial.stopped, true);
        const paused = await journal.readImportProgress(initialPlugin);
        assert.equal(paused.taskId, initial.taskId);
        assert.equal(paused.fingerprint, preview.fingerprint);
        assert.equal(paused.state, "paused");
        assert.deepEqual(paused.rows.map((row) => row.state), ["applied", "pending"]);
        assert.equal(paused.rows[0].docId, initial.docIds[0]);
        assert.equal(paused.rows[1].docId, "");
        assert(!JSON.stringify(paused).includes("https://"));
        record("导入检查点真实建文档后暂停：确切ID与applied/pending持久化，不保存原文件或URL正文", { initial, paused });

        const reloadedPlugin = newPlugin();
        const resumedPreview = await importer.previewImport(csv, "pocket-csv");
        assert.equal(resumedPreview.fingerprint, preview.fingerprint);
        const rejectionOffset = calls.length;
        await assert.rejects(importer.runImport(reloadedPlugin, resumedPreview.rows, { ...options, fingerprint: "0".repeat(64), resumeTaskId: initial.taskId }), { reason: "file" });
        await assert.rejects(importer.runImport(reloadedPlugin, resumedPreview.rows, { ...options, folder: "/错误目标目录", resumeTaskId: initial.taskId }), { reason: "target" });
        await assert.rejects(importer.runImport(reloadedPlugin, resumedPreview.rows, options), { reason: "unfinished" });
        assert(calls.slice(rejectionOffset).every((call) => call.route === "/api/query/sql" || call.route === "/api/attr/batchGetBlockAttrs"));
        assert.deepEqual(await journal.readImportProgress(reloadedPlugin), paused);
        record("重载导入任务必须匹配原文件指纹和原目标；未处理任务阻止新建，拒绝不会改检查点", { taskId: initial.taskId });

        const firstId = initial.docIds[0];
        await clipStore.writeClip(reloadedPlugin, firstId, { status: "reading", author: "导入后用户手填作者", priority: 5, rating: 4 }, { force: true });
        const firstBeforeResume = await client.apiChecked("/api/attr/getBlockAttrs", { id: firstId });
        const firstBody = await client.apiChecked("/api/export/exportMdContent", { id: firstId, yfm: false, addTitle: false, refMode: 2 });
        const resumeOffset = calls.length;
        const resumed = await importer.runImport(reloadedPlugin, resumedPreview.rows, { ...options, resumeTaskId: initial.taskId });
        assert.equal(resumed.taskId, initial.taskId);
        assert.equal(resumed.imported, 1);
        assert.equal(resumed.failed, 0);
        assert.equal(resumed.unknown, 0);
        assert.equal(resumed.stopped, false);
        assert.equal(resumed.docIds.length, 1);
        assert.notEqual(resumed.docIds[0], firstId);
        const finished = await journal.readImportProgress(newPlugin());
        assert.equal(finished.state, "finished");
        assert.deepEqual(finished.rows.map((row) => row.state), ["applied", "applied"]);
        assert.deepEqual(finished.rows.map((row) => row.docId), [firstId, resumed.docIds[0]]);
        assert.equal(calls.slice(resumeOffset).filter((call) => call.route === "/api/filetree/createDocWithMd").length, 1);
        assert.equal(calls.slice(resumeOffset).filter((call) => call.route === "/api/attr/setBlockAttrs" && call.body.id === firstId).length, 0);
        assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: firstId }), firstBeforeResume);
        assert.equal((await client.apiChecked("/api/export/exportMdContent", { id: firstId, yfm: false, addTitle: false, refMode: 2 })).content, firstBody.content);
        const repeatedOffset = calls.length;
        const repeated = await importer.runImport(newPlugin(), resumedPreview.rows, { ...options, resumeTaskId: initial.taskId });
        assert.equal(repeated.imported, 0);
        assert.equal(repeated.docIds.length, 0);
        assert.equal(calls.slice(repeatedOffset).filter((call) => call.route === "/api/filetree/createDocWithMd").length, 0);
        record("新插件实例恢复检查点仅建pending文章，已完成ID/用户后改状态与手填/正文保留；完成任务重复恢复不另建", { resumed, finished, repeated, preservedFirstAttrs: firstBeforeResume });
        evidence.completed = true;
        evidence.completedAt = new Date().toISOString();
        writeEvidence();
        console.log(`导入检查点证据：${path.join(evidenceDir, "import-journal-evidence.json")}（${evidence.scenarios.length} 条）`);
    } catch (error) {
        evidence.failure = { message: error.message, stack: error.stack };
        writeEvidence();
        throw error;
    } finally {
        globalThis.__gleanS1FetchSyncPost = transport;
    }
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
    const runEvidence = { workspace: WORKSPACE, kernel, base, port, startedAt: new Date().toISOString(), bazaarTrusted: false, completed: false, scenarios: passedScenarios };
    const saveRunEvidence = () => fs.writeFileSync(path.join(WORKSPACE, "s1-run-evidence.json"), `${JSON.stringify(runEvidence, null, 2)}\n`);
    saveRunEvidence();
    try {
        const version = await waitForBoot(base, lines, () => {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
        }, client);
        const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
        client.setToken(conf.accessAuthCode || "");
        await client.apiChecked("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        runEvidence.kernelVersion = version;
        runEvidence.bazaarTrusted = true;
        saveRunEvidence();
        globalThis.__gleanS1FetchSyncPost = async (route, body) => {
            const result = await client.api(route, body);
            if (route === "/api/filetree/createDocWithMd" && typeof result?.data === "string") {
                const id = result.data;
                const deadline = Date.now() + 10000;
                while (Date.now() < deadline) {
                    const rows = await client.api("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE id='${id}' AND type='d' LIMIT 1` });
                    if (rows?.code === 0 && rows.data?.some((row) => row.id === id)) break;
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
            }
            return result;
        };
        console.log(`S1 服务级 E2E：内核 ${JSON.stringify(version)}，回环端口 ${port}`);
        console.log(`隔离工作区：${WORKSPACE}`);
        await runFlow(client, WORKSPACE);
        runEvidence.completed = true;
        console.log(`S1 服务级 E2E：全部通过（${passedScenarios.length} 条）`);
    } catch (error) {
        runEvidence.failure = { message: error.message, stack: error.stack };
        throw error;
    } finally {
        await shutdownKernel(client, child);
        runEvidence.finishedAt = new Date().toISOString();
        saveRunEvidence();
        fs.writeFileSync(path.join(WORKSPACE, "kernel-tail.log"), `${lines.slice(-100).join("\n")}\n`);
    }
}

main().catch((error) => {
    console.error(`S1 服务级 E2E 失败：${error.stack || error}`);
    process.exitCode = 1;
});

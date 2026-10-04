import assert from "node:assert/strict";

export async function runLibraryExtensions({ client, plugin, box, until, pass }) {
    const clipStore = await import("../../src/services/clip-store.ts");
    const { normalizeSettings } = await import("../../src/services/settings.ts");
    const { installBridge } = await import("../../src/services/bridge.ts");
    const settings = normalizeSettings({ anchorNotebooks: [box] });
    const articleId = await client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: "/扩展验证/有摘录的文章",
        markdown: "# 有摘录的文章\n\n> 可回溯的摘录原句。\n\n另一段普通正文。",
        tags: "知识回流",
    });
    const ordinaryId = await client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: "/扩展验证/普通笔记",
        markdown: "# 普通笔记\n\n> 不应进入全库摘录。",
    });
    await until("扩展文章 SQL 索引", async () => {
        const rows = await clipStore.listAnchorDocs([box]);
        return [articleId, ordinaryId].every((docId) => rows.some((row) => row.id === docId));
    });
    await clipStore.writeClip(plugin, articleId, {
        status: "later", url: "https://example.org/library-extensions", priority: 5, rating: 4,
        aiTags: ["AI 主题"], site: "example.org",
    });
    const originalAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: articleId });
    const originalBody = await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 });
    await until("扩展文章属性 SQL 索引", async () => (await clipStore.listClipDocs()).some((row) => row.id === articleId));
    const host = {};
    let notifications = 0;
    const facade = { pluginInstance: plugin, settings, notifyDataChanged() { notifications += 1; } };
    const uninstall = installBridge(facade, "1.1.0", host);
    const bridge = host.siyuanGlean;
    assert.equal(bridge.apiVersion, 1);
    assert.equal(await bridge.getClip(ordinaryId), null);
    const filtered = await bridge.listClips({ site: "example.org", tag: "知识回流", aiTag: "AI 主题", limit: 1 });
    assert.equal(filtered[0]?.id, articleId);
    filtered[0].tags.push("外部修改");
    filtered[0].aiTags.push("外部修改");
    const fresh = await bridge.getClip(articleId);
    assert.deepEqual(fresh.tags, ["知识回流"]);
    assert.deepEqual(fresh.aiTags, ["AI 主题"]);
    await assert.rejects(bridge.setClipStatus(articleId, "done"), /disabled/);
    assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: articleId }), originalAttrs);
    settings.integration.bridgeWriteEnabled = true;
    await bridge.setClipStatus(articleId, "done");
    await bridge.setClipStatus(articleId, "archived");
    const afterBridge = await client.apiChecked("/api/attr/getBlockAttrs", { id: articleId });
    assert.equal(afterBridge["custom-clip-status"], "archived");
    assert.match(afterBridge["custom-clip-done-time"], /^\d{14}$/);
    for (const field of ["custom-clip-url", "custom-clip-priority", "custom-clip-rating", "tags"]) assert.equal(afterBridge[field], originalAttrs[field]);
    assert.equal(notifications, 2);
    uninstall();
    assert.equal(host.siyuanGlean, undefined);
    await assert.rejects(bridge.listClips(), /unloaded/);
    assert.deepEqual(await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 }), originalBody);
    pass("对外桥真实内核读写、默认关闭、完成历史、脱离引用及卸载失效；正文和手填属性保留");

    const highlights = await import("../../src/services/highlights.ts");
    const highlightDomain = await import("../../src/domain/highlights.ts");
    const rootRows = await client.apiChecked("/api/query/sql", { stmt: `SELECT id, content, type FROM blocks WHERE root_id = '${articleId}' AND type = 'p' ORDER BY id ASC` });
    const markedParagraph = rootRows.find((row) => row.content === "另一段普通正文。");
    assert(markedParagraph);
    await client.apiChecked("/api/attr/setBlockAttrs", { id: markedParagraph.id, attrs: { "custom-clip-highlight": "verified" } });
    await until("标记摘录 SQL 索引", async () => {
        const items = await highlights.listLibraryHighlights(plugin, settings);
        return items.some((item) => item.id === markedParagraph.id);
    });
    const markedSourceBody = await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 });
    const wall = await highlights.listLibraryHighlights(plugin, settings);
    const articleQuotes = wall.filter((item) => item.rootId === articleId);
    assert.equal(articleQuotes.length, 2);
    assert(wall.every((item) => item.rootId !== ordinaryId));
    assert.equal(highlightDomain.filterHighlights(wall, { site: "example.org", tag: "知识回流", aiTag: "AI 主题", search: "摘录原句" }).length, 1);
    const quote = articleQuotes.find((item) => item.id !== markedParagraph.id);
    const quoteLabels = { title: "摘录回流", original: "原块", source: "来源" };
    const selection = articleQuotes.map((item) => item.id);
    const csv = await highlights.exportHighlightsCsv(wall, selection);
    assert(csv.includes(markedParagraph.id));
    assert(csv.includes("AI 主题"));
    const highlightPreview = await highlights.prepareHighlightExport(wall, selection, quoteLabels);
    const highlightSave = await until("摘录导出稿标记和索引", async () => {
        const result = await highlights.saveHighlightDraft(plugin, highlightPreview);
        if (!result.ok && result.reason !== "markFailed") throw new Error(`摘录导出失败: ${result.reason}`);
        return result.ok ? result : false;
    });
    assert.notEqual(highlightSave.docId, articleId);
    assert.deepEqual(await highlights.saveHighlightDraft(plugin, highlightPreview), highlightSave);
    const exportAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: highlightSave.docId });
    assert.equal(exportAttrs["custom-clip-internal"], "true");
    assert.equal(exportAttrs["custom-clip-status"], undefined);
    assert.equal(exportAttrs.tags, undefined);
    const exportedQuoteMd = await client.apiChecked("/api/export/exportMdContent", { id: highlightSave.docId, yfm: false, addTitle: false, refMode: 2 });
    assert(exportedQuoteMd.content.includes(`siyuan://blocks/${quote.id}`));
    assert(exportedQuoteMd.content.includes(`siyuan://blocks/${articleId}`));
    assert.deepEqual(await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 }), markedSourceBody);
    assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: articleId }), afterBridge);
    await client.apiChecked("/api/attr/setBlockAttrs", { id: markedParagraph.id, attrs: { "custom-clip-highlight": "changed" } });
    await until("源标记变更 SQL 索引", async () => (await highlights.listDocHighlights(articleId)).some((item) => item.id === markedParagraph.id && item.source.highlight === "changed"));
    await assert.rejects(highlights.exportHighlightsCsv(wall, selection), (error) => error.reason === "changed");
    const freshWall = await highlights.listLibraryHighlights(plugin, settings);
    assert(freshWall.every((item) => item.rootId !== highlightSave.docId));
    const currentSourceBody = await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 });
    pass("全库摘录真实 SQL 引述/标记聚合、两类标签、源变更阻断和带原块回链的独立导出；原文不改");

    const statsService = await import("../../src/services/stats-service.ts");
    const reviewSession = await statsService.previewReadingReview(plugin, settings, { period: "month" });
    assert(reviewSession.review.completedItems.some((item) => item.id === articleId && item.status === "archived"));
    assert(reviewSession.review.stats.periodCompleted >= 1);
    assert(reviewSession.review.stats.periodByUserTag.some((tag) => tag.name === "知识回流"));
    assert(reviewSession.review.stats.periodByAiTag.some((tag) => tag.name === "AI 主题"));
    assert.equal(reviewSession.review.stats.total, Object.keys((await clipStore.reconcileIndex(plugin, settings)).clips).length);
    assert(reviewSession.review.snapshotAt);
    const year = new Date().getFullYear();
    const expectedDays = new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
    assert.equal(reviewSession.review.stats.heatmap.length, expectedDays);
    assert(reviewSession.csv.includes(articleId));
    assert(reviewSession.markdown.includes(`siyuan://blocks/${articleId}`));
    assert.deepEqual(await statsService.saveReadingReviewReport(plugin, reviewSession), { ok: false, reason: "confirmationRequired" });
    assert.equal(reviewSession.createdDocId, "");
    const reviewSave = await until("阅读回顾报告标记和索引", async () => {
        const result = await statsService.saveReadingReviewReport(plugin, reviewSession, true);
        if (!result.ok && !["markFailed", "readFailed"].includes(result.reason)) throw new Error(`阅读回顾报告失败: ${result.reason}`);
        return result.ok ? result : false;
    });
    assert.deepEqual(await statsService.saveReadingReviewReport(plugin, reviewSession, true), reviewSave);
    const reportAttrs = await client.apiChecked("/api/attr/getBlockAttrs", { id: reviewSave.docId });
    assert.equal(reportAttrs["custom-clip-internal"], "true");
    for (const field of ["custom-clip-status", "custom-clip-url", "custom-clip-priority", "custom-clip-rating", "tags"]) assert.equal(reportAttrs[field], undefined);
    const afterReport = await clipStore.reconcileIndex(plugin, settings);
    assert.equal(afterReport.clips[reviewSave.docId], undefined);
    assert.equal(afterReport.candidates[reviewSave.docId], undefined);
    assert.deepEqual(await client.apiChecked("/api/attr/getBlockAttrs", { id: articleId }), afterBridge);
    assert.deepEqual(await client.apiChecked("/api/export/exportMdContent", { id: articleId, yfm: false, addTitle: false, refMode: 2 }), currentSourceBody);
    pass("阅读回顾真实对账、归档完成事实、独立标签和年度逐日统计；预览确认建内部报告且重试无重复");

    const pagedDoc = await client.apiChecked("/api/filetree/createDocWithMd", {
        notebook: box,
        path: "/扩展验证/分页摘录文章",
        markdown: Array.from({ length: 501 }, (_, index) => `> 分页摘录 ${index + 1}`).join("\n\n"),
    });
    await until("分页文章 SQL 索引", async () => (await clipStore.listAnchorDocs([box])).some((row) => row.id === pagedDoc));
    await clipStore.writeClip(plugin, pagedDoc, { status: "later" });
    await until("501 条摘录 SQL 索引", async () => (await highlights.listDocHighlights(pagedDoc)).length === 501);
    const allPages = await highlights.listLibraryHighlights(plugin, settings);
    const pagedHighlights = allPages.filter((item) => item.rootId === pagedDoc);
    assert.equal(pagedHighlights.length, 501);
    assert.equal(new Set(pagedHighlights.map((item) => item.id)).size, 501);
    assert(pagedHighlights.every((item, index) => index === 0 || pagedHighlights[index - 1].id < item.id));
    pass("单篇 501 条真实引述跨越 500 条 SQL 游标页，全库聚合不遗漏、不重复且稳定排序");

    const { loadReadingOutline } = await import("../../src/services/outline-service.ts");
    const headingRows = await client.apiChecked("/api/query/sql", {
        stmt: `SELECT id, content, type, subtype, root_id, sort FROM blocks WHERE root_id = '${articleId}' AND type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') ORDER BY sort ASC, id ASC`,
    });
    assert(headingRows.some((row) => row.root_id === articleId && /^h[1-6]$/.test(row.subtype)));
    const outline = await loadReadingOutline(articleId);
    assert(outline.length >= 1);
    assert(outline.every((item) => item.id && item.level >= 1 && item.level <= 6));
    pass("真实内核 heading SQL 返回 sort/id 游标数据，阅读大纲保留 h1-h6 实际级别");

    const { exportLibraryCsv, exportAnonymousDiagnostic } = await import("../../src/services/library-export-service.ts");
    const libraryCsv = await exportLibraryCsv(plugin, settings);
    assert(libraryCsv.includes(articleId));
    assert(!libraryCsv.includes("可回溯的摘录原句"));
    const diagnostic = JSON.parse(await exportAnonymousDiagnostic(plugin, settings, "desktop"));
    assert.equal(diagnostic.index.fresh, true);
    assert.equal(diagnostic.frontend, "desktop");
    assert.equal("url" in diagnostic, false);
    assert.equal("title" in diagnostic, false);
    pass("真实内核完整对账后导出属性 CSV 与匿名诊断，正文和来源内容不进入诊断");
}

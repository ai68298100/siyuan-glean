import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-stats:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-stats:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanStatsPost(...args);", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { buildStats, buildReadingReview, previewReadingReview, saveReadingReviewReport, exportWeeklyReport } = await import("../src/services/stats-service.ts");
const { DEFAULT_SETTINGS } = await import("../src/services/settings.ts");
const articleId = "20261004120000-aaaaaaa";
const archivedId = "20261004120000-bbbbbbb";
const candidateId = "20261004120000-ccccccc";
const reportId = "20261004120000-ddddddd";
const now = new Date(2026, 9, 4, 12);
const options = { now, reference: now, period: "week" };

function harness() {
    const documents = new Map([
        [articleId, { id: articleId, content: "已读文章", hpath: "/文章/已读文章", box: "box-1", updated: "20261004120000", markdown: "正文" }],
        [archivedId, { id: archivedId, content: "归档文章", hpath: "/文章/归档文章", box: "box-1", updated: "20261004120000", markdown: "正文" }],
        [candidateId, { id: candidateId, content: "候选文章", hpath: "/文章/候选文章", box: "box-1", updated: "20261004120000", markdown: "https://candidate.test/article" }],
    ]);
    const attributes = new Map([
        [articleId, { "custom-clip-status": "done", "custom-clip-done-time": "20261001120000", "custom-clip-time": "20260930120000", "custom-clip-words": "200", "custom-clip-site": "site.test", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "用户,共同", "custom-clip-ai-tags": "AI,共同" }],
        [archivedId, { "custom-clip-status": "archived", "custom-clip-done-time": "20261002120000", "custom-clip-time": "20261001120000", "custom-clip-site": "site.test", tags: "用户", "custom-clip-ai-tags": "AI" }],
        [candidateId, { "custom-clip-url": "https://candidate.test/article" }],
    ]);
    const calls = [];
    const files = new Map([["glean-index.json", { version: 1, updatedAt: "stale", clips: {}, candidates: {} }]]);
    const failure = { query: false, querySecondPage: false, attrs: false, mark: false, index: false, create: false, invalidId: false, read: false };
    let createGate;
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) {
            if (failure.index) throw new Error("index save failed");
            files.set(name, structuredClone(value));
        },
    };
    globalThis.__gleanStatsPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        if (route === "/api/query/sql" && failure.query) return { code: 1, msg: "query failed" };
        switch (route) {
            case "/api/query/sql": {
                const id = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                if (id) return { code: 0, data: documents.has(id) ? [{ ...documents.get(id) }] : [] };
                const limit = Number(/LIMIT\s+(\d+)/i.exec(body.stmt)?.[1] ?? 500);
                const offset = Number(/OFFSET\s+(\d+)/i.exec(body.stmt)?.[1] ?? 0);
                if (failure.querySecondPage && offset > 0) return { code: 1, msg: "second page failed" };
                const rows = [...documents.values()].filter((document) => {
                    const attrs = attributes.get(document.id) ?? {};
                    if (/box IN/.test(body.stmt)) return document.box === "box-1";
                    if (/tag LIKE/.test(body.stmt)) return String(attrs.tags ?? "").includes("剪藏");
                    return attrs["custom-clip-status"] || attrs["custom-clip-url"];
                }).sort((first, second) => second.id.localeCompare(first.id));
                return { code: 0, data: rows.slice(offset, offset + limit) };
            }
            case "/api/attr/batchGetBlockAttrs":
                return failure.attrs ? { code: 1, msg: "attrs failed" } : { code: 0, data: Object.fromEntries(body.ids.map((id) => [id, attributes.get(id) ?? {}])) };
            case "/api/attr/getBlockAttrs": return { code: 0, data: { ...attributes.get(body.id) } };
            case "/api/attr/setBlockAttrs": {
                if (failure.mark) return { code: 1, msg: "mark failed" };
                attributes.set(body.id, { ...attributes.get(body.id), ...body.attrs });
                return { code: 0, data: null };
            }
            case "/api/export/exportMdContent":
                return failure.read ? { code: 1, msg: "read failed" } : { code: 0, data: { hPath: documents.get(body.id)?.hpath, content: documents.get(body.id)?.markdown } };
            case "/api/filetree/createDocWithMd": {
                if (createGate) await createGate;
                documents.set(reportId, { id: reportId, content: "阅读回顾", hpath: body.path, box: body.notebook, updated: "20261004120000", markdown: body.markdown });
                attributes.set(reportId, {});
                if (failure.create) throw new Error("response lost after commit");
                return { code: 0, data: failure.invalidId ? "" : reportId };
            }
            default: throw new Error(`Unexpected endpoint ${route}`);
        }
    };
    return {
        documents, attributes, calls, files, failure, plugin,
        settings: { ...DEFAULT_SETTINGS, anchorNotebooks: ["box-1"] },
        countCreates() { return calls.filter((call) => call.route === "/api/filetree/createDocWithMd").length; },
        holdCreate(promise) { createGate = promise; },
    };
}

test("预览服务先完整对账，候选独立，可信归档进入期间完成，快照脱离索引引用", async () => {
    const fixture = harness();
    const before = structuredClone([...fixture.attributes]);
    const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
    assert.equal(session.review.stats.total, 2);
    assert.equal(session.review.stats.done, 1);
    assert.equal(session.review.stats.periodCompleted, 2);
    assert.equal(session.review.candidateCount, 1);
    assert.equal(session.review.completedItems.length, 2);
    assert.equal(session.review.stats.periodByUserTag.find((group) => group.name === "用户")?.count, 2);
    assert.equal(session.review.stats.periodByAiTag.find((group) => group.name === "AI")?.count, 2);
    assert.equal(session.review.snapshotAt, fixture.files.get("glean-index.json").updatedAt);
    assert.ok(Number.isFinite(Date.parse(session.review.snapshotAt)));
    assert.equal(fixture.countCreates(), 0);
    assert.deepEqual([...fixture.attributes], before);
    assert.ok(session.markdown.includes("归档文章"));
    assert.ok(session.csv.includes('"candidate-snapshot","unconfirmed","1"'));
    const current = fixture.files.get("glean-index.json");
    assert.equal(buildStats(current, now).doneThisWeek, 1);
    assert.equal(buildReadingReview(current, options).stats.periodCompleted, 2);
    current.clips[articleId].tags.push("后来修改");
    assert.ok(!session.review.completedItems.find((item) => item.id === articleId).tags.includes("后来修改"));
    assert.equal(session.state, "ready");
});

test("作者回顾从真实属性重建投影，排除有状态的internal且不抹除其原状态", async () => {
    const fixture = harness();
    fixture.attributes.get(articleId)["custom-clip-author"] = "公众号";
    fixture.attributes.get(archivedId)["custom-clip-author"] = "内部署名";
    fixture.attributes.get(archivedId)["custom-clip-internal"] = "true";
    const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
    assert.equal(session.review.stats.periodCompleted, 1);
    assert.equal(session.review.stats.total, 1);
    assert.deepEqual(session.review.stats.periodByAuthor, [{ name: "公众号", count: 1 }]);
    assert.equal(session.review.stats.periodSiteAuthors[0].authors[0].name, "公众号");
    assert.ok(session.markdown.includes("公众号"));
    assert.ok(session.csv.includes("公众号"));
    assert.ok(!session.csv.includes("内部署名"));
    assert.equal(fixture.attributes.get(archivedId)["custom-clip-status"], "archived");
});

for (const stage of ["query", "attrs", "index"]) {
    test(`预览 ${stage} 失败不生成报告、不伪造空统计，旧索引保留`, async () => {
        const fixture = harness();
        const before = structuredClone(fixture.files.get("glean-index.json"));
        fixture.failure[stage] = true;
        await assert.rejects(previewReadingReview(fixture.plugin, fixture.settings, options));
        assert.deepEqual(fixture.files.get("glean-index.json"), before);
        assert.equal(fixture.countCreates(), 0);
    });
}

test("满页后的第二页失败必须中止预览且保留旧索引", async () => {
    const fixture = harness();
    for (let index = 0; index < 500; index += 1) {
        const id = `20261003120000-${String(index).padStart(7, "0")}`;
        fixture.documents.set(id, { id, content: "大量文章", hpath: `/文章/${id}`, box: "box-1", updated: "20261003120000", markdown: "正文" });
        fixture.attributes.set(id, { "custom-clip-status": "later" });
    }
    fixture.failure.querySecondPage = true;
    await assert.rejects(previewReadingReview(fixture.plugin, fixture.settings, options), /second page failed/);
    assert.equal(fixture.files.get("glean-index.json").updatedAt, "stale");
    assert.equal(fixture.countCreates(), 0);
});

test("确认后创建当前预览，只有 internal 属性，重复保存幂等且报告不会进入候选", async () => {
    const fixture = harness();
    const before = structuredClone([...fixture.attributes]);
    const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
    assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session), { ok: false, reason: "confirmationRequired" });
    assert.equal(fixture.countCreates(), 0);
    const result = await saveReadingReviewReport(fixture.plugin, session, true);
    assert.deepEqual(result, { ok: true, docId: reportId });
    assert.equal(fixture.documents.get(reportId).markdown, session.markdown);
    assert.deepEqual(fixture.attributes.get(reportId), { "custom-clip-internal": "true" });
    for (const [id, attributes] of before) assert.deepEqual(fixture.attributes.get(id), attributes);
    assert.equal(session.state, "saved");
    assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), result);
    assert.equal(fixture.countCreates(), 1);
    const next = await previewReadingReview(fixture.plugin, fixture.settings, options);
    assert.equal(next.review.stats.total, 2);
    assert.equal(next.review.candidateCount, 1);
    assert.ok(!next.review.completedItems.some((item) => item.id === reportId));
    assert.equal(fixture.files.get("glean-index.json").candidates[reportId], undefined);
});

for (const stage of ["mark", "index", "read"]) {
    test(`建稿后 ${stage} 失败保留 ID，重试不重复创建或覆盖报告与用户字段`, async () => {
        const fixture = harness();
        const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
        const markdown = session.markdown;
        fixture.failure[stage] = true;
        const first = await saveReadingReviewReport(fixture.plugin, session, true);
        assert.equal(first.ok, false);
        assert.equal(first.docId, reportId);
        assert.equal(first.reason, stage === "read" ? "readFailed" : "markFailed");
        assert.equal(session.createdDocId, reportId);
        assert.equal(session.state, "created");
        const second = await saveReadingReviewReport(fixture.plugin, session, true);
        assert.deepEqual(second, first);
        assert.equal(fixture.countCreates(), 1);
        fixture.failure[stage] = false;
        fixture.attributes.get(reportId)["custom-clip-rating"] = "5";
        fixture.attributes.get(articleId)["custom-clip-status"] = "later";
        const markCount = fixture.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length;
        const recovered = await saveReadingReviewReport(fixture.plugin, session, true);
        assert.deepEqual(recovered, { ok: true, docId: reportId });
        assert.equal(fixture.countCreates(), 1);
        assert.equal(fixture.documents.get(reportId).markdown, markdown);
        assert.equal(fixture.attributes.get(reportId)["custom-clip-rating"], "5");
        assert.equal(fixture.attributes.get(articleId)["custom-clip-status"], "later");
        if (stage === "index") assert.equal(fixture.calls.filter((call) => call.route === "/api/attr/setBlockAttrs").length, markCount);
    });
}

for (const stage of ["create", "invalidId"]) {
    test(`${stage} 无可信响应时创建结果未知，后续保存永久禁止再次创建`, async () => {
        const fixture = harness();
        const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
        fixture.failure[stage] = true;
        assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), { ok: false, reason: "createUnknown" });
        fixture.failure[stage] = false;
        assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), { ok: false, reason: "createUnknown" });
        assert.equal(fixture.countCreates(), 1);
        assert.equal(session.state, "unknown");
        assert.equal(session.createdDocId, "");
    });
}

test("并发确认只能发出一次创建，忙碌调用不改变恢复状态", async () => {
    const fixture = harness();
    const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
    let release;
    fixture.holdCreate(new Promise((resolve) => { release = resolve; }));
    const first = saveReadingReviewReport(fixture.plugin, session, true);
    assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), { ok: false, reason: "busy" });
    release();
    assert.equal((await first).ok, true);
    assert.equal(fixture.countCreates(), 1);
});

test("已创建报告被删除、移动或加入读库时恢复失败，不另建或覆盖状态", async () => {
    for (const change of ["deleted", "moved", "captured"]) {
        const fixture = harness();
        const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
        fixture.failure.mark = true;
        await saveReadingReviewReport(fixture.plugin, session, true);
        fixture.failure.mark = false;
        if (change === "deleted") fixture.documents.delete(reportId);
        if (change === "moved") fixture.documents.get(reportId).hpath = "/用户移动的报告";
        if (change === "captured") fixture.attributes.get(reportId)["custom-clip-status"] = "done";
        const before = structuredClone([...fixture.attributes]);
        assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), { ok: false, docId: reportId, reason: "readFailed" });
        assert.equal(fixture.countCreates(), 1);
        assert.deepEqual([...fixture.attributes], before);
    }
});

test("无笔记本可预览和 CSV，但创建需要目标；旧导出入口不能跳过预览", async () => {
    const fixture = harness();
    fixture.settings.anchorNotebooks = [];
    const session = await previewReadingReview(fixture.plugin, fixture.settings, options);
    assert.ok(session.csv);
    assert.deepEqual(await saveReadingReviewReport(fixture.plugin, session, true), { ok: false, reason: "notebookMissing" });
    await assert.rejects(exportWeeklyReport(fixture.files.get("glean-index.json"), fixture.settings, fixture.plugin), /Preview/);
    assert.equal(fixture.countCreates(), 0);
});

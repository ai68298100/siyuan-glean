import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-backup-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-backup-test:siyuan") {
            return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanBackupPost(...args);", shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});

const { exportLibraryBackup, previewBackupRestore, applyBackupRestore } = await import("../src/services/backup-service.ts");
const { DEFAULT_SETTINGS, normalizeSettings, saveSettings } = await import("../src/services/settings.ts");
const { normalizeUiPrefs, saveUiPrefs } = await import("../src/services/prefs.ts");
const { emptyIndex } = await import("../src/services/index-store.ts");
const { BACKUP_FORMAT, parseBackup } = await import("../src/domain/backup.ts");
const { ATTR } = await import("../src/domain/schema.ts");

const firstId = "20261004120000-aaaaaaa";
const secondId = "20261004120000-bbbbbbb";
const missingId = "20261004120000-ccccccc";
const internalId = "20261004120000-ddddddd";
const unavailableId = "20261004120000-eeeeeee";
const notebookId = "20261004110000-nnnnnnn";
const otherNotebookId = "20261004110000-mmmmmmm";
const initialAttrs = {
    [ATTR.status]: "later",
    [ATTR.url]: "https://example.test/original",
    [ATTR.author]: "手填作者",
    [ATTR.priority]: "4",
    [ATTR.rating]: "5",
    tags: "用户标签",
    "custom-user-note": "用户备注",
};

function savedDocument(id = firstId, attrs = { [ATTR.status]: "later", [ATTR.summary]: "恢复摘要" }) {
    return { id, title: "备份标题", box: notebookId, hpath: "/旧目录/备份标题", attrs: structuredClone(attrs) };
}

function backupContent(documents = [savedDocument()], overrides = {}) {
    return JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        createdAt: "2026-10-04T04:00:00.000Z",
        pluginVersion: "1.1.0",
        documents,
        settings: normalizeSettings({ inboxQuota: 75 }),
        uiPrefs: normalizeUiPrefs({ lastView: "stats", readerSidebarCollapsed: true }),
        index: { version: 1, clips: { phantom: { title: "不可信索引" } }, candidates: {}, sentinel: "不恢复派生快照" },
        ...overrides,
    });
}

function harness() {
    const documents = new Map();
    const attributes = new Map();
    const markdowns = new Map();
    const calls = [];
    const loads = [];
    const saves = [];
    const files = new Map([
        ["settings.json", normalizeSettings(DEFAULT_SETTINGS)],
        ["ui-prefs.json", normalizeUiPrefs({ lastView: "library" })],
        ["glean-index.json", emptyIndex()],
        ["ai-usage.json", { privateUsage: "不能导出用量" }],
        ["ai-log.json", { privateLog: "不能导出日志" }],
    ]);
    const controls = {
        failReads: new Set(),
        failMeta: new Set(),
        failWrites: new Set(),
        loseWriteResponses: new Set(),
        failLoads: new Set(),
        failSaves: new Set(),
        loseSaveResponses: new Set(),
        omitBatch: new Map(),
        failScan: false,
        beforeWrite: null,
        afterWrite: null,
        beforeSave: null,
        afterSave: null,
    };
    let batchCount = 0;
    const plugin = {
        manifest: { version: "1.1.0" },
        async loadData(name) {
            loads.push(name);
            if (controls.failLoads.has(name)) throw new Error(`Cannot read ${name}`);
            return structuredClone(files.get(name));
        },
        async saveData(name, value) {
            saves.push({ name, value: structuredClone(value) });
            if (controls.beforeSave) await controls.beforeSave(name, value);
            if (controls.failSaves.has(name)) throw new Error(`Cannot save ${name}`);
            files.set(name, structuredClone(value));
            if (controls.afterSave) await controls.afterSave(name, value);
            if (controls.loseSaveResponses.has(name)) throw new Error(`Response lost for ${name}`);
        },
    };
    function add(id, attrs = initialAttrs, meta = {}, markdown = "# 原文\n\n保留原句和块引用。") {
        documents.set(id, { id, content: "当前标题", hpath: `/当前目录/${id}`, box: notebookId, updated: "20261004120000", tag: "", ...meta });
        attributes.set(id, structuredClone(attrs));
        markdowns.set(id, markdown);
    }
    add(firstId);
    globalThis.__gleanBackupPost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        switch (route) {
            case "/api/attr/getBlockAttrs":
                if (controls.failReads.has(body.id)) throw new Error("Attribute read failed");
                return { code: 0, data: structuredClone(attributes.get(body.id) ?? {}) };
            case "/api/attr/batchGetBlockAttrs": {
                batchCount += 1;
                const omitted = controls.omitBatch.get(batchCount) ?? new Set();
                return { code: 0, data: Object.fromEntries(body.ids.filter((id) => documents.has(id) && !omitted.has(id)).map((id) => [id, structuredClone(attributes.get(id) ?? {})])) };
            }
            case "/api/attr/setBlockAttrs": {
                if (controls.beforeWrite) await controls.beforeWrite(body);
                if (controls.failWrites.has(body.id)) throw new Error("Attribute write rejected");
                assert.ok(documents.has(body.id), "Cannot write a missing document");
                const next = { ...attributes.get(body.id) };
                for (const [key, value] of Object.entries(body.attrs)) {
                    if (value === null) delete next[key];
                    else next[key] = value;
                }
                attributes.set(body.id, next);
                if (controls.afterWrite) await controls.afterWrite(body);
                if (controls.loseWriteResponses.has(body.id)) throw new Error("Attribute response lost");
                return { code: 0, data: null };
            }
            case "/api/query/sql": {
                const matchedId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                if (matchedId) {
                    if (controls.failMeta.has(matchedId)) throw new Error("Metadata read failed");
                    return { code: 0, data: documents.has(matchedId) ? [structuredClone(documents.get(matchedId))] : [] };
                }
                if (controls.failScan) throw new Error("Scan query failed");
                let rows = [...documents.values()];
                if (body.stmt.includes("box IN")) {
                    const boxes = [...body.stmt.match(/box IN \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
                    rows = rows.filter((row) => boxes.includes(row.box));
                } else if (body.stmt.includes("tag LIKE")) {
                    rows = rows.filter((row) => row.tag.includes("剪藏") || attributes.get(row.id)?.tags?.includes("剪藏"));
                } else if (body.stmt.includes("custom-clip-status")) {
                    rows = rows.filter((row) => ATTR.status in (attributes.get(row.id) ?? {}) || ATTR.url in (attributes.get(row.id) ?? {}));
                } else assert.fail(`Unexpected SQL ${body.stmt}`);
                rows.sort((first, second) => second.updated.localeCompare(first.updated) || second.id.localeCompare(first.id));
                const limit = Number(/LIMIT\s+(\d+)/.exec(body.stmt)?.[1] ?? 500);
                const offset = Number(/OFFSET\s+(\d+)/.exec(body.stmt)?.[1] ?? 0);
                return { code: 0, data: structuredClone(rows.slice(offset, offset + limit)) };
            }
            case "/api/export/exportMdContent":
                return { code: 0, data: { content: markdowns.get(body.id), hPath: documents.get(body.id)?.hpath } };
            default: assert.fail(`Unexpected endpoint ${route}`);
        }
    };
    return {
        plugin, documents, attributes, markdowns, files, calls, loads, saves, controls, add,
        writes() { return calls.filter((call) => call.route === "/api/attr/setBlockAttrs"); },
        savedFiles(name) { return saves.filter((save) => save.name === name); },
    };
}

function field(session, key, id = firstId) {
    const diff = session.rows.find((row) => row.document.id === id)?.fields.find((entry) => entry.key === key);
    assert.ok(diff, `Expected difference for ${id}: ${key}`);
    return diff;
}

function librarySnapshot(fixture) {
    return structuredClone({ documents: fixture.documents, attributes: fixture.attributes, markdowns: fixture.markdowns });
}

function assertLibraryUnchanged(fixture, before) {
    assert.deepEqual(librarySnapshot(fixture), before);
    assert.equal(fixture.writes().length, 0);
}

function assertSingleWrite(fixture, id, attrs) {
    assert.deepEqual(fixture.writes(), [{ route: "/api/attr/setBlockAttrs", body: { id, attrs } }]);
}

async function assertUsedPreviewRejected(fixture, session) {
    const writes = fixture.writes().length;
    const saves = fixture.saves.length;
    await assert.rejects(applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: true }), /fresh confirmed preview/);
    assert.equal(fixture.writes().length, writes);
    assert.equal(fixture.saves.length, saves);
    assert.equal(session.busy, false);
    assert.equal(session.used, true);
}

test("导出回读真实属性，仅刷新派生索引；跳过 internal 和未确认候选，保留非法旧值", async () => {
    const fixture = harness();
    Object.assign(fixture.attributes.get(firstId), { [ATTR.author]: "错误\n署名", [ATTR.priority]: "99", "custom-clip-unknown": "旧扩展值" });
    fixture.add(secondId, { [ATTR.status]: "done", [ATTR.summary]: "另一篇" });
    fixture.add(internalId, { [ATTR.status]: "later", [ATTR.internal]: "true" });
    fixture.add(unavailableId, { [ATTR.url]: "https://candidate.test/" });
    fixture.files.get("settings.json").ai.apiKey = "PRIVATE-KEY-SENTINEL";
    fixture.files.get("settings.json").unknownSetting = "忽略未知设置";
    fixture.files.get("ui-prefs.json").unknownPreference = "忽略未知偏好";
    const before = librarySnapshot(fixture);
    const savedSettings = structuredClone(fixture.files.get("settings.json"));
    const savedPrefs = structuredClone(fixture.files.get("ui-prefs.json"));
    const content = await exportLibraryBackup(fixture.plugin, normalizeSettings(DEFAULT_SETTINGS));
    const backup = parseBackup(content);
    assert.deepEqual(backup.documents.map((document) => document.id), [firstId, secondId]);
    assert.deepEqual(backup.documents[0], { id: firstId, title: "当前标题", box: notebookId, hpath: fixture.documents.get(firstId).hpath, attrs: Object.fromEntries(Object.entries(before.attributes.get(firstId)).filter(([key]) => key.startsWith("custom-clip-"))) });
    assert.equal(backup.documents[0].attrs[ATTR.author], "错误\n署名");
    assert.equal(backup.documents[0].attrs[ATTR.priority], "99");
    assert.equal(backup.documents[0].attrs.tags, undefined);
    assert.equal(backup.documents[0].attrs["custom-user-note"], undefined);
    assert.deepEqual(backup.settings, normalizeSettings(savedSettings));
    assert.deepEqual(backup.uiPrefs, normalizeUiPrefs(savedPrefs));
    assert.deepEqual(backup.index, fixture.files.get("glean-index.json"));
    assert.equal(backup.pluginVersion, "1.1.0");
    assert.ok(Number.isFinite(Date.parse(backup.createdAt)));
    assert.ok(!content.includes("PRIVATE-KEY-SENTINEL"));
    assert.ok(!content.includes("不能导出用量"));
    assert.ok(!content.includes("不能导出日志"));
    assert.ok(!content.includes("保留原句和块引用"));
    assert.ok(fixture.saves.every((save) => save.name === "glean-index.json"));
    assert.deepEqual(fixture.files.get("settings.json"), savedSettings);
    assert.deepEqual(fixture.files.get("ui-prefs.json"), savedPrefs);
    assertLibraryUnchanged(fixture, before);
});

test("导出属性回读不完整时失败，不返回缺文章的成功备份", async () => {
    const fixture = harness();
    fixture.controls.omitBatch.set(2, new Set([firstId]));
    const before = librarySnapshot(fixture);
    await assert.rejects(exportLibraryBackup(fixture.plugin, normalizeSettings(DEFAULT_SETTINGS)), /Backup attribute read incomplete/);
    assertLibraryUnchanged(fixture, before);
});

test("导出扫描失败保留旧索引，不能导出缓存冒充完整备份", async () => {
    const fixture = harness();
    fixture.files.set("glean-index.json", { ...emptyIndex(), sentinel: "保留旧缓存" });
    fixture.controls.failScan = true;
    const before = librarySnapshot(fixture);
    await assert.rejects(exportLibraryBackup(fixture.plugin, normalizeSettings(DEFAULT_SETTINGS)), /Scan query failed/);
    assert.equal(fixture.files.get("glean-index.json").sentinel, "保留旧缓存");
    assert.equal(fixture.saves.length, 0);
    assertLibraryUnchanged(fixture, before);
});

for (const fileName of ["settings.json", "ui-prefs.json"]) {
    for (const operation of ["export", "preview"]) {
        test(`${operation} 的 ${fileName} 读取失败明确拒绝，不能用默认值冒充已保存快照`, async () => {
            const fixture = harness();
            fixture.controls.failLoads.add(fileName);
            const before = librarySnapshot(fixture);
            const request = operation === "export"
                ? exportLibraryBackup(fixture.plugin, normalizeSettings(DEFAULT_SETTINGS))
                : previewBackupRestore(fixture.plugin, backupContent());
            await assert.rejects(request, new RegExp(`Cannot read ${fileName.replace(".", "\\.")}`));
            assert.ok(fixture.saves.every((save) => save.name === "glean-index.json"));
            assertLibraryUnchanged(fixture, before);
        });
    }
}

test("无效导入包在任何内核读取或插件存储操作前拒绝", async () => {
    const fixture = harness();
    await assert.rejects(previewBackupRestore(fixture.plugin, backupContent([], { version: 2 })), /Unsupported backup format or version/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.loads.length, 0);
    assert.equal(fixture.saves.length, 0);
});

test("预览只读，缺失、internal、读取失败分别标明；不按同名文档匹配", async () => {
    const fixture = harness();
    fixture.add(secondId, initialAttrs, { content: "备份标题" });
    fixture.add(internalId, { [ATTR.internal]: "true", [ATTR.status]: "later" });
    fixture.add(unavailableId);
    fixture.controls.failReads.add(unavailableId);
    const before = librarySnapshot(fixture);
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId), savedDocument(missingId), savedDocument(internalId), savedDocument(unavailableId)]));
    assert.deepEqual(session.rows.map((row) => [row.document.id, row.state, row.allowDuplicate]), [
        [firstId, "ready", false], [missingId, "missing", false], [internalId, "internal", false], [unavailableId, "unavailable", false],
    ]);
    assert.equal(session.rows[0].snapshot.meta.hpath, fixture.documents.get(firstId).hpath);
    assert.equal(session.rows[1].snapshot, null);
    assert.ok(session.rows.slice(1).every((row) => row.fields.length === 0));
    assert.equal(fixture.saves.length, 0);
    assertLibraryUnchanged(fixture, before);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assert.equal(report.selected, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    assert.deepEqual(fixture.attributes.get(secondId), before.attributes.get(secondId));
    assert.ok(!fixture.documents.has(missingId));
});

test("默认仅恢复缺失字段，已有作者和状态及评分删除均保留，重建索引不导入旧快照", async () => {
    const fixture = harness();
    const before = structuredClone(fixture.attributes.get(firstId));
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "done", [ATTR.author]: "备份作者", [ATTR.summary]: "恢复摘要" })]));
    assert.equal(field(session, ATTR.summary).selected, true);
    assert.equal(field(session, ATTR.author).selected, false);
    assert.equal(field(session, ATTR.status).selected, false);
    assert.equal(field(session, ATTR.rating).selected, false);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.deepEqual(report, { applied: 1, processed: 1, selected: 1, stopped: false, indexFresh: true, settings: "skipped", uiPrefs: "skipped" });
    assert.deepEqual(fixture.attributes.get(firstId), { ...before, [ATTR.summary]: "恢复摘要" });
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    assert.equal(fixture.files.get("glean-index.json").clips[firstId].summary, "恢复摘要");
    assert.equal(fixture.files.get("glean-index.json").clips.phantom, undefined);
    assert.equal(fixture.files.get("glean-index.json").sentinel, undefined);
    assert.ok(fixture.saves.every((save) => save.name === "glean-index.json"));
    assert.equal(fixture.markdowns.get(firstId), "# 原文\n\n保留原句和块引用。");
    await assertUsedPreviewRejected(fixture, session);
});

test("逐字段明确选择可以覆盖五个手填字段，读完状态恢复不伪造完成时间", async () => {
    const fixture = harness();
    const saved = { [ATTR.status]: "done", [ATTR.url]: "https://new.test/article", [ATTR.author]: "备份作者", [ATTR.priority]: "1", [ATTR.rating]: "0" };
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, saved)]));
    for (const key of Object.keys(saved)) {
        assert.equal(field(session, key).selected, false);
        field(session, key).selected = true;
    }
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assertSingleWrite(fixture, firstId, saved);
    assert.deepEqual(fixture.attributes.get(firstId), { ...initialAttrs, ...saved });
    assert.equal(fixture.attributes.get(firstId)[ATTR.doneTime], undefined);
});

test("逐字段明确删除 URL、作者、优先级和评分，只有所选键写 null，不改用户标签和正文", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "later" })]));
    for (const key of [ATTR.url, ATTR.author, ATTR.priority, ATTR.rating]) {
        assert.equal(field(session, key).kind, "delete");
        assert.equal(field(session, key).selected, false);
        field(session, key).selected = true;
    }
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.url]: null, [ATTR.author]: null, [ATTR.priority]: null, [ATTR.rating]: null });
    assert.deepEqual(fixture.attributes.get(firstId), { [ATTR.status]: "later", tags: "用户标签", "custom-user-note": "用户备注" });
    assert.equal(fixture.markdowns.get(firstId), "# 原文\n\n保留原句和块引用。");
});

test("非法旧属性导出保留，预览即使被勾选也不恢复非法或未知值", async () => {
    const fixture = harness();
    const legacy = { [ATTR.author]: "错误\n署名", [ATTR.priority]: "99", [ATTR.words]: "03", "custom-clip-unknown": "旧扩展值" };
    Object.assign(fixture.attributes.get(firstId), legacy, { [ATTR.summary]: "有效摘要" });
    const exported = await exportLibraryBackup(fixture.plugin, normalizeSettings(DEFAULT_SETTINGS));
    assert.deepEqual(parseBackup(exported).documents[0].attrs, Object.fromEntries(Object.entries(fixture.attributes.get(firstId)).filter(([key]) => key.startsWith("custom-clip-"))));
    fixture.attributes.set(firstId, { ...initialAttrs, [ATTR.words]: "10", "custom-clip-current-only": "不删除未知值" });
    const session = await previewBackupRestore(fixture.plugin, exported);
    for (const key of [...Object.keys(legacy), "custom-clip-current-only"]) {
        const difference = field(session, key);
        assert.equal(difference.supported, false);
        assert.equal(difference.selected, false);
        difference.selected = true;
    }
    assert.equal((await applyBackupRestore(fixture.plugin, session, { confirmed: true })).applied, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "有效摘要" });
    assert.equal(fixture.attributes.get(firstId)[ATTR.author], "手填作者");
    assert.equal(fixture.attributes.get(firstId)[ATTR.words], "10");
    assert.equal(fixture.attributes.get(firstId)["custom-clip-unknown"], undefined);
    assert.equal(fixture.attributes.get(firstId)["custom-clip-current-only"], "不删除未知值");
});

for (const location of ["box", "hpath"]) {
    test(`预览后 ${location} 变化拒绝写入旧目标，保留用户当前位置`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent());
        fixture.documents.get(firstId)[location] = location === "box" ? otherNotebookId : "/新目录/移走的文章";
        const before = librarySnapshot(fixture);
        const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
        assert.equal(report.applied, 0);
        assert.equal(session.rows[0].state, "changed");
        assertLibraryUnchanged(fixture, before);
        await assertUsedPreviewRejected(fixture, session);
    });
}

for (const selectedKey of [ATTR.author, ATTR.summary]) {
    test(`所选 ${selectedKey} 在预览后被用户修改时，整篇补丁拒绝覆盖`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "later", [ATTR.author]: "备份作者", [ATTR.summary]: "恢复摘要" })]));
        field(session, selectedKey).selected = true;
        fixture.attributes.get(firstId)[selectedKey] = "用户新值";
        const before = librarySnapshot(fixture);
        const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
        assert.equal(report.applied, 0);
        assert.equal(session.rows[0].state, "changed");
        assertLibraryUnchanged(fixture, before);
    });
}

test("未选择的属性可以变化，恢复只补所选缺失字段并保留用户的新值", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    fixture.attributes.get(firstId)[ATTR.author] = "用户最新作者";
    fixture.attributes.get(firstId).tags = "用户最新标签";
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    assert.equal(fixture.attributes.get(firstId)[ATTR.author], "用户最新作者");
    assert.equal(fixture.attributes.get(firstId).tags, "用户最新标签");
});

test("预览后目标变成 internal 时拒绝写入", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    fixture.attributes.get(firstId)[ATTR.internal] = "true";
    const before = librarySnapshot(fixture);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 0);
    assert.equal(session.rows[0].state, "internal");
    assertLibraryUnchanged(fixture, before);
});

for (const restoredField of ["url", "status"]) {
    test(`恢复 ${restoredField} 复查完整 URL，同来源冲突拒绝整篇，重新预览明确保留后才恢复`, async () => {
        const fixture = harness();
        const source = "https://EXAMPLE.test:443/article/#old";
        fixture.attributes.set(firstId, restoredField === "url" ? { [ATTR.status]: "later" } : { [ATTR.url]: source });
        const content = backupContent([savedDocument(firstId, { [ATTR.status]: "later", [ATTR.url]: source, [ATTR.summary]: "恢复摘要" })]);
        const session = await previewBackupRestore(fixture.plugin, content);
        fixture.add(secondId, { [ATTR.status]: "done", [ATTR.url]: "https://example.test/article#new" });
        const before = librarySnapshot(fixture);
        const refused = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
        assert.equal(refused.applied, 0);
        assert.equal(session.rows[0].state, "conflict");
        assertLibraryUnchanged(fixture, before);
        await assertUsedPreviewRejected(fixture, session);
        const fresh = await previewBackupRestore(fixture.plugin, content);
        assert.equal(fresh.rows[0].allowDuplicate, false);
        fresh.rows[0].allowDuplicate = true;
        const accepted = await applyBackupRestore(fixture.plugin, fresh, { confirmed: true });
        assert.equal(accepted.applied, 1);
        assert.equal(fresh.rows[0].state, "applied");
        assert.equal(fixture.attributes.get(firstId)[ATTR.url], source);
        assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "恢复摘要");
        assert.deepEqual(fixture.attributes.get(secondId), before.attributes.get(secondId));
        assert.equal(fixture.writes().length, 1);
        assert.ok(fixture.saves.every((save) => save.name === "glean-index.json"));
    });
}

test("补回 status 时未选 URL 的变化也阻止旧预览，避免按旧来源查重后写入新来源", async () => {
    const fixture = harness();
    fixture.attributes.set(firstId, { [ATTR.url]: "https://old.test/article" });
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "later", [ATTR.url]: "https://old.test/article", [ATTR.summary]: "恢复摘要" })]));
    assert.ok(!session.rows[0].fields.some((difference) => difference.key === ATTR.url));
    fixture.attributes.get(firstId)[ATTR.url] = "https://new.test/article";
    fixture.add(secondId, { [ATTR.status]: "later", [ATTR.url]: "https://new.test/article" });
    const before = librarySnapshot(fixture);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 0);
    assert.equal(session.rows[0].state, "changed");
    assertLibraryUnchanged(fixture, before);
});

test("查重排除目标自身，显式重写等价 URL 不造成自冲突", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "later", [ATTR.url]: "https://EXAMPLE.test:443/original/#hash" })]));
    field(session, ATTR.url).selected = true;
    assert.equal((await applyBackupRestore(fixture.plugin, session, { confirmed: true })).applied, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.url]: "https://EXAMPLE.test:443/original/#hash" });
});

test("同一包的后续文章仍按已恢复的前一篇查重，不批量写出隐含同来源副本", async () => {
    const fixture = harness();
    fixture.attributes.set(firstId, { [ATTR.status]: "later" });
    fixture.add(secondId, { [ATTR.status]: "later" });
    const savedAttrs = { [ATTR.status]: "later", [ATTR.url]: "https://duplicate.test/article", [ATTR.summary]: "恢复摘要" };
    const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, savedAttrs), savedDocument(secondId, savedAttrs)]));
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assert.equal(report.processed, 2);
    assert.deepEqual(session.rows.map((row) => row.state), ["applied", "conflict"]);
    assertSingleWrite(fixture, firstId, { [ATTR.url]: savedAttrs[ATTR.url], [ATTR.summary]: "恢复摘要" });
    assert.deepEqual(fixture.attributes.get(secondId), { [ATTR.status]: "later" });
});

test("内核成功响应不能替代写后读回，读回不匹配不能报告 applied", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    fixture.controls.afterWrite = ({ id }) => { fixture.attributes.get(id)[ATTR.summary] = "另一客户端的新值"; };
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 0);
    assert.equal(session.rows[0].state, "changed");
    assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "另一客户端的新值");
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    await assertUsedPreviewRejected(fixture, session);
});

test("属性写响应丢失但实际落盘且读回匹配时确认成功，仅发送一次属性写", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    fixture.controls.loseWriteResponses.add(firstId);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assert.equal(report.indexFresh, true);
    assert.equal(session.rows[0].state, "applied");
    assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "恢复摘要");
    assert.equal(fixture.files.get("glean-index.json").clips[firstId].summary, "恢复摘要");
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    const writePosition = fixture.calls.findIndex((call) => call.route === "/api/attr/setBlockAttrs");
    assert.ok(fixture.calls.slice(writePosition + 1).some((call) => call.route === "/api/attr/getBlockAttrs" && call.body.id === firstId));
    await assertUsedPreviewRejected(fixture, session);
});

for (const mismatch of [false, true]) {
    test(`响应丢失后多字段读回${mismatch ? "一项不符不能确认整篇成功" : "全部匹配含删除才确认整篇成功"}`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent([savedDocument(firstId, { [ATTR.status]: "later", [ATTR.author]: "备份作者", [ATTR.summary]: "恢复摘要" })]));
        field(session, ATTR.author).selected = true;
        field(session, ATTR.rating).selected = true;
        fixture.controls.loseWriteResponses.add(firstId);
        if (mismatch) fixture.controls.afterWrite = ({ id }) => { fixture.attributes.get(id)[ATTR.author] = "另一客户端的作者"; };
        const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
        assert.equal(report.applied, mismatch ? 0 : 1);
        assert.equal(session.rows[0].state, mismatch ? "unknown" : "applied");
        assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "恢复摘要");
        assert.equal(fixture.attributes.get(firstId)[ATTR.rating], undefined);
        assert.equal(fixture.attributes.get(firstId)[ATTR.author], mismatch ? "另一客户端的作者" : "备份作者");
        assertSingleWrite(fixture, firstId, { [ATTR.author]: "备份作者", [ATTR.rating]: null, [ATTR.summary]: "恢复摘要" });
        await assertUsedPreviewRejected(fixture, session);
    });
}

test("属性已落盘但索引保存失败，可读回确认文章成功，并单独报告索引未刷新", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    fixture.controls.failSaves.add("glean-index.json");
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
    assert.equal(report.applied, 1);
    assert.equal(report.indexFresh, false);
    assert.equal(session.rows[0].state, "applied");
    assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "恢复摘要");
    assert.equal(fixture.files.get("glean-index.json").clips[firstId], undefined);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    await assertUsedPreviewRejected(fixture, session);
});

for (const failure of ["readback", "mismatch", "rejected"]) {
    test(`写结果 ${failure} 不能确认时报告 unknown，不自动重试或回滚`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent());
        if (failure === "rejected") fixture.controls.failWrites.add(firstId);
        else {
            fixture.controls.loseWriteResponses.add(firstId);
            fixture.controls.afterWrite = ({ id }) => {
                if (failure === "readback") fixture.controls.failReads.add(id);
                else fixture.attributes.get(id)[ATTR.summary] = "不匹配的实际值";
            };
        }
        const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true });
        assert.equal(report.applied, 0);
        assert.equal(session.rows[0].state, "unknown");
        assert.equal(fixture.attributes.get(firstId)[ATTR.summary], failure === "rejected" ? undefined : failure === "readback" ? "恢复摘要" : "不匹配的实际值");
        assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
        await assertUsedPreviewRejected(fixture, session);
    });
}

test("未确认、无选择和忙碌预览均拒绝；失败前置条件不会消耗可用预览", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    await assert.rejects(applyBackupRestore(fixture.plugin, session, { confirmed: false }), /fresh confirmed preview/);
    field(session, ATTR.summary).selected = false;
    await assert.rejects(applyBackupRestore(fixture.plugin, session, { confirmed: true }), /No restore fields selected/);
    assert.equal(session.used, false);
    assert.equal(fixture.writes().length, 0);
    field(session, ATTR.summary).selected = true;
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    fixture.controls.beforeWrite = async () => { entered.resolve(); await released.promise; };
    const applying = applyBackupRestore(fixture.plugin, session, { confirmed: true });
    await entered.promise;
    try {
        assert.equal(session.busy, true);
        await assert.rejects(applyBackupRestore(fixture.plugin, session, { confirmed: true }), /fresh confirmed preview/);
    } finally { released.resolve(); }
    assert.equal((await applying).applied, 1);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    await assertUsedPreviewRejected(fixture, session);
});

test("取消保留已完成文章，跳过后续文章和偏好；新预览仅恢复仍缺失的字段", async () => {
    const fixture = harness();
    fixture.add(secondId);
    const controller = new AbortController();
    const content = backupContent([savedDocument(firstId), savedDocument(secondId)]);
    const session = await previewBackupRestore(fixture.plugin, content);
    const progress = [];
    const report = await applyBackupRestore(fixture.plugin, session, {
        confirmed: true, signal: controller.signal, restoreSettings: true, restoreUiPrefs: true,
        onProgress(processed, selected) { progress.push([processed, selected]); controller.abort(); },
    });
    assert.deepEqual(report, { applied: 1, processed: 1, selected: 2, stopped: true, indexFresh: true, settings: "skipped", uiPrefs: "skipped" });
    assert.deepEqual(progress, [[1, 2]]);
    assert.deepEqual(session.rows.map((row) => row.state), ["applied", "skipped"]);
    assert.equal(fixture.attributes.get(firstId)[ATTR.summary], "恢复摘要");
    assert.equal(fixture.attributes.get(secondId)[ATTR.summary], undefined);
    assertSingleWrite(fixture, firstId, { [ATTR.summary]: "恢复摘要" });
    assert.equal(fixture.savedFiles("settings.json").length, 0);
    assert.equal(fixture.savedFiles("ui-prefs.json").length, 0);
    await assertUsedPreviewRejected(fixture, session);
    const fresh = await previewBackupRestore(fixture.plugin, content);
    assert.ok(!fresh.rows[0].fields.some((difference) => difference.selected));
    assert.equal((await applyBackupRestore(fixture.plugin, fresh, { confirmed: true })).applied, 1);
    assert.deepEqual(fixture.writes().map((call) => call.body.id), [firstId, secondId]);
});

test("开始前取消不写属性和偏好，旧预览消耗后不可复用", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent());
    const controller = new AbortController();
    controller.abort();
    const before = librarySnapshot(fixture);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true, signal: controller.signal, restoreSettings: true, restoreUiPrefs: true });
    assert.equal(report.stopped, true);
    assert.equal(report.applied, 0);
    assert.equal(report.processed, 0);
    assert.equal(session.rows[0].state, "skipped");
    assert.equal(fixture.savedFiles("settings.json").length, 0);
    assert.equal(fixture.savedFiles("ui-prefs.json").length, 0);
    assertLibraryUnchanged(fixture, before);
    await assertUsedPreviewRejected(fixture, session);
});

test("只读预览可以取消，中断不产生文章状态或持久化恢复授权", async () => {
    const fixture = harness();
    const controller = new AbortController();
    controller.abort();
    const before = librarySnapshot(fixture);
    await assert.rejects(previewBackupRestore(fixture.plugin, backupContent(), controller.signal), /Backup preview cancelled/);
    assert.equal(fixture.saves.length, 0);
    assertLibraryUnchanged(fixture, before);
});

test("设置和偏好恢复各自显式选择，恢复设置关闭所有 AI 和协作写开关及默认编辑", async () => {
    const fixture = harness();
    const saved = {
        ...normalizeSettings({ inboxQuota: 75, reader: { openInTab: true, defaultMode: "edit" } }),
        ai: { ...DEFAULT_SETTINGS.ai, enrichMode: "auto", enrichDailyCap: 12, channel: "custom", customBaseUrl: "https://ai.test/v1", customModel: "test-model", customSecretName: "named-secret", dedupOnEnrich: true, relatedWhileReading: true, formattingEnabled: true, presetActions: true, authorSuggestionEnabled: true, questionCardEnabled: true, apiKey: "DO-NOT-RESTORE-KEY" },
        integration: { checkinEnabled: true, checkinItemId: "selected-item", bridgeWriteEnabled: true },
    };
    const session = await previewBackupRestore(fixture.plugin, backupContent([], { settings: saved }));
    assert.equal(fixture.saves.length, 0);
    assert.equal(fixture.files.get("settings.json").ai.enrichMode, "manual");
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: true, restoreUiPrefs: true });
    assert.equal(report.settings, "applied");
    assert.equal(report.uiPrefs, "applied");
    assert.equal(report.applied, 0);
    const restored = fixture.files.get("settings.json");
    assert.equal(restored.inboxQuota, 75);
    assert.equal(restored.ai.enrichMode, "off");
    for (const key of ["dedupOnEnrich", "relatedWhileReading", "formattingEnabled", "presetActions", "authorSuggestionEnabled", "questionCardEnabled"]) assert.equal(restored.ai[key], false, key);
    assert.equal(restored.integration.checkinEnabled, false);
    assert.equal(restored.integration.bridgeWriteEnabled, false);
    assert.equal(restored.integration.checkinItemId, "selected-item");
    assert.deepEqual(restored.reader, { openInTab: true, defaultMode: "read" });
    assert.equal(restored.ai.customSecretName, "named-secret");
    assert.equal(restored.ai.customModel, "test-model");
    assert.equal(restored.ai.apiKey, undefined);
    assert.deepEqual(fixture.files.get("ui-prefs.json"), session.preferences.afterUiPrefs);
    assert.equal(fixture.writes().length, 0);
    assert.ok(fixture.calls.every((call) => !call.route.startsWith("/api/ai/")));
    assert.equal(fixture.savedFiles("settings.json").length, 1);
    assert.equal(fixture.savedFiles("ui-prefs.json").length, 1);
});

for (const preference of ["settings", "uiPrefs"]) {
    test(`${preference} 预览后冲突保留新值，另一种偏好仍可独立恢复`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent());
        const fileName = preference === "settings" ? "settings.json" : "ui-prefs.json";
        if (preference === "settings") await saveSettings(fixture.plugin, normalizeSettings({ inboxQuota: 95 }));
        else await saveUiPrefs(fixture.plugin, { lastView: "resurface" });
        const concurrentValue = structuredClone(fixture.files.get(fileName));
        const earlierSaves = fixture.savedFiles(fileName).length;
        const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: true, restoreUiPrefs: true });
        assert.equal(report.applied, 1);
        assert.equal(report[preference], "changed");
        assert.equal(report[preference === "settings" ? "uiPrefs" : "settings"], "applied");
        assert.deepEqual(fixture.files.get(fileName), concurrentValue);
        assert.equal(fixture.savedFiles(fileName).length, earlierSaves);
        await assertUsedPreviewRejected(fixture, session);
    });
}

for (const preference of ["settings", "uiPrefs"]) {
    test(`${preference} 保存队列内复查预览，先发起但尚未落盘的用户编辑不能被恢复覆盖`, async () => {
        const fixture = harness();
        const session = await previewBackupRestore(fixture.plugin, backupContent([]));
        const fileName = preference === "settings" ? "settings.json" : "ui-prefs.json";
        const entered = Promise.withResolvers();
        const released = Promise.withResolvers();
        fixture.controls.beforeSave = async (name) => {
            if (name === fileName) { entered.resolve(); await released.promise; }
        };
        const editing = preference === "settings"
            ? saveSettings(fixture.plugin, normalizeSettings({ inboxQuota: 95 }))
            : saveUiPrefs(fixture.plugin, { lastView: "resurface" });
        await entered.promise;
        const restoring = applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: preference === "settings", restoreUiPrefs: preference === "uiPrefs" });
        released.resolve();
        await editing;
        const report = await restoring;
        assert.equal(report[preference], "changed");
        assert.equal(fixture.savedFiles(fileName).length, 1);
        if (preference === "settings") assert.equal(fixture.files.get(fileName).inboxQuota, 95);
        else assert.equal(fixture.files.get(fileName).lastView, "resurface");
        assert.equal(fixture.writes().length, 0);
    });
}

for (const preference of ["settings", "uiPrefs"]) {
    for (const failure of ["mismatch", "responseLost"]) {
        test(`${preference} 保存后 ${failure} 返回 unknown，不自动重复写偏好`, async () => {
            const fixture = harness();
            const session = await previewBackupRestore(fixture.plugin, backupContent([]));
            const fileName = preference === "settings" ? "settings.json" : "ui-prefs.json";
            if (failure === "responseLost") fixture.controls.loseSaveResponses.add(fileName);
            else fixture.controls.afterSave = (name) => {
                if (name !== fileName) return;
                if (preference === "settings") fixture.files.get(name).inboxQuota = 95;
                else fixture.files.get(name).lastView = "resurface";
            };
            const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: preference === "settings", restoreUiPrefs: preference === "uiPrefs" });
            assert.equal(report[preference], "unknown");
            assert.equal(fixture.savedFiles(fileName).length, 1);
            assert.equal(fixture.writes().length, 0);
            if (failure === "responseLost") assert.deepEqual(fixture.files.get(fileName), preference === "settings" ? session.preferences.afterSettings : session.preferences.afterUiPrefs);
            await assertUsedPreviewRejected(fixture, session);
        });
    }
}

test("未知设置版本不可恢复，但文章字段和显式 UI 偏好恢复不受阻", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent(undefined, { settings: { version: 2, inboxQuota: 75 } }));
    assert.equal(session.preferences.settingsSupported, false);
    await assert.rejects(applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreSettings: true }), /Unsupported settings version/);
    assert.equal(session.used, false);
    assert.equal(fixture.saves.length, 0);
    assert.equal(fixture.writes().length, 0);
    const report = await applyBackupRestore(fixture.plugin, session, { confirmed: true, restoreUiPrefs: true });
    assert.equal(report.applied, 1);
    assert.equal(report.settings, "skipped");
    assert.equal(report.uiPrefs, "applied");
    assert.equal(fixture.savedFiles("settings.json").length, 0);
});

test("设置更新回调收到预览原值和安全恢复值，仍需真实保存后的读回验证", async () => {
    const fixture = harness();
    const session = await previewBackupRestore(fixture.plugin, backupContent([]));
    const callbackArgs = [];
    const report = await applyBackupRestore(fixture.plugin, session, {
        confirmed: true, restoreSettings: true,
        async updateSettings(next, expected) {
            callbackArgs.push(structuredClone({ next, expected }));
            await saveSettings(fixture.plugin, next, { expected });
        },
    });
    assert.equal(report.settings, "applied");
    assert.deepEqual(callbackArgs, [{ next: session.preferences.afterSettings, expected: session.preferences.beforeSettings }]);
    const noSave = await previewBackupRestore(fixture.plugin, backupContent([], { settings: normalizeSettings({ inboxQuota: 150 }) }));
    const notApplied = await applyBackupRestore(fixture.plugin, noSave, { confirmed: true, restoreSettings: true, async updateSettings() {} });
    assert.equal(notApplied.settings, "unknown");
    assert.equal(fixture.files.get("settings.json").inboxQuota, 75);
    assert.equal(fixture.savedFiles("settings.json").length, 1);
});

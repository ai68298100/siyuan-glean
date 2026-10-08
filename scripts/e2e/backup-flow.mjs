import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export async function runBackupFlow({ client, plugin, box, until, pass, workspace }) {
    const clipStore = await import("../../src/services/clip-store.ts");
    const backupService = await import("../../src/services/backup-service.ts");
    const { parseBackup } = await import("../../src/domain/backup.ts");
    const { loadIndex } = await import("../../src/services/index-store.ts");
    const { loadSettings, normalizeSettings, saveSettings } = await import("../../src/services/settings.ts");
    const { loadUiPrefs, saveUiPrefs } = await import("../../src/services/prefs.ts");
    const evidenceDir = path.join(workspace, "backup-flow");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const indexMarker = "backup-index-snapshot-must-never-be-restored";
    const ghostId = "20000101000000-backupx";
    const kernelCalls = [];
    const storageWrites = [];
    let afterAttributeWrite;
    const monitoredPlugin = {
        ...plugin,
        async saveData(name, value) {
            storageWrites.push({ name, containsBackupSnapshot: JSON.stringify(value).includes(indexMarker) });
            await plugin.saveData(name, value);
        },
    };
    const transport = globalThis.__gleanS1FetchSyncPost;
    assert.equal(typeof transport, "function");
    globalThis.__gleanS1FetchSyncPost = async (route, body) => {
        kernelCalls.push({ route, id: body?.id, ...(route === "/api/attr/setBlockAttrs" ? { attrs: structuredClone(body.attrs) } : {}) });
        const result = await transport(route, body);
        if (route === "/api/attr/setBlockAttrs" && result.code === 0) await afterAttributeWrite?.(body);
        return result;
    };
    const evidence = {
        workspace: path.resolve(workspace),
        startedAt: new Date().toISOString(),
        completed: false,
        documents: {},
        scenarios: [],
        kernelCalls,
        storageWrites,
    };
    const writeEvidence = () => fs.writeFileSync(path.join(evidenceDir, "backup-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    const record = (label, details = {}) => {
        evidence.scenarios.push({ label, ...details });
        writeEvidence();
        pass(label);
    };
    const attrsOf = (id) => client.apiChecked("/api/attr/getBlockAttrs", { id });
    const bodyOf = async (id) => (await client.apiChecked("/api/export/exportMdContent", { id, yfm: false, addTitle: false, refMode: 2 })).content;
    const baseline = new Map();
    const makeArticle = async (name, patch) => {
        const id = await client.apiChecked("/api/filetree/createDocWithMd", {
            notebook: box,
            path: `/备份恢复验证/${name}`,
            markdown: `# ${name}\n\n必须保留的用户正文：${name}。\n\n> 这是原文引述，恢复不得复制或替换。`,
            tags: "备份用户标签",
        });
        await until(`${name} SQL 元数据`, async () => (await clipStore.listAnchorDocs([box])).some((doc) => doc.id === id));
        const attrs = await attrsOf(id);
        assert.equal(typeof attrs.tags, "string");
        baseline.set(id, { body: await bodyOf(id), tags: attrs.tags });
        await clipStore.writeClip(monitoredPlugin, id, { status: "later", ...patch });
        evidence.documents[name] = id;
        return id;
    };
    const selectFields = (session, selections) => {
        for (const row of session.rows) {
            const keys = selections[row.document.id] ?? [];
            for (const key of keys) assert(row.fields.some((field) => field.key === key && field.supported), `字段必须可恢复：${row.document.id}/${key}`);
            for (const field of row.fields) field.selected = keys.includes(field.key);
        }
    };
    const rowOf = (session, id) => {
        const row = session.rows.find((item) => item.document.id === id);
        assert(row, `缺少恢复行：${id}`);
        return row;
    };
    const assertContentPreserved = async () => {
        for (const [id, original] of baseline) {
            assert.equal(await bodyOf(id), original.body, `原文变化：${id}`);
            assert.equal((await attrsOf(id)).tags, original.tags, `用户标签变化：${id}`);
        }
    };
    const writesSince = (offset) => kernelCalls.slice(offset).filter((call) => call.route === "/api/attr/setBlockAttrs");
    const assertServiceReadback = (offset, id) => {
        const calls = kernelCalls.slice(offset);
        const writeOffset = calls.findIndex((call) => call.route === "/api/attr/setBlockAttrs" && call.id === id);
        assert(writeOffset >= 0);
        assert(calls.slice(writeOffset + 1).some((call) => call.route === "/api/attr/getBlockAttrs" && call.id === id), "恢复服务必须在写入后重新读取真实属性");
    };

    try {
        evidence.kernelVersion = await client.apiChecked("/api/system/version");
        writeEvidence();
        const settings = normalizeSettings({ anchorNotebooks: [box] });
        await saveSettings(monitoredPlugin, settings);
        await saveUiPrefs(monitoredPlugin, { lastView: "library", readerSidebarCollapsed: true });
        const rawAuthor = `原始来源署名${"旧".repeat(121)}`;
        const legacy = await makeArticle("原始非法属性", { url: "https://example.org/backup-legacy" });
        await client.apiChecked("/api/attr/setBlockAttrs", {
            id: legacy,
            attrs: { "custom-clip-author": rawAuthor, "custom-clip-priority": "999", "custom-clip-rating": "-7", "custom-clip-future-field": "未知原始属性值" },
        });
        const editable = await makeArticle("默认补缺与显式恢复", {
            url: "https://example.org/backup-original-source", author: "备份确认作者", priority: 4, rating: 3, summary: "备份摘要", aiTags: ["备份AI标签"],
        });
        const changed = await makeArticle("预览后属性变化", { author: "备份竞态作者", summary: "备份竞态摘要" });
        const readback = await makeArticle("写后手填读回冲突", { author: "备份读回作者" });
        const duplicate = await makeArticle("同来源冲突", { url: "https://example.org/backup-duplicate", author: "备份同来源作者" });
        const stoppedFirst = await makeArticle("停止前已写", { author: "第一篇备份作者" });
        const stoppedSecond = await makeArticle("停止后未写", { author: "第二篇备份作者" });
        const articleIds = [legacy, editable, changed, readback, duplicate, stoppedFirst, stoppedSecond];
        await until("备份样本属性 SQL 索引", async () => {
            const docs = await clipStore.listClipDocs();
            return articleIds.every((id) => docs.some((doc) => doc.id === id));
        });
        const legacyBeforeExport = await attrsOf(legacy);
        const exportedContent = await backupService.exportLibraryBackup(monitoredPlugin, settings);
        fs.writeFileSync(path.join(evidenceDir, "exported-backup.json"), `${exportedContent}\n`);
        const exported = parseBackup(exportedContent);
        const legacyExport = exported.documents.find((document) => document.id === legacy);
        assert(legacyExport);
        assert.deepEqual(legacyExport.attrs, Object.fromEntries(Object.entries(legacyBeforeExport).filter(([key]) => key.startsWith("custom-clip-"))));
        assert.equal(legacyExport.attrs["custom-clip-author"], rawAuthor);
        assert.equal(legacyExport.attrs["custom-clip-priority"], "999");
        assert.equal(legacyExport.attrs["custom-clip-rating"], "-7");
        assert.equal(legacyExport.attrs["custom-clip-future-field"], "未知原始属性值");
        assert(exported.index.clips[editable]);
        assert(exported.documents.every((document) => !("tags" in document.attrs) && !("body" in document)));
        assert(!exportedContent.includes("必须保留的用户正文"));
        await assertContentPreserved();
        record("备份导出：真实根属性保留原始作者及未知/非法旧值；正文与用户标签不进入恢复字段", { legacyId: legacy, rawAttrs: legacyExport.attrs });

        const contentFor = (ids, edit) => {
            const value = structuredClone(exported);
            value.documents = ids.map((id) => {
                const document = value.documents.find((item) => item.id === id);
                assert(document);
                return document;
            });
            value.index = {
                ...value.index,
                backupSentinel: indexMarker,
                clips: {
                    ...value.index.clips,
                    [editable]: { ...value.index.clips[editable], author: indexMarker, status: "archived" },
                    [ghostId]: { ...value.index.clips[editable], id: ghostId, author: indexMarker },
                },
            };
            edit?.(value);
            return JSON.stringify(value);
        };
        await clipStore.writeClip(monitoredPlugin, editable, {
            url: "https://example.org/backup-user-current", status: "reading", author: "当前手填作者", priority: 1, rating: 5,
            summary: null, aiTags: null, snapshot: "assets/current-user-snapshot.html",
        }, { force: true });
        const previewContent = contentFor([editable], (value) => {
            value.settings.inboxQuota = 83;
            value.uiPrefs.lastView = "stats";
        });
        fs.writeFileSync(path.join(evidenceDir, "preview-input.json"), `${previewContent}\n`);
        const beforePreview = await attrsOf(editable);
        const beforePreviewIndex = await monitoredPlugin.loadData("glean-index.json");
        const beforeSettings = await loadSettings(monitoredPlugin, { strict: true });
        const beforeUiPrefs = await loadUiPrefs(monitoredPlugin, { strict: true });
        const previewCallOffset = kernelCalls.length;
        const previewStorageOffset = storageWrites.length;
        const preview = await backupService.previewBackupRestore(monitoredPlugin, previewContent);
        assert.equal(preview.busy, false);
        assert.equal(preview.used, false);
        assert.equal(rowOf(preview, editable).state, "ready");
        assert.equal(rowOf(preview, editable).allowDuplicate, false);
        assert.deepEqual(await attrsOf(editable), beforePreview);
        assert.deepEqual(await monitoredPlugin.loadData("glean-index.json"), beforePreviewIndex);
        assert.equal(storageWrites.length, previewStorageOffset);
        assert.equal(writesSince(previewCallOffset).length, 0);
        assert.deepEqual(rowOf(preview, editable).fields.filter((field) => field.selected).map((field) => field.key).sort(), ["custom-clip-ai-tags", "custom-clip-summary"]);
        for (const field of rowOf(preview, editable).fields) assert.equal(field.selected, field.supported && field.kind === "add");
        for (const key of ["custom-clip-url", "custom-clip-author", "custom-clip-status", "custom-clip-priority", "custom-clip-rating"]) {
            const field = rowOf(preview, editable).fields.find((item) => item.key === key);
            assert.equal(field?.kind, "replace");
            assert.equal(field.selected, false);
        }
        assert.equal(rowOf(preview, editable).fields.find((field) => field.key === "custom-clip-snapshot")?.selected, false);
        const unconfirmedOffset = kernelCalls.length;
        await assert.rejects(backupService.applyBackupRestore(monitoredPlugin, preview, { confirmed: false }));
        assert.equal(preview.used, false);
        assert.equal(writesSince(unconfirmedOffset).length, 0);
        await assertContentPreserved();
        record("备份预览只读且需确认；仅补缺默认选中，手填覆盖与删除默认不选", { id: editable, fields: rowOf(preview, editable).fields });

        const defaultOffset = kernelCalls.length;
        const defaultReport = await backupService.applyBackupRestore(monitoredPlugin, preview, { confirmed: true });
        assertServiceReadback(defaultOffset, editable);
        assert.equal(defaultReport.applied, 1);
        assert.equal(defaultReport.processed, 1);
        assert.equal(defaultReport.indexFresh, true);
        assert.equal(defaultReport.settings, "skipped");
        assert.equal(defaultReport.uiPrefs, "skipped");
        const defaultReadback = await attrsOf(editable);
        assert.equal(defaultReadback["custom-clip-summary"], "备份摘要");
        assert.equal(defaultReadback["custom-clip-ai-tags"], "备份AI标签");
        for (const key of ["custom-clip-url", "custom-clip-author", "custom-clip-status", "custom-clip-priority", "custom-clip-rating", "custom-clip-snapshot", "tags"]) assert.equal(defaultReadback[key], beforePreview[key]);
        assert.deepEqual(await loadSettings(monitoredPlugin, { strict: true }), beforeSettings);
        assert.deepEqual(await loadUiPrefs(monitoredPlugin, { strict: true }), beforeUiPrefs);
        assert.deepEqual(writesSince(defaultOffset).map((call) => Object.keys(call.attrs).sort()), [["custom-clip-ai-tags", "custom-clip-summary"]]);
        const rebuiltIndex = await loadIndex(monitoredPlugin, { strict: true });
        assert.equal(rebuiltIndex.clips[editable].author, "当前手填作者");
        assert.equal(rebuiltIndex.clips[editable].status, "reading");
        assert.equal(rebuiltIndex.clips[ghostId], undefined);
        assert.equal(JSON.stringify(rebuiltIndex).includes(indexMarker), false);
        assert(storageWrites.every((write) => !write.containsBackupSnapshot));
        record("默认恢复仅补缺且保留手填、设置与偏好；篡改的索引快照不写入，最终从真实属性对账", { report: defaultReport, readback: defaultReadback, ghostId });

        const explicit = await backupService.previewBackupRestore(monitoredPlugin, previewContent);
        const explicitKeys = ["custom-clip-url", "custom-clip-author", "custom-clip-status", "custom-clip-priority", "custom-clip-rating", "custom-clip-snapshot"];
        selectFields(explicit, { [editable]: explicitKeys });
        const explicitOffset = kernelCalls.length;
        const explicitReport = await backupService.applyBackupRestore(monitoredPlugin, explicit, { confirmed: true });
        assertServiceReadback(explicitOffset, editable);
        assert.equal(explicitReport.applied, 1);
        assert.equal(rowOf(explicit, editable).state, "applied");
        const explicitReadback = await attrsOf(editable);
        const savedEditable = exported.documents.find((document) => document.id === editable);
        for (const key of explicitKeys) assert.equal(explicitReadback[key] ?? null, savedEditable.attrs[key] ?? null);
        assert.equal(explicitReadback["custom-clip-summary"], defaultReadback["custom-clip-summary"]);
        assert.deepEqual(writesSince(explicitOffset).map((call) => Object.keys(call.attrs).sort()), [[...explicitKeys].sort()]);
        const afterExplicitIndex = await loadIndex(monitoredPlugin, { strict: true });
        assert.equal(afterExplicitIndex.clips[editable].author, "备份确认作者");
        assert.equal(afterExplicitIndex.clips[editable].priority, 4);
        assert.equal(afterExplicitIndex.clips[editable].rating, 3);
        await assertContentPreserved();
        record("显式逐字段恢复：URL/作者/状态/优先级/评分覆盖和单键删除均真实读回，未选择字段保持", { report: explicitReport, readback: explicitReadback });

        const unsupportedContent = contentFor([legacy], (value) => {
            Object.assign(value.documents[0].attrs, {
                "custom-clip-author": "  另一原始非法署名  ", "custom-clip-priority": "888", "custom-clip-rating": "非法评分",
                "custom-clip-future-field": "不得恢复的未知属性", "custom-clip-summary": "仅恢复合法摘要",
            });
        });
        fs.writeFileSync(path.join(evidenceDir, "unsupported-input.json"), `${unsupportedContent}\n`);
        const unsupported = await backupService.previewBackupRestore(monitoredPlugin, unsupportedContent);
        const unsupportedRow = rowOf(unsupported, legacy);
        const unsupportedKeys = ["custom-clip-author", "custom-clip-priority", "custom-clip-rating", "custom-clip-future-field"];
        for (const key of unsupportedKeys) {
            const field = unsupportedRow.fields.find((item) => item.key === key);
            assert.equal(field?.supported, false);
            assert.equal(field.selected, false);
            field.selected = true;
        }
        const unsupportedOffset = kernelCalls.length;
        const unsupportedReport = await backupService.applyBackupRestore(monitoredPlugin, unsupported, { confirmed: true });
        assert.equal(unsupportedReport.applied, 1);
        const unsupportedReadback = await attrsOf(legacy);
        for (const key of unsupportedKeys) assert.equal(unsupportedReadback[key], legacyBeforeExport[key]);
        assert.equal(unsupportedReadback["custom-clip-summary"], "仅恢复合法摘要");
        assert.deepEqual(writesSince(unsupportedOffset).map((call) => Object.keys(call.attrs)), [["custom-clip-summary"]]);
        record("非法与未知备份字段即使篡改选择也不恢复；合法补缺单独生效且原始旧值保留", { report: unsupportedReport, readback: unsupportedReadback });

        await clipStore.writeClip(monitoredPlugin, changed, { author: "预览时当前作者", summary: null }, { force: true });
        const stale = await backupService.previewBackupRestore(monitoredPlugin, contentFor([changed]));
        selectFields(stale, { [changed]: ["custom-clip-author", "custom-clip-summary"] });
        await clipStore.saveClipAuthor(monitoredPlugin, changed, "预览时当前作者", "预览后用户新作者");
        const changedBeforeApply = await attrsOf(changed);
        const staleOffset = kernelCalls.length;
        const staleReport = await backupService.applyBackupRestore(monitoredPlugin, stale, { confirmed: true });
        assert.equal(staleReport.applied, 0);
        assert.equal(staleReport.processed, 1);
        assert.equal(rowOf(stale, changed).state, "changed");
        assert.equal(writesSince(staleOffset).length, 0);
        assert.deepEqual(await attrsOf(changed), changedBeforeApply);
        assert.equal((await attrsOf(changed))["custom-clip-summary"], undefined);
        record("预览后手填作者变化拒绝整篇所选补丁，无部分补缺或自动重试", { report: staleReport, readback: changedBeforeApply });

        await clipStore.writeClip(monitoredPlugin, readback, { author: "读回冲突前当前作者" }, { force: true });
        const readbackSession = await backupService.previewBackupRestore(monitoredPlugin, contentFor([readback]));
        selectFields(readbackSession, { [readback]: ["custom-clip-author"] });
        const readbackOffset = kernelCalls.length;
        afterAttributeWrite = async (request) => {
            if (request.id !== readback) return;
            afterAttributeWrite = undefined;
            await clipStore.saveClipAuthor({ ...monitoredPlugin }, readback, "备份读回作者", "写后用户手填作者");
        };
        let readbackReport;
        try {
            readbackReport = await backupService.applyBackupRestore(monitoredPlugin, readbackSession, { confirmed: true });
        } finally {
            afterAttributeWrite = undefined;
        }
        assert.equal(readbackReport.applied, 0);
        assert.equal(readbackReport.processed, 1);
        assert.equal(rowOf(readbackSession, readback).state, "changed");
        assert.deepEqual(writesSince(readbackOffset).map((call) => call.attrs["custom-clip-author"]), ["备份读回作者", "写后用户手填作者"]);
        assert.equal((await attrsOf(readback))["custom-clip-author"], "写后用户手填作者");
        assert.equal((await loadIndex(monitoredPlugin, { strict: true })).clips[readback].author, "写后用户手填作者");
        record("内核已写后另一客户端手填作者：恢复读回判为变化，不报成功、不重发覆盖且对账保留新值", { report: readbackReport, readback: await attrsOf(readback) });

        await clipStore.writeClip(monitoredPlugin, duplicate, { url: "https://example.org/backup-duplicate-current" }, { force: true });
        const duplicatePeer = await makeArticle("已有同来源文章", { url: "https://example.org/backup-duplicate", author: "已有文章作者" });
        const duplicateBeforeApply = await attrsOf(duplicate);
        const peerBeforeApply = await attrsOf(duplicatePeer);
        assert.equal((await clipStore.findClipUrlConflict("https://example.org/backup-duplicate", duplicate, monitoredPlugin))?.id, duplicatePeer);
        const conflictContent = contentFor([duplicate]);
        const conflict = await backupService.previewBackupRestore(monitoredPlugin, conflictContent);
        selectFields(conflict, { [duplicate]: ["custom-clip-url"] });
        const conflictOffset = kernelCalls.length;
        const conflictReport = await backupService.applyBackupRestore(monitoredPlugin, conflict, { confirmed: true });
        assert.equal(conflictReport.applied, 0);
        assert.equal(rowOf(conflict, duplicate).state, "conflict");
        assert.equal(writesSince(conflictOffset).length, 0);
        assert.deepEqual(await attrsOf(duplicate), duplicateBeforeApply);
        const duplicateAllowed = await backupService.previewBackupRestore(monitoredPlugin, conflictContent);
        assert.equal(rowOf(duplicateAllowed, duplicate).allowDuplicate, false);
        selectFields(duplicateAllowed, { [duplicate]: ["custom-clip-url"] });
        rowOf(duplicateAllowed, duplicate).allowDuplicate = true;
        const duplicateReport = await backupService.applyBackupRestore(monitoredPlugin, duplicateAllowed, { confirmed: true });
        assert.equal(duplicateReport.applied, 1);
        assert.equal((await attrsOf(duplicate))["custom-clip-url"], "https://example.org/backup-duplicate");
        assert.deepEqual(await attrsOf(duplicatePeer), peerBeforeApply);
        const nextDuplicatePreview = await backupService.previewBackupRestore(monitoredPlugin, conflictContent);
        assert.equal(rowOf(nextDuplicatePreview, duplicate).allowDuplicate, false);
        record("同URL恢复默认冲突拒写；新预览显式允许另一份才恢复，既有文章与会话外授权保持", { duplicateId: duplicate, peerId: duplicatePeer, conflictReport, duplicateReport });

        await clipStore.writeClip(monitoredPlugin, duplicate, { status: null }, { force: true });
        const restoreStatus = await backupService.previewBackupRestore(monitoredPlugin, conflictContent);
        selectFields(restoreStatus, { [duplicate]: ["custom-clip-status"] });
        const statusOffset = kernelCalls.length;
        const statusReport = await backupService.applyBackupRestore(monitoredPlugin, restoreStatus, { confirmed: true });
        assert.equal(statusReport.applied, 0);
        assert.equal(rowOf(restoreStatus, duplicate).state, "conflict");
        assert.equal(writesSince(statusOffset).length, 0);
        assert.equal((await attrsOf(duplicate))["custom-clip-status"], undefined);
        record("URL未改变时补回读库状态仍查重，同来源默认拒绝重新收录", { report: statusReport });

        await clipStore.writeClip(monitoredPlugin, stoppedFirst, { author: "第一篇当前作者" }, { force: true });
        await clipStore.writeClip(monitoredPlugin, stoppedSecond, { author: "第二篇当前作者" }, { force: true });
        const interrupted = await backupService.previewBackupRestore(monitoredPlugin, contentFor([stoppedFirst, stoppedSecond]));
        selectFields(interrupted, { [stoppedFirst]: ["custom-clip-author"], [stoppedSecond]: ["custom-clip-author"] });
        const abort = new AbortController();
        const stopOffset = kernelCalls.length;
        const progress = [];
        const stopReport = await backupService.applyBackupRestore(monitoredPlugin, interrupted, {
            confirmed: true,
            signal: abort.signal,
            onProgress(processed, selected) {
                progress.push({ processed, selected });
                if (processed === 1) abort.abort();
            },
        });
        assert.equal(stopReport.applied, 1);
        assert.equal(stopReport.processed, 1);
        assert.equal(stopReport.selected, 2);
        assert.equal(stopReport.stopped, true);
        assert.equal(stopReport.indexFresh, true);
        assert.equal(rowOf(interrupted, stoppedFirst).state, "applied");
        assert.equal(rowOf(interrupted, stoppedSecond).state, "skipped");
        assert.equal((await attrsOf(stoppedFirst))["custom-clip-author"], "第一篇备份作者");
        assert.equal((await attrsOf(stoppedSecond))["custom-clip-author"], "第二篇当前作者");
        assert.deepEqual(writesSince(stopOffset).map((call) => call.id), [stoppedFirst]);
        assert.deepEqual(progress, [{ processed: 1, selected: 2 }]);
        const usedOffset = kernelCalls.length;
        await assert.rejects(backupService.applyBackupRestore(monitoredPlugin, interrupted, { confirmed: true }));
        await assert.rejects(backupService.applyBackupRestore(monitoredPlugin, stale, { confirmed: true }));
        assert.equal(writesSince(usedOffset).length, 0);
        assert.equal((await attrsOf(stoppedFirst))["custom-clip-author"], "第一篇备份作者");
        const stopIndex = await loadIndex(monitoredPlugin, { strict: true });
        assert.equal(stopIndex.clips[stoppedFirst].author, "第一篇备份作者");
        assert.equal(stopIndex.clips[stoppedSecond].author, "第二篇当前作者");
        record("恢复停止后已写不回滚、未写保持原值且最终对账；停止与冲突会话不能自动复用", { report: stopReport, progress, states: interrupted.rows.map((row) => ({ id: row.document.id, state: row.state })) });

        await assertContentPreserved();
        assert(storageWrites.every((write) => !write.containsBackupSnapshot));
        evidence.contentReadback = await Promise.all([...baseline].map(async ([id, original]) => ({ id, body: await bodyOf(id), userTags: (await attrsOf(id)).tags, originalBody: original.body, originalUserTags: original.tags })));
        record("备份恢复全链保留所有原文正文与用户tags，所有saveData写入均不含导入索引快照");
        evidence.completed = true;
        evidence.completedAt = new Date().toISOString();
        writeEvidence();
        return { evidencePath: path.join(evidenceDir, "backup-evidence.json"), scenarios: evidence.scenarios.length };
    } catch (error) {
        evidence.failure = { message: error.message, stack: error.stack };
        writeEvidence();
        throw error;
    } finally {
        globalThis.__gleanS1FetchSyncPost = transport;
    }
}

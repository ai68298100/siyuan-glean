import test from "node:test";
import assert from "node:assert/strict";
import { isImportDocumentPath, normalizeImportFolder, parseImportProgress, recoverImportProgress, summarizeImportProgress, type ImportProgress } from "../src/domain/import-progress.ts";

function journal(): ImportProgress {
    return {
        version: 1, taskId: "20261004120000-aaaaaaa", fingerprint: "a".repeat(64), format: "pocket-csv",
        notebookId: "20261004110000-nnnnnnn", folder: "/导入", state: "paused",
        createdAt: "2026-10-04T04:00:00.000Z", updatedAt: "2026-10-04T04:00:00.000Z",
        rows: [{ key: "b".repeat(64), hpath: "/导入/100%正确", state: "pending", docId: "", reason: "" }],
    };
}

test("目录规范化拒绝真实路径逃逸，百分号是JSON路径中的普通字符", () => {
    assert.equal(normalizeImportFolder("  \\导入\\100%正确//  "), "/导入/100%正确");
    assert.equal(normalizeImportFolder("/"), "/");
    assert.equal(normalizeImportFolder("/导入/%2e%2e/%2f/%"), "/导入/%2e%2e/%2f/%");
    for (const folder of ["../导入", "/导入/../其他", "/导入/./文章", "C:\\导入", "/导入/\u0000", "/导入/\u2028", "/导入/ 空白 ", "/导入/..."] .slice(0, -1)) {
        assert.throws(() => normalizeImportFolder(folder), { reason: "target" });
    }
    assert.equal(isImportDocumentPath("/导入/100%正确", "/导入"), true);
    assert.equal(isImportDocumentPath("/100%正确", "/"), true);
    for (const path of ["/导入/../文档", "/导入/", "/其他/文档", "/导入/子目录/文档", "/导入//文档", "/导入/ 文档 "]) {
        assert.equal(isImportDocumentPath(path, "/导入"), false);
    }
    assert.deepEqual(parseImportProgress(journal()), journal());
});

test("日志严格校验版本、结构、指纹、精确ID与规范日期", () => {
    const invalid = [
        { version: 2 }, { fingerprint: "A".repeat(64) }, { fingerprint: "a".repeat(63) }, { notebookId: "box" },
        { taskId: "doc-1" }, { folder: "导入" }, { format: "auto" }, { state: "finished" },
        { createdAt: "2026-02-30T04:00:00.000Z" }, { createdAt: "2026-10-04T04:00:00Z" },
        { updatedAt: "2026-10-03T04:00:00.000Z" }, { rows: [] }, { body: "禁止落盘" },
    ];
    for (const patch of invalid) assert.throws(() => parseImportProgress({ ...journal(), ...patch }));
    for (const value of ["", null, [], "{}", { code: -1 }]) assert.throws(() => parseImportProgress(value), { reason: "invalid" });
});

test("日志行严格检查阶段、ID、原因以及重复身份", () => {
    const original = journal();
    for (const patch of [
        { state: "created" }, { state: "applied", docId: "doc-1" }, { state: "unknown", reason: "" },
        { state: "pending", docId: "20261004120000-bbbbbbb" }, { state: "failed", docId: "20261004120000-bbbbbbb", reason: "" },
        { state: "pending", reason: "read" }, { hpath: "/其他/标题" }, { key: "invalid" }, { url: "https://example.org" },
    ]) assert.throws(() => parseImportProgress({ ...original, rows: [{ ...original.rows[0], ...patch }] }), { reason: "invalid" });
    assert.throws(() => parseImportProgress({ ...original, rows: [original.rows[0], original.rows[0]] }), { reason: "invalid" });
    assert.throws(() => parseImportProgress({ ...original, rows: [
        { ...original.rows[0], state: "created", docId: "20261004120000-bbbbbbb" },
        { ...original.rows[0], key: "c".repeat(64), state: "created", docId: "20261004120000-bbbbbbb" },
    ] }), { reason: "invalid" });
});

test("重载时创建意图变unknown，确切ID和已完成结果保留，不改输入", () => {
    const original = journal();
    original.state = "running";
    original.rows = [
        { ...original.rows[0], state: "creating" },
        { ...original.rows[0], key: "c".repeat(64), state: "created", docId: "20261004120000-ccccccc" },
        { ...original.rows[0], key: "d".repeat(64), state: "applied", docId: "20261004120000-ddddddd" },
        { ...original.rows[0], key: "e".repeat(64), state: "duplicate" },
        { ...original.rows[0], key: "f".repeat(64), state: "failed", docId: "20261004120000-fffffff", reason: "capture" },
    ];
    const recovered = recoverImportProgress(original);
    assert.equal(recovered.state, "paused");
    assert.equal(recovered.rows[0].state, "unknown");
    assert.equal(recovered.rows[0].reason, "unknown");
    assert.equal(recovered.rows[1].docId, original.rows[1].docId);
    assert.equal(original.rows[0].state, "creating");
    assert.equal(original.state, "running");
    assert.deepEqual(summarizeImportProgress(recovered), { applied: 1, duplicate: 1, failed: 1, unknown: 1, pending: 1 });
    const completed = { ...journal(), state: "running" as const, rows: [{ ...journal().rows[0], state: "duplicate" as const }] };
    assert.equal(recoverImportProgress(completed).state, "finished");
});

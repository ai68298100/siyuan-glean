import test from "node:test";
import assert from "node:assert/strict";
import {
    advanceInboxRecovery, createInboxRecovery, normalizeInboxFolder, parseInboxRecovery,
} from "../src/domain/inbox-recovery.ts";

const now = new Date("2026-10-07T15:00:00.000Z");
const base = createInboxRecovery("cloud-1", "20261007120000-boxboxx", "收集箱", false, now);

test("收集箱检查点严格保留阶段、目标和确切文档 ID", () => {
    assert.deepEqual(parseInboxRecovery(JSON.stringify(base)), base);
    const pending = advanceInboxRecovery(base, "capture-pending", "20261007150000-aaaaaaa", new Date(now.getTime() + 1));
    assert.equal(pending.docId, "20261007150000-aaaaaaa");
    const remove = advanceInboxRecovery(pending, "remove-pending", pending.docId, new Date(now.getTime() + 2));
    assert.equal(remove.phase, "remove-pending");
    assert.throws(() => advanceInboxRecovery(remove, "capture-pending", remove.docId));
    assert.throws(() => parseInboxRecovery({ ...base, docId: "20261007150000-aaaaaaa" }));
    assert.throws(() => parseInboxRecovery({ ...base, unknown: true }));
    assert.throws(() => parseInboxRecovery({ ...base, folder: "../收集箱" }));
    assert.throws(() => parseInboxRecovery({ ...base, folder: "收集\\箱" }));
});

test("创建结果未知时只能进入空 ID unknown，禁止猜测恢复", () => {
    const unknown = advanceInboxRecovery(base, "unknown", "", new Date(now.getTime() + 1));
    assert.equal(unknown.docId, "");
    assert.throws(() => advanceInboxRecovery(unknown, "capture-pending", "20261007150000-aaaaaaa"));
});

test("收集箱目录规范化拒绝路径逃逸和危险字符", () => {
    assert.equal(normalizeInboxFolder("收藏/待读"), "收藏/待读");
    for (const folder of ["", "/", "../收集箱", "收藏/../其他", "收藏/./文章", "收藏/ 空白 ", "收藏\\待读", "收藏\u0000", "收藏:危险", "收藏<>危险"]) {
        assert.throws(() => normalizeInboxFolder(folder));
    }
    assert.throws(() => createInboxRecovery("cloud-1", "box", "../收集箱", false, now));
});

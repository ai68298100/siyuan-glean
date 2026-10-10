import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { missingSnapshotEntries, snapshotCoverage } from "../src/domain/snapshot.ts";

test("快照覆盖率只统计有路径的已收录文章，空库为完整覆盖", () => {
    assert.deepEqual(snapshotCoverage([]), { total: 0, captured: 0, missing: 0, percent: 100 });
    assert.deepEqual(snapshotCoverage([
        { id: "a", snapshot: "/box/assets/a.html" },
        { id: "b", snapshot: "" },
        { id: "c", snapshot: "   " },
        { id: "d", snapshot: null },
    ]), { total: 4, captured: 1, missing: 3, percent: 25 });
});

test("补拍候选保持输入顺序并只包含缺快照项", () => {
    const entries = [{ id: "a", snapshot: "x" }, { id: "b" }, { id: "c", snapshot: "" }];
    assert.deepEqual(missingSnapshotEntries(entries).map((entry) => entry.id), ["b", "c"]);
});

test("批量服务和 UI 明确逐篇失败可重试且不覆盖已有快照", () => {
    const root = resolve(import.meta.dirname, "..");
    const service = readFileSync(resolve(root, "src/services/snapshot-service.ts"), "utf8");
    const ui = readFileSync(resolve(root, "src/ui/SnapshotGovernance.svelte"), "utf8");
    assert.match(service, /entries\.filter\(\(entry\) => typeof entry\.snapshot !== "string"/);
    assert.match(service, /for \(const entry of pending\)/);
    assert.match(service, /failed\.push/);
    assert.match(ui, /batchSnapshotClips/);
    assert.match(ui, /retryFailed/);
    assert.match(ui, /snapshot\.batchRetry/);
    assert.match(ui, /snapshot\.batchTake/);
});

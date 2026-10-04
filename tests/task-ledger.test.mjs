import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { auditTaskLedger, parseCurrentBoard, renderLedger } from "../scripts/task-ledger.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("current execution board has unique IDs and all four task states", () => {
    const todo = fs.readFileSync(path.join(root, "TODO.md"), "utf8");
    const handoff = fs.readFileSync(path.join(root, "docs", "HANDOFF.md"), "utf8");
    const audit = auditTaskLedger(todo, handoff);
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.tasks.map((task) => task.id), ["T-3260", "T-3261", "T-3262", "T-3263", "T-3264", "T-3265", "T-3266"]);
    assert.deepEqual(audit.currentDuplicates, []);
    assert.deepEqual(audit.missingFields, []);
    assert.equal(audit.staleNextTaskMentions.length, 0);
    assert.match(renderLedger(audit), /T-3265/);
});

test("task ledger rejects duplicate current tasks and missing state fields", () => {
    const board = [
        "## 当前执行板",
        "- [◐] **T-1** 示例。代码状态：完成；隔离验证：完成；真实验收：待 B；延后原因：外部条件。",
        "- [◐] **T-1** 重复。代码状态：完成；隔离验证：完成；真实验收：待 B；延后原因：外部条件。",
        "### 先闭环",
    ].join("\n");
    const tasks = parseCurrentBoard(board);
    assert.equal(tasks.length, 2);
    const audit = auditTaskLedger(board, "# 当前有效交接\n");
    assert.deepEqual(audit.currentDuplicates, ["T-1"]);
    assert.equal(audit.ok, false);
    const missing = auditTaskLedger(
        "## 当前执行板\n- [◐] **T-2** 缺状态。代码状态：完成；隔离验证：完成；真实验收：待 B。\n### 先闭环\n",
        "# 当前有效交接\n",
    );
    assert.deepEqual(missing.missingFields, ["T-2"]);
    assert.equal(missing.ok, false);
});

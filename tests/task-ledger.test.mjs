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
    assert.deepEqual(audit.tasks.map((task) => task.id), [
        "T-3307", "T-3306", "T-3305", "T-3303", "T-3302", "T-3301", "T-3292", "T-3293", "T-3294", "T-3295", "T-3296", "T-3297", "T-3298", "T-3299", "T-3300", "T-3274", "T-3275", "T-3276", "T-3277", "T-3278", "T-3279", "T-3280", "T-3281", "T-3282",
        "T-3283", "T-3284", "T-3285", "T-3286", "T-3287", "T-3288", "T-3289", "T-3290", "T-3291",
        "T-3260", "T-3261", "T-3262", "T-3263", "T-3264", "T-3265", "T-3266", "T-3267", "T-3268",
        "T-3269", "T-3270", "T-3271", "T-3272", "T-3273",
    ]);
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

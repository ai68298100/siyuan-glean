import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERFORMANCE_BUDGETS, PERFORMANCE_OPERATIONS, PERFORMANCE_SIZES, attributeBatchBudget, queryPageBudget } from "../scripts/perf/perf-matrix.mjs";

const root = resolve(import.meta.dirname, "..");

test("性能基线固定 1k/5k/10k 三档规模", () => {
    assert.deepEqual(PERFORMANCE_SIZES, [1000, 5000, 10000]);
});

test("性能基线覆盖扫描、索引、筛选、导入和今日拾遗", () => {
    assert.deepEqual(PERFORMANCE_OPERATIONS.map((operation) => operation.id), [
        "scan-scopes",
        "rebuild-index",
        "filter-and-facets",
        "import-parse",
        "resurface",
    ]);
    for (const operation of PERFORMANCE_OPERATIONS) assert.ok(PERFORMANCE_BUDGETS[operation.id].maxMedianMs > 0);
});

test("性能基线把分页和属性批量预算锁为当前实现的上界", () => {
    assert.equal(queryPageBudget(1000), 9);
    assert.equal(queryPageBudget(5000), 33);
    assert.equal(queryPageBudget(10000), 63);
    assert.equal(attributeBatchBudget(1000), 5);
    assert.equal(attributeBatchBudget(5000), 25);
    assert.equal(attributeBatchBudget(10000), 50);
});

test("性能协议明确 UI 宿主渲染仍需真实环境测量", () => {
    const guide = readFileSync(resolve(root, "docs/PERFORMANCE-BASELINE.md"), "utf8");
    assert.match(guide, /真实思源宿主/);
    assert.match(guide, /pnpm perf:check/);
    assert.match(guide, /saveData/);
    assert.match(guide, /4路并发/);
    assert.match(guide, /派生索引/);
});


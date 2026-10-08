export const PERFORMANCE_SIZES = Object.freeze([1000, 5000, 10000]);

export const PERFORMANCE_OPERATIONS = Object.freeze([
    { id: "scan-scopes", label: "扫描三类范围" },
    { id: "rebuild-index", label: "重建派生索引" },
    { id: "filter-and-facets", label: "筛选与分面" },
    { id: "import-parse", label: "导入解析" },
    { id: "resurface", label: "今日拾遗" },
]);

export const PERFORMANCE_BUDGETS = Object.freeze({
    "scan-scopes": { maxMedianMs: 3000 },
    "rebuild-index": { maxMedianMs: 10000 },
    "filter-and-facets": { maxMedianMs: 1500 },
    "import-parse": { maxMedianMs: 3000 },
    resurface: { maxMedianMs: 1500 },
});

export function queryPageBudget(size) {
    return 3 * (Math.ceil(size / 500) + 1);
}

export function attributeBatchBudget(size) {
    return Math.ceil(size / 200);
}


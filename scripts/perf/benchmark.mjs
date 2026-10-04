import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import {
    PERFORMANCE_BUDGETS,
    PERFORMANCE_OPERATIONS,
    PERFORMANCE_SIZES,
    attributeBatchBudget,
    queryPageBudget,
} from "./perf-matrix.mjs";

const apiStub = `
export const getBlockAttrs = (...args) => globalThis.__gleanPerfApi.getBlockAttrs(...args);
export const batchGetBlockAttrs = (...args) => globalThis.__gleanPerfApi.batchGetBlockAttrs(...args);
export const setBlockAttrs = (...args) => globalThis.__gleanPerfApi.setBlockAttrs(...args);
export const querySql = (...args) => globalThis.__gleanPerfApi.querySql(...args);
export const exportMdContent = (...args) => globalThis.__gleanPerfApi.exportMdContent(...args);
`;
const apiUrl = `data:text/javascript,${encodeURIComponent(apiStub)}`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "../api/client" && context.parentURL?.endsWith("/services/clip-store.ts")) {
            return { url: apiUrl, shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});

const [{ scanDocScopes, reconcileIndex }, { filterAndSortLibrary, libraryFacets }, { parsePocketCsv }, { pickDaily }] = await Promise.all([
    import("../../src/services/clip-store.ts"),
    import("../../src/domain/library-view.ts"),
    import("../../src/domain/importers.ts"),
    import("../../src/domain/resurface.ts"),
]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(root, "output/performance");
const outputPath = path.join(outputDir, "last-run.json");
const now = new Date(2026, 9, 3, 12, 0, 0);
const rounds = 3;
const strict = process.argv.includes("--check");

function makeDataset(size) {
    const rows = [];
    const attrs = new Map();
    for (let index = 0; index < size; index += 1) {
        const id = `doc-${String(index).padStart(6, "0")}`;
        const updated = `2026${String((index % 9) + 1).padStart(2, "0")}01000000`;
        rows.push({
            id,
            content: `性能基线文章 ${index}`,
            hpath: `/读库/性能基线文章-${index}`,
            box: `box-${index % 4}`,
            updated,
            tag: index % 2 === 0 ? "剪藏" : "",
        });
        attrs.set(id, {
            "custom-clip-status": index % 5 === 0 ? "reading" : "inbox",
            "custom-clip-url": `https://example-${index % 31}.test/article/${index}`,
            "custom-clip-site": `example-${index % 31}.test`,
            "custom-clip-time": `2025${String((index % 9) + 1).padStart(2, "0")}01000000`,
            "custom-clip-src": index % 2 === 0 ? "web-clipper" : "import-pocket",
            "custom-clip-content-type": "fulltext",
            "custom-clip-ai-tags": JSON.stringify([`topic-${index % 40}`]),
            "custom-clip-priority": String((index % 5) + 1),
            "custom-clip-words": String(400 + (index % 1600)),
            "custom-clip-minutes": String(1 + (index % 45)),
        });
    }
    rows.sort((left, right) => right.updated.localeCompare(left.updated) || right.id.localeCompare(left.id));
    return { rows, attrs };
}

function makeKernelHarness(size) {
    const { rows, attrs } = makeDataset(size);
    const counters = { queries: 0, attributeBatches: 0, attributeIds: 0, saves: 0 };
    const saved = new Map();
    const page = (sql) => {
        const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 500);
        const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? 0);
        if (sql.includes("box IN")) {
            const boxes = [...(sql.match(/box IN \(([^)]+)\)/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map((match) => match[1]);
            return rows.filter((row) => boxes.includes(row.box)).slice(offset, offset + limit);
        }
        if (sql.includes("tag LIKE")) return rows.filter((row) => Boolean(row.tag)).slice(offset, offset + limit);
        if (sql.includes("WHERE id =")) {
            const id = sql.match(/WHERE id = '([^']+)'/)?.[1] ?? "";
            return rows.filter((row) => row.id === id);
        }
        return rows.slice(offset, offset + limit);
    };
    globalThis.__gleanPerfApi = {
        async getBlockAttrs(id) { return { ...(attrs.get(id) ?? {}) }; },
        async batchGetBlockAttrs(ids) {
            counters.attributeBatches += 1;
            counters.attributeIds += ids.length;
            return ids.map((id) => ({ id, attrs: { ...(attrs.get(id) ?? {}) } }));
        },
        async setBlockAttrs() {},
        async exportMdContent() { return { content: "" }; },
        async querySql(sql) {
            counters.queries += 1;
            return page(sql);
        },
    };
    const plugin = {
        async loadData(name) { return structuredClone(saved.get(name) ?? null); },
        async saveData(name, value) {
            counters.saves += 1;
            saved.set(name, structuredClone(value));
        },
    };
    return {
        plugin,
        settings: { anchorNotebooks: ["box-0", "box-1", "box-2", "box-3"] },
        counters,
        reset() {
            counters.queries = 0;
            counters.attributeBatches = 0;
            counters.attributeIds = 0;
            counters.saves = 0;
        },
        snapshot() { return { ...counters }; },
    };
}

function makeLibraryItems(size) {
    const statuses = ["inbox", "later", "reading", "done", "archived"];
    return Array.from({ length: size }, (_, index) => ({
        kind: "clip",
        id: `library-${String(index).padStart(6, "0")}`,
        title: `大库筛选文章 ${index}`,
        hpath: `/读库/大库筛选文章-${index}`,
        updated: `2026${String((index % 9) + 1).padStart(2, "0")}01000000`,
        status: statuses[index % statuses.length],
        site: `example-${index % 31}.test`,
        tags: [`topic-${index % 40}`],
        aiTags: [`ai-${index % 25}`],
        src: index % 2 === 0 ? "web-clipper" : "import-pocket",
        contentType: "fulltext",
        timeSource: "source",
        time: `2025${String((index % 9) + 1).padStart(2, "0")}01000000`,
        words: 400 + (index % 1600),
        priority: (index % 5) + 1,
        rating: index % 6,
    }));
}

function makeImportCsv(size) {
    const lines = ["title,url,time_added,time_read,status,tags"];
    for (let index = 0; index < size; index += 1) {
        lines.push(`导入文章 ${index},https://import-${index % 97}.test/article/${index},1700000000,,unread,topic-${index % 20}`);
    }
    return lines.join("\n");
}

function makeSurfaceItems(size) {
    const statuses = ["inbox", "later", "reading", "done", "archived"];
    return Array.from({ length: size }, (_, index) => ({
        id: `surface-${String(index).padStart(6, "0")}`,
        title: `今日拾遗文章 ${index}`,
        status: statuses[index % statuses.length],
        priority: (index % 5) + 1,
        time: `2025${String((index % 9) + 1).padStart(2, "0")}01000000`,
        aiTags: [`topic-${index % 40}`],
        lastSurfaced: index % 17 === 0 ? "20261002" : "",
        summary: "",
    }));
}

async function measure(fn, reset, snapshot) {
    await fn();
    const samples = [];
    let metrics = {};
    let value;
    for (let round = 0; round < rounds; round += 1) {
        reset();
        const started = performance.now();
        value = await fn();
        samples.push(performance.now() - started);
        metrics = snapshot();
    }
    samples.sort((left, right) => left - right);
    return {
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
        p95Ms: Number(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)].toFixed(2)),
        metrics,
        value,
    };
}

async function runSize(size) {
    const kernel = makeKernelHarness(size);
    const scan = await measure(
        () => scanDocScopes(kernel.settings, 500),
        kernel.reset,
        kernel.snapshot,
    );
    const rebuild = await measure(
        () => reconcileIndex(kernel.plugin, kernel.settings),
        kernel.reset,
        kernel.snapshot,
    );
    const library = makeLibraryItems(size);
    const filter = await measure(
        () => {
            const filtered = filterAndSortLibrary(library, { status: "inbox", site: "example-7.test", keyword: "文章" });
            const facets = libraryFacets(library);
            return { filtered: filtered.length, facets: Object.values(facets).reduce((total, values) => total + values.length, 0) };
        },
        () => {},
        () => ({}),
    );
    const csv = makeImportCsv(size);
    const imported = await measure(
        () => parsePocketCsv(csv),
        () => {},
        () => ({}),
    );
    const surfaceItems = makeSurfaceItems(size);
    const resurface = await measure(
        () => pickDaily(surfaceItems, [new Set(["topic-1", "topic-2"])], { count: 10, includeDone: false, now }),
        () => {},
        () => ({}),
    );
    const scanValue = scan.value;
    const rebuildValue = rebuild.value;
    return {
        size,
        operations: {
            "scan-scopes": {
                medianMs: scan.medianMs,
                p95Ms: scan.p95Ms,
                rows: scanValue.all.length,
                queryCount: scan.metrics.queries,
            },
            "rebuild-index": {
                medianMs: rebuild.medianMs,
                p95Ms: rebuild.p95Ms,
                clips: Object.keys(rebuildValue.clips).length,
                attributeBatches: rebuild.metrics.attributeBatches,
                attributeIds: rebuild.metrics.attributeIds,
                saves: rebuild.metrics.saves,
            },
            "filter-and-facets": { medianMs: filter.medianMs, p95Ms: filter.p95Ms, ...filter.value },
            "import-parse": { medianMs: imported.medianMs, p95Ms: imported.p95Ms, items: imported.value.items.length, dropped: imported.value.dropped },
            resurface: { medianMs: resurface.medianMs, p95Ms: resurface.p95Ms, picks: resurface.value.length },
        },
    };
}

function validate(report) {
    const violations = [];
    for (const result of report.results) {
        for (const operation of PERFORMANCE_OPERATIONS) {
            const value = result.operations[operation.id];
            const budget = PERFORMANCE_BUDGETS[operation.id];
            if (value.medianMs > budget.maxMedianMs) violations.push(`${result.size} ${operation.id} 中位数 ${value.medianMs}ms 超过 ${budget.maxMedianMs}ms`);
        }
        const scan = result.operations["scan-scopes"];
        if (scan.rows !== result.size) violations.push(`${result.size} 扫描结果 ${scan.rows} 不等于输入规模`);
        if (scan.queryCount > queryPageBudget(result.size)) violations.push(`${result.size} 扫描查询 ${scan.queryCount} 超过分页预算 ${queryPageBudget(result.size)}`);
        const rebuild = result.operations["rebuild-index"];
        if (rebuild.clips !== result.size) violations.push(`${result.size} 索引条目 ${rebuild.clips} 不等于输入规模`);
        if (rebuild.attributeBatches > attributeBatchBudget(result.size)) violations.push(`${result.size} 属性批次 ${rebuild.attributeBatches} 超过 ${attributeBatchBudget(result.size)}`);
        if (result.operations["import-parse"].items !== result.size) violations.push(`${result.size} 导入解析条目数量不完整`);
        if (result.operations.resurface.picks > 10) violations.push(`${result.size} 今日拾遗超过 10 篇`);
    }
    return violations;
}

const results = [];
for (const size of PERFORMANCE_SIZES) results.push(await runSize(size));
const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: os.cpus().length },
    rounds,
    sizes: PERFORMANCE_SIZES,
    operations: PERFORMANCE_OPERATIONS,
    budgets: PERFORMANCE_BUDGETS,
    results,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const result of results) {
    const summary = PERFORMANCE_OPERATIONS.map((operation) => `${operation.id}=${result.operations[operation.id].medianMs}ms`).join(" ");
    console.log(`${result.size}: ${summary}`);
}
console.log(`性能报告已写入 ${path.relative(root, outputPath)}`);
if (strict) {
    const violations = validate(report);
    if (violations.length > 0) {
        console.error(violations.map((violation) => `- ${violation}`).join("\n"));
        process.exitCode = 1;
    } else {
        console.log("性能基线通过：分页、属性批次、结果规模和中位耗时均在预算内。");
    }
}


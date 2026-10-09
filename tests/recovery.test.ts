import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRefreshQueue } from "../src/libs/refresh-queue.ts";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("恢复矩阵覆盖六类故障域和真实代码入口", () => {
    const matrix = read("docs/RECOVERY-MATRIX.md");
    for (const domain of ["网络", "内核", "权限", "正文", "AI", "导入"]) assert.match(matrix, new RegExp(`\\| ${domain} \\|`));
    assert.match(matrix, /DockPanel\.svelte/);
    assert.match(matrix, /import-service\.ts/);
    assert.match(matrix, /enrich-service\.ts/);
    assert.match(matrix, /ReaderTab\.svelte/);
});

test("网络和内核失败保留缓存并提供重试", () => {
    const dock = read("src/ui/DockPanel.svelte");
    assert.match(dock, /offline/);
    assert.match(dock, /msg\.offlineRetry/);
    assert.match(dock, /loadError/);
    assert.match(dock, /loadIndex\(facade\.pluginInstance\)/);
    assert.match(dock, /onclick=\{\(\) => void reload\(\)\}/);
});

test("导入失败按 URL 保留并支持只重试失败项", () => {
    const service = read("src/services/import-service.ts");
    const dialog = read("src/ui/ImportDialog.svelte");
    assert.match(service, /failedUrls: string\[\]/);
    assert.match(service, /summary\.failedUrls\.push\(row\.url\)/);
    assert.match(dialog, /retryRows/);
    assert.match(dialog, /startImport\(retryRows\)/);
    assert.match(dialog, /mergeSummaries/);
    assert.match(dialog, /retryFailures: rowsOverride \? summary\?\.failedItems/);
    assert.match(dialog, /import\.retryConfirm/);
    assert.match(dialog, /disabled=\{busy \|\| !resumeConfirmed \|\| progressReadFailed/);
    assert.match(dialog, /import\.notebookFailed/);
    assert.match(dialog, /void loadNotebooks\(\)/);
    assert.match(dialog, /notebookLoading \|\| notebookError/);
});

test("AI 和正文失败不覆盖文章事实", () => {
    const ai = read("src/services/enrich-service.ts");
    const reader = read("src/ui/ReaderTab.svelte");
    assert.match(ai, /appendLog/);
    assert.match(ai, /skipped: "error"/);
    assert.match(reader, /reader\.actionFailed/);
    assert.match(reader, /clip\.bodyCheckFailed/);
});

test("并发刷新合并为串行补跑，所有调用等待最新结果", async () => {
    const firstGate = Promise.withResolvers<void>();
    const secondGate = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const refresh = createRefreshQueue(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 1) await firstGate.promise;
        if (calls === 2) {
            secondStarted.resolve();
            await secondGate.promise;
        }
        active -= 1;
    });
    const first = refresh();
    const second = refresh();
    const third = refresh();
    assert.equal(first, second);
    assert.equal(second, third);
    assert.equal(calls, 1);
    firstGate.resolve();
    await secondStarted.promise;
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    secondGate.resolve();
    await Promise.all([first, second, third]);
    assert.equal(active, 0);
    await refresh();
    assert.equal(calls, 3);
});

test("补跑期间的新刷新请求仍会执行，不被丢弃", async () => {
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const secondStarted = Promise.withResolvers<void>();
    let calls = 0;
    const refresh = createRefreshQueue(async () => {
        const index = calls++;
        if (index === 1) secondStarted.resolve();
        await gates[index]?.promise;
    });
    const completion = refresh();
    void refresh();
    gates[0].resolve();
    await secondStarted.promise;
    void refresh();
    gates[1].resolve();
    await completion;
    assert.equal(calls, 3);
});

test("刷新失败传播给等待者，后续重试能重新执行", async () => {
    const gate = Promise.withResolvers<void>();
    const error = new Error("kernel unavailable");
    let fail = true;
    let calls = 0;
    const refresh = createRefreshQueue(async () => {
        calls += 1;
        await gate.promise;
        if (fail) throw error;
    });
    const first = refresh();
    const second = refresh();
    const rejected = [assert.rejects(first, (actual) => actual === error), assert.rejects(second, (actual) => actual === error)];
    gate.resolve();
    await Promise.all(rejected);
    fail = false;
    await refresh();
    assert.equal(calls, 2);
});

test("后台对账保留列表和收集箱 DOM，部分成功只移除成功选择", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const batchBar = read("src/ui/LibraryBatchBar.svelte");
    assert.match(dock, /createRefreshQueue/);
    assert.match(dock, /\{#if loading && !index\.updatedAt\}/);
    assert.doesNotMatch(dock, /\{#if view === "library" && !loading\}/);
    assert.match(dock, /selection = new Set\(\[\.\.\.selection\]\.filter\(\(id\) => !succeeded\.has\(id\)\)\)/);
    assert.match(dock, /if \(batchBusy \|\| selection\.size === 0\) return/);
    assert.match(batchBar, /disabled=\{busy\}/);
});

test("云端删除失败保留条目，迁入与删除不能并发", () => {
    const inbox = read("src/ui/InboxSection.svelte");
    // T-3316：云端删除成功才弹"已迁入"并移除条目；失败路径只弹失败提示并保留 pendingRemoval
    assert.match(inbox, /if \(result\.cloudRemoved\) \{\s*showMessage\(t\(i18n, "inbox\.migrated"\), 3000\);\s*items = items\.filter/);
    assert.match(inbox, /pendingRemoval\[item\.oId\] = result\.docId;\s*showMessage\(t\(i18n, "inbox\.cloudRemoveFailed"\), 3500\)/);
    // dismiss 先更新本地列表，检查点清理失败单独提示（不再让已删条目留在界面上）
    assert.match(inbox, /async function dismiss\(item: Shorthand\) \{\s*if \(busyId\) return/);
    assert.match(inbox, /items = items\.filter\(\(entry\) => entry\.oId !== item\.oId\);\s*delete pendingRemoval\[item\.oId\];/);
    assert.match(inbox, /disabled=\{Boolean\(busyId\)\}/);
    assert.match(inbox, /pendingRemoval\[item\.oId\] \? void dismiss\(item\) : void migrate\(item\)/);
    assert.match(inbox, /inbox\.retryCloudRemoval/);
});

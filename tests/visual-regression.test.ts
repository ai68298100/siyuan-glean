import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVisualCases, VISUAL_STATES, VISUAL_VIEWPORTS, visualCaseId } from "../scripts/visual/visual-matrix.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/visual-regression/baseline.json"), "utf8"));

test("视觉矩阵保留三种规定视口", () => {
    assert.deepEqual(manifest.viewports.map((viewport: { id: string; width: number; height: number }) => `${viewport.id}:${viewport.width}x${viewport.height}`), [
        "desktop:1280x800",
        "narrow:768x1024",
        "mobile:390x844",
    ]);
});

test("视觉矩阵覆盖八类状态", () => {
    assert.deepEqual(manifest.states.map((state: { id: string }) => state.id), VISUAL_STATES.map((state) => state.id));
    assert.deepEqual(manifest.states.map((state: { label: string }) => state.label), VISUAL_STATES.map((state) => state.label));
});

test("视觉矩阵恰好覆盖 3×8 个唯一案例", () => {
    const expected = buildVisualCases();
    assert.equal(expected.length, 24);
    assert.equal(manifest.cases.length, expected.length);
    assert.deepEqual(manifest.cases.map((item: { id: string }) => item.id), expected.map((item) => item.id));
    assert.equal(new Set(manifest.cases.map((item: { id: string }) => item.id)).size, 24);
    for (const viewport of VISUAL_VIEWPORTS) {
        for (const state of VISUAL_STATES) {
            assert.equal(manifest.cases.some((item: { id: string }) => item.id === visualCaseId(viewport.id, state.id)), true);
        }
    }
});

test("视觉案例未取得真实宿主截图时明确保持待验收", () => {
    assert.equal(manifest.cases.every((item: { status: string }) => item.status === "pending-host"), true);
    assert.equal(manifest.source, "design/prototype-v2.html");
});

test("视觉回归协议声明真实宿主边界和严格检查命令", () => {
    const guide = readFileSync(resolve(root, "docs/visual-regression/README.md"), "utf8");
    assert.match(guide, /pnpm visual:check/);
    assert.match(guide, /--strict/);
    assert.match(guide, /pending-host/);
    assert.match(guide, /B-0009/);
    assert.match(guide, /不能冒充实际 Svelte 组件截图/);
});

test("canonical 原型覆盖同宿主专注阅读及批注回退边界", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    assert.match(prototype, /data-page="reader"/);
    assert.match(prototype, /data-action="reader-focus"/);
    assert.match(prototype, /data-action="reader-exit"/);
    assert.match(prototype, /data-action="reader-native"/);
    assert.match(prototype, /data-reader-selection/);
    assert.match(prototype, /不启用浏览器全屏/);
    assert.match(prototype, /需在真实思源中验证/);
    assert.match(prototype, /reader-screen\[data-focus="true"\]/);
    assert.match(prototype, /reader-focus[\s\S]*?queueMicrotask\(\(\)=>document\.querySelector\('\[data-action="reader-exit"\]'\)\.focus\(\)\)/);
    assert.match(prototype, /reader-exit[\s\S]*?queueMicrotask\(\(\)=>document\.querySelector\('\[data-action="reader-focus"\]'\)\.focus\(\)\)/);
});

test("canonical 原型入口与生产 Dock/独立设置/文章阅读入口一致", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    const dockNavigation = prototype.match(/<nav class="nav" aria-label="原型页面">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    const homeNavigation = prototype.match(/<nav class="tabs" aria-label="主要视图">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    const mobileNavigation = prototype.match(/<nav class="mobile-nav" aria-label="移动端导航">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    assert.deepEqual([...dockNavigation.matchAll(/data-view="([a-z]+)"/g)].map((match) => match[1]), ["home", "library", "stats", "highlights"]);
    assert.deepEqual([...homeNavigation.matchAll(/data-view="([a-z]+)"/g)].map((match) => match[1]), ["home", "library", "stats", "highlights"]);
    assert.deepEqual([...mobileNavigation.matchAll(/data-view="([a-z]+)"/g)].map((match) => match[1]), ["home", "library", "highlights"]);
    assert.match(prototype, /<dialog class="screen settings-dialog" id="settings"/);
    assert.match(prototype, /data-action="settings-close"/);
    assert.match(prototype, /function openSettings\(\)[\s\S]*dialog\.showModal\(\)/);
    assert.match(prototype, /function requestSettingsClose\(\)[\s\S]*settingsDirty[\s\S]*openSettingsConfirm\('\[data-discard-dialog\]'/);
    assert.match(prototype, /由文章的“开始 \/ 继续阅读”进入/);
    assert.match(prototype, /data-action="library-open"[^>]*>打开<\/button>/);
    assert.match(prototype, /移动端使用思源原生页签/);
    assert.match(prototype, /id="reader-tab-enabled" data-setting/);
    assert.match(prototype, /function openArticle\(action\)[\s\S]*root\.dataset\.canvas==='mobile'[\s\S]*reader-tab-enabled[\s\S]*navigate\('reader'\)/);
    assert.match(prototype, /view==='reader'&&root\.dataset\.canvas==='mobile'\)\{if\(location\.hash==='#reader'\)history\.replaceState\(\{view:'home'\}/);
    assert.match(prototype, /case 'library-preview':document\.querySelector\('\[data-preview-panel\]'\)\.classList\.remove\('hidden'\)/);
    assert.match(prototype, /case 'open-source':say\('已选择打开原文/);
    assert.match(prototype, /本地演示不会跳转/);
    assert.doesNotMatch(dockNavigation, /data-view="reader"|data-view="settings"/);
    assert.doesNotMatch(mobileNavigation, /data-view="reader"|data-view="settings"/);
});

test("canonical 原型覆盖用户标签显示别名与原值筛选", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    assert.match(prototype, /data-alias-source|id="alias-source-tag"/);
    assert.match(prototype, /data-action="alias-save"/);
    assert.match(prototype, /data-action="alias-edit"/);
    assert.match(prototype, /data-action="alias-remove"/);
    assert.match(prototype, /data-action="alias-delete-confirm"/);
    assert.match(prototype, /data-action="alias-delete-cancel"/);
    assert.match(prototype, /id="library-tag-filter"/);
    assert.match(prototype, /筛选 chip 与保存视图仍使用原标签值/);
    assert.match(prototype, /不會创建或改写文章标签|不会创建或改写文章标签/);
    assert.match(prototype, /id="highlight-tag-filter"/);
    assert.match(prototype, /标签：阅读/);
    assert.match(prototype, /精读 \(阅读\)/);
    assert.doesNotMatch(prototype, /标签：精读（原标签：阅读）/);
});

test("canonical 今日拾遗原型包含可操作的情境选文与合成证据边界", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    const panel = prototype.match(/<section class="panel glean-context-selection"[\s\S]*?<\/section>/)?.[0] ?? "";
    const budget = panel.match(/<select data-context-budget[\s\S]*?<\/select>/)?.[0] ?? "";
    assert.deepEqual([...budget.matchAll(/<option value="(\d+)"/g)].map((match) => match[1]), ["5", "15", "30"]);
    assert.match(budget, /value="15" selected/);
    for (const control of ["data-context-tag", "data-context-done", "data-context-unknown", "data-context-results", "data-context-empty", "data-context-diagnostics"]) assert.ok(panel.includes(control), `missing ${control}`);
    assert.match(panel, /不连接思源、不写状态，不代表真实宿主验收/);
    assert.match(panel, /仅来源链接需要联网打开原文/);
    assert.ok(prototype.indexOf('data-context-selection aria-labelledby') < prototype.indexOf('<section class="card" aria-labelledby="resurface-card-title"'));
    assert.match(prototype, /@container glean-content \(max-width:560px\)\{[^\n]*min-height:44px/);
    assert.match(prototype, /control\.addEventListener\('change',renderContextSelection\)/);
    assert.match(prototype, /button\.dataset\.action=item\.contentType==='link'\?'open-source':'library-open'/);
    assert.match(prototype, /button\.setAttribute\('aria-describedby',title\.id\)/);
});

test("canonical 情境选文演示遵守预算、用户标签与显式放宽契约", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    const selectorSource = prototype.match(/function selectContextDemo\(items,options\)\{[\s\S]*?\n  \}(?=\n  function renderContextSelection)/)?.[0];
    assert.ok(selectorSource, "missing executable context demo selector");
    const select = new Function(`return (${selectorSource})`)() as (items: unknown[], options: Record<string, unknown>) => { candidates: Array<{ id: string }>; diagnostics: { unknownMinutes: number; overBudget: number } };
    const items = [
        { id: "short", status: "inbox", minutes: 8, priority: 2, waitingDays: 10, tags: ["阅读"] },
        { id: "unknown", status: "later", minutes: 0, priority: 1, waitingDays: 7, tags: ["AI"], contentType: "link" },
        { id: "done", status: "done", minutes: 5, priority: 2, waitingDays: 3, tags: ["方法"] },
        { id: "long", status: "later", minutes: 24, priority: 1, waitingDays: 6, tags: ["阅读"], aiTags: ["AI"] },
    ];
    const defaults = select(items, { budget: 15, tag: "", includeDone: false, includeUnknownMinutes: false });
    assert.deepEqual(defaults.candidates.map((item) => item.id), ["short"]);
    assert.equal(defaults.diagnostics.unknownMinutes, 1);
    assert.equal(defaults.diagnostics.overBudget, 1);
    assert.equal(select(items, { budget: 5 }).candidates.length, 0);
    assert.deepEqual(select(items, { budget: 5, includeDone: true }).candidates.map((item) => item.id), ["done"]);
    assert.deepEqual(select(items, { budget: 30, tag: "AI", includeUnknownMinutes: true }).candidates.map((item) => item.id), ["unknown"]);
    assert.deepEqual(select(items, { budget: 30, tag: "阅读" }).candidates.map((item) => item.id), ["short", "long"]);
});

test("canonical 原型覆盖窄 Dock 更多筛选和移动筛选抽屉", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    for (const selector of ["data-action=\"library-more-filters\"", "data-filter-popover", "data-action=\"mobile-filter-open\"", "data-mobile-filter-sheet", "data-action=\"mobile-filter-apply\"", "data-action=\"mobile-filter-clear\""]) {
        assert.ok(prototype.includes(selector), `missing ${selector}`);
    }
    assert.match(prototype, /aria-controls="mobile-filter-sheet"/);
    assert.match(prototype, /role="dialog" aria-modal="true" aria-labelledby="mobile-filter-title"/);
    assert.match(prototype, /function openMobileFilter\(\)\{mobileFilterDraft=\{\.\.\.appliedFilters\}/);
    assert.match(prototype, /function applyMobileFilter\(\)[\s\S]*Object\.assign\(appliedFilters,mobileFilterDraft\)/);
    assert.match(prototype, /function clearMobileFilter\(\)[\s\S]*for\(const key of filterKeys\)mobileFilterDraft\[key\]=''[\s\S]*排序保持不变/);
    assert.match(prototype, /if\(returnFocus&&mobileFilterReturnFocus\?\.isConnected\)mobileFilterReturnFocus\.focus/);
    assert.match(prototype, /\.library-filter-bar>:not\(\.filter-result-state\)\{display:none\}/);
    assert.match(prototype, /surface\.inert=true;surface\.setAttribute\('aria-hidden','true'\)/);
    assert.match(prototype, /document\.documentElement\.style\.overflow='hidden';document\.body\.style\.overflow='hidden'/);
    assert.match(prototype, /sortKey==='title'\?a\.dataset\.item/);
    assert.match(prototype, /document\.querySelectorAll\('\[data-library-result-count\]'\)\.forEach/);
    assert.match(prototype, /function clearLibraryFilters\(\)[\s\S]*mobileFilterDraft=\{\.\.\.appliedFilters\}[\s\S]*syncLibraryFilterUi\(\)/);
    assert.match(prototype, /case 'library-clear':clearLibraryFilters\(\)/);
    assert.doesNotMatch(prototype, /querySelector\('\[data-action="library-clear"\]'\)\.addEventListener/);
    assert.ok(prototype.includes("document.querySelector('[data-mobile-filter-sheet]').addEventListener('keydown'"));
    assert.ok(prototype.includes("document.querySelector('[data-filter-popover]').addEventListener('keydown'"));
    for (const key of ["author", "site", "tag", "aiTag", "source", "timeSource", "contentType", "sortBy", "direction"]) {
        assert.match(prototype, new RegExp(`data-filter-key="${key}"`), `missing filter field ${key}`);
    }
});

test("清空高亮筛选会重新计算可见摘录并取消无结果态", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    assert.match(prototype, /case 'highlight-clear-filter':[\s\S]*?applyHighlightTagFilter\(\);say\('已清除高亮筛选'\)/);
    assert.match(prototype, /function applyHighlightTagFilter\(\)[\s\S]*row\.classList\.toggle\('hidden',!visible\)/);
});

test("ReaderTab 退出专注后将键盘焦点还给专注入口", () => {
    const reader = readFileSync(resolve(root, "src/ui/ReaderTab.svelte"), "utf8");
    assert.match(reader, /async function exitImmersive\(\): Promise<void>\s*\{\s*immersive = false;\s*await tick\(\);\s*readerRoot\?\.querySelector<HTMLButtonElement>\("\.glean-reader__toolbar-immersive"\)\?\.focus\(\);/);
});

test("历史增量稿中的交互动作均已迁入 canonical 原型", () => {
    const prototype = readFileSync(resolve(root, "design/prototype-v2.html"), "utf8");
    const additions = readFileSync(resolve(root, "design/prototype-v2-additions.html"), "utf8");
    const historicalActions = [...additions.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]);
    const uniqueActions = [...new Set(historicalActions)];
    const replacements: Record<string, string[]> = { "reading-expand": ["bookmark-save", "bookmark-restore"] };
    for (const action of uniqueActions) {
        for (const current of replacements[action] ?? [action]) {
            assert.match(prototype, new RegExp(`data-action="${current}"`), `missing migrated action: ${action} -> ${current}`);
        }
    }
    assert.match(additions, /历史参考/);
    assert.match(additions, /canonical 主原型/);
});


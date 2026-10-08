import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("wide workbench header exposes prototype capture plus popup, organize and settings actions", () => {
    const source = read("src/ui/DockPanel.svelte");
    const actions = source.slice(source.indexOf('<div class="glean-head-actions">'), source.indexOf("</div>", source.indexOf('<div class="glean-head-actions">')));
    assert.match(actions, /isTabCanvas && \(view === "resurface" \|\| view === "library"\)/);
    assert.match(actions, /quickCapture\(\)/);
    assert.match(source, /async function quickCapture\(\): Promise<void>/);
    assert.match(source, /facade\.addCurrentDocToLibrary\(\)/);
    assert.match(actions, /aria-busy=\{quickCaptureBusy\}/);
    assert.match(actions, /disabled=\{quickCaptureBusy\}/);
    assert.match(actions, /action\.quickCapture/);
    assert.match(actions, /action\.addToInbox/);
    assert.match(actions, /panel\.popupShort/);
    assert.match(actions, /panel\.migrateShort/);
    assert.match(actions, /panel\.settings/);
    assert.equal((actions.match(/glean-head-action__label/g) ?? []).length, 4);
    assert.equal((actions.match(/aria-label=/g) ?? []).length, 4);
});

test("labels are enabled only by the wide canvas container and keep theme colors", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-tab-root\s*\{[^}]*container-name:\s*glean-workbench;[^}]*container-type:\s*inline-size;/s);
    assert.match(styles, /@container\s+glean-workbench\s*\(min-width:\s*760px\)/);
    assert.match(styles, /\.glean-head-action__label\s*\{\s*display:\s*none;/);
    assert.match(styles, /\.glean-head-action__label\s*\{\s*display:\s*inline;/);
    assert.match(styles, /border:\s*1px solid var\(--b3-border-color\)/);
    assert.match(styles, /background:\s*var\(--b3-theme-surface\)/);
    assert.match(styles, /\.glean-head-action--primary\s*\{[\s\S]*var\(--glean-grad\)/);
});

test("popup action uses the same wide-canvas wrapper as a workbench tab", () => {
    const source = read("src/index.ts");
    assert.match(source, /containerClass:\s*"glean-tab-root"/);
    assert.match(source, /container\.className\s*=\s*"glean-tab-root fn__flex-1"/);
});

test("prototype workbench frame shows the three readable header actions", () => {
    const prototype = read("design/prototype-v2.html");
    const home = prototype.slice(prototype.indexOf('<article class="screen" id="home">'), prototype.indexOf("</article>", prototype.indexOf('<article class="screen" id="home">')));
    assert.match(home, /⧉ 浮窗/);
    assert.match(home, /🧹 整理/);
    assert.match(home, /⚙ 设置/);
});

test("prototype workbench frame keeps quick capture as the primary action", () => {
    const prototype = read("design/prototype-v2.html");
    const home = prototype.slice(prototype.indexOf('<article class="screen" id="home">'), prototype.indexOf("</article>", prototype.indexOf('<article class="screen" id="home">')));
    const library = prototype.slice(prototype.indexOf('<article class="screen" id="library">'), prototype.indexOf("</article>", prototype.indexOf('<article class="screen" id="library">')));
    assert.match(home, /＋ 快速收录/);
    assert.match(library, /＋ 收录/);
});

test("wide canvas resurface cards use an adaptive grid while dock stays single column", () => {
    const styles = read("src/index.scss");
    const wide = styles.slice(styles.indexOf("@container glean-workbench (min-width: 760px)"));
    assert.match(wide, /\.glean-surf\s*\{[\s\S]*display:\s*grid/);
    assert.match(wide, /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 310px\), 1fr\)\)/);
    assert.match(wide, /\.glean-surf__acts\s*\{[\s\S]*flex-wrap:\s*wrap/);
    assert.match(wide, /\.glean-surf-foot\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
    assert.match(wide, /\.glean-surf-swipe\s*\{[\s\S]*display:\s*flex/);
    assert.match(wide, /\.glean-surf-card\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
    assert.match(wide, /\.glean-surf-card \.glean-surf__acts\s*\{[\s\S]*margin-top:\s*auto/);
    const narrow = styles.slice(styles.indexOf(".glean-surf {"), styles.indexOf(".glean-surf-swipe-hint"));
    assert.match(narrow, /display:\s*flex/);
    assert.match(narrow, /flex-direction:\s*column/);
});

test("mobile resurface exposes prototype quick actions through parent navigation callbacks", () => {
    const resurface = read("src/ui/ResurfaceView.svelte");
    const dock = read("src/ui/DockPanel.svelte");
    const styles = read("src/index.scss");
    assert.match(resurface, /onQuickCapture\?: \(\) => void/);
    assert.match(resurface, /onQuickSearch\?: \(\) => void/);
    assert.match(resurface, /onQuickCandidates\?: \(\) => void/);
    assert.match(resurface, /resurface\.quickCapture/);
    assert.match(resurface, /class="glean-resurface__quick-title"/);
    assert.match(resurface, /resurface\.quickSearch/);
    assert.match(resurface, /resurface\.quickCandidates/);
    assert.match(resurface, /onclick=\{onQuickCapture\}/);
    assert.doesNotMatch(resurface, /quickCapture.*facade\.openImport/s);
    assert.match(resurface, /const quickActionsTitleId =/);
    assert.match(resurface, /<section class="glean-resurface__quick" aria-labelledby=\{quickActionsTitleId\}>/);
    assert.match(resurface, /<h2 id=\{quickActionsTitleId\} class="glean-resurface__quick-title">/);
    assert.ok(resurface.indexOf('<section class="glean-resurface__quick"') > resurface.indexOf('<div class="glean-surf">'));
    assert.match(dock, /onQuickCapture=\{quickCapture\}/);
    assert.match(dock, /onQuickSearch={openLibrarySearchFromHome}/);
    assert.match(dock, /onQuickCandidates={openCandidateQueue}/);
    assert.match(styles, /\.glean-resurface__quick-action\s*\{[\s\S]*min-height: 44px/);
    assert.match(styles, /\.glean-resurface__quick-title\s*\{[\s\S]*font-weight:\s*700/);
});

test("wide canvas highlights use a two-column card area and center empty states", () => {
    const source = read("src/ui/HighlightView.svelte");
    assert.match(source, /class="glean-highlights__items"/);
    assert.match(source, /class="glean-empty glean-highlights__empty"/);
    assert.match(source, /@container\s+glean-workbench\s*\(min-width:\s*760px\)/);
    assert.match(source, /\.glean-highlights__items\s*\{\s*display:\s*grid;/);
    assert.match(source, /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 360px\), 1fr\)\)/);
    assert.match(source, /\.glean-highlights__empty\s*\{\s*width:\s*min\(100%, 720px\);\s*align-self:\s*center;/);
});

test("stats prioritize three primary metrics and keep the supplemental snapshot compact", () => {
    const source = read("src/ui/StatsView.svelte");
    const styles = read("src/index.scss");
    assert.match(source, /class="glean-stats__distribution"/);
    assert.match(source, /class="glean-stats__distributions"/);
    assert.match(source, /@container\s+glean-workbench\s*\(min-width:\s*760px\)/);
    assert.match(source, /\.glean-stats__overview\s*>\s*\.glean-stats__metrics\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(source, /\.glean-stats__metrics--supplemental\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(source, /aria-labelledby=\{idFor\("breakdown-title"\)\}/);
    assert.match(source, /class="glean-sr-only">\{t\(i18n, "review\.bySite"\)\}/);
    assert.match(source, /review\.scopeShort/);
    assert.match(source, /<details class="glean-stats__scope">/);
    assert.match(source, /review\.moreMetrics/);
    assert.match(source, /review\.recentTrend/);
    assert.match(source, /review\.detailedActivity/);
    assert.match(source, /review\.detailedAnalysis/);
    assert.match(source, /class="glean-stats__completed-detail"/);
    assert.match(source, /glean-stats__trend-bar--empty/);
    assert.match(source, /role=\{day\.count > 0 \? "img"/);
    assert.match(source, /i18n, "review\.heatmapDay"/);
    assert.match(source, /\.glean-stats__intro \{\s*align-items: flex-start;/);
    assert.match(source, /grid-template-columns: repeat\(2, minmax\(136px, 1fr\)\)/);
    assert.match(styles, /\.glean-stats__metrics\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(source, /\.glean-stats__distributions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(source, /\.glean-stats__distribution\s*\{\s*min-width:\s*0/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.glean-stats__trend[\s\S]*grid-auto-columns: minmax\(3px, 1fr\)[\s\S]*overflow-x: auto/);
    assert.match(styles, /@container glean-workbench \(max-width: 640px\)[\s\S]*\.glean-stats__trend-bar \{ min-width: 3px; \}/);
});

test("all three canvas roots use the same workbench container contract", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-panel,\s*\.glean-tab-root\s*\{\s*container-name:\s*glean-workbench;\s*container-type:\s*inline-size;/);
    assert.match(styles, /@container\s+glean-workbench\s*\(min-width:\s*600px\)\s*\{[\s\S]*\.glean-list/);
    assert.doesNotMatch(styles, /\/\* tab 画布宽幅适配 \*\/\s*\.glean-tab-root\s*\{/);
});

test("settings, migration and import dialogs keep the standard bounded dialog contract", () => {
    const index = read("src/index.ts");
    const styles = read("src/index.scss");
    assert.match(index, /openMigrate\(\)[\s\S]*?width:\s*"720px",\s*height:\s*"560px"/);
    assert.match(index, /openImport\(\)[\s\S]*?width:\s*"720px",\s*height:\s*"560px"/);
    assert.match(index, /openSettings\(\)[\s\S]*?width:\s*"560px",\s*height:\s*"620px"/);
    assert.match(styles, /\.glean-migrate\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden/);
    assert.match(styles, /\.glean-settings\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow-y:\s*auto/);
    assert.match(styles, /\.glean-mtable\s*\{[\s\S]*overflow:\s*auto/);
});

test("wide canvas exposes labels for compact popovers and sort direction", () => {
    const popover = read("src/ui/ActionPopover.svelte");
    const filters = read("src/ui/LibraryFilters.svelte");
    const highlights = read("src/ui/HighlightView.svelte");
    const styles = read("src/index.scss");
    assert.match(popover, /glean-action-popover__trigger--compact/);
    assert.match(popover, /glean-action-popover__trigger-label/);
    assert.match(filters, /glean-filter-dir__label/);
    assert.match(highlights, /glean-filter-dir__label/);
    assert.match(styles, /\.glean-action-popover__trigger-label,[\s\S]*\.glean-filter-dir__label\s*\{\s*display:\s*none/);
    assert.match(styles, /@container\s+glean-workbench\s*\(min-width:\s*760px\)[\s\S]*\.glean-action-popover__trigger-label,[\s\S]*\.glean-filter-dir__label\s*\{\s*display:\s*inline/);
});

test("desktop header subtitle reflects the current view and active library filters", () => {
    const source = read("src/ui/DockPanel.svelte");
    const zh = read("public/i18n/zh_CN.json");
    const en = read("public/i18n/en_US.json");
    assert.match(source, /const headerSubtitle = \$derived\.by/);
    assert.match(source, /panel\.headerFiltered/);
    assert.match(source, /panel\.headerView/);
    assert.match(source, /<div class="glean-brand__sub">\{headerSubtitle\}<\/div>/);
    assert.match(zh, /"panel\.headerFiltered": "\$\{view\} · 读库 \$\{n\} 篇 · 已筛选 \$\{filters\} 项"/);
    assert.match(en, /"panel\.headerFiltered": "\$\{view\} · \$\{n\} in library · \$\{filters\} filters"/);
    assert.doesNotMatch(source, /glean-brand__badge/);
    const prototype = read("design/prototype-v2.html");
    const home = prototype.slice(prototype.indexOf('<article class="screen" id="home">'), prototype.indexOf("</article>", prototype.indexOf('<article class="screen" id="home">')));
    assert.match(home, /今日拾遗 · 读库 128 篇 · 已筛选 2 项/);
});

test("library cards and rows expose today pin through the shared resurface service", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /import \{ archiveStaleCandidates, setSurfacePinned \} from "\.\.\/services\/resurface-service"/);
    assert.match(source, /function isPinnedToday\(entry: ClipIndexEntry\)/);
    assert.match(source, /function toggleSurfacePin\(entry: ClipIndexEntry\)/);
    assert.match(source, /aria-pressed=\{isPinnedToday\(entry\)\}/);
    assert.match(source, /surfacePinLabel\(entry\)/);
    assert.match(source, /void toggleSurfacePin\(entry\)/);
    assert.match(source, /resurface\.pinToday/);
    assert.match(source, /resurface\.unpinToday/);
});

test("workbench list and kanban expose the shared batch selection surface", () => {
    const source = read("src/ui/DockPanel.svelte");
    const additions = read("design/prototype-v2-additions.html");
    assert.match(source, /import LibraryBatchBar from "\.\/LibraryBatchBar\.svelte"/);
    assert.equal((source.match(/<LibraryBatchBar/g) ?? []).length, 3);
    assert.match(source, /class="glean-kcard__select"/);
    assert.match(source, /class="glean-drow__select"/);
    assert.match(source, /class:glean-kanban--batch={selection\.size > 0}/);
    assert.match(source, /class:glean-lib__main--batch={selection\.size > 0}/);
    assert.match(additions, /列表 \/ 看板、预览侧栏和批量操作仍在同一上下文内/);
});

test("large library keeps full filtering but bounds list, table and kanban DOM windows", () => {
    const source = read("src/ui/DockPanel.svelte");
    const styles = read("src/index.scss");
    assert.match(source, /const LIBRARY_RENDER_PAGE = 80/);
    assert.match(source, /const visibleRows = \$derived\(rows\.slice\(0, renderLimit\)\)/);
    assert.match(source, /const hasMoreRows = \$derived\(visibleRows\.length < rows\.length\)/);
    assert.match(source, /function loadMoreRows\(\): void/);
    assert.equal((source.match(/\{#each visibleRows as entry/g) ?? []).length, 2);
    assert.match(source, /const visibleKanbanCols = \$derived\(kanbanCols\.map/);
    assert.match(source, /\{#each visibleKanbanCols as col/);
    assert.match(source, /library\.renderedCount/);
    assert.match(source, /library\.loadMore/);
    assert.match(styles, /\.glean-list-more\s*\{[\s\S]*justify-content:\s*center/);
});

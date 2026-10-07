import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("onboarding exposes dialog naming, progress, selection and async states", () => {
    const source = read("src/ui/OnboardingDialog.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-busy=\{scanning\}/);
    assert.match(source, /<h2 id=\{titleId\}/);
    assert.match(source, /role="group" aria-labelledby=\{anchorTitleId\}/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="alert"/);
});

test("settings exposes names for groups, controls and save state", () => {
    const source = read("src/ui/SettingsView.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-busy=\{saveBusy\}/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiEnrichMode"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiChannel"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.readerMode"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.aiDailyCap"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.checkinItem"\)\}/);
    assert.match(source, /customBaseUrlInsecure/);
});

test("stats uses per-instance section names and readable daily heatmap labels", () => {
    const source = read("src/ui/StatsView.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const idFor = \(part: string\) => `\$\{idPrefix\}-\$\{part\}`;/);
    assert.match(source, /aria-labelledby=\{idFor\("activity-title"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "review\.heatmap"/);
    assert.match(source, /role=\{day\.count > 0 \? "img"/);
    assert.match(source, /i18n, "review\.heatmapDay"/);
    assert.doesNotMatch(source, /id="glean-stats-(?:overview|activity|breakdown|completed)-title"/);
});

test("highlight selection controls and exports form separate named action groups", () => {
    const source = read("src/ui/HighlightView.svelte");
    const styles = read("src/index.scss");
    assert.match(source, /const titleId = `glean-highlights-title-\$\{instanceId\}`;/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-pressed=\{direction === "asc"\}/);
    assert.match(source, /library\.directionAscending/);
    assert.doesNotMatch(source, /glean-highlights__tools glean-highlights__tools--selection" role=/);
    assert.match(source, /class="glean-highlights__selection-actions" role="group"/);
    assert.match(source, /class="glean-highlights__export-actions" role="group"/);
    assert.match(source, /glean-highlights__preview-action/);
    assert.match(source, /item\.text\.slice\(0, 120\)/);
    assert.match(source, /\(visible\.page - 1\) \* highlightPageSize/);
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.glean-highlights__selection-actions,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("reader controls and sections use per-instance ids", () => {
    const source = read("src/ui/ReaderTab.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const idFor = \(part: string\) => `glean-reader-\$\{instanceId\}-\$\{part\}`;/);
    assert.match(source, /aria-controls=\{sidebarId\}/);
    assert.match(source, /aria-controls=\{appearancePanelId\}/);
    assert.match(source, /bind:open=\{appearanceOpen\}/);
    assert.match(source, /reader\.companionTitle/);
    assert.match(source, /aria-controls=\{shortcutsId\}/);
    assert.match(source, /id=\{speechRateId\}/);
    assert.match(source, /<label for=\{speechRateId\}/);
    assert.doesNotMatch(source, /id="glean-reader-(?:sidebar|shortcuts|sidebar-title|recent-title|appearance-title|outline-title|excerpt-title|speech-title|ai-title|rank-title)"/);
    assert.doesNotMatch(source, /id="glean-speech-rate"/);
});

test("reading context labels are unique per mounted instance", () => {
    const source = read("src/ui/ReadingContext.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const titleId = `glean-reading-context-title-\$\{instanceId\}`;/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /<div id=\{titleId\}/);
    assert.doesNotMatch(source, /aria-labelledby="glean-reading-context-title"/);
    assert.doesNotMatch(source, /id="glean-reading-context-title"/);
});

test("Dock 搜索打开后自动聚焦，并提供可访问的清空动作", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /bind:this=\{searchInput\}/);
    assert.match(source, /searchInput\?\.focus\(\)/);
    assert.match(source, /class="glean-search__clear"/);
    assert.match(source, /aria-label=\{t\(i18n, "panel\.searchClear"\)\}/);
});

test("mobile onboarding entry remains guarded by frontend detection", () => {
    const source = read("src/index.ts");
    assert.match(source, /const frontend = getFrontend\(\);/);
    assert.match(source, /this\.isMobile = frontend === "mobile" \|\| frontend === "browser-mobile";/);
    assert.match(source, /if \(!this\.isMobile\) \{/);
    assert.match(source, /if \(this\.isMobile\) return;/);
});

test("responsive and visually-hidden UI contracts remain present", () => {
    const source = read("src/index.scss");
    assert.match(source, /@media \(max-width: 560px\)/);
    assert.match(source, /\.glean-sr-only\s*\{/);
    assert.match(source, /\.glean-settings__footer\s*\{/);
    assert.match(source, /\.glean-settings__wide-input\s*\{/);
});

test("shared dialogs expose modal semantics and return focus after closing", () => {
    const dialog = read("src/libs/dialog.ts");
    const modalFocus = read("src/libs/modal-focus.ts");
    assert.match(dialog, /setAttribute\("role", "dialog"\)/);
    assert.match(dialog, /setAttribute\("aria-modal", "true"\)/);
    assert.match(dialog, /setAttribute\("aria-label", args\.title\)/);
    assert.match(dialog, /installModalFocus\(modalRoot/);
    assert.match(modalFocus, /event\.key === "Escape"/);
    assert.match(modalFocus, /event\.key !== "Tab"/);
    assert.match(modalFocus, /addEventListener\("focusin"/);
    assert.match(modalFocus, /previousFocus && available\(previousFocus\)/);
    assert.match(modalFocus, /focusableElements\(root\)\[0\]/);
});

test("import and migration dialogs provide unique headings and accessible progress values", () => {
    const importDialog = read("src/ui/ImportDialog.svelte");
    const migrateDialog = read("src/ui/MigrateDialog.svelte");
    assert.match(importDialog, /const instanceId = \$props\.id\(\);/);
    assert.match(importDialog, /aria-labelledby=\{titleId\}/);
    assert.match(importDialog, /<h2 id=\{titleId\}/);
    assert.match(importDialog, /role="group" aria-label=\{t\(i18n, "import\.importing"\)\}/);
    assert.match(importDialog, /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=\{progress\}/);
    assert.match(migrateDialog, /const instanceId = \$props\.id\(\);/);
    assert.match(migrateDialog, /aria-labelledby=\{titleId\}/);
    assert.match(migrateDialog, /<h2 id=\{titleId\}/);
    assert.match(migrateDialog, /role="group" aria-label=\{t\(i18n, "migrate\.writing"\)\}/);
    assert.match(migrateDialog, /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=\{progressPct\}/);
});

test("icon-only actions expose labels independent of hover tooltips", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    const readingContext = read("src/ui/ReadingContext.svelte");
    assert.match(dock, /class="glean-icon-btn glean-head-action" title=\{t\(i18n, "panel\.popup"\)\} aria-label=\{t\(i18n, "panel\.popup"\)\}/);
    assert.match(dock, /title=\{snapshotLabel\(entry\)\}\s*aria-label=\{snapshotLabel\(entry\)\}/);
    assert.match(dock, /title=\{t\(i18n, "candidate\.fixUrl"\)\} aria-label=\{t\(i18n, "candidate\.fixUrl"\)\}/);
    assert.match(resurface, /title=\{t\(i18n, "action\.refresh"\)\} aria-label=\{t\(i18n, "action\.refresh"\)\}/);
    assert.match(readingContext, /title=\{t\(i18n, "clip\.bodyCheckHint"\)\}\s*aria-label=\{t\(i18n, "clip\.bodyCheckHint"\)\}/);
});

test("status semantics and accessibility modes do not rely on color or motion alone", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-st-badge\s*\{[\s\S]*&::before/);
    assert.match(styles, /glean-st-badge--inbox[\s\S]*content:\s*"✦"/);
    assert.match(styles, /glean-st-badge--done[\s\S]*content:\s*"✓"/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /@media \(prefers-contrast: more\)/);
    assert.match(styles, /@media \(forced-colors: active\)/);
    assert.match(styles, /:focus-visible[\s\S]*outline:\s*2px solid var\(--b3-theme-primary\)/);
    assert.match(styles, /forced-colors: active[\s\S]*outline-color:\s*Highlight/);
});

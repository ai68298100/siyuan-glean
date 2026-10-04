import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("onboarding exposes dialog naming, progress, selection and async states", () => {
    const source = read("src/ui/OnboardingDialog.svelte");
    assert.match(source, /aria-labelledby="glean-onboarding-title"/);
    assert.match(source, /aria-busy=\{scanning\}/);
    assert.match(source, /<h2 id="glean-onboarding-title"/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="alert"/);
});

test("settings exposes names for groups, controls and save state", () => {
    const source = read("src/ui/SettingsView.svelte");
    assert.match(source, /aria-labelledby="glean-settings-title"/);
    assert.match(source, /aria-busy=\{saveBusy\}/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiEnrichMode"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiChannel"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.readerMode"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.aiDailyCap"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.checkinItem"\)\}/);
    assert.match(source, /customBaseUrlInsecure/);
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

test("import and migration dialogs provide headings and live progress", () => {
    const importDialog = read("src/ui/ImportDialog.svelte");
    const migrateDialog = read("src/ui/MigrateDialog.svelte");
    assert.match(importDialog, /aria-labelledby="glean-import-title"/);
    assert.match(importDialog, /<h2 id="glean-import-title"/);
    assert.match(importDialog, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(migrateDialog, /aria-labelledby="glean-migrate-title"/);
    assert.match(migrateDialog, /<h2 id="glean-migrate-title"/);
    assert.match(migrateDialog, /role="status" aria-live="polite" aria-atomic="true"/);
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

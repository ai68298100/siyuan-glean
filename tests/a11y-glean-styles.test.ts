import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const styles = readFileSync(resolve(root, "src/index.scss"), "utf8");

test("forced-colors maps glean tokens and host bridge variables to system keywords", () => {
    assert.match(styles, /@media \(forced-colors: active\)/);
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));

    // Glean tokens
    assert.match(forcedBlock, /--glean-accent-a:\s*Highlight;/);
    assert.match(forcedBlock, /--glean-accent-b:\s*Highlight;/);
    assert.match(forcedBlock, /--glean-border-soft:\s*CanvasText;/);
    assert.match(forcedBlock, /--glean-glass:\s*Canvas;/);
    assert.match(forcedBlock, /--glean-glass-border:\s*CanvasText;/);

    // Host bridge variables
    assert.match(forcedBlock, /--b3-theme-primary:\s*Highlight;/);
    assert.match(forcedBlock, /--b3-theme-on-primary:\s*HighlightText;/);
    assert.match(forcedBlock, /--b3-theme-background:\s*Canvas;/);
    assert.match(forcedBlock, /--b3-theme-surface:\s*Canvas;/);
    assert.match(forcedBlock, /--b3-theme-on-background:\s*CanvasText;/);
    assert.match(forcedBlock, /--b3-border-color:\s*CanvasText;/);
});

test("forced-colors gives cards, inputs, and components 1px CanvasText borders", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /\.glean-card[\s\S]*?border:\s*1px solid CanvasText;/);
    assert.match(forcedBlock, /\.glean-kcard/);
    assert.match(forcedBlock, /\.glean-drow/);
    assert.match(forcedBlock, /\.b3-button/);
    assert.match(forcedBlock, /\.b3-text-field/);
    assert.match(forcedBlock, /\.b3-select/);
});

test("forced-colors gives dialogs, drawers, and popovers 2px CanvasText borders", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /\.glean-dialog,[\s\S]*?\.glean-drawer,[\s\S]*?\.b3-dialog__container\s*\{[\s\S]*?border:\s*2px solid CanvasText !important;/);
});

test("forced-colors maps primary buttons and selected tabs to Highlight and HighlightText", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /\.glean-btn--primary,[\s\S]*?\.b3-button--primary\s*\{[\s\S]*?background:\s*Highlight !important;[\s\S]*?color:\s*HighlightText !important;/);
    assert.match(forcedBlock, /\.glean-tabs__item\.is-active[\s\S]*?outline:\s*2px solid Highlight !important;[\s\S]*?background:\s*Highlight !important;[\s\S]*?color:\s*HighlightText !important;/);
});

test("forced-colors provides high-contrast focus rings with 2px offset", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /:focus-visible\s*\{[\s\S]*?outline:\s*2px solid Highlight !important;[\s\S]*?outline-color:\s*Highlight !important;[\s\S]*?outline-offset:\s*2px;/);
});

test("forced-colors preserves status dots, badges, switches, and SVGs with forced-color-adjust: none", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /\.glean-status-dot[\s\S]*?forced-color-adjust:\s*none;/);
    assert.match(forcedBlock, /\.glean-heat-cell/);
    assert.match(forcedBlock, /\.glean-sw/);
    assert.match(forcedBlock, /input\[type="checkbox"\]\.b3-switch/);
    assert.match(forcedBlock, /svg/);
});

test("forced-colors handles body-level .b3-dialog isolation without leaking into host elements", () => {
    const forcedBlock = styles.slice(styles.indexOf("@media (forced-colors: active)"));
    assert.match(forcedBlock, /\.b3-dialog:has\(\.b3-dialog__content\)/);
    assert.match(forcedBlock, /\.b3-dialog:has\(\.b3-dialog__action\)/);
    assert.match(forcedBlock, /\.b3-dialog__header\s*\{[\s\S]*?border-bottom:\s*1px solid CanvasText !important;/);
    assert.match(forcedBlock, /\.b3-dialog__action\s*\{[\s\S]*?border-top:\s*1px solid CanvasText !important;/);
});

test("prefers-contrast: more enhances borders, tabs, and body dialogs", () => {
    assert.match(styles, /@media \(prefers-contrast: more\)/);
    const contrastBlock = styles.slice(styles.indexOf("@media (prefers-contrast: more)"));
    assert.match(contrastBlock, /--glean-border-soft:\s*var\(--b3-theme-on-background\);/);
    assert.match(contrastBlock, /\.glean-tabs__item\.is-active[\s\S]*?font-weight:\s*700;/);
    assert.match(contrastBlock, /\.b3-dialog:has\(\.b3-dialog__content\)/);
    assert.match(contrastBlock, /\.b3-dialog__container\s*\{[\s\S]*?border:\s*2px solid var\(--b3-theme-on-background\);/);
});

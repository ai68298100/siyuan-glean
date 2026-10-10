import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMobileKeyboardOpen, mobileKeyboardInset } from "../src/domain/mobile-viewport.ts";
import { clampSurfaceSwipe, resolveSurfaceSwipe } from "../src/domain/surface-swipe.ts";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("mobile dock exposes four navigation destinations without changing desktop views", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /class:glean-panel--mobile=\{facade\.isMobile\}/);
    assert.match(source, /\{#if !facade\.isMobile\}/);
    assert.match(source, /<nav class="glean-mobile-nav"/);
    assert.match(source, /mobile\.navHome/);
    assert.match(source, /mobile\.navLibrary/);
    assert.match(source, /mobile\.navHighlights/);
    assert.match(source, /mobile\.navSettings/);
    assert.match(source, /aria-current=\{mobileActive === item\.key \? "page" : undefined\}/);
    assert.match(source, /facade\.openSettings\(\)/);
});

test("mobile dock keeps touch-sized, theme-driven bottom navigation styles", () => {
    const source = read("src/index.scss");
    assert.match(source, /\.glean-panel--mobile\s*\{/);
    assert.match(source, /\.glean-mobile-nav\s*\{/);
    assert.match(source, /min-height:\s*48px/);
    assert.match(source, /var\(--b3-theme-surface\)/);
    assert.match(source, /env\(safe-area-inset-bottom/);
});

test("mobile dock exposes title, view-level back, more actions, and real reload state", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /class="glean-mobile-topbar"/);
    assert.match(source, /mobileBack/);
    assert.match(source, /mobileMoreOpen/);
    assert.match(source, /mobileTaskState/);
    assert.match(source, /role="status"/);
    assert.match(source, /aria-expanded=\{mobileMoreOpen\}/);
    assert.match(source, /openPopup\(\)/);
    assert.match(source, /facade\.openMigrate\(\)/);
    assert.match(source, /facade\.openImport\(\)/);
    assert.match(source, /facade\.openSettings\(\)/);
});

test("mobile top actions keep a 44px touch target and theme variables", () => {
    const source = read("src/index.scss");
    assert.match(source, /\.glean-panel--mobile \.glean-mobile-topbar/);
    assert.match(source, /\.glean-mobile-topbar__back,/);
    assert.match(source, /min-width:\s*44px/);
    assert.match(source, /min-height:\s*44px/);
    assert.match(source, /var\(--b3-theme-background-light\)/);
    assert.match(source, /var\(--b3-border-color\)/);
});

test("mobile library filters use a draft drawer with explicit apply and clear actions", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /mobileFilterOpen/);
    assert.match(source, /mobileFilterDraft/);
    assert.match(source, /openMobileFilters/);
    assert.match(source, /applyMobileFilters/);
    assert.match(source, /clearMobileFilterDraft/);
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /library\.resultCount/);
    assert.match(source, /library\.filterApply/);
    assert.match(source, /library\.filterClear/);
});

test("mobile library filter drawer keeps safe-area and touch-sized controls", () => {
    const source = read("src/index.scss");
    assert.match(source, /\.glean-mobile-filter-layer\s*\{/);
    assert.match(source, /\.glean-mobile-filter-sheet\s*\{/);
    assert.match(source, /env\(safe-area-inset-bottom/);
    assert.match(source, /\.glean-mobile-filter-sheet__close/);
    assert.match(source, /min-height:\s*44px/);
    assert.match(source, /var\(--b3-theme-surface\)/);
});

test("mobile filter drawer traps keyboard focus and returns it on close", () => {
    const source = read("src/ui/DockPanel.svelte");
    const modalFocus = read("src/libs/modal-focus.ts");
    assert.match(source, /mobileFilterSheet/);
    assert.match(source, /installModalFocus\(mobileFilterSheet/);
    assert.match(modalFocus, /event\.key === "Escape"/);
    assert.match(modalFocus, /event\.key !== "Tab"/);
    assert.match(modalFocus, /previousFocus && available\(previousFocus\)/);
    assert.match(modalFocus, /focus\(\{ preventScroll: true \}\)/);
});

test("mobile viewport math isolates keyboard inset and threshold", () => {
    assert.equal(mobileKeyboardInset({ innerHeight: 800, viewportHeight: 800 }), 0);
    assert.equal(mobileKeyboardInset({ innerHeight: 800, viewportHeight: 512 }), 288);
    assert.equal(mobileKeyboardInset({ innerHeight: 800, viewportHeight: 512, viewportOffsetTop: 12 }), 276);
    assert.equal(mobileKeyboardInset({ innerHeight: 800, viewportHeight: 900 }), 0);
    assert.equal(isMobileKeyboardOpen({ innerHeight: 800, viewportHeight: 721 }), false);
    assert.equal(isMobileKeyboardOpen({ innerHeight: 800, viewportHeight: 720 }), true);
});

test("mobile keyboard avoidance shares visual viewport vars across dock and dialogs", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const dialog = read("src/libs/dialog.ts");
    const viewport = read("src/libs/mobile-viewport.ts");
    const styles = read("src/index.scss");
    assert.match(dock, /onMount/);
    assert.match(dock, /installMobileViewportVars/);
    assert.match(dialog, /getFrontend/);
    assert.match(dialog, /installMobileViewportVars/);
    assert.match(viewport, /visualViewport/);
    assert.match(styles, /bottom: var\(--glean-keyboard-inset, 0px\)/);
    assert.match(styles, /padding-bottom: var\(--glean-keyboard-inset, 0px\)/);
    assert.match(styles, /max-height: calc\(var\(--glean-visual-viewport-height, 100vh\) - 16px\)/);
    assert.match(styles, /scroll-padding-bottom: calc\(72px \+ var\(--glean-keyboard-inset, 0px\)\)/);
});

test("mobile layout reserves all safe-area edges for dock content and sheets", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /--glean-safe-top:\s*env\(safe-area-inset-top/);
    assert.match(styles, /--glean-safe-right:\s*env\(safe-area-inset-right/);
    assert.match(styles, /--glean-safe-bottom:\s*env\(safe-area-inset-bottom/);
    assert.match(styles, /--glean-safe-left:\s*env\(safe-area-inset-left/);
    assert.match(styles, /--glean-mobile-nav-space:\s*calc\(/);
    assert.match(styles, /padding-top:\s*calc\(12px \+ var\(--glean-safe-top/);
    assert.match(styles, /padding: 6px calc\(8px \+ var\(--glean-safe-right/);
    assert.match(styles, /padding: 12px calc\(12px \+ var\(--glean-safe-right/);
});

test("mobile narrow and landscape layouts keep long text and sheets usable", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /@media \(max-width: 420px\)/);
    assert.match(styles, /@media \(orientation: landscape\) and \(max-height: 560px\)/);
    assert.match(styles, /white-space:\s*normal/);
    assert.match(styles, /overflow-wrap:\s*anywhere/);
    assert.match(styles, /min-width:\s*min\(190px/);
    assert.match(styles, /max-height:\s*min\(92%, 520px\)/);
    assert.match(styles, /\.glean-mobile-filter-sheet\s*\{[\s\S]*box-sizing:\s*border-box/);
});

test("mobile resurface swipe maps horizontal direction and clamps feedback", () => {
    assert.equal(resolveSurfaceSwipe(80, 10), "later");
    assert.equal(resolveSurfaceSwipe(-80, 10), "archive");
    assert.equal(resolveSurfaceSwipe(40, 0), null);
    assert.equal(resolveSurfaceSwipe(100, 120), null);
    assert.equal(clampSurfaceSwipe(999), 132);
    assert.equal(clampSurfaceSwipe(-999), -132);
});

test("mobile resurface swipe keeps explicit actions and guarded undo", () => {
    const view = read("src/ui/ResurfaceView.svelte");
    const service = read("src/services/resurface-service.ts");
    const styles = read("src/index.scss");
    for (const event of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        assert.match(view, new RegExp(`on${event}=\\{facade\\.isMobile \\?`));
    }
    assert.match(view, /undoSurfaceAction/);
    assert.match(view, /resurface\.swipeHint/);
    assert.match(service, /文章状态已变化，无法撤销/);
    assert.match(styles, /touch-action:\s*pan-y/);
    assert.match(styles, /\.glean-surf-act[\s\S]*min-height:\s*44px/);
});

test("today pin stays a visible action and uses the clip store path", () => {
    const view = read("src/ui/ResurfaceView.svelte");
    const service = read("src/services/resurface-service.ts");
    assert.match(view, /setSurfacePinned/);
    assert.match(view, /aria-pressed=\{isPinnedToday\(pick\)\}/);
    assert.match(view, /resurface\.pinToday/);
    assert.match(view, /resurface\.unpinToday/);
    assert.match(service, /writeClip\(plugin, docId, \{ pinned: next \|\| null \}/);
    assert.match(service, /todayStamp\(\)/);
});

test("mobile controls use a 44px hit area across panels and dialogs", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /@media \(max-width: 560px\)/);
    assert.match(styles, /\.glean-btn,[\s\S]*\.glean-status-actions__btn,[\s\S]*min-height: 44px/);
    assert.match(styles, /\.glean-op-btn[\s\S]*width: 44px/);
    assert.match(styles, /\.glean-search[\s\S]*min-height: 44px/);
    assert.match(styles, /\.dialog-content \.b3-select,[\s\S]*min-height: 44px/);
    assert.match(styles, /\.glean-panel--mobile \.glean-icon-btn,[\s\S]*min-height: 44px/);
});

test("settings switches keep the visual track while exposing a 44px button", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-sw\s*\{[\s\S]*width: 44px/);
    assert.match(styles, /\.glean-sw\s*\{[\s\S]*min-width: 44px/);
    assert.match(styles, /\.glean-sw\s*\{[\s\S]*height: 44px/);
    assert.match(styles, /\.glean-sw\s*\{[\s\S]*&::before[\s\S]*width: 36px/);
    assert.match(styles, /\.glean-sw\s*\{[\s\S]*&::after[\s\S]*width: 17px/);
});

test("mobile card operations and selection do not depend on hover", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-panel--mobile \.glean-card__ops,[\s\S]*\.glean-panel--mobile \.glean-card__check/);
    assert.match(styles, /\.glean-panel--mobile \.glean-card__ops,[\s\S]*opacity: 1/);
    assert.match(styles, /\.glean-panel--mobile \.glean-card__check[\s\S]*min-width: 44px/);
    assert.match(styles, /\.glean-panel--mobile \.glean-card__check[\s\S]*min-height: 44px/);
});

test("mobile offline state keeps cached content and exposes retry", () => {
    const view = read("src/ui/DockPanel.svelte");
    const styles = read("src/index.scss");
    assert.match(view, /navigator\.onLine/);
    assert.match(view, /addEventListener\("offline"/);
    assert.match(view, /addEventListener\("online"/);
    assert.match(view, /mobile\.taskOffline/);
    assert.match(view, /mobile\.offlineHint/);
    assert.match(view, /msg\.offlineRetry/);
    assert.match(styles, /\.glean-offline-notice\s*\{/);
});

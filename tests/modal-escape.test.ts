import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installEscapeHandler, installModalFocus } from "../src/libs/modal-focus.ts";
import { createDialogSingleton } from "../src/libs/dialog-singleton.ts";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

class FakeElement {
    isConnected = true;
    tabIndex = 0;
    popoverOpen = false;
    attributes = new Map<string, string>();
    parent: FakeElement | null;
    constructor(parent: FakeElement | null = null) { this.parent = parent; }
    contains(node: FakeElement | null): boolean { return Boolean(node && (node === this || this.contains(node.parent))); }
    closest() { return null; }
    getClientRects() { return [1]; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    matches() { return false; }
    querySelector(selector: string) { return selector === ":popover-open" && this.popoverOpen ? this : null; }
    querySelectorAll() { return []; }
    focus() { (globalThis.document as unknown as { activeElement: FakeElement }).activeElement = this; }
}

function harness() {
    const listeners = new Map<string, Array<(event: any) => void>>();
    const documentStub = {
        body: new FakeElement(), activeElement: new FakeElement(),
        addEventListener(name: string, handler: (event: any) => void) { listeners.set(name, [...listeners.get(name) ?? [], handler]); },
        removeEventListener(name: string, handler: (event: any) => void) { listeners.set(name, (listeners.get(name) ?? []).filter((current) => current !== handler)); },
    };
    Object.assign(globalThis, {
        document: documentStub, HTMLElement: FakeElement, SVGElement: FakeElement,
        getComputedStyle: () => ({ visibility: "visible" }),
        window: { siyuan: undefined, setTimeout: () => 1, clearTimeout: () => {} },
    });
    function press(target: FakeElement, patch: Record<string, unknown> = {}) {
        const event = {
            key: "Escape", target, defaultPrevented: false, isComposing: false, keyCode: 27, repeat: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; },
            ...patch,
        };
        documentStub.activeElement = target;
        for (const handler of [...listeners.get("keydown") ?? []]) {
            handler(event);
            if (event.stopped) break;
        }
        return event;
    }
    return { press, listeners };
}

test("浮窗Esc：晚注册的预览先关闭，外层modal保留；卸载后恢复外层关闭", () => {
    const current = harness();
    const modal = new FakeElement();
    const preview = new FakeElement(modal);
    let modalClosed = 0;
    let previewClosed = 0;
    const disposeModal = installModalFocus(modal as unknown as HTMLElement, { onClose: () => { modalClosed += 1; } });
    const disposePreview = installEscapeHandler(preview as unknown as HTMLElement, () => { previewClosed += 1; return true; });
    const event = current.press(preview);
    assert.equal(previewClosed, 1);
    assert.equal(modalClosed, 0);
    assert.equal(event.defaultPrevented, true);
    disposePreview();
    disposePreview();
    current.press(preview);
    assert.equal(modalClosed, 1);
    disposeModal();
    assert.equal(current.listeners.get("keydown")?.length, 0);
});

test("Esc边界：已处理、IME、重复和外部焦点不关闭预览，独立工作台也可关闭", () => {
    const current = harness();
    const preview = new FakeElement();
    let closed = 0;
    const dispose = installEscapeHandler(preview as unknown as HTMLElement, () => { closed += 1; return true; });
    for (const patch of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }, { key: "Enter" }]) current.press(preview, patch);
    current.press(new FakeElement());
    assert.equal(closed, 0);
    current.press(preview);
    assert.equal(closed, 1);
    dispose();
});

test("原生Popover与宿主外部弹窗优先，不连带关闭预览或外层浮窗", () => {
    const current = harness();
    const modal = new FakeElement();
    const preview = new FakeElement(modal);
    let closed = 0;
    const disposeModal = installModalFocus(modal as unknown as HTMLElement, { onClose: () => { closed += 1; } });
    const disposePreview = installEscapeHandler(preview as unknown as HTMLElement, () => { closed += 1; return true; });
    modal.popoverOpen = true;
    preview.popoverOpen = true;
    assert.equal(current.press(preview).defaultPrevented, false);
    assert.equal(closed, 0);
    modal.popoverOpen = false;
    preview.popoverOpen = false;
    (globalThis.window as unknown as { siyuan: unknown }).siyuan = { dialogs: [{ element: new FakeElement() }] };
    assert.equal(current.press(preview).defaultPrevented, false);
    assert.equal(closed, 0);
    disposePreview();
    disposeModal();
});

test("工作台弹窗只复用仍连接的实例，并且旧实例关闭回调不释放新实例", () => {
    type Handle = { dialog: { element: HTMLElement }; id: number };
    const elements: Array<{ isConnected: boolean; focusCount: number }> = [];
    const closeCallbacks: Array<() => void> = [];
    let creates = 0;
    const open = createDialogSingleton<string, Handle>((_args, onClose) => {
        const container = { focus() { elements.at(-1)!.focusCount += 1; } };
        const element = {
            isConnected: true,
            focusCount: 0,
            querySelector(selector: string) { return selector === ".b3-dialog__container" ? container : null; },
        };
        elements.push(element);
        closeCallbacks.push(onClose);
        return { dialog: { element: element as unknown as HTMLElement }, id: ++creates };
    });

    const first = open("first");
    assert.equal(open("duplicate"), first);
    assert.equal(creates, 1);
    assert.equal(elements[0].focusCount, 1);

    elements[0].isConnected = false;
    const second = open("second");
    assert.notEqual(second, first);
    assert.equal(creates, 2);
    closeCallbacks[0]();
    assert.equal(open("still-second"), second);
    assert.equal(creates, 2);

    closeCallbacks[1]();
    const third = open("after-close");
    assert.notEqual(third, second);
    assert.equal(creates, 3);
});

test("工作台各入口共用插件级单例且Dock不再用固定延迟解锁", () => {
    const index = read("src/index.ts");
    const dock = read("src/ui/DockPanel.svelte");
    assert.match(index, /createDialogSingleton\([\s\S]*?callback: onClose/);
    assert.match(index, /openWorkbenchPopup\(initialPreviewId\?: string\): void\s*\{\s*this\.openWorkbenchPopupSingleton\(initialPreviewId\)/);
    assert.doesNotMatch(dock, /popupOpen|setTimeout\(\(\) => \(popupOpen = false\)/);
});

test("FormattingDialog支持window级别Escape关闭与快捷键支持（T-3390）", () => {
    const src = read("src/ui/FormattingDialog.svelte");
    assert.match(src, /<svelte:window\s+onkeydown=\{handleKeydown\}\s*\/>/);
    assert.match(src, /event\.key === "Escape" && !busy/);
    assert.match(src, /event\.ctrlKey \|\| event\.metaKey/);
});

test("OnboardingDialog与MigrateDialog支持window级别Escape与状态守卫闭环（T-3408）", () => {
    const onboarding = read("src/ui/OnboardingDialog.svelte");
    assert.match(onboarding, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(onboarding, /if \(event\.key === "Escape"\) \{[\s\S]*?if \(actionBusy \|\| scanning\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?continueLater\(\);/);

    const migrate = read("src/ui/MigrateDialog.svelte");
    assert.match(migrate, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(migrate, /if \(event\.key === "Escape"\) \{[\s\S]*?if \(phase === "running" \|\| discardBusy \|\| Boolean\(rowBusyId\)\) return;/);
    assert.match(migrate, /if \(editingRowId\) \{[\s\S]*?editingRowId = "";[\s\S]*?return;[\s\S]*?\}/);
    assert.match(migrate, /if \(confirmingDiscard\) \{[\s\S]*?void cancelDiscardConfirmation\(\);[\s\S]*?return;[\s\S]*?\}/);
    assert.match(migrate, /onClose\(\);/);
    assert.match(migrate, /else if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); editingRowId = ""; \}/);
});

test("ImportDialog支持window级别Escape分级拦截与状态守卫闭环（T-3409）", () => {
    const importDialog = read("src/ui/ImportDialog.svelte");
    assert.match(importDialog, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(importDialog, /if \(event\.key === "Escape"\) \{[\s\S]*?if \(phase === "importing" \|\| busy \|\| stopping \|\| progressLoading\) return;/);
    assert.match(importDialog, /if \(discardConfirmed \|\| forceResetConfirmed \|\| resumeConfirmed \|\| importConfirmed\) \{[\s\S]*?discardConfirmed = false;[\s\S]*?return;[\s\S]*?\}/);
    assert.match(importDialog, /onClose\(\);/);
});

test("BackupPanel与FlashcardRecoveryPanel支持window级别Escape分级撤销与忙碌守卫（T-3410）", () => {
    const backup = read("src/ui/BackupPanel.svelte");
    assert.match(backup, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(backup, /if \(busy === "export" \|\| busy === "restore" \|\| busy === "file"\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/);
    assert.match(backup, /if \(busy === "preview"\) \{[\s\S]*?controller\?\.abort\(\);[\s\S]*?return;/);
    assert.match(backup, /if \(session\) \{[\s\S]*?reset\(\);[\s\S]*?return;/);

    const flashcardRecovery = read("src/ui/FlashcardRecoveryPanel.svelte");
    assert.match(flashcardRecovery, /<svelte:window onkeydown=\{handleWindowKeydown\} \/>/);
    assert.match(flashcardRecovery, /if \(event\.key === "Escape" && panelState === "busy"\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/);
});

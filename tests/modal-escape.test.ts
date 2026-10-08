import test from "node:test";
import assert from "node:assert/strict";
import { installEscapeHandler, installModalFocus } from "../src/libs/modal-focus.ts";

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

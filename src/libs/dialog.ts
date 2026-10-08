/*
 * Svelte 弹窗工具（模板 siyuan-note/plugin-sample-vite-svelte 移植, MIT, frostime）
 */
import { Dialog, getFrontend } from "siyuan";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import { installMobileViewportVars } from "./mobile-viewport";
import { installModalFocus } from "./modal-focus";
import { isActivationKey } from "../domain/keyboard";

function isMobileFrontend(): boolean {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    closeLabel?: string,
    width?: string, height?: string,
    callback?: () => void;
}) => {
    let disposeViewport = () => {};
    let disposeFocus = () => {};
    const previousFocus = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement
        ? document.activeElement
        : null;
    let closed = false;
    let closing = false;
    const dialog = new Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; flex-direction: column; align-items: stretch; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box;"></div>`,
        width: args.width,
        height: args.height,
        destroyCallback: () => {
            if (closed) return;
            closed = true;
            disposeFocus();
            disposeViewport();
            args.callback?.();
        }
    });
    const modalRoot = dialog.element.querySelector<HTMLElement>(".b3-dialog__container") ?? dialog.element;
    modalRoot.setAttribute("role", "dialog");
    modalRoot.setAttribute("aria-modal", "true");
    if (!modalRoot.hasAttribute("aria-labelledby")) modalRoot.setAttribute("aria-label", args.title);
    const requestClose = () => {
        if (closed || closing) return;
        closing = true;
        dialog.destroy();
    };
    const closeIcon = dialog.element.querySelector<SVGElement>(".b3-dialog__close");
    if (closeIcon) {
        closeIcon.setAttribute("role", "button");
        closeIcon.setAttribute("aria-label", args.closeLabel ?? args.title);
        closeIcon.setAttribute("tabindex", "0");
        closeIcon.addEventListener("keydown", (event) => {
            if (!(event instanceof KeyboardEvent) || event.isComposing || !isActivationKey(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            requestClose();
        });
    }
    disposeViewport = installMobileViewportVars(dialog.element, isMobileFrontend());
    dialog.element.querySelector(".dialog-content")?.appendChild(args.ele);
    disposeFocus = installModalFocus(modalRoot, { onClose: requestClose, returnFocus: previousFocus });
    return {
        dialog,
        close: requestClose
    };
};

export const svelteDialog = (args: {
    title: string,
    closeLabel?: string,
    component: Component<any>, // Svelte 5 component constructor
    props?: Record<string, any>,
    width?: string,
    height?: string,
    /** 附加到挂载容器的类（如工作台宽画布 glean-tab-root） */
    containerClass?: string,
    callback?: () => void;
}) => {
    let container = document.createElement("div");
    container.className = ["glean-dialog-root", args.containerClass ?? ""].filter(Boolean).join(" ");
    container.style.display = "contents";

    let closeDialog: (() => void) | undefined;
    let componentInstance = mount(args.component, {
        target: container,
        props: { ...args.props, onClose: () => closeDialog?.() }
    });

    const { dialog, close } = simpleDialog({
        ...args,
        ele: container,
        callback: () => {
            unmount(componentInstance);
            if (args.callback) args.callback();
        }
    });

    closeDialog = close;

    return {
        component: componentInstance,
        dialog,
        close
    };
};

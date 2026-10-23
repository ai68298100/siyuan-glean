/*
 * Svelte 弹窗工具（模板 siyuan-note/plugin-sample-vite-svelte 移植, MIT, frostime）
 */
import { Dialog, getFrontend } from "siyuan";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";
import { installMobileViewportVars } from "./mobile-viewport";
import { installModalFocus } from "./modal-focus";
import { isActivationKey } from "../domain/keyboard";
import pluginManifest from "../../plugin.json";

function isMobileFrontend(): boolean {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}

/**
 * 统领规范：为思源原生 Dialog 标题栏装配统一的品牌标题栏规范（.lv-dialog-title-wrap）。
 * 包含 22×22 青绿底白麦穗标 + 标题 + 版本胶囊，保持幂等。
 */
export function mountPlatformDialogTitleWrap(
    dialogElement: HTMLElement | null | undefined,
    titleText: string,
    badgeText = `v${pluginManifest.version}`,
    iconName = "iconGleanWheat",
): HTMLElement | null {
    if (!dialogElement || typeof dialogElement.querySelector !== "function") return null;
    const header = dialogElement.querySelector(".b3-dialog__header");
    const titleEl = header?.querySelector(".b3-dialog__title");
    if (!header || !titleEl) return null;
    const existing = header.querySelector(".lv-dialog-title-wrap") as HTMLElement | null;
    if (existing) return existing;

    const wrap = document.createElement("div");
    wrap.className = "lv-dialog-title-wrap";
    const iconSpan = document.createElement("span");
    iconSpan.className = "lv-dialog-title-icon";
    iconSpan.innerHTML = `<svg><use xlink:href="#${iconName || "iconGleanWheat"}"></use></svg>`;
    const titleSpan = document.createElement("span");
    titleSpan.className = "lv-dialog-title-text";
    titleSpan.textContent = titleText || "";
    wrap.append(iconSpan, titleSpan);
    if (badgeText) {
        const badgeSpan = document.createElement("span");
        badgeSpan.className = "lv-dialog-title-pill";
        badgeSpan.textContent = badgeText;
        wrap.appendChild(badgeSpan);
    }
    titleEl.textContent = "";
    titleEl.appendChild(wrap);
    return wrap;
}

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    closeLabel?: string,
    canClose?: () => boolean,
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
        if (closed || closing || args.canClose?.() === false) return;
        closing = true;
        dialog.destroy();
    };
    const closeIcon = dialog.element.querySelector<SVGElement>(".b3-dialog__close");
    if (closeIcon) {
        closeIcon.setAttribute("role", "button");
        closeIcon.setAttribute("aria-label", args.closeLabel ?? args.title);
        closeIcon.setAttribute("tabindex", "0");
        closeIcon.addEventListener("click", (event) => {
            if (args.canClose?.() !== false) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        closeIcon.addEventListener("keydown", (event) => {
            if (!(event instanceof KeyboardEvent) || event.isComposing || !isActivationKey(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            requestClose();
        });
    }
    disposeViewport = installMobileViewportVars(dialog.element, isMobileFrontend());
    mountPlatformDialogTitleWrap(dialog.element, args.title);
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
    let closeGuard: (() => boolean) | undefined;
    let componentInstance = mount(args.component, {
        target: container,
        props: {
            ...args.props,
            onClose: () => closeDialog?.(),
            registerCloseGuard: (guard: () => boolean) => {
                closeGuard = guard;
                return () => {
                    if (closeGuard === guard) closeGuard = undefined;
                };
            },
        }
    });

    const { dialog, close } = simpleDialog({
        ...args,
        canClose: () => closeGuard?.() ?? true,
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

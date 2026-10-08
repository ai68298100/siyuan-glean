type FocusTarget = HTMLElement | SVGElement;

interface ModalScope {
    root: HTMLElement;
    focusInitial: () => void;
}

interface ModalFocusOptions {
    onClose: () => void;
    returnFocus?: FocusTarget | null;
}

const scopes: ModalScope[] = [];
const escapeHandlers: Array<{ root: HTMLElement; handle: (event: KeyboardEvent) => boolean }> = [];

function dispatchEscape(event: KeyboardEvent, container?: HTMLElement): boolean {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return false;
    const scope = [...escapeHandlers].reverse().find((item) =>
        (!container || container.contains(item.root)) && item.root.contains(event.target as Node) && visible(item.root) && !externalOverlay(item.root)
    );
    if (!scope || scope.root.querySelector(":popover-open")) return false;
    return scope.handle(event);
}

export function installEscapeHandler(root: HTMLElement, handle: (event: KeyboardEvent) => boolean): () => void {
    const scope = { root, handle };
    escapeHandlers.push(scope);
    const onKey = (event: KeyboardEvent) => {
        if (!dispatchEscape(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", onKey, true);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        document.removeEventListener("keydown", onKey, true);
        const position = escapeHandlers.indexOf(scope);
        if (position >= 0) escapeHandlers.splice(position, 1);
    };
}

function visible(element: FocusTarget): boolean {
    return element.isConnected && !element.closest("[hidden], [inert], [aria-hidden='true']") &&
        element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible";
}

function available(element: FocusTarget): boolean {
    return visible(element) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
}

function focusableElements(root: HTMLElement): FocusTarget[] {
    return Array.from(root.querySelectorAll<FocusTarget>(
        "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable='true']"
    )).filter((element) => element.tabIndex >= 0 && available(element)).sort((first, second) =>
        (first.tabIndex > 0 ? first.tabIndex : Infinity) - (second.tabIndex > 0 ? second.tabIndex : Infinity)
    );
}

function externalOverlay(root: HTMLElement): boolean {
    const host = window.siyuan;
    const topDialog = host?.dialogs?.[host.dialogs.length - 1]?.element;
    if (topDialog?.isConnected && !topDialog.contains(root)) return true;
    const active = document.activeElement;
    const overlay = active?.closest("[role='dialog'], [role='menu'], [role='listbox']");
    if (overlay && !root.contains(overlay) && !overlay.contains(root)) return true;
    const menu = host?.menus?.menu?.element;
    return Boolean(menu && active && menu.contains(active) && visible(menu));
}

export function installModalFocus(root: HTMLElement, options: ModalFocusOptions): () => void {
    const activeElement = document.activeElement;
    const previousFocus = options.returnFocus === undefined
        ? activeElement instanceof HTMLElement || activeElement instanceof SVGElement ? activeElement : null
        : options.returnFocus;
    const previousTabIndex = root.getAttribute("tabindex");
    root.tabIndex = -1;
    let disposed = false;
    const scope: ModalScope = {
        root,
        focusInitial: () => {
            const first = focusableElements(root)[0];
            (first ?? root).focus({ preventScroll: true });
        },
    };
    const isActive = () => !disposed && scopes[scopes.length - 1] === scope && root.isConnected && !externalOverlay(root);
    const onKeyDown = (event: KeyboardEvent) => {
        if (!isActive() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
            if (event.repeat) return;
            if (root.querySelector(":popover-open")) return;
            if (dispatchEscape(event, root)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            options.onClose();
            return;
        }
        if (event.key !== "Tab") return;
        const elements = focusableElements(root);
        const active = document.activeElement;
        const current = elements.indexOf(active as FocusTarget);
        if (current < 0 || (event.shiftKey && current === 0) || (!event.shiftKey && current === elements.length - 1)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const target = event.shiftKey ? elements[elements.length - 1] : elements[0];
            (target ?? root).focus({ preventScroll: true });
        }
    };
    const onFocusIn = () => {
        if (isActive() && !root.contains(document.activeElement)) scope.focusInitial();
    };
    scopes.push(scope);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    const focusTimer = window.setTimeout(() => {
        if (isActive()) scope.focusInitial();
    }, 0);

    return () => {
        if (disposed) return;
        const wasTop = scopes[scopes.length - 1] === scope;
        const active = document.activeElement;
        const shouldRestore = wasTop && (active === document.body || root.contains(active));
        disposed = true;
        window.clearTimeout(focusTimer);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("focusin", onFocusIn, true);
        scopes.splice(scopes.indexOf(scope), 1);
        if (previousTabIndex === null) root.removeAttribute("tabindex");
        else root.setAttribute("tabindex", previousTabIndex);
        if (!shouldRestore) return;
        const parent = scopes[scopes.length - 1];
        if (previousFocus && available(previousFocus) && (!parent || parent.root.contains(previousFocus))) {
            previousFocus.focus({ preventScroll: true });
        } else if (parent?.root.isConnected) {
            parent.focusInitial();
        }
    };
}

import { isMobileKeyboardOpen, mobileKeyboardInset } from "../domain/mobile-viewport.ts";

const noop = () => {};

export function installMobileViewportVars(target: HTMLElement | null, enabled: boolean): () => void {
    if (!target || !enabled || typeof window === "undefined") return noop;

    const visualViewport = window.visualViewport;
    const update = () => {
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
        const metrics = {
            innerHeight: window.innerHeight,
            viewportHeight,
            viewportOffsetTop,
        };
        const inset = mobileKeyboardInset(metrics);
        target.style.setProperty("--glean-keyboard-inset", `${inset}px`);
        target.style.setProperty("--glean-visual-viewport-height", `${Math.round(viewportHeight)}px`);
        target.toggleAttribute("data-glean-keyboard-open", isMobileKeyboardOpen(metrics));
    };

    update();
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);

    return () => {
        window.removeEventListener("resize", update);
        visualViewport?.removeEventListener("resize", update);
        visualViewport?.removeEventListener("scroll", update);
        target.style.removeProperty("--glean-keyboard-inset");
        target.style.removeProperty("--glean-visual-viewport-height");
        target.removeAttribute("data-glean-keyboard-open");
    };
}

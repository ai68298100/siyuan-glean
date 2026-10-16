/**
 * 把阅读上下文挂到思源原生编辑器容器，跟随根块切换和编辑器销毁卸载。
 * 仅使用 SDK 公开的事件与 IProtyle.element/rootID；不进入正文 DOM。
 */
import { getAllEditor, type IProtyle } from "siyuan";
import { mount, unmount } from "svelte";
import type { GleanFacade } from "../types";
import ReadingContext from "./ReadingContext.svelte";

interface MountedContext {
    docId: string;
    target: HTMLElement;
    instance: ReturnType<typeof mount>;
}

export function installReadingContext(facade: GleanFacade): () => void {
    const mounted = new Map<HTMLElement, MountedContext>();
    let activeElement: HTMLElement | null = null;
    let activeDocId = "";

    function detach(element: HTMLElement): void {
        if (activeElement === element) {
            activeElement = null;
            activeDocId = "";
        }
        const previous = mounted.get(element);
        if (!previous) return;
        mounted.delete(element);
        void unmount(previous.instance);
        previous.target.remove();
    }

    function attach(protyle: IProtyle): void {
        const element = protyle?.element;
        if (!(element instanceof HTMLElement)) return;
        // 内嵌阅读器和工作台预览已有自己的上下文，不能再注入原生编辑器栏。
        if (element.closest(".glean-protyle-host")) {
            detach(element);
            return;
        }
        const docId = protyle.block?.rootID ?? "";
        const previous = mounted.get(element);
        if (previous?.docId === docId && previous.target.isConnected) {
            // 正文分段加载不改变根属性；重复刷新会令上下文栏与骨架屏反复交替。
            return;
        }
        detach(element);
        if (!docId) return;

        const target = document.createElement("div");
        target.className = "glean-reading-context-host";
        element.prepend(target);
        const instance = mount(ReadingContext, { target, props: { facade, docId } });
        mounted.set(element, { docId, target, instance });
    }

    const onLoaded = (event: CustomEvent<{ protyle: IProtyle }>) => attach(event.detail.protyle);
    const onSwitched = (event: CustomEvent<{ protyle: IProtyle }>) => {
        const protyle = event.detail.protyle;
        const element = protyle?.element;
        const previous = element instanceof HTMLElement ? mounted.get(element) : undefined;
        attach(protyle);
        if (!(element instanceof HTMLElement)) return;
        const current = mounted.get(element);
        if (!current) {
            activeElement = null;
            activeDocId = "";
            return;
        }
        const changed = activeElement !== element || activeDocId !== current.docId;
        activeElement = element;
        activeDocId = current.docId;
        // 真正切回旧编辑器时读回外部手填属性；同一激活事件不重复请求。
        // 新挂载由组件首次读取，属性写入另由 glean:data-changed 广播刷新。
        if (changed && previous === current) {
            document.dispatchEvent(new CustomEvent("glean:reading-context-refresh", { detail: { id: current.docId } }));
        }
    };
    const onDestroyed = (event: CustomEvent<{ protyle: IProtyle }>) => {
        const element = event.detail.protyle?.element;
        if (element instanceof HTMLElement) detach(element);
    };

    const bus = facade.pluginInstance.eventBus;
    bus.on("loaded-protyle-static", onLoaded);
    bus.on("loaded-protyle-dynamic", onLoaded);
    bus.on("switch-protyle", onSwitched);
    bus.on("destroy-protyle", onDestroyed);
    for (const editor of getAllEditor()) attach(editor.protyle);

    return () => {
        bus.off("loaded-protyle-static", onLoaded);
        bus.off("loaded-protyle-dynamic", onLoaded);
        bus.off("switch-protyle", onSwitched);
        bus.off("destroy-protyle", onDestroyed);
        for (const element of mounted.keys()) detach(element);
    };
}

export type ProtyleMode = "preview" | "wysiwyg";

export interface ProtyleInstance {
    switchMode(mode: ProtyleMode): void;
    resize(): void;
    destroy(): void;
}

export interface ProtyleController {
    setMode(mode: ProtyleMode): void;
    resize(): void;
    destroy(): void;
}

interface ControllerOptions {
    host: HTMLElement;
    mode: ProtyleMode;
    create: (mount: HTMLElement, ready: (instance: ProtyleInstance) => void) => ProtyleInstance;
    observe?: (host: HTMLElement, resize: () => void) => () => void;
    onReady?: () => void;
    onError?: (error: unknown) => void;
}

export function createProtyleController(options: ControllerOptions): ProtyleController {
    const mount = options.host.ownerDocument.createElement("div");
    mount.className = "glean-protyle-mount";
    options.host.replaceChildren(mount);
    let instance: ProtyleInstance | null = null;
    let disposed = false;
    let ready = false;
    let mode = options.mode;
    let appliedMode = mode;
    /** destroy() 已销毁过的实例；after 回调迟到时避免对同一实例二次 destroy（内核注销重复执行）。 */
    let destroyedInstance: ProtyleInstance | null = null;
    let disconnect = () => {};

    function invoke(action: (current: ProtyleInstance) => void): void {
        if (disposed || !instance || !ready) return;
        try { action(instance); } catch (error) { options.onError?.(error); }
    }

    const controller: ProtyleController = {
        setMode(next) {
            if (disposed) return;
            mode = next;
            if (mode === appliedMode) return;
            invoke((current) => { current.switchMode(mode); appliedMode = mode; });
        },
        resize() { invoke((current) => current.resize()); },
        destroy() {
            if (disposed) return;
            disposed = true;
            disconnect();
            try { instance?.destroy(); } catch (error) { options.onError?.(error); }
            destroyedInstance = instance;
            mount.remove();
            instance = null;
        },
    };

    try {
        instance = options.create(mount, (current) => {
            if (disposed) {
                if (current !== destroyedInstance) {
                    try { current.destroy(); } catch { }
                }
                return;
            }
            instance = current;
            ready = true;
            options.onReady?.();
            controller.setMode(mode);
            controller.resize();
        });
        disconnect = options.observe?.(options.host, () => controller.resize()) ?? disconnect;
    } catch (error) {
        controller.destroy();
        options.onError?.(error);
    }
    return controller;
}

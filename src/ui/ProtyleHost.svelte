<script lang="ts">
    import { Protyle } from "siyuan";
    import type { App } from "siyuan";
    import { untrack } from "svelte";
    import { t } from "../libs/i18n";
    import { createProtyleController, type ProtyleController, type ProtyleMode } from "../libs/protyle-controller";

    interface Props {
        app: App;
        docId: string;
        mode: ProtyleMode;
        i18n: Record<string, string>;
        host?: HTMLDivElement | null;
        controller?: ProtyleController | null;
        className?: string;
        onOpenDocument: () => void;
    }

    let { app, docId, mode, i18n, host = $bindable(null), controller = $bindable(null), className = "", onOpenDocument }: Props = $props();
    let attempt = $state(0);
    let stage = $state<"loading" | "ready" | "failed">("loading");

    $effect(() => {
        const element = host;
        const id = docId;
        void attempt;
        if (!element || !id) return;
        let active = true;
        stage = "loading";
        const timeout = window.setTimeout(() => { if (active && stage === "loading") stage = "failed"; }, 15000);
        const current = createProtyleController({
            host: element,
            mode: untrack(() => mode),
            create: (mount, after) => new Protyle(app, mount, {
                blockId: id, rootId: id, mode: untrack(() => mode),
                render: { breadcrumb: false, background: false },
                after,
            }),
            observe: (target, resize) => {
                if (typeof ResizeObserver === "undefined") return () => {};
                const observer = new ResizeObserver(resize);
                observer.observe(target);
                return () => observer.disconnect();
            },
            onReady: () => { if (active) { window.clearTimeout(timeout); stage = "ready"; } },
            onError: (error) => {
                console.debug("[glean] Protyle lifecycle failed:", error);
                if (active) { window.clearTimeout(timeout); stage = "failed"; }
            },
        });
        controller = current;
        return () => {
            active = false;
            window.clearTimeout(timeout);
            current.destroy();
            if (controller === current) controller = null;
        };
    });

    $effect(() => { controller?.setMode(mode); });
</script>

<div class="glean-protyle-shell glean-protyle-shell--{stage} {className}" aria-busy={stage === "loading"}>
    {#if stage !== "ready"}
        <div class="glean-protyle-status glean-protyle-status--{stage}" role="status" aria-live="polite" aria-labelledby="glean-protyle-status-label">
            {#if stage === "loading"}<span class="glean-protyle-status__dot" aria-hidden="true"></span>{/if}
            <span id="glean-protyle-status-label" class="glean-protyle-status__label">{t(i18n, stage === "loading" ? "panel.loading" : "preview.failed")}</span>
            {#if stage === "failed"}
                <button class="glean-btn" onclick={() => attempt += 1}>{t(i18n, "action.retry")}</button>
                <button class="glean-btn glean-btn--ghost" onclick={onOpenDocument}>{t(i18n, "preview.openDocument")}</button>
            {/if}
        </div>
    {/if}
    <div class="glean-protyle-host" bind:this={host}></div>
</div>

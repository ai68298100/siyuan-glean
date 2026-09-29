<script lang="ts">
    /**
     * 内嵌阅读页签（D-0029/T-1730）：左 = 真实思源编辑器（Protyle 实例），右 = 伴生栏。
     * 页签打开文档是"打开动作"，不写五态（D-0021）；伴生栏动作与三画布共用同一服务，
     * 按真实成功数反馈。编辑/标注经 Protyle 走内核事务，插件不另存正文副本。
     */
    import { showMessage, openTab } from "siyuan";
    import { Protyle } from "siyuan";
    import { untrack } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { fulltextBodyState } from "../domain/content";
    import { hasSourceAction, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
    import type { ClipStatus } from "../domain/schema";
    import {
        batchSetStatus,
        measureClipBody,
        readClipContext,
        writeClip,
        type ReadingClipContext,
    } from "../services/clip-store";
    import { snapshotClip } from "../services/snapshot-service";
    import { recordReadingDone } from "../services/checkin-bridge";
    import ClipStatusActions from "./ClipStatusActions.svelte";
    import ClipRankControls from "./ClipRankControls.svelte";

    interface Props {
        facade: GleanFacade;
    }

    let { facade }: Props = $props();
    const i18n = $derived(facade.i18n);

    let docId = $state(facade.consumeReaderFocus());
    let mode = $state<"read" | "edit">(facade.settings.reader.defaultMode);
    let protyleHost = $state<HTMLDivElement | null>(null);
    let context = $state<ReadingClipContext | null>(null);
    let measuring = $state(false);
    let snapping = $state(false);
    let statusBusy = $state(false);
    let protyle: Protyle | null = null;

    const bodyState = $derived(context ? fulltextBodyState(context.contentType, context.words) : "na");

    function modeValue(value: "read" | "edit"): "preview" | "wysiwyg" {
        return value === "edit" ? "wysiwyg" : "preview";
    }

    async function loadContext(id: string): Promise<void> {
        try {
            context = await readClipContext(id);
        } catch (error) {
            console.debug("[glean] 阅读页签读取上下文失败:", error);
            context = null;
        }
    }

    // 挂载效果只依赖 docId 与宿主节点；模式切换走 switchMode，不重建实例（保留位置）。
    $effect(() => {
        const id = docId;
        const host = protyleHost;
        if (!id || !host) return;
        const initialMode = untrack(() => mode);
        protyle?.destroy();
        protyle = null;
        untrack(() => host.replaceChildren());
        protyle = new Protyle(facade.pluginInstance.app, host, {
            blockId: id,
            rootId: id,
            mode: modeValue(initialMode),
            render: { breadcrumb: false, background: false },
        });
        void untrack(() => loadContext(id));
        return () => {
            protyle?.destroy();
            protyle = null;
        };
    });

    // 页签聚焦与尺寸事件由壳派发；数据变化后只刷新伴生栏，不动正文实例。
    $effect(() => {
        const onFocus = () => {
            const id = facade.consumeReaderFocus();
            if (id) docId = id;
        };
        const onResize = () => protyle?.resize();
        const onData = () => {
            if (docId) void loadContext(docId);
        };
        document.addEventListener("glean:focus-reader", onFocus);
        document.addEventListener("glean:reader-resize", onResize);
        document.addEventListener("glean:data-changed", onData);
        return () => {
            document.removeEventListener("glean:focus-reader", onFocus);
            document.removeEventListener("glean:reader-resize", onResize);
            document.removeEventListener("glean:data-changed", onData);
        };
    });

    function setMode(next: "read" | "edit"): void {
        if (mode === next || !protyle) return;
        mode = next;
        protyle.switchMode(modeValue(next));
        showMessage(t(i18n, next === "edit" ? "reader.editHint" : "reader.readHint"), 2500);
    }

    function openSource(): void {
        const url = context ? sourceUrlForCarrier(context.contentType, context.url) : "";
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    }

    /** 显式"检测正文"（T-1727）：导出重算并写回，不改用户正文。 */
    async function checkBody(): Promise<void> {
        if (!context || measuring) return;
        measuring = true;
        try {
            const measured = await measureClipBody(facade.pluginInstance, context.id);
            if (context) context = { ...context, words: measured.words };
            showMessage(
                measured.missing
                    ? t(i18n, "clip.bodyMissingConfirm")
                    : t(i18n, "clip.bodyOk", { n: measured.words }),
                3500
            );
            facade.notifyDataChanged();
        } catch (error) {
            console.warn("[glean] 正文检测失败:", error);
            showMessage(t(i18n, "clip.bodyCheckFailed"), 3000);
        } finally {
            measuring = false;
        }
    }

    /** "重新剪藏"是打开原文的显式导航；本文不被覆盖，快照保留。 */
    function recapture(): void {
        const url = context ? sourceUrlForCarrier(context.contentType, context.url) : "";
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        showMessage(t(i18n, "clip.reclipHint"), 4500);
    }

    async function writeStatus(status: ClipStatus): Promise<void> {
        if (!context || statusBusy) return;
        const current = context;
        statusBusy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], status);
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return;
            }
            if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            context = { ...(context?.id === current.id ? context : current), status };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.statusChanged"), 2500);
        } finally {
            statusBusy = false;
        }
    }

    async function startReading(): Promise<void> {
        if (!context) return;
        // 页签内文档已打开；"开始阅读"只负责显式写入 reading，不再导航。
        await writeStatus("reading");
    }

    async function setPriority(value: number): Promise<void> {
        if (!context || statusBusy) return;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, context.id, { priority: value }, { force: true });
            context = { ...context, priority: value };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function setRating(value: number): Promise<void> {
        if (!context || statusBusy) return;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, context.id, { rating: value }, { force: true });
            context = { ...context, rating: value };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function takeSnapshot(): Promise<void> {
        if (!context || snapping) return;
        if (context.snapshot) {
            void openTab({ app: facade.pluginInstance.app, asset: { path: context.snapshot } });
            return;
        }
        snapping = true;
        try {
            const { path } = await snapshotClip(facade.pluginInstance, context.id);
            context = { ...context, snapshot: path };
            showMessage(t(i18n, "snapshot.done"), 3000);
            facade.notifyDataChanged();
        } catch {
            showMessage(t(i18n, "snapshot.failed"), 3000);
        } finally {
            snapping = false;
        }
    }

    function backToLibrary(): void {
        if (context) void facade.openLibraryArticle(context.id);
    }

    function carrierLabel(value: string | undefined): string {
        return t(i18n, `clip.type.${resolveCarrier(value)}`);
    }
</script>

<div class="glean-reader">
    <div class="glean-reader__main">
        {#if docId}
            <div class="glean-reader__host" bind:this={protyleHost}></div>
        {:else}
            <div class="glean-reader__empty">
                <div class="glean-reader__empty-art">📖</div>
                <div class="glean-reader__empty-title">{t(i18n, "reader.empty")}</div>
                <div class="glean-reader__empty-hint">{t(i18n, "reader.emptyHint")}</div>
            </div>
        {/if}
    </div>
    {#if docId}
        <aside class="glean-reader__side" aria-label={t(i18n, "reader.title")}>
            <div class="glean-reader__title" title={context?.title}>{context?.title || t(i18n, "panel.untitled")}</div>
            <div class="glean-reader__meta">
                <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(context?.contentType)}`}>
                    {carrierLabel(context?.contentType)}
                </span>
                {#if context?.site}<span>{context.site}</span>{/if}
            </div>
            <div class="glean-reader__mode" role="group" aria-label={t(i18n, "settings.readerMode")}>
                <button
                    class="glean-seg__btn"
                    class:glean-seg__btn--on={mode === "read"}
                    title={t(i18n, "reader.readHint")}
                    onclick={() => setMode("read")}
                >{t(i18n, "reader.modeRead")}</button>
                <button
                    class="glean-seg__btn"
                    class:glean-seg__btn--on={mode === "edit"}
                    title={t(i18n, "reader.editHint")}
                    onclick={() => setMode("edit")}
                >{t(i18n, "reader.modeEdit")}</button>
            </div>
            {#if context}
                <ClipStatusActions
                    {i18n}
                    status={context.status}
                    disabled={statusBusy}
                    onStartReading={() => void startReading()}
                    onSetStatus={(status) => void writeStatus(status)}
                />
                <ClipRankControls
                    {i18n}
                    priority={context.priority}
                    rating={context.rating}
                    disabled={statusBusy}
                    onPriority={(value) => void setPriority(value)}
                    onRating={(value) => void setRating(value)}
                />
                <div class="glean-reader__ops">
                    {#if hasSourceAction(context.contentType, context.url)}
                        <button class="glean-btn glean-btn--ghost" onclick={openSource}>↗ {t(i18n, "clip.openSource")}</button>
                    {:else if resolveCarrier(context.contentType) === "link"}
                        <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                    {/if}
                    <button class="glean-btn glean-btn--ghost" disabled={snapping} onclick={() => void takeSnapshot()}>
                        {context.snapshot ? "⟐" : "📷"}
                    </button>
                </div>
                {#if bodyState === "unmeasured"}
                    <button class="glean-btn glean-btn--ghost" disabled={measuring} title={t(i18n, "clip.bodyCheckHint")} onclick={() => void checkBody()}>
                        ⌕ {t(i18n, "clip.bodyCheck")}
                    </button>
                {:else if bodyState === "missing"}
                    <div class="glean-reader__issue">
                        <span title={t(i18n, "clip.bodyMissingHint")}>{t(i18n, "clip.bodyMissing")}</span>
                        {#if hasSourceAction(context.contentType, context.url)}
                            <button class="glean-btn glean-btn--ghost" onclick={recapture}>↻ {t(i18n, "clip.reclip")}</button>
                        {/if}
                    </div>
                {/if}
                <button class="glean-reader__back" onclick={backToLibrary}>{t(i18n, "reading.backToLibrary")}</button>
            {:else}
                <div class="glean-reader__issue"><span>{t(i18n, "reader.emptyHint")}</span></div>
            {/if}
        </aside>
    {/if}
</div>

<script lang="ts">
    /**
     * 原生思源编辑器上的低干扰阅读上下文（S3/T-1721）。
     *
     * 这里只渲染标题、载体、来源和状态，正文始终由思源编辑器承载。
     * 当前根块属性每次加载都从 clip-store 读取，索引不能覆盖编辑器里的事实。
     */
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { hasSourceAction, openTargetForCarrier, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
    import { fulltextBodyState, type FulltextBodyState } from "../domain/content";
    import { batchSetStatus, measureClipBody, readClipContext, type ReadingClipContext } from "../services/clip-store";
    import type { ClipStatus } from "../domain/schema";
    import { recordReadingDone } from "../services/checkin-bridge";
    import ClipStatusActions from "./ClipStatusActions.svelte";
    import { openFormattingDialog } from "./formatting-dialog";

    interface Props {
        facade: GleanFacade;
        docId: string;
    }

    let { facade, docId }: Props = $props();
    const i18n = $derived(facade.i18n);
    const instanceId = $props.id();
    const titleId = `glean-reading-context-title-${instanceId}`;
    let context = $state<ReadingClipContext | null>(null);
    let loading = $state(true);
    let busy = $state(false);
    let reloadToken = 0;
    let mounted = true;

    async function reload(): Promise<void> {
        const token = ++reloadToken;
        if (!mounted) return;
        if (!docId) {
            if (token !== reloadToken || !mounted) return;
            context = null;
            loading = false;
            return;
        }
        loading = true;
        try {
            const next = await readClipContext(docId);
            if (token !== reloadToken || !mounted) return;
            context = next;
        } catch (error) {
            // 编辑器切换期间根块可能已经销毁；上下文退出即可，不打扰正文。
            console.debug("[glean] 阅读上下文读取失败:", error);
            if (token !== reloadToken || !mounted) return;
            context = null;
        } finally {
            if (token === reloadToken && mounted) loading = false;
        }
    }

    $effect(() => {
        mounted = true;
        void reload();
        const handler = () => void reload();
        const refreshHandler = (event: Event) => {
            if ((event as CustomEvent<{ id?: string }>).detail?.id === docId) void reload();
        };
        document.addEventListener("glean:data-changed", handler);
        document.addEventListener("glean:reading-context-refresh", refreshHandler);
        return () => {
            mounted = false;
            reloadToken += 1;
            document.removeEventListener("glean:data-changed", handler);
            document.removeEventListener("glean:reading-context-refresh", refreshHandler);
        };
    });

    function carrierLabel(value: string | undefined): string {
        return t(i18n, `clip.type.${resolveCarrier(value)}`);
    }

    function statusLabel(value: ClipStatus): string {
        return t(i18n, `status.${value}`);
    }

    let bodyState = $derived<FulltextBodyState>(context ? fulltextBodyState(context.contentType, context.words) : "na");
    let measuring = $state(false);

    /** 显式"检测正文"（T-1727）：导出重算字数并写回；不修改正文，不触碰快照。 */
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

    /** "重新剪藏"是打开原文的显式导航：官方剪藏扩展产出新文档，本文不被覆盖。 */
    function recapture(): void {
        if (!context) return;
        const url = sourceUrlForCarrier(context.contentType, context.url);
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        showMessage(t(i18n, "clip.reclipHint"), 4500);
    }

    function openContextSource(current: ReadingClipContext): void {
        const url = sourceUrlForCarrier(current.contentType, current.url);
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function openSource(): void {
        if (context) openContextSource(context);
    }

    async function writeStatus(status: ClipStatus): Promise<boolean> {
        if (!context || busy) return false;
        const current = context;
        busy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], status);
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return false;
            }
            if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            // 对账可能在写入期间完成；保留最新标题/来源，只覆盖刚刚成功的状态。
            context = { ...(context?.id === current.id ? context : current), status };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.statusChanged"), 2500);
            return true;
        } finally {
            busy = false;
        }
    }

    async function setStatus(status: ClipStatus): Promise<void> {
        await writeStatus(status);
    }

    async function startReading(): Promise<void> {
        if (!context || busy) return;
        const current = context;
        if (current.status !== "reading" && !await writeStatus("reading")) return;
        // link 的主动作是来源；全文即使有来源也继续留在思源正文。
        if (openTargetForCarrier(current.contentType, current.url) === "source") openContextSource(current);
        else facade.openReadingDocument(current.id);
    }

    function backToLibrary(): void {
        if (context) void facade.openLibraryArticle(context.id);
    }
</script>

{#if loading}
    <aside class="glean-reading-context glean-reading-context--loading" aria-label={t(i18n, "panel.loading")} aria-busy="true">
        <div class="glean-reading-context__loading-main" aria-hidden="true">
            <span class="glean-reading-context__skeleton glean-reading-context__skeleton--title"></span>
            <span class="glean-reading-context__skeleton glean-reading-context__skeleton--meta"></span>
        </div>
        <div class="glean-reading-context__loading-label" role="status" aria-live="polite">{t(i18n, "panel.loading")}</div>
    </aside>
{:else if context}
    <aside class="glean-reading-context" aria-labelledby={titleId} aria-busy={busy || measuring}>
        <div class="glean-reading-context__main">
            <div id={titleId} class="glean-reading-context__title" role="heading" aria-level="2" title={context.title}>{context.title || t(i18n, "panel.untitled")}</div>
            <div class="glean-reading-context__meta">
                <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(context.contentType)}`}>
                    {carrierLabel(context.contentType)}
                </span>
                <span class="glean-reading-context__status">{statusLabel(context.status)}</span>
                {#if context.url}
                    <span class="glean-reading-context__source" title={context.url}>{context.url}</span>
                {/if}
            </div>
        </div>
        <div class="glean-reading-context__actions">
            {#if hasSourceAction(context.contentType, context.url)}
                <button type="button" class="glean-reading-context__source-btn glean-reading-context__source-btn--primary" title={t(i18n, "reading.sourceHint")} onclick={openSource}>
                    <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg>{t(i18n, "clip.openSource")}
                </button>
            {:else if resolveCarrier(context.contentType) === "link"}
                <span class="glean-reading-context__missing">{t(i18n, "clip.sourceMissing")}</span>
            {/if}
            {#if bodyState === "unmeasured"}
                <button
                    type="button"
                    class="glean-reading-context__source-btn"
                    disabled={measuring}
                    title={t(i18n, "clip.bodyCheckHint")}
                    aria-label={t(i18n, "clip.bodyCheckHint")}
                    aria-busy={measuring}
                    onclick={checkBody}
                ><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanSearch" /></svg></button>
            {:else if bodyState === "missing"}
                <span class="glean-reading-context__missing" title={t(i18n, "clip.bodyMissingHint")}>
                    {t(i18n, "clip.bodyMissing")}
                </span>
                {#if hasSourceAction(context.contentType, context.url)}
                    <button
                        type="button"
                        class="glean-reading-context__source-btn glean-reading-context__reclip"
                        title={t(i18n, "clip.bodyMissingHint")}
                        aria-label={t(i18n, "clip.bodyMissingHint")}
                        onclick={recapture}
                    ><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanRefresh" /></svg></button>
                {/if}
            {/if}
            <button type="button" class="glean-reading-context__back" onclick={backToLibrary}>
                {t(i18n, "reading.backToLibrary")}
            </button>
            <button type="button" class="glean-reading-context__source-btn" onclick={() => openFormattingDialog(facade, context!.id)}>{t(i18n, "formatting.open")}</button>
            <ClipStatusActions
                i18n={i18n}
                status={context.status}
                disabled={busy}
                onStartReading={startReading}
                onSetStatus={setStatus}
            />
        </div>
    </aside>
{/if}

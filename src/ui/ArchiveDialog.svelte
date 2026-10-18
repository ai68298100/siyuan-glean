<script lang="ts">
    /**
     * 归档后处理三选对话框（T-1866，D-0032 / DATA-CONTRACT §7）。
     * 阅读页签、命令面板、Dock 行、工作台预览与看板的归档按钮都走本对话框；
     * 今日拾遗与自动化批量仍使用快速归档语义，宿主内恢复走 RestoreDialog：
     * 保留原位置（默认）/ 移入【归档】文档 / 删除文章（移入【回收】），
     * 彻底删除为二级动作（二次确认，purgeDoc 防误删同名新文档由服务层保证）。
     * 今日拾遗与自动化批量不进此对话框（快速归档=默认项语义，T-1875 禁止批量默认不可逆）。
     */
    import { showMessage } from "siyuan";
    import { onMount, tick } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { writeClip } from "../services/clip-store";
    import { archiveMoveDoc, buildDocPurgeInfo, docHostContext, purgeDoc, recycleDoc, type DocHostContext } from "../services/lifecycle-service";

    interface Props {
        facade: GleanFacade;
        docId: string;
        /** svelteDialog 注入的关闭回调 */
        onClose: () => void;
    }

    let { facade, docId, onClose }: Props = $props();
    const i18n = $derived(facade.i18n);
    const instanceId = $props.id();
    const idPrefix = `glean-archive-${instanceId}`;
    let pending = $state(false);
    let purgeInfo = $state<{ title: string; hpath: string; url: string } | null>(null);
    let purgeConfirmOpen = $state(false);
    let purgeError = $state("");
    let purgeTrigger = $state<HTMLButtonElement>();
    let purgeCancel = $state<HTMLButtonElement>();
    // T-1876 可发现性：显示将要使用的宿主路径与"已在宿主下"状态
    let ctx = $state<DocHostContext | null>(null);

    onMount(() => {
        void docHostContext(docId).then((value) => { ctx = value; }).catch(() => undefined);
    });

    async function runSettled(feedbackKey: string, action: () => Promise<unknown>): Promise<void> {
        try {
            const result = await action() as { indexSyncFailed?: boolean } | undefined;
            facade.notifyDataChanged();
            showMessage(t(i18n, result?.indexSyncFailed ? "msg.statusIndexPending" : feedbackKey), result?.indexSyncFailed ? 4000 : 3000);
            onClose();
        } catch (error) {
            console.warn("[glean] 归档后处理失败:", error);
            purgeError = t(i18n, "msg.actionFailed");
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        } finally {
            pending = false;
        }
    }

    async function settle(feedbackKey: string, action: () => Promise<unknown>): Promise<void> {
        if (pending) return;
        pending = true;
        await runSettled(feedbackKey, action);
    }

    const keepInPlace = () => settle("archive.doneInPlace", async () => {
        // 保留原位置 = 三选项的默认语义：只写状态，不动文档（与今日拾遗/批量快速归档同语义）
        return writeClip(facade.pluginInstance, docId, { status: "archived" }, { forceStatus: true });
    });

    const moveToArchive = () => settle("archive.doneMoved", () => archiveMoveDoc(facade.pluginInstance, docId));
    const moveToRecycle = () => settle("archive.doneRecycled", () => recycleDoc(facade.pluginInstance, docId));

    async function beginPurgeConfirmation(): Promise<void> {
        if (pending) return;
        pending = true;
        purgeError = "";
        try {
            const info = await buildDocPurgeInfo(docId);
            if (!info) {
                purgeError = t(i18n, "msg.actionFailed");
                return;
            }
            purgeInfo = info;
            purgeConfirmOpen = true;
        } catch (error) {
            console.warn("[glean] 删除前置信息读取失败:", error);
            purgeError = t(i18n, "msg.actionFailed");
        } finally {
            pending = false;
            if (purgeConfirmOpen) {
                await tick();
                purgeCancel?.focus();
            }
        }
    }

    async function cancelPurgeConfirmation(): Promise<void> {
        purgeConfirmOpen = false;
        purgeInfo = null;
        await tick();
        purgeTrigger?.focus();
    }

    async function confirmPurge(): Promise<void> {
        if (pending || !purgeConfirmOpen || !purgeInfo) return;
        pending = true;
        purgeError = "";
        await runSettled("archive.donePurged", () => purgeDoc(facade.pluginInstance, docId));
    }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && !pending && !purgeConfirmOpen) onClose(); }} />

<div class="glean-archive-dlg">
    <div class="glean-archive-dlg__hint">
        {t(i18n, "archive.hint")}
        {#if ctx?.hostKind === "archive" || ctx?.hostKind === "recycle"}
            <span class="glean-archive-dlg__inhost">{t(i18n, "archive.alreadyInHost")}</span>
        {/if}
    </div>
    <button class="glean-archive-dlg__opt" disabled={pending || purgeConfirmOpen} onclick={() => void keepInPlace()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">⤓</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.inPlace")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "archive.inPlaceHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending || purgeConfirmOpen} onclick={() => void moveToArchive()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">📁</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.moveToHost")}</span>
            <span class="glean-archive-dlg__desc">
                {t(i18n, "archive.moveToHostHint")}
                {#if ctx}<span class="glean-archive-dlg__path">{t(i18n, "archive.targetPath", { path: ctx.archiveTarget })}</span>{/if}
            </span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending || purgeConfirmOpen} onclick={() => void moveToRecycle()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">🗑</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.recycle")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "archive.recycleHint")}</span>
        </span>
    </button>
    {#if purgeError}
        <div class="glean-load-error" role="alert">{purgeError}</div>
    {/if}
    {#if purgeConfirmOpen && purgeInfo}
        <div class="glean-confirm" role="group" aria-busy={pending} aria-labelledby={`${idPrefix}-purge-title`} aria-describedby={`${idPrefix}-purge-description ${idPrefix}-purge-details`}>
            <h3 id={`${idPrefix}-purge-title`}>{t(i18n, "archive.purgeConfirmTitle")}</h3>
            <p id={`${idPrefix}-purge-description`}>{t(i18n, "archive.purgeConfirmWarning")}</p>
            <dl id={`${idPrefix}-purge-details`} class="glean-confirm__details">
                <dt>{t(i18n, "archive.purgeDocTitle")}</dt><dd>{purgeInfo.title}</dd>
                <dt>{t(i18n, "archive.purgeDocPath")}</dt><dd>{purgeInfo.hpath}</dd>
                {#if purgeInfo.url}<dt>{t(i18n, "archive.purgeDocSource")}</dt><dd>{purgeInfo.url}</dd>{/if}
            </dl>
            <div class="glean-confirm__actions">
                <button class="glean-btn glean-btn--ghost" bind:this={purgeCancel} disabled={pending} onclick={() => void cancelPurgeConfirmation()}>{t(i18n, "action.cancel")}</button>
                <button class="glean-btn glean-btn--danger" disabled={pending} aria-busy={pending} onclick={() => void confirmPurge()}>{t(i18n, pending ? "panel.loading" : "archive.purgeConfirmAction")}</button>
            </div>
        </div>
    {:else}
    <button class="glean-archive-dlg__purge" bind:this={purgeTrigger} disabled={pending} onclick={() => void beginPurgeConfirmation()}>
        {t(i18n, "archive.purgeLink")}
    </button>
    {/if}
</div>

<style>
    .glean-confirm {
        display: grid;
        gap: 10px;
        padding: 16px;
        border: 1px solid var(--glean-border-soft);
        border-radius: 6px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
    }

    .glean-confirm h3,
    .glean-confirm p {
        margin: 0;
    }

    .glean-confirm__details {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 4px 10px;
        margin: 0;
        overflow-wrap: anywhere;
        font-size: 13px;
    }

    .glean-confirm__details dt {
        color: var(--b3-theme-on-surface);
        opacity: .72;
    }

    .glean-confirm__details dd {
        min-width: 0;
        margin: 0;
    }

    .glean-confirm__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }

    .glean-btn--danger {
        border: 1px solid color-mix(in srgb, var(--b3-theme-error) 62%, var(--glean-border-soft));
        background: var(--b3-theme-error);
        color: var(--b3-theme-on-error, #fff);
    }

    .glean-btn--danger:hover:not(:disabled) {
        filter: brightness(0.94);
    }

    @media (max-width: 560px) {
        .glean-confirm__actions > .glean-btn {
            flex: 1 1 130px;
            min-height: 44px;
        }
    }
</style>

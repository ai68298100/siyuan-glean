<script lang="ts">
    /**
     * 恢复策略对话框（T-1872，D-0033 / DATA-CONTRACT §7.6）。
     * 仅宿主内的文章弹出（非宿主文章恢复走既有直接动作）：仅恢复 / 恢复并移出宿主。
     * 恢复 = 状态写回 later；移出目标 = 宿主所在文件夹（从当前位置推导，无隐式状态）。
     */
    import { showMessage } from "siyuan";
    import { onMount } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { writeClip } from "../services/clip-store";
    import { docHostContext, moveDocOutOfHost, type DocHostContext } from "../services/lifecycle-service";

    interface Props {
        facade: GleanFacade;
        docId: string;
        /** svelteDialog 注入的关闭回调 */
        onClose: () => void;
    }

    let { facade, docId, onClose }: Props = $props();
    const i18n = $derived(facade.i18n);
    let pending = $state(false);
    let contextLoading = $state(true);
    let contextError = $state(false);
    let actionError = $state("");
    let lastMoveOut = $state(false);
    // T-1876 可发现性：移出目标目录
    let ctx = $state<DocHostContext | null>(null);

    async function loadContext(): Promise<void> {
        if (contextLoading) return;
        contextLoading = true;
        contextError = false;
        try {
            ctx = await docHostContext(docId);
        } catch {
            contextError = true;
        } finally {
            contextLoading = false;
        }
    }

    onMount(() => {
        contextLoading = false;
        void loadContext();
    });

    async function settle(feedbackKey: string, moveOut: boolean): Promise<void> {
        if (pending) return;
        pending = true;
        actionError = "";
        lastMoveOut = moveOut;
        try {
            if (moveOut) await moveDocOutOfHost(docId);
            const result = await writeClip(facade.pluginInstance, docId, { status: "later" }, { forceStatus: true });
            facade.notifyDataChanged();
            showMessage(t(i18n, result.indexSyncFailed ? "msg.statusIndexPending" : feedbackKey), result.indexSyncFailed ? 4000 : 3000);
            onClose();
        } catch (error) {
            console.warn("[glean] 恢复失败:", error);
            // 两步操作（移出宿主 + 写状态）部分失败时提示已完成的进度，避免重复执行的语义混乱
            actionError = moveOut ? "restore.partialMoved" : "msg.actionFailed";
            showMessage(t(i18n, actionError), 4000);
        } finally {
            pending = false;
        }
    }
</script>

<div class="glean-archive-dlg" aria-busy={pending || contextLoading}>
    <div class="glean-archive-dlg__hint">{t(i18n, "restore.hint")}</div>
    {#if contextLoading}<p class="glean-load-error" role="status" aria-live="polite">{t(i18n, "panel.loading")}</p>{/if}
    {#if contextError}<div class="glean-load-error" role="alert" aria-live="assertive"><span>{t(i18n, "msg.actionFailed")}</span><button class="glean-btn" disabled={contextLoading} onclick={() => void loadContext()}>{t(i18n, "action.retry")}</button></div>{/if}
    {#if actionError}<div class="glean-load-error" role="alert" aria-live="assertive"><span>{t(i18n, actionError)}</span><button class="glean-btn" disabled={pending} onclick={() => void settle(lastMoveOut ? "restore.doneMoved" : "restore.done", lastMoveOut)}>{t(i18n, "action.retry")}</button></div>{/if}
    <button class="glean-archive-dlg__opt" disabled={pending || contextLoading || contextError} aria-busy={pending} onclick={() => void settle("restore.done", false)}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">↩</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "restore.inPlace")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "restore.inPlaceHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending || contextLoading || contextError} aria-busy={pending} onclick={() => void settle("restore.doneMoved", true)}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">📂</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "restore.moveOut")}</span>
            <span class="glean-archive-dlg__desc">
                {t(i18n, "restore.moveOutHint")}
                {#if ctx?.moveOutTarget !== null && ctx?.moveOutTarget !== undefined}
                    <span class="glean-archive-dlg__path">
                        {t(i18n, "archive.targetPath", { path: ctx.moveOutTarget || t(i18n, "common.rootFolder") })}
                    </span>
                {/if}
            </span>
        </span>
    </button>
</div>

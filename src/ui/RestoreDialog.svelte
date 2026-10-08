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
    // T-1876 可发现性：移出目标目录
    let ctx = $state<DocHostContext | null>(null);

    onMount(() => {
        void docHostContext(docId).then((value) => { ctx = value; }).catch(() => undefined);
    });

    async function settle(feedbackKey: string, moveOut: boolean): Promise<void> {
        if (pending) return;
        pending = true;
        try {
            if (moveOut) await moveDocOutOfHost(docId);
            await writeClip(facade.pluginInstance, docId, { status: "later" }, { forceStatus: true });
            facade.notifyDataChanged();
            showMessage(t(i18n, feedbackKey), 3000);
            onClose();
        } catch (error) {
            console.warn("[glean] 恢复失败:", error);
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        } finally {
            pending = false;
        }
    }
</script>

<div class="glean-archive-dlg">
    <div class="glean-archive-dlg__hint">{t(i18n, "restore.hint")}</div>
    <button class="glean-archive-dlg__opt" disabled={pending} onclick={() => void settle("restore.done", false)}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">↩</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "restore.inPlace")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "restore.inPlaceHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending} onclick={() => void settle("restore.doneMoved", true)}>
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

<script lang="ts">
    /**
     * 归档后处理三选对话框（T-1866，D-0032 / DATA-CONTRACT §7）。
     * 统一 Dock、工作台、看板、阅读页签、命令面板的归档入口语义：
     * 保留原位置（默认）/ 移入【归档】文档 / 删除文章（移入【回收】），
     * 彻底删除为二级动作（二次确认，purgeDoc 防误删同名新文档由服务层保证）。
     * 今日拾遗与自动化批量不进此对话框（快速归档=默认项语义，T-1875 禁止批量默认不可逆）。
     */
    import { showMessage } from "siyuan";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { writeClip } from "../services/clip-store";
    import { archiveMoveDoc, buildDocPurgeInfo, purgeDoc, recycleDoc } from "../services/lifecycle-service";

    interface Props {
        facade: GleanFacade;
        docId: string;
        /** svelteDialog 注入的关闭回调 */
        onClose: () => void;
    }

    let { facade, docId, onClose }: Props = $props();
    const i18n = $derived(facade.i18n);
    let pending = $state(false);

    async function settle(feedbackKey: string, action: () => Promise<unknown>): Promise<void> {
        if (pending) return;
        pending = true;
        try {
            await action();
            facade.notifyDataChanged();
            showMessage(t(i18n, feedbackKey), 3000);
            onClose();
        } catch (error) {
            console.warn("[glean] 归档后处理失败:", error);
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        } finally {
            pending = false;
        }
    }

    const keepInPlace = () => settle("archive.doneInPlace", async () => {
        // 保留原位置 = 三选项的默认语义：只写状态，不动文档（与今日拾遗/批量快速归档同语义）
        await writeClip(facade.pluginInstance, docId, { status: "archived" }, { forceStatus: true });
    });

    const moveToArchive = () => settle("archive.doneMoved", () => archiveMoveDoc(facade.pluginInstance, docId));
    const moveToRecycle = () => settle("archive.doneRecycled", () => recycleDoc(facade.pluginInstance, docId));

    async function purge(): Promise<void> {
        if (pending) return;
        const info = await buildDocPurgeInfo(docId);
        if (!info) {
            showMessage(t(i18n, "msg.actionFailed"), 3000);
            return;
        }
        const summary = `${info.title}\n${info.hpath}${info.url ? `\n${info.url}` : ""}`;
        // §7.3：确认框必须列标题/路径/来源；不可逆提示；思源数据历史兜底
        if (!window.confirm(t(i18n, "archive.purgeConfirm", { info: summary }))) return;
        await settle("archive.donePurged", () => purgeDoc(facade.pluginInstance, docId));
    }
</script>

<div class="glean-archive-dlg">
    <div class="glean-archive-dlg__hint">{t(i18n, "archive.hint")}</div>
    <button class="glean-archive-dlg__opt" disabled={pending} onclick={() => void keepInPlace()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">⤓</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.inPlace")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "archive.inPlaceHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending} onclick={() => void moveToArchive()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">📁</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.moveToHost")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "archive.moveToHostHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__opt" disabled={pending} onclick={() => void moveToRecycle()}>
        <span class="glean-archive-dlg__icon" aria-hidden="true">🗑</span>
        <span class="glean-archive-dlg__body">
            <span class="glean-archive-dlg__name">{t(i18n, "archive.recycle")}</span>
            <span class="glean-archive-dlg__desc">{t(i18n, "archive.recycleHint")}</span>
        </span>
    </button>
    <button class="glean-archive-dlg__purge" disabled={pending} onclick={() => void purge()}>
        {t(i18n, "archive.purgeLink")}
    </button>
</div>

<script lang="ts">
/** 收集箱区（T-1500）：云端收集箱条目列表 → 一键迁入读库。不可用（未登录/无订阅）时整块隐藏。 */
import { openTab, showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { removeShorthands, type Shorthand } from "../api/inbox";
import { checkInbox, InboxRecoveryError, migrateShorthand } from "../services/inbox-service";
import { clearInboxRecovery, loadInboxRecovery } from "../services/inbox-recovery";
import type { InboxRecovery } from "../domain/inbox-recovery";

interface Props {
    facade: GleanFacade;
    onMutated: () => void;
}

let { facade, onMutated }: Props = $props();

const instanceId = $props.id();
const titleId = `glean-inbox-title-${instanceId}`;
const contentId = `glean-inbox-content-${instanceId}`;
const i18n = $derived(facade.i18n);

let available = $state(false);
let checked = $state(false);
let inboxCheckFailed = $state(false);
let expanded = $state(false);
let items = $state<Shorthand[]>([]);
let busyId = $state("");
let duplicate = $state<{ item: Shorthand; existingId: string } | null>(null);
let pendingRemoval = $state<Record<string, string>>({});
let pendingCapture = $state<Record<string, string>>({});
let unknownRecovery = $state<Record<string, boolean>>({});
let recovery = $state<InboxRecovery | null>(null);

function applyRecovery(checkpoint: InboxRecovery | null) {
    recovery = checkpoint;
    pendingRemoval = {};
    pendingCapture = {};
    unknownRecovery = {};
    if (!checkpoint) return;
    if (checkpoint.phase === "remove-pending" && checkpoint.docId) pendingRemoval[checkpoint.shorthandId] = checkpoint.docId;
    if (checkpoint.phase === "capture-pending" && checkpoint.docId) pendingCapture[checkpoint.shorthandId] = checkpoint.docId;
    if (checkpoint.phase === "unknown") unknownRecovery[checkpoint.shorthandId] = true;
}

function recoveryMessage(error: unknown): string {
    if (!(error instanceof InboxRecoveryError)) {
        console.warn("[glean] 收集箱操作失败:", error);
        return t(i18n, "msg.actionFailed");
    }
    const messages: Record<InboxRecoveryError["reason"], string> = {
        readFailed: "inbox.recoveryReadFailed",
        invalid: "inbox.recoveryInvalid",
        checkpointFailed: "inbox.recoveryCheckpointFailed",
        clearFailed: "inbox.recoveryCheckpointFailed",
        busy: "inbox.recoveryBusy",
        createUnknown: "inbox.recoveryCreateUnknown",
        captureFailed: "inbox.recoveryCaptureFailed",
        removeFailed: "inbox.cloudRemoveFailed",
        conflict: "inbox.duplicate",
    };
    return t(i18n, messages[error.reason]);
}

function rememberRecovery(checkpoint: InboxRecovery | undefined) {
    if (checkpoint) applyRecovery(checkpoint);
}

async function refresh() {
    try {
        const status = await checkInbox();
        available = status.available;
        items = status.page?.shorthands ?? [];
        inboxCheckFailed = false;
        try {
            applyRecovery(await loadInboxRecovery(facade.pluginInstance));
        } catch (error) {
            applyRecovery(null);
            showMessage(recoveryMessage(error), 5000);
        }
    } catch {
        // 查询失败与"未订阅收集箱"区分开：给用户重试入口而不是静默隐藏整个区域
        available = false;
        inboxCheckFailed = true;
    } finally {
        checked = true;
    }
}

$effect(() => {
    void refresh();
});

async function migrate(item: Shorthand, allowDuplicate = false) {
    if (busyId) return;
    busyId = item.oId;
    try {
        const notebookId = facade.settings.anchorNotebooks[0];
        if (!notebookId) {
            showMessage(t(i18n, "panel.noAnchorHint"), 4000);
            return;
        }
        const result = await migrateShorthand(facade.pluginInstance, item, { notebookId, allowDuplicate });
        if (result.duplicate && result.existing) {
            duplicate = { item, existingId: result.existing.id };
            return;
        }
        if (result.recovery) rememberRecovery(result.recovery);
        else if (result.cloudRemoved) applyRecovery(null);
        if (result.cloudRemoved) {
            showMessage(t(i18n, "inbox.migrated"), 3000);
            items = items.filter((entry) => entry.oId !== item.oId);
        } else {
            // 云端删除失败时只弹失败提示（文案已含"本地已创建"），避免两条 toast 互相覆盖
            pendingRemoval[item.oId] = result.docId;
            showMessage(t(i18n, "inbox.cloudRemoveFailed"), 3500);
        }
        onMutated();
    } catch (error) {
        if (error instanceof InboxRecoveryError) rememberRecovery(error.recovery);
        showMessage(recoveryMessage(error), 5000);
    } finally {
        busyId = "";
    }
}

async function dismiss(item: Shorthand) {
    if (busyId) return;
    busyId = item.oId;
    try {
        await removeShorthands([item.oId]);
        // 先更新本地列表：检查点清理失败不应让已删除的云端条目继续留在界面上
        items = items.filter((entry) => entry.oId !== item.oId);
        delete pendingRemoval[item.oId];
        if (recovery?.shorthandId === item.oId) {
            try {
                await clearInboxRecovery(facade.pluginInstance, recovery, true);
                applyRecovery(null);
            } catch (error) {
                showMessage(recoveryMessage(error), 5000);
            }
        }
        if (duplicate?.item.oId === item.oId) duplicate = null;
    } catch (error) {
        showMessage(recoveryMessage(error), 5000);
    } finally {
        busyId = "";
    }
}
</script>

{#if checked && inboxCheckFailed}
    <div class="glean-inbox" role="region" aria-labelledby={titleId}>
        <div class="glean-inbox__empty" role="status">
            {t(i18n, "inbox.checkFailed")}
            <button class="glean-linkish" type="button" onclick={() => void refresh()}>{t(i18n, "action.retry")}</button>
        </div>
    </div>
{:else if checked && available}
    <div class="glean-inbox" role="region" aria-labelledby={titleId} aria-busy={Boolean(busyId)}>
        <button type="button" class="glean-inbox__toggle" aria-expanded={expanded} aria-controls={contentId} onclick={() => (expanded = !expanded)}>
            <span id={titleId} class="glean-meta-icon"><svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href="#iconGleanInbox" /></svg>{t(i18n, "inbox.title")}</span>
            <span class="glean-inbox__count">{items.length}</span>
            <span class="glean-inbox__spacer"></span>
            <span class="glean-inbox__arrow">{expanded ? "▾" : "▸"}</span>
        </button>
        {#if expanded}
            <div id={contentId} role="group" aria-labelledby={titleId}>
                {#if items.length === 0}
                    <div class="glean-inbox__empty" role="status">{t(i18n, "inbox.empty")}</div>
                {:else}
                    {#each items as item (item.oId)}
                        <div class="glean-inbox__item" aria-busy={busyId === item.oId}>
                            <div class="glean-inbox__body">
                                <div class="glean-inbox__title">{item.shorthandTitle || item.shorthandURL || t(i18n, "panel.untitled")}</div>
                                {#if item.shorthandURL}
                                    <div class="glean-inbox__url">{item.shorthandURL}</div>
                                {/if}
                            </div>
                            <div class="glean-inbox__ops">
                                <button type="button" class="glean-cap-btn" aria-busy={busyId === item.oId} disabled={Boolean(busyId) || Boolean(unknownRecovery[item.oId])} onclick={() => pendingRemoval[item.oId] ? void dismiss(item) : void migrate(item)}>
                                    {t(i18n, pendingRemoval[item.oId] ? "inbox.retryCloudRemoval" : pendingCapture[item.oId] ? "inbox.retryCapture" : unknownRecovery[item.oId] ? "inbox.recoveryUnknownShort" : "inbox.migrate")}
                                </button>
                                <button type="button" class="glean-inbox__dismiss" aria-busy={busyId === item.oId} disabled={Boolean(busyId)} title={t(i18n, "inbox.dismiss")} aria-label={t(i18n, "inbox.dismiss")} onclick={() => void dismiss(item)}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanClose" /></svg></button>
                            </div>
                        </div>
                        {#if pendingRemoval[item.oId]}
                            <div class="glean-inbox__duplicate" role="group" aria-label={t(i18n, "inbox.cloudRemoveFailed")}>
                                <span role="alert">{t(i18n, "inbox.cloudRemoveFailed")}</span>
                                <button type="button" class="glean-op-btn" onclick={() => void openTab({ app: facade.pluginInstance.app, doc: { id: pendingRemoval[item.oId] }, keepCursor: false })}>{t(i18n, "inbox.openExisting")}</button>
                            </div>
                        {/if}
                        {#if pendingCapture[item.oId]}
                            <div class="glean-inbox__duplicate" role="group" aria-label={t(i18n, "inbox.recoveryCaptureFailed")}>
                                <span role="alert">{t(i18n, "inbox.recoveryCaptureFailed")}</span>
                                <button type="button" class="glean-op-btn" onclick={() => void openTab({ app: facade.pluginInstance.app, doc: { id: pendingCapture[item.oId] }, keepCursor: false })}>{t(i18n, "inbox.openExisting")}</button>
                            </div>
                        {/if}
                        {#if unknownRecovery[item.oId]}
                            <div class="glean-inbox__duplicate" role="group" aria-label={t(i18n, "inbox.recoveryUnknown")}>
                                <span role="alert">{t(i18n, "inbox.recoveryUnknown")}</span>
                            </div>
                        {/if}
                        {#if duplicate?.item.oId === item.oId}
                            <div class="glean-inbox__duplicate" role="group" aria-label={t(i18n, "inbox.duplicate")}>
                                <span role="status">{t(i18n, "inbox.duplicate")}</span>
                                <button type="button" class="glean-op-btn" onclick={() => duplicate && void openTab({ app: facade.pluginInstance.app, doc: { id: duplicate.existingId }, keepCursor: false })}>{t(i18n, "inbox.openExisting")}</button>
                                <button type="button" class="glean-op-btn" disabled={Boolean(busyId)} onclick={() => void migrate(item, true)}>{t(i18n, "inbox.keepDuplicate")}</button>
                                <button type="button" class="glean-op-btn" onclick={() => (duplicate = null)}>{t(i18n, "action.cancel")}</button>
                            </div>
                        {/if}
                    {/each}
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
    /* 样式集中在 src/index.scss（设计系统） */
</style>

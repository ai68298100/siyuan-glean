<script lang="ts">
/** 收集箱区（T-1500）：云端收集箱条目列表 → 一键迁入读库。不可用（未登录/无订阅）时整块隐藏。 */
import { showMessage } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { removeShorthands, type Shorthand } from "../api/inbox";
import { checkInbox, migrateShorthand } from "../services/inbox-service";

interface Props {
    facade: GleanFacade;
    onMutated: () => void;
}

let { facade, onMutated }: Props = $props();

const i18n = $derived(facade.i18n);

let available = $state(false);
let checked = $state(false);
let expanded = $state(false);
let items = $state<Shorthand[]>([]);
let busyId = $state("");

async function refresh() {
    try {
        const status = await checkInbox();
        available = status.available;
        items = status.page?.shorthands ?? [];
    } catch {
        available = false;
    } finally {
        checked = true;
    }
}

$effect(() => {
    void refresh();
});

async function migrate(item: Shorthand) {
    if (busyId) return;
    busyId = item.oId;
    try {
        const notebookId = facade.settings.anchorNotebooks[0];
        if (!notebookId) {
            showMessage(t(i18n, "panel.noAnchorHint"), 4000);
            return;
        }
        const result = await migrateShorthand(facade.pluginInstance, item, { notebookId });
        showMessage(t(i18n, "inbox.migrated"), 3000);
        items = items.filter((entry) => entry.oId !== item.oId);
        if (!result.cloudRemoved) {
            showMessage(t(i18n, "inbox.cloudRemoveFailed"), 3500);
        }
        onMutated();
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        busyId = "";
    }
}

async function dismiss(item: Shorthand) {
    busyId = item.oId;
    try {
        await removeShorthands([item.oId]);
        items = items.filter((entry) => entry.oId !== item.oId);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        busyId = "";
    }
}
</script>

{#if checked && available}
    <div class="glean-inbox">
        <button class="glean-inbox__toggle" onclick={() => (expanded = !expanded)}>
            <span>📥 {t(i18n, "inbox.title")}</span>
            <span class="glean-inbox__count">{items.length}</span>
            <span class="glean-inbox__spacer"></span>
            <span class="glean-inbox__arrow">{expanded ? "▾" : "▸"}</span>
        </button>
        {#if expanded}
            {#if items.length === 0}
                <div class="glean-inbox__empty">{t(i18n, "inbox.empty")}</div>
            {:else}
                {#each items as item (item.oId)}
                    <div class="glean-inbox__item">
                        <div class="glean-inbox__body">
                            <div class="glean-inbox__title">{item.shorthandTitle || item.shorthandURL || t(i18n, "panel.untitled")}</div>
                            {#if item.shorthandURL}
                                <div class="glean-inbox__url">{item.shorthandURL}</div>
                            {/if}
                        </div>
                        <div class="glean-inbox__ops">
                            <button class="glean-cap-btn" disabled={busyId === item.oId} onclick={() => void migrate(item)}>
                                {t(i18n, "inbox.migrate")}
                            </button>
                            <button class="glean-inbox__dismiss" title={t(i18n, "inbox.dismiss")} onclick={() => void dismiss(item)}>✕</button>
                        </div>
                    </div>
                {/each}
            {/if}
        {/if}
    </div>
{/if}

<style>
    /* 样式集中在 src/index.scss（设计系统） */
</style>

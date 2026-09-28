<script lang="ts">
/** 设置视图（T-1101）：锚点笔记本多选、AI 开关组、重浮参数、迁移参数、索引重建。 */
import { onMount } from "svelte";
import { showMessage } from "siyuan";
import { listNotebooks, type NotebookMeta } from "../api/client";
import { rebuildIndex } from "../services/clip-store";
import { t } from "../libs/i18n";
import type { GleanFacade } from "../types";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

// svelte-ignore state_referenced_locally -- 设置视图按当前值初始化一次，属有意行为
let notebooks = $state<NotebookMeta[]>([]);
let anchorNotebooks = $state<string[]>(facade.settings.anchorNotebooks);
let aiEnrich = $state(facade.settings.ai.enrichOnCapture);
let aiRelated = $state(facade.settings.ai.relatedWhileReading);
let aiActions = $state(facade.settings.ai.presetActions);
let dailyCount = $state(facade.settings.resurface.dailyCount);
let includeDone = $state(facade.settings.resurface.includeDoneHighlights);
let inboxQuota = $state(facade.settings.inboxQuota);
let staleDays = $state(facade.settings.staleDays);
let batchSize = $state(facade.settings.migrateBatchSize);

onMount(() => {
    void listNotebooks().then((items) => (notebooks = items));
});

function toggleNotebook(id: string) {
    anchorNotebooks = anchorNotebooks.includes(id)
        ? anchorNotebooks.filter((item) => item !== id)
        : [...anchorNotebooks, id];
}

async function save() {
    await facade.updateSettings({
        ...facade.settings,
        anchorNotebooks: [...anchorNotebooks],
        ai: { enrichOnCapture: aiEnrich, relatedWhileReading: aiRelated, presetActions: aiActions },
        resurface: { dailyCount, includeDoneHighlights: includeDone },
        inboxQuota,
        staleDays,
        migrateBatchSize: batchSize,
    });
    showMessage(t(i18n, "msg.statusChanged"), 2500);
}

async function doRebuildIndex() {
    await rebuildIndex(facade.pluginInstance, facade.settings);
    showMessage(t(i18n, "msg.indexRebuilt"), 2500);
}
</script>

<div class="glean-settings">
    <section class="glean-settings__section">
        <h3>{t(i18n, "settings.anchorNotebooks")}</h3>
        <p class="glean-settings__desc">{t(i18n, "settings.anchorNotebooksDesc")}</p>
        <div class="glean-settings__notebooks">
            {#each notebooks as notebook (notebook.id)}
                <label class="glean-check">
                    <input
                        type="checkbox"
                        checked={anchorNotebooks.includes(notebook.id)}
                        onchange={() => toggleNotebook(notebook.id)}
                    />
                    <span>{notebook.name}</span>
                </label>
            {/each}
            {#if notebooks.length === 0}
                <span class="glean-settings__empty">—</span>
            {/if}
        </div>
    </section>

    <section class="glean-settings__section">
        <h3>{t(i18n, "settings.aiGroup")}</h3>
        <label class="glean-check">
            <input type="checkbox" bind:checked={aiEnrich} />
            <span>{t(i18n, "settings.aiEnrichOnCapture")}</span>
        </label>
        <label class="glean-check">
            <input type="checkbox" bind:checked={aiRelated} />
            <span>{t(i18n, "settings.aiRelated")}</span>
        </label>
        <label class="glean-check">
            <input type="checkbox" bind:checked={aiActions} />
            <span>{t(i18n, "settings.aiSummaryActions")}</span>
        </label>
    </section>

    <section class="glean-settings__section">
        <h3>{t(i18n, "settings.resurfaceGroup")}</h3>
        <label class="glean-settings__row">
            <span>{t(i18n, "settings.resurfaceCount")}</span>
            <input class="b3-text-field" type="number" min="1" max="10" bind:value={dailyCount} />
        </label>
        <label class="glean-check">
            <input type="checkbox" bind:checked={includeDone} />
            <span>{t(i18n, "settings.resurfaceIncludeDone")}</span>
        </label>
        <label class="glean-settings__row">
            <span>{t(i18n, "settings.inboxQuota")}</span>
            <input class="b3-text-field" type="number" min="5" max="1000" bind:value={inboxQuota} />
        </label>
        <label class="glean-settings__row">
            <span>{t(i18n, "settings.staleDays")}</span>
            <input class="b3-text-field" type="number" min="7" max="3650" bind:value={staleDays} />
        </label>
    </section>

    <section class="glean-settings__section">
        <h3>{t(i18n, "settings.dangerGroup")}</h3>
        <label class="glean-settings__row">
            <span>{t(i18n, "migrate.batchSize")}（≤50）</span>
            <input class="b3-text-field" type="number" min="1" max="50" bind:value={batchSize} />
        </label>
        <div class="glean-settings__row">
            <span>{t(i18n, "settings.rebuildIndexDesc")}</span>
            <button class="b3-button b3-button--outline" onclick={() => void doRebuildIndex()}>
                {t(i18n, "settings.rebuildIndex")}
            </button>
        </div>
    </section>

    <footer class="glean-settings__footer">
        <button class="b3-button" onclick={() => void save()}>{t(i18n, "action.close")}</button>
    </footer>
</div>

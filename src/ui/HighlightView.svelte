<script lang="ts">
/** 高亮视图（T-1202）：当前文档引述块聚合。只消费批注产出，不提供编辑（D-0008）。 */
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { listDocHighlights, type HighlightItem } from "../services/highlights";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

let items = $state<HighlightItem[]>([]);
let loading = $state(true);
let lastDocId = $state("");

const currentDocId = $derived(facade.currentDocId());

$effect(() => {
    void loadHighlights(currentDocId);
});

async function loadHighlights(docId: string) {
    if (!docId) {
        items = [];
        loading = false;
        return;
    }
    if (docId === lastDocId && !loading) return;
    loading = true;
    try {
        items = await listDocHighlights(docId);
        lastDocId = docId;
    } catch {
        items = [];
    } finally {
        loading = false;
    }
}
</script>

<div class="glean-panel">
    <div class="glean-stats">
        {#if loading}
            <div class="glean-panel__loading">{t(i18n, "panel.loading")}</div>
        {:else if !currentDocId}
            <div class="glean-empty">
                <div class="glean-empty__art"><svg><use href="#iconGleanWheat" /></svg></div>
                <div class="glean-empty__title">{t(i18n, "highlight.noDoc")}</div>
                <div class="glean-empty__hint">{t(i18n, "highlight.noDocHint")}</div>
            </div>
        {:else if items.length === 0}
            <div class="glean-empty">
                <div class="glean-empty__art">✨</div>
                <div class="glean-empty__title">{t(i18n, "highlight.empty")}</div>
                <div class="glean-empty__hint">{t(i18n, "highlight.emptyHint")}</div>
            </div>
        {:else}
            {#each items as item (item.id)}
                <div class="glean-hl">
                    <div class="glean-hl__q">{item.text}</div>
                    <div class="glean-hl__m"><span>{t(i18n, "highlight.quoteTag")}</span></div>
                </div>
            {/each}
            <div class="glean-sect" style="margin-top:2px; text-align:center; opacity:.7">AI · {t(i18n, "ai.actionsPreview")}</div>
        {/if}
    </div>
</div>

<script lang="ts">
/** 高亮视图（T-1202/T-1301）：当前文档引述块聚合 + ✨相关旧文。只消费批注产出，不提供编辑（D-0008）。 */
import { openTab } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { listDocHighlights, type HighlightItem } from "../services/highlights";
import { findRelated } from "../services/enrich-service";
import { makeQuoteCard } from "../services/flashcard-service";
import { showMessage } from "siyuan";

interface Props {
    facade: GleanFacade;
}

let { facade }: Props = $props();

const i18n = $derived(facade.i18n);

let items = $state<HighlightItem[]>([]);
let loading = $state(true);
let lastDocId = $state("");
let related = $state<Array<{ id: string; title: string }>>([]);
let docTitle = $state("");
let cardingKey = $state("");

const currentDocId = $derived(facade.currentDocId());

$effect(() => {
    void loadHighlights(currentDocId);
});

async function loadHighlights(docId: string) {
    if (!docId) {
        items = [];
        related = [];
        loading = false;
        return;
    }
    if (docId === lastDocId && !loading) return;
    loading = true;
    try {
        items = await listDocHighlights(docId);
        lastDocId = docId;
        // T-1301 相关旧文：嵌入未启用时返回空（区块整体隐藏，UI-STANDARD §5.6）
        const query = items[0]?.text || docId;
        related = await findRelated(docId, query);
        docTitle = await fetchTitle(docId);
    } catch {
        items = [];
        related = [];
    } finally {
        loading = false;
    }
}

async function fetchTitle(docId: string): Promise<string> {
    const { querySql } = await import("../api/client");
    const rows = await querySql<{ content: string }>("SELECT content FROM blocks WHERE id = '" + docId.replace(/'/g, "''") + "' LIMIT 1");
    return rows[0]?.content ?? "";
}

async function card(quote: string) {
    const key = quote.slice(0, 24);
    if (cardingKey) return;
    cardingKey = key;
    try {
        await makeQuoteCard(facade.settings, docTitle || t(i18n, "panel.untitled"), quote);
        showMessage(t(i18n, "flashcard.done"), 3000);
    } catch (error) {
        showMessage(String(error).slice(0, 140), 5000);
    } finally {
        cardingKey = "";
    }
}

function openDoc(docId: string) {
    void openTab({ app: facade.pluginInstance.app, doc: { id: docId }, keepCursor: false });
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
                    <div class="glean-hl__m">
                        <span>{t(i18n, "highlight.quoteTag")}</span>
                        <button
                            class="glean-hl__card"
                            disabled={cardingKey === item.text.slice(0, 24)}
                            onclick={() => void card(item.text)}
                        >🎴 {t(i18n, "flashcard.make")}</button>
                    </div>
                </div>
            {/each}
            {#if related.length > 0}
                <div class="glean-sect" style="margin-top:6px">✨ {t(i18n, "ai.relatedTitle")}</div>
                {#each related as rel (rel.id)}
                    <button class="glean-rel" onclick={() => openDoc(rel.id)}>
                        <span class="glean-rel__t">{rel.title}</span>
                        <span class="glean-rel__go">→</span>
                    </button>
                {/each}
            {/if}
            <div class="glean-sect" style="margin-top:2px; text-align:center; opacity:.7">AI · {t(i18n, "ai.actionsPreview")}</div>
        {/if}
    </div>
</div>

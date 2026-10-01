<script lang="ts">
/** 高亮视图（T-1202/T-1301）：当前文档引述块聚合 + ✨相关旧文。只消费批注产出，不提供编辑（D-0008）。 */
import { openTab } from "siyuan";
import type { GleanFacade } from "../types";
import { t } from "../libs/i18n";
import { listDocHighlights, getQuoteColor, setQuoteColor, type HighlightItem } from "../services/highlights";
import { findRelated } from "../services/enrich-service";
import { formatQuoteShare } from "../domain/quotes";
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

// T-1975：请求代次守卫——切换文档时丢弃晚到的旧结果，引述/相关旧文/标题不串文
let loadSeq = 0;

$effect(() => {
    void loadHighlights(currentDocId);
});

// T-1981：数据变更后强制刷新（摘录插入/删除、属性变化），不残留上一篇内容
$effect(() => {
    const onData = () => {
        lastDocId = "";
        void loadHighlights(currentDocId);
    };
    document.addEventListener("glean:data-changed", onData);
    return () => document.removeEventListener("glean:data-changed", onData);
});

async function loadHighlights(docId: string) {
    const seq = ++loadSeq;
    if (!docId) {
        items = [];
        related = [];
        loading = false;
        return;
    }
    if (docId === lastDocId && !loading) return;
    loading = true;
    try {
        const nextItems = await listDocHighlights(docId);
        if (seq !== loadSeq) return;
        items = nextItems;
        lastDocId = docId;
        // T-1901：颜色标记逐块补齐（getBlockAttrs 可靠；SQL ial 列同步有限）
        const colors = await Promise.all(nextItems.map((item) => getQuoteColor(item.id)));
        if (seq !== loadSeq) return;
        items = nextItems.map((item, index) => ({ ...item, color: colors[index] }));
        // T-1301 相关旧文：嵌入未启用时返回空（区块整体隐藏，UI-STANDARD §5.6）
        const query = nextItems[0]?.text || docId;
        const nextRelated = await findRelated(docId, query);
        if (seq !== loadSeq) return;
        related = nextRelated;
        const nextTitle = await fetchTitle(docId);
        if (seq !== loadSeq) return;
        docTitle = nextTitle;
    } catch {
        if (seq !== loadSeq) return;
        items = [];
        related = [];
    } finally {
        if (seq === loadSeq) loading = false;
    }
}

async function fetchTitle(docId: string): Promise<string> {
    // T-1961：拼接查询前拒绝注入向量（单引号已另行转义），异常 ID 按无标题处理
    if (!docId || /['"\\;()\s/]|--/.test(docId)) return "";
    const { querySql } = await import("../api/client");
    const rows = await querySql<{ content: string }>("SELECT content FROM blocks WHERE id = '" + docId.replace(/'/g, "''") + "' LIMIT 1");
    return rows[0]?.content ?? "";
}

async function card(quote: string) {
    const key = quote.slice(0, 24);
    if (cardingKey) return;
    cardingKey = key;
    try {
        await makeQuoteCard(facade.settings, docTitle || t(i18n, "panel.untitled"), quote, facade.pluginInstance);
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

/** T-1753：跳到原文位置——doc.id 传引述块 ID，思源打开所在文档（块内精确滚动随 B-0002）。 */
function jumpToQuote(quoteBlockId: string): void {
    if (/^\d{14}-[0-9a-z]{7}$/.test(quoteBlockId)) openDoc(quoteBlockId);
}

// T-1901 高亮颜色：五档循环（黄/红/蓝/绿/清除），写引述块级 IAL 标记
const COLOR_CYCLE = ["", "yellow", "red", "blue", "green"];

function nextColor(current: string): string {
    const index = COLOR_CYCLE.indexOf(current);
    return COLOR_CYCLE[(index + 1) % COLOR_CYCLE.length];
}

async function cycleColor(item: HighlightItem): Promise<void> {
    const next = nextColor(item.color);
    try {
        await setQuoteColor(item.id, next);
        item.color = next;
    } catch (error) {
        console.warn("[glean] 高亮颜色切换失败:", error);
        showMessage(t(i18n, "msg.actionFailed"), 3000);
    }
}

/** T-1803 分享卡：复制格式化引用（rootId=当前文档，标题用已加载的 docTitle）。 */
async function copyShare(item: HighlightItem): Promise<void> {
    const share = formatQuoteShare({
        id: item.id,
        rootId: currentDocId,
        text: item.text,
        title: docTitle,
        site: "",
        tags: [],
        aiTags: [],
        color: item.color,
    });
    try {
        await navigator.clipboard.writeText(share);
        showMessage(t(i18n, "reader.copied"), 2000);
    } catch {
        showMessage(t(i18n, "reader.actionFailed"), 2500);
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
            <!-- T-1824：列表容器（宽画布下双栏栅格，窄画布保持纵向） -->
            <div class="glean-hl-list">
                {#each items as item (item.id)}
                <div class="glean-hl">
                    <div class="glean-hl__q">{item.text}</div>
                    <div class="glean-hl__m">
                        <span>{t(i18n, "highlight.quoteTag")}</span>
                        {#if item.at}
                            <!-- T-1753：摘录时间（块更新时间投影） -->
                            <span class="glean-hl__time">{item.at.slice(4, 6)}/{item.at.slice(6, 8)} {item.at.slice(8, 10)}:{item.at.slice(10, 12)}</span>
                        {/if}
                        <!-- T-1901 高亮颜色：五档循环（黄/红/蓝/绿/清除） -->
                        <button
                            class="glean-hl__card glean-hl__color glean-hl__color--{item.color || 'none'}"
                            title={t(i18n, "highlight.cycleColor")}
                            onclick={() => void cycleColor(item)}
                        >●</button>
                        <!-- T-1803 分享卡：复制为格式化引用（含来源与回链） -->
                        <button class="glean-hl__card" title={t(i18n, "highlight.copyShare")} onclick={() => void copyShare(item)}>
                            ⧉ {t(i18n, "highlight.copyShare")}
                        </button>
                        <button class="glean-hl__card" title={t(i18n, "highlight.jumpTo")} onclick={() => jumpToQuote(item.id)}>
                            ↗ {t(i18n, "highlight.jumpTo")}
                        </button>
                        <button
                            class="glean-hl__card"
                            disabled={cardingKey === item.text.slice(0, 24)}
                            onclick={() => void card(item.text)}
                        >🎴 {t(i18n, "flashcard.make")}</button>
                    </div>
                </div>
                {/each}
            </div>
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

<script lang="ts">
    /**
     * 内嵌阅读页签（D-0029/T-1730）：左 = 真实思源编辑器（Protyle 实例），右 = 伴生栏。
     * 页签打开文档是"打开动作"，不写五态（D-0021）；伴生栏动作与三画布共用同一服务，
     * 按真实成功数反馈。编辑/标注经 Protyle 走内核事务，插件不另存正文副本。
     */
    import { showMessage, openTab } from "siyuan";
    import { Protyle } from "siyuan";
    import { untrack } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { fulltextBodyState } from "../domain/content";
    import { hasSourceAction, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
    import type { ClipStatus } from "../domain/schema";
    import {
        batchSetStatus,
        measureClipBody,
        readClipContext,
        writeClip,
        type ReadingClipContext,
    } from "../services/clip-store";
    import { snapshotClip } from "../services/snapshot-service";
    import { recordReadingDone } from "../services/checkin-bridge";
    import { excerptFromSelection, insertQuoteExcerpt } from "../services/excerpt-service";
    import { makeQuoteCard } from "../services/flashcard-service";
    import { findRelated } from "../services/enrich-service";
    import { pickNextUnread } from "../services/resurface-service";
    import { readerAiEnabled, readerAsk, readerSummarize, readerTranslate, saveReaderSummary } from "../services/reader-ai";
    import { clampAskQuestion } from "../domain/reader";
    import { fetchDocOutline, outlineIndent, type OutlineHeading } from "../services/outline";
    import { nextSpeechRate } from "../domain/tts";
    import { speakText, stopSpeaking, ttsAvailable } from "../services/tts";
    import ClipStatusActions from "./ClipStatusActions.svelte";
    import ClipRankControls from "./ClipRankControls.svelte";

    interface Props {
        facade: GleanFacade;
    }

    let { facade }: Props = $props();
    const i18n = $derived(facade.i18n);

    /** 页签初值 = 挂载时刻的会话状态快照（T-1790：经函数读取 props，消除顶层本地引用）。 */
    function readerInitState() {
        return {
            docId: facade.consumeReaderFocus(),
            defaultMode: facade.settings.reader.defaultMode,
        };
    }
    const readerInit = readerInitState();
    let docId = $state(readerInit.docId);
    let mode = $state<"read" | "edit">(readerInit.defaultMode);
    let protyleHost = $state<HTMLDivElement | null>(null);
    let context = $state<ReadingClipContext | null>(null);
    let measuring = $state(false);
    let snapping = $state(false);
    let statusBusy = $state(false);
    let protyle: Protyle | null = null;

    const bodyState = $derived(context ? fulltextBodyState(context.contentType, context.words) : "na");

    // 摘录段（D-0030）：selectionchange 限定正文宿主内；blockId 空=定位失败，仅可复制。
    let excerpt = $state<{ text: string; blockId: string } | null>(null);

    // AI 伴读段（D-0030）：显式动作 + 结果卡；额度与富化共享。
    const aiOn = $derived(readerAiEnabled(facade.settings));
    const relatedOn = $derived(aiOn && facade.settings.ai.relatedWhileReading);
    const channelLabel = $derived(
        facade.settings.ai.channel === "custom"
            ? facade.settings.ai.customModel || "custom"
            : t(i18n, "reader.aiChannelSiyuan")
    );
    let aiBusy = $state("");
    let aiResult = $state<{ kind: "summarize" | "translate" | "ask"; action: string; text: string } | null>(null);
    let relatedItems = $state<Array<{ id: string; title: string }>>([]);
    let relatedShown = $state(false);

    // T-1760 问这篇文章：单轮动作（无追问、不做聊天窗）；问题文本只是输入，不落任何存储
    let askInput = $state("");
    let askActionLabel = $derived(t(i18n, "reader.aiAsk"));

    // T-1740 本文大纲：标题树 + 点击滚动定位（DOM scrollIntoView；真机滚动随 B-0002）
    let outline = $state<OutlineHeading[]>([]);
    let outlineOpen = $state(false);
    let outlineSeq = 0;
    const outlineIndents = $derived(outlineIndent(outline));

    // T-1744 TTS 朗读：Web Speech 能力探测降级；移动端隐藏入口（facade.isMobile）；
    // 朗读源 = 正文 DOM 文本（公开字段），选区优先用摘录捕获；纯会话行为不落任何存储。
    const ttsOn = $derived(ttsAvailable() && !facade.isMobile);
    let speaking = $state(false);
    let speechRate = $state(1);
    let speechHandle: { stop: () => void; active: () => boolean } | null = null;

    function bodyTextForSpeech(): string {
        return (protyle?.protyle?.element?.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    function startSpeech(text: string): void {
        if (!ttsOn || !text) return;
        stopSpeech(false);
        speaking = true;
        speechHandle = speakText(text, speechRate, () => {
            speaking = false;
            speechHandle = null;
        });
    }

    function stopSpeech(notify = true): void {
        speechHandle?.stop();
        speechHandle = null;
        stopSpeaking();
        speaking = false;
        if (notify) showMessage(t(i18n, "reader.ttsStopped"), 1500);
    }

    function toggleSpeechRate(): void {
        speechRate = nextSpeechRate(speechRate);
        showMessage(t(i18n, "reader.ttsRate", { n: speechRate }), 1500);
        if (speaking) {
            // 换速即重启当前朗读（简单可预期；断点续读随真机反馈再议）
            const text = bodyTextForSpeech();
            startSpeech(text);
        }
    }

    async function loadOutline(id: string): Promise<void> {
        const seq = ++outlineSeq;
        try {
            const next = await fetchDocOutline(id);
            if (seq !== outlineSeq) return;
            outline = next;
        } catch {
            if (seq !== outlineSeq) return;
            outline = [];
        }
    }

    function scrollToHeading(blockId: string): void {
        const host = protyle?.protyle?.element;
        if (!host) return;
        const target = host.querySelector(`[data-node-id="${blockId}"]`);
        if (!target) {
            showMessage(t(i18n, "reader.outlineMiss"), 2500);
            return;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function modeValue(value: "read" | "edit"): "preview" | "wysiwyg" {
        return value === "edit" ? "wysiwyg" : "preview";
    }

    // T-1839：请求代次守卫——快速切换文章时丢弃晚到的旧上下文，旧结果不覆盖新文档
    let contextSeq = 0;

    async function loadContext(id: string): Promise<void> {
        const seq = ++contextSeq;
        try {
            const next = await readClipContext(id);
            if (seq !== contextSeq) return;
            context = next;
        } catch (error) {
            if (seq !== contextSeq) return;
            console.debug("[glean] 阅读页签读取上下文失败:", error);
            context = null;
        }
    }

    // 挂载效果只依赖 docId 与宿主节点；模式切换走 switchMode，不重建实例（保留位置）。
    $effect(() => {
        const id = docId;
        const host = protyleHost;
        if (!id || !host) return;
        const initialMode = untrack(() => mode);
        protyle?.destroy();
        protyle = null;
        untrack(() => host.replaceChildren());
        protyle = new Protyle(facade.pluginInstance.app, host, {
            blockId: id,
            rootId: id,
            mode: modeValue(initialMode),
            render: { breadcrumb: false, background: false },
        });
        void untrack(() => loadContext(id));
        void untrack(() => loadOutline(id));
        return () => {
            protyle?.destroy();
            protyle = null;
            // T-1744：页签销毁时停止朗读，不留悬挂的语音队列
            stopSpeech(false);
        };
    });

    // 页签聚焦与尺寸事件由壳派发；数据变化后只刷新伴生栏，不动正文实例。
    $effect(() => {
        const onFocus = () => {
            const id = facade.consumeReaderFocus();
            if (id) docId = id;
        };
        const onResize = () => protyle?.resize();
        const onData = () => {
            if (docId) void loadContext(docId);
        };
        const onSelect = () => {
            excerpt = excerptFromSelection(protyleHost, window.getSelection());
        };
        document.addEventListener("glean:focus-reader", onFocus);
        document.addEventListener("glean:reader-resize", onResize);
        document.addEventListener("glean:data-changed", onData);
        document.addEventListener("selectionchange", onSelect);
        return () => {
            document.removeEventListener("glean:focus-reader", onFocus);
            document.removeEventListener("glean:reader-resize", onResize);
            document.removeEventListener("glean:data-changed", onData);
            document.removeEventListener("selectionchange", onSelect);
        };
    });

    function openRelatedDoc(id: string): void {
        docId = id;
        aiResult = null;
        relatedShown = false;
        relatedItems = [];
        excerpt = null;
        askInput = "";
        outline = [];
    }

    async function quoteExcerpt(): Promise<void> {
        if (!excerpt?.blockId || !context) return;
        try {
            await insertQuoteExcerpt(excerpt.blockId, excerpt.text);
            showMessage(t(i18n, "reader.excerptDone"), 2500);
            facade.notifyDataChanged();
        } catch (error) {
            console.warn("[glean] 摘录插入失败:", error);
            showMessage(t(i18n, "reader.actionFailed"), 3000);
        }
    }

    async function cardFromExcerpt(): Promise<void> {
        if (!excerpt?.text || !context) return;
        try {
            await makeQuoteCard(facade.settings, context.title, excerpt.text, facade.pluginInstance);
            showMessage(t(i18n, "flashcard.done"), 3000);
        } catch (error) {
            console.warn("[glean] 摘录制卡失败:", error);
            showMessage(t(i18n, "reader.actionFailed"), 3000);
        }
    }

    async function copyText(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            showMessage(t(i18n, "reader.copied"), 2000);
        } catch {
            showMessage(t(i18n, "reader.actionFailed"), 2500);
        }
    }

    async function runSummarize(): Promise<void> {
        if (!context || aiBusy) return;
        aiBusy = "summarize";
        try {
            const outcome = await readerSummarize(facade.pluginInstance, context.id, facade.settings);
            if (outcome.ok && outcome.text) {
                aiResult = { kind: "summarize", action: t(i18n, "reader.aiSummarize"), text: outcome.text };
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            aiBusy = "";
        }
    }

    async function runTranslate(): Promise<void> {
        if (!context || aiBusy || !excerpt?.text) return;
        aiBusy = "translate";
        try {
            const outcome = await readerTranslate(facade.pluginInstance, context.id, excerpt.text, facade.settings);
            if (outcome.ok && outcome.text) {
                aiResult = { kind: "translate", action: t(i18n, "reader.aiTranslate"), text: outcome.text };
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            aiBusy = "";
        }
    }

    async function runRelated(): Promise<void> {
        if (!context || aiBusy) return;
        aiBusy = "related";
        try {
            relatedItems = await findRelated(context.id, context.title);
            relatedShown = true;
            if (relatedItems.length === 0) showMessage(t(i18n, "reader.relatedNone"), 3000);
        } finally {
            aiBusy = "";
        }
    }

    /** T-1760：单轮"问这篇文章"——本文全文为上下文，一次一问，结果卡可复制。 */
    async function runAsk(): Promise<void> {
        if (!context || aiBusy) return;
        const question = clampAskQuestion(askInput);
        if (!question) {
            showMessage(t(i18n, "reader.askEmpty"), 2500);
            return;
        }
        aiBusy = "ask";
        try {
            const outcome = await readerAsk(facade.pluginInstance, context.id, question, facade.settings);
            if (outcome.ok && outcome.text) {
                aiResult = { kind: "ask", action: askActionLabel, text: outcome.text };
                askInput = "";
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            aiBusy = "";
        }
    }

    async function copyExcerpt(): Promise<void> {
        if (!excerpt) return;
        await copyText(excerpt.text);
    }

    async function copyAiResult(): Promise<void> {
        if (!aiResult) return;
        await copyText(aiResult.text);
    }

    async function keepSummary(): Promise<void> {
        if (!aiResult || !context) return;
        try {
            await saveReaderSummary(facade.pluginInstance, context.id, aiResult.text);
            showMessage(t(i18n, "reader.aiSummarySaved"), 2500);
            facade.notifyDataChanged();
        } catch {
            showMessage(t(i18n, "reader.actionFailed"), 3000);
        }
    }

    function setMode(next: "read" | "edit"): void {
        if (mode === next || !protyle) return;
        mode = next;
        protyle.switchMode(modeValue(next));
        showMessage(t(i18n, next === "edit" ? "reader.editHint" : "reader.readHint"), 2500);
    }

    function openSource(): void {
        const url = context ? sourceUrlForCarrier(context.contentType, context.url) : "";
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    }

    /** 显式"检测正文"（T-1727）：导出重算并写回，不改用户正文。 */
    async function checkBody(): Promise<void> {
        if (!context || measuring) return;
        measuring = true;
        try {
            const measured = await measureClipBody(facade.pluginInstance, context.id);
            if (context) context = { ...context, words: measured.words };
            showMessage(
                measured.missing
                    ? t(i18n, "clip.bodyMissingConfirm")
                    : t(i18n, "clip.bodyOk", { n: measured.words }),
                3500
            );
            facade.notifyDataChanged();
        } catch (error) {
            console.warn("[glean] 正文检测失败:", error);
            showMessage(t(i18n, "clip.bodyCheckFailed"), 3000);
        } finally {
            measuring = false;
        }
    }

    /** "重新剪藏"是打开原文的显式导航；本文不被覆盖，快照保留。 */
    function recapture(): void {
        const url = context ? sourceUrlForCarrier(context.contentType, context.url) : "";
        if (!url) {
            showMessage(t(i18n, "clip.sourceMissing"), 3000);
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        showMessage(t(i18n, "clip.reclipHint"), 4500);
    }

    async function writeStatus(status: ClipStatus): Promise<void> {
        if (!context || statusBusy) return;
        const current = context;
        statusBusy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], status);
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return;
            }
            if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            context = { ...(context?.id === current.id ? context : current), status };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.statusChanged"), 2500);
        } finally {
            statusBusy = false;
        }
    }

    async function startReading(): Promise<void> {
        if (!context) return;
        // 页签内文档已打开；"开始阅读"只负责显式写入 reading，不再导航。
        await writeStatus("reading");
    }

    /**
     * "读完并下一篇"（T-1723）：显式动作，默认不自动前进。
     * 完成写入成功后才切下一篇；没有下一篇时不回滚完成状态。
     */
    async function doneAndNext(): Promise<void> {
        if (!context || statusBusy) return;
        const current = context;
        statusBusy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], "done");
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return;
            }
            if (facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            facade.notifyDataChanged();
            const next = await pickNextUnread(facade.pluginInstance, current.id);
            if (!next) {
                context = { ...current, status: "done" };
                showMessage(t(i18n, "reader.noNext"), 3000);
                return;
            }
            showMessage(t(i18n, "msg.statusChanged"), 2000);
            docId = next;
            aiResult = null;
            relatedShown = false;
            relatedItems = [];
            excerpt = null;
        } finally {
            statusBusy = false;
        }
    }

    async function setPriority(value: number): Promise<void> {
        if (!context || statusBusy) return;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, context.id, { priority: value }, { force: true });
            context = { ...context, priority: value };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function setRating(value: number): Promise<void> {
        if (!context || statusBusy) return;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, context.id, { rating: value }, { force: true });
            context = { ...context, rating: value };
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function takeSnapshot(): Promise<void> {
        if (!context || snapping) return;
        if (context.snapshot) {
            void openTab({ app: facade.pluginInstance.app, asset: { path: context.snapshot } });
            return;
        }
        snapping = true;
        try {
            const { path } = await snapshotClip(facade.pluginInstance, context.id);
            context = { ...context, snapshot: path };
            showMessage(t(i18n, "snapshot.done"), 3000);
            facade.notifyDataChanged();
        } catch {
            showMessage(t(i18n, "snapshot.failed"), 3000);
        } finally {
            snapping = false;
        }
    }

    function backToLibrary(): void {
        if (context) void facade.openLibraryArticle(context.id);
    }

    function carrierLabel(value: string | undefined): string {
        return t(i18n, `clip.type.${resolveCarrier(value)}`);
    }
</script>

<div class="glean-reader">
    <div class="glean-reader__main">
        {#if docId}
            <div class="glean-reader__host" bind:this={protyleHost}></div>
        {:else}
            <div class="glean-reader__empty">
                <div class="glean-reader__empty-art">📖</div>
                <div class="glean-reader__empty-title">{t(i18n, "reader.empty")}</div>
                <div class="glean-reader__empty-hint">{t(i18n, "reader.emptyHint")}</div>
            </div>
        {/if}
    </div>
    {#if docId}
        <aside class="glean-reader__side" aria-label={t(i18n, "reader.title")}>
            <div class="glean-reader__title" title={context?.title}>{context?.title || t(i18n, "panel.untitled")}</div>
            <div class="glean-reader__meta">
                <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(context?.contentType)}`}>
                    {carrierLabel(context?.contentType)}
                </span>
                {#if context?.site}<span>{context.site}</span>{/if}
            </div>
            {#if outline.length > 0}
                <!-- T-1740 本文大纲：标题树 + 点击滚动定位 -->
                {#if outlineOpen}
                    <nav class="glean-reader__outline" aria-label={t(i18n, "reader.outline")}>
                        {#each outline as heading, index (heading.id)}
                            <button
                                class="glean-reader__outline-item"
                                style={`padding-left:${6 + outlineIndents[index] * 12}px`}
                                title={heading.text}
                                onclick={() => scrollToHeading(heading.id)}
                            >{heading.text}</button>
                        {/each}
                    </nav>
                {/if}
                <button
                    class="glean-btn glean-btn--ghost glean-reader__outline-toggle"
                    aria-expanded={outlineOpen}
                    onclick={() => (outlineOpen = !outlineOpen)}
                >{outlineOpen ? "▾" : "▸"} {t(i18n, "reader.outline")}</button>
            {/if}
            <div class="glean-reader__mode" role="group" aria-label={t(i18n, "settings.readerMode")}>
                <button
                    class="glean-seg__btn"
                    class:glean-seg__btn--on={mode === "read"}
                    title={t(i18n, "reader.readHint")}
                    onclick={() => setMode("read")}
                >{t(i18n, "reader.modeRead")}</button>
                <button
                    class="glean-seg__btn"
                    class:glean-seg__btn--on={mode === "edit"}
                    title={t(i18n, "reader.editHint")}
                    onclick={() => setMode("edit")}
                >{t(i18n, "reader.modeEdit")}</button>
            </div>
            {#if context}
                <ClipStatusActions
                    {i18n}
                    status={context.status}
                    disabled={statusBusy}
                    onStartReading={() => void startReading()}
                    onSetStatus={(status) => void writeStatus(status)}
                />
                <button
                    class="glean-btn glean-btn--ghost"
                    disabled={statusBusy}
                    title={t(i18n, "reader.doneNextHint")}
                    onclick={() => void doneAndNext()}
                >✓→ {t(i18n, "reader.doneNext")}</button>
                {#if docId}
                    <div class="glean-reader__section">
                        <div class="glean-reader__section-title">{t(i18n, "reader.excerptTitle")}</div>
                        {#if excerpt}
                            <div class="glean-reader__excerpt" title={excerpt.text}>
                                {excerpt.text.slice(0, 80)}{excerpt.text.length > 80 ? "…" : ""}
                            </div>
                            {#if !excerpt.blockId}
                                <div class="glean-reader__issue"><span>{t(i18n, "reader.excerptNoBlock")}</span></div>
                            {/if}
                            <div class="glean-reader__ops">
                                <button
                                    class="glean-btn glean-btn--ghost"
                                    disabled={!excerpt.blockId}
                                    title={excerpt.blockId ? "" : t(i18n, "reader.excerptNoBlock")}
                                    onclick={() => void quoteExcerpt()}
                                >{t(i18n, "reader.excerptQuote")}</button>
                                <button class="glean-btn glean-btn--ghost" onclick={() => void cardFromExcerpt()}>
                                    {t(i18n, "flashcard.make")}
                                </button>
                                <button class="glean-btn glean-btn--ghost" onclick={() => void copyExcerpt()}>
                                    {t(i18n, "reader.copy")}
                                </button>
                            </div>
                        {:else}
                            <div class="glean-reader__hint">{t(i18n, "reader.excerptHint")}</div>
                        {/if}
                    </div>
                    <div class="glean-reader__section">
                        <div class="glean-reader__section-title">{t(i18n, "reader.aiTitle")}</div>
                        {#if !aiOn}
                            <div class="glean-reader__hint">{t(i18n, "reader.aiOff")}</div>
                        {:else}
                            <div class="glean-reader__ops">
                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(aiBusy)} onclick={() => void runSummarize()}>
                                    ✨ {t(i18n, "reader.aiSummarize")}
                                </button>
                                <button
                                    class="glean-btn glean-btn--ghost"
                                    disabled={Boolean(aiBusy) || !excerpt?.text}
                                    title={excerpt?.text ? "" : t(i18n, "reader.excerptHint")}
                                    onclick={() => void runTranslate()}
                                >文A {t(i18n, "reader.aiTranslate")}</button>
                                {#if relatedOn}
                                    <button class="glean-btn glean-btn--ghost" disabled={Boolean(aiBusy)} onclick={() => void runRelated()}>
                                        🔗 {t(i18n, "reader.aiRelated")}
                                    </button>
                                {/if}
                            </div>
                            {#if aiOn}
                                <!-- T-1760 问这篇文章：单轮输入，无会话、无追问（不做聊天窗） -->
                                <div class="glean-reader__ask">
                                    <input
                                        class="glean-mini-input glean-reader__ask-input"
                                        type="text"
                                        placeholder={t(i18n, "reader.askPlaceholder")}
                                        aria-label={t(i18n, "reader.aiAsk")}
                                        bind:value={askInput}
                                        maxlength={500}
                                        onkeydown={(event) => {
                                            if (event.key === "Enter" && !aiBusy) {
                                                event.preventDefault();
                                                void runAsk();
                                            }
                                        }}
                                    />
                                    <button
                                        class="glean-btn glean-btn--ghost"
                                        disabled={Boolean(aiBusy)}
                                        onclick={() => void runAsk()}
                                    >{t(i18n, "reader.aiAsk")}</button>
                                </div>
                            {/if}
                            {#if aiResult}
                                <div class="glean-reader__ai-card">
                                    <div class="glean-reader__ai-src">
                                        {t(i18n, "reader.aiSource", { channel: channelLabel, action: aiResult.action })}
                                    </div>
                                    <div class="glean-reader__ai-text">{aiResult.text}</div>
                                    <div class="glean-reader__ops">
                                        <button class="glean-btn glean-btn--ghost" onclick={() => void copyAiResult()}>
                                            {t(i18n, "reader.copy")}
                                        </button>
                                        {#if aiResult.kind === "summarize"}
                                            <button class="glean-btn glean-btn--ghost" onclick={() => void keepSummary()}>
                                                {t(i18n, "reader.aiSaveSummary")}
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                            {#if relatedShown && relatedItems.length > 0}
                                <div class="glean-reader__related">
                                    {#each relatedItems as item (item.id)}
                                        <button class="glean-reader__related-item" title={item.title} onclick={() => openRelatedDoc(item.id)}>
                                            {item.title}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        {/if}
                    </div>
                {/if}
                {#if context}
                    <div class="glean-reader__section">
                        <div class="glean-reader__section-title">{t(i18n, "panel.rankTitle")}</div>
                        <ClipRankControls
                            {i18n}
                            priority={context.priority}
                            rating={context.rating}
                            disabled={statusBusy}
                            onPriority={(value) => void setPriority(value)}
                            onRating={(value) => void setRating(value)}
                        />
                    </div>
                {/if}
                <div class="glean-reader__ops">
                    {#if hasSourceAction(context.contentType, context.url)}
                        <button class="glean-btn glean-btn--ghost" onclick={openSource}>↗ {t(i18n, "clip.openSource")}</button>
                    {:else if resolveCarrier(context.contentType) === "link"}
                        <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                    {/if}
                    <button class="glean-btn glean-btn--ghost" disabled={snapping} onclick={() => void takeSnapshot()}>
                        {context.snapshot ? "⟐" : "📷"}
                    </button>
                    {#if ttsOn}
                        <!-- T-1744 TTS：选区（摘录捕获）优先，其次全文；能力缺失/移动端整行隐藏 -->
                        {#if speaking}
                            <button class="glean-btn glean-btn--ghost" onclick={() => stopSpeech()}>{t(i18n, "reader.ttsStop")}</button>
                        {:else}
                            <button
                                class="glean-btn glean-btn--ghost"
                                title={excerpt?.text ? t(i18n, "reader.ttsSelection") : t(i18n, "reader.ttsFull")}
                                onclick={() => startSpeech(excerpt?.text || bodyTextForSpeech())}
                            >▶ {t(i18n, "reader.ttsSpeak")}</button>
                        {/if}
                        <button class="glean-btn glean-btn--ghost" title={t(i18n, "reader.ttsRateTitle")} onclick={toggleSpeechRate}>
                            {speechRate}×
                        </button>
                    {/if}
                </div>
                {#if bodyState === "unmeasured"}
                    <button class="glean-btn glean-btn--ghost" disabled={measuring} title={t(i18n, "clip.bodyCheckHint")} onclick={() => void checkBody()}>
                        ⌕ {t(i18n, "clip.bodyCheck")}
                    </button>
                {:else if bodyState === "missing"}
                    <div class="glean-reader__issue">
                        <span title={t(i18n, "clip.bodyMissingHint")}>{t(i18n, "clip.bodyMissing")}</span>
                        {#if hasSourceAction(context.contentType, context.url)}
                            <button class="glean-btn glean-btn--ghost" onclick={recapture}>↻ {t(i18n, "clip.reclip")}</button>
                        {/if}
                    </div>
                {/if}
                <button class="glean-reader__back" onclick={backToLibrary}>{t(i18n, "reading.backToLibrary")}</button>
            {:else}
                <div class="glean-reader__issue"><span>{t(i18n, "reader.emptyHint")}</span></div>
            {/if}
        </aside>
    {/if}
</div>

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
    /** 伴生栏收藏星标的本地态（context.favorite 由 readClipContext 投影） */
    let favorite = $state(false);

    /** T-1755：伴生栏收藏切换（favorite 非手填保护字段）。 */
    async function toggleFavoriteFlag(): Promise<void> {
        if (!context) return;
        const next = !favorite;
        try {
            await writeClip(facade.pluginInstance, context.id, { favorite: next });
            favorite = next;
            facade.notifyDataChanged();
        } catch (error) {
            console.warn("[glean] 收藏切换失败:", error);
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        }
    }
    import { snapshotClip } from "../services/snapshot-service";
    import { recordReadingDone } from "../services/checkin-bridge";
    import { excerptFromSelection, insertQuoteExcerpt } from "../services/excerpt-service";
    import { makeQuoteCard } from "../services/flashcard-service";
    import { findRelated } from "../services/enrich-service";
    import { pickNextUnread } from "../services/resurface-service";
    import { readerAiEnabled, readerAsk, readerSummarize, readerTranslate, readerTranslateFull, inferQuestionCard, saveReaderSummary } from "../services/reader-ai";
    import { clampAskQuestion } from "../domain/reader";
    import { fetchDocOutline, outlineIndent, type OutlineHeading } from "../services/outline";
    import { nextSpeechRate } from "../domain/tts";
    import { speakText, stopSpeaking, ttsAvailable } from "../services/tts";
    import { anchorBlockInViewport, blockPosition, countDocBlocks, saveReadingPos } from "../services/reading-position";
    import { settleReadingMinutes } from "../services/reading-time";
    import { loadUiPrefs, saveUiPrefs, type ReaderTypography } from "../services/prefs";
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

    // T-1742 排版偏好：字号/行距三档（ui-prefs 持久化，纯视图状态）
    let typography = $state<ReaderTypography>({ fontSize: "md", lineHeight: "normal", width: "medium", theme: "follow" });
    $effect(() => {
        void loadUiPrefs(facade.pluginInstance).then((prefs) => {
            typography = prefs.readerTypography;
        });
    });

    function cycleFontSize(): void {
        const order: ReaderTypography["fontSize"][] = ["sm", "md", "lg"];
        typography = { ...typography, fontSize: order[(order.indexOf(typography.fontSize) + 1) % order.length] };
        void saveUiPrefs(facade.pluginInstance, { readerTypography: typography });
    }

    function cycleLineHeight(): void {
        const order: ReaderTypography["lineHeight"][] = ["compact", "normal", "relaxed"];
        typography = { ...typography, lineHeight: order[(order.indexOf(typography.lineHeight) + 1) % order.length] };
        void saveUiPrefs(facade.pluginInstance, { readerTypography: typography });
    }

    function cycleWidth(): void {
        const order: ReaderTypography["width"][] = ["narrow", "medium", "wide"];
        typography = { ...typography, width: order[(order.indexOf(typography.width) + 1) % order.length] };
        void saveUiPrefs(facade.pluginInstance, { readerTypography: typography });
    }

    function cycleTheme(): void {
        const order: ReaderTypography["theme"][] = ["follow", "paper", "sepia"];
        typography = { ...typography, theme: order[(order.indexOf(typography.theme) + 1) % order.length] };
        void saveUiPrefs(facade.pluginInstance, { readerTypography: typography });
    }

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
    let aiResult = $state<{ kind: "summarize" | "translate" | "ask" | "translateFull"; action: string; text: string } | null>(null);
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
            favorite = next?.favorite === true;
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
        // T-1746：恢复上次阅读断点（轻延迟等 Protyle 渲染首屏）
        window.setTimeout(() => void untrack(() => restoreReadingPos(id)), 600);
        // T-1746：滚动捕获阶段监听防抖写断点；离开/销毁立即落盘
        const scrollHost = protyle?.protyle?.element;
        const onScroll = () => scheduleReadingPos();
        scrollHost?.addEventListener("scroll", onScroll, true);
        return () => {
            scrollHost?.removeEventListener("scroll", onScroll, true);
            if (posSaveTimer) {
                clearTimeout(posSaveTimer);
                posSaveTimer = null;
            }
            void untrack(() => flushReadingPos());
            // T-1747：页签销毁结算本次阅读时长（cleanup 闭包捕获的 docId 是本文档初值——正确：
            // effect 依赖 docId，切文时旧 cleanup 先结算旧文档，新 effect 为新文档开新会话）
            // svelte-ignore state_referenced_locally
            void untrack(() => settleSessionFor(untrack(() => docId)));
            resetSession();
            protyle?.destroy();
            protyle = null;
            // T-1744：页签销毁时停止朗读，不留悬挂的语音队列
            stopSpeech(false);
        };
    });

    // T-1747：切文结算由 mount effect 的 docId 依赖处理（旧 cleanup 结算旧文档）；
    // 这里只挂 visibilitychange 暂停/恢复与显示刷新。
    $effect(() => {
        const onVisibility = () => (document.hidden ? pauseSession() : resumeSession());
        document.addEventListener("visibilitychange", onVisibility);
        const timer = setInterval(() => {
            sessionDisplay = Math.floor(sessionElapsedMs() / 60_000);
        }, 30_000);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            clearInterval(timer);
        };
    });

    $effect(() => {
        // T-1748 键盘流：document 级监听 + isReaderFocused 限定（仅焦点在阅读宿主时生效）
        document.addEventListener("keydown", handleHotkey);
        return () => document.removeEventListener("keydown", handleHotkey);
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

    /** T-1745 双语对照：全文翻译（租约/额度共享），结果入对照块（可折叠、可复制）。 */
    let translateFullOpen = $state(false);

    // T-1746 阅读断点与进度：滚动防抖写锚定块 + 细进度条（结构估计无百分比）+ 续读定位
    let readingPercent = $state(0);
    let posSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSavedPos = "";

    function currentAnchorId(): string {
        const host = protyle?.protyle?.element;
        if (!host) return "";
        return anchorBlockInViewport(host);
    }

    async function flushReadingPos(): Promise<void> {
        const id = docId;
        const anchor = currentAnchorId();
        if (!id || !anchor || anchor === lastSavedPos) return;
        lastSavedPos = anchor;
        try {
            await saveReadingPos(id, anchor, facade.pluginInstance);
            const [position, total] = await Promise.all([blockPosition(id, anchor), countDocBlocks(id)]);
            if (total > 0) readingPercent = Math.min(100, Math.round((position / total) * 100));
        } catch (error) {
            console.debug("[glean] 阅读断点写入失败:", error);
        }
    }

    function scheduleReadingPos(): void {
        if (posSaveTimer) clearTimeout(posSaveTimer);
        posSaveTimer = setTimeout(() => void flushReadingPos(), 30_000);
    }

    async function restoreReadingPos(id: string): Promise<void> {
        try {
            const restored = await readClipContext(id);
            const pos = restored?.readingPos ?? "";
            if (!pos || !protyle?.protyle?.element) return;
            protyle.protyle.element.querySelector(`[data-node-id="${pos}"]`)?.scrollIntoView({ block: "start" });
        } catch (error) {
            console.debug("[glean] 阅读断点恢复失败:", error);
        }
    }

    // T-1747 阅读计时：页签前台累计（visibilitychange 暂停），切文/销毁/标记已读结算。
    let sessionStart = Date.now();
    let pausedElapsed = 0;
    let sessionDisplay = $state(0);

    function pauseSession(): void {
        if (sessionStart > 0) {
            pausedElapsed += Date.now() - sessionStart;
            sessionStart = 0;
        }
    }

    function resumeSession(): void {
        if (sessionStart === 0) sessionStart = Date.now();
    }

    function sessionElapsedMs(): number {
        return pausedElapsed + (sessionStart > 0 ? Date.now() - sessionStart : 0);
    }

    /** 结算指定文档：累计 ≥1 分钟才写（增量累加，不足不写）。 */
    async function settleSessionFor(targetDocId: string): Promise<void> {
        const elapsed = sessionElapsedMs();
        pauseSession();
        pausedElapsed = 0;
        resumeSession();
        if (elapsed < 60_000 || !targetDocId) return;
        try {
            await settleReadingMinutes(facade.pluginInstance, targetDocId, Date.now() - elapsed);
        } catch (error) {
            console.debug("[glean] 阅读计时结算失败:", error);
        }
    }

    function resetSession(): void {
        sessionStart = Date.now();
        pausedElapsed = 0;
        sessionDisplay = 0;
    }

    // T-1748 键盘流：宿主聚焦时 j/k 步进滚动、e 切模式、m 标记已读、x 摘录、? 帮助。
    // 仅当焦点在阅读宿主内且不在输入控件时生效；与思源全局快捷键的冲突随 B-0002 真机核验。
    function stepToNeighborBlock(direction: 1 | -1): void {
        const host = protyle?.protyle?.element;
        if (!host) return;
        const blocks = Array.from(host.querySelectorAll("[data-node-id]"));
        const anchorId = currentAnchorId();
        const index = blocks.findIndex((block) => block.getAttribute("data-node-id") === anchorId);
        const next = blocks[Math.min(blocks.length - 1, Math.max(0, index + direction))];
        next?.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function showHotkeyHelp(): void {
        const wrap = document.createElement("div");
        const rows: Array<[string, string]> = [
            ["j / k", t(i18n, "reader.hotkeyScroll")],
            ["e", t(i18n, "reader.hotkeyMode")],
            ["m", t(i18n, "action.markDone")],
            ["x", t(i18n, "reader.excerptQuote")],
            ["?", t(i18n, "reader.hotkeyHelp")],
        ];
        wrap.innerHTML = rows
            .map(([key, label]) => `<div style="display:flex;gap:12px;padding:3px 0;font-size:12.5px"><span style="flex-shrink:0;font-weight:600">${key}</span><span>${label}</span></div>`)
            .join("");
        void import("../libs/dialog").then(({ simpleDialog: dialog }) => {
            dialog({ title: t(i18n, "reader.hotkeyHelp"), ele: wrap, width: "420px" });
        });
    }

    function isReaderFocused(): boolean {
        const host = document.querySelector(".glean-reader");
        if (!host) return false;
        const active = document.activeElement;
        const selection = window.getSelection();
        const anchor = selection && !selection.isCollapsed ? selection.anchorNode : active;
        return Boolean(anchor && host.contains(anchor));
    }

    function handleHotkey(event: KeyboardEvent): void {
        if (!docId || !isReaderFocused()) return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        switch (event.key) {
            case "j":
                event.preventDefault();
                stepToNeighborBlock(1);
                break;
            case "k":
                event.preventDefault();
                stepToNeighborBlock(-1);
                break;
            case "e":
                event.preventDefault();
                setMode(mode === "read" ? "edit" : "read");
                break;
            case "m":
                event.preventDefault();
                void writeStatus("done");
                break;
            case "x":
                event.preventDefault();
                void quoteExcerpt();
                break;
            case "?":
                event.preventDefault();
                showHotkeyHelp();
                break;
        }
    }

    async function runTranslateFull(): Promise<void> {
        if (!context || aiBusy) return;
        aiBusy = "translateFull";
        try {
            const outcome = await readerTranslateFull(facade.pluginInstance, context.id, facade.settings);
            if (outcome.ok && outcome.text) {
                aiResult = { kind: "translateFull", action: t(i18n, "reader.aiTranslateFull"), text: outcome.text };
                translateFullOpen = true;
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            aiBusy = "";
        }
    }

    // T-1751 AI 问句制卡：AI 生成回忆问句 → 用户可改 → 确认入卡（写入由用户触发）。
    let questionDraft = $state("");
    let questionBusy = $state(false);

    async function generateQuestion(): Promise<void> {
        if (!excerpt?.text || questionBusy) return;
        questionBusy = true;
        try {
            const outcome = await inferQuestionCard(facade.pluginInstance, excerpt.text, facade.settings);
            if (outcome.ok && outcome.text) {
                questionDraft = outcome.text;
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            questionBusy = false;
        }
    }

    async function makeQuestionCard(): Promise<void> {
        if (!context || !excerpt?.text || !questionDraft.trim()) return;
        try {
            await makeQuoteCard(facade.settings, context.title, excerpt.text, facade.pluginInstance, questionDraft.trim());
            showMessage(t(i18n, "flashcard.done"), 3000);
            questionDraft = "";
        } catch (error) {
            showMessage(String(error).slice(0, 120), 4000);
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
        const previous = mode;
        mode = next;
        try {
            protyle.switchMode(modeValue(next));
            showMessage(t(i18n, next === "edit" ? "reader.editHint" : "reader.readHint"), 2500);
        } catch (error) {
            // T-2022 切换失败：回滚选中态并给可重试反馈，不静默
            mode = previous;
            console.warn("[glean] 阅读模式切换失败:", error);
            showMessage(t(i18n, "msg.actionFailed"), 3000);
        }
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
            // T-1747：标记已读前结算本次阅读时长（read-minutes 含最后一次会话）
            if (status === "done") await settleSessionFor(current.id);
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
            // T-1747：标记已读前结算本次阅读时长
            await settleSessionFor(current.id);
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

<div class="glean-reader glean-reader--font-{typography.fontSize} glean-reader--lh-{typography.lineHeight} glean-reader--w-{typography.width} glean-reader--theme-{typography.theme}">
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
            {#if readingPercent > 0}
                <!-- T-1746：结构估计进度条（无百分比数字，遵守 T-1728 反伪精确纪律） -->
                <div class="glean-reader__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingPercent} aria-label={t(i18n, "reader.readingProgress")}>
                    <i style={`width:${readingPercent}%`}></i>
                </div>
            {/if}
            <div class="glean-reader__titleline">
                <div class="glean-reader__title" title={context?.title}>{context?.title || t(i18n, "panel.untitled")}</div>
                {#if context}
                    <!-- T-1755 收藏星标 -->
                    <button
                        class="glean-reader__fav"
                        class:glean-reader__fav--on={favorite}
                        role="switch"
                        aria-checked={favorite}
                        title={t(i18n, favorite ? "action.unfavorite" : "action.favorite")}
                        onclick={() => void toggleFavoriteFlag()}
                    >{favorite ? "★" : "☆"}</button>
                {/if}
            </div>
            <div class="glean-reader__meta">
                <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(context?.contentType)}`}>
                    {carrierLabel(context?.contentType)}
                </span>
                {#if context?.site}<span>{context.site}</span>{/if}
                {#if sessionDisplay > 0}
                    <!-- T-1747：本次会话阅读时长（会话状态，不落属性） -->
                    <span>· {t(i18n, "reader.sessionMinutes", { n: sessionDisplay })}</span>
                {/if}
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
            <!-- T-2022 parity：挂 .glean-seg 容器（胶囊轨道/padding），与 Settings/Dock 同一控件形态 -->
            <div class="glean-seg glean-reader__mode" role="group" aria-label={t(i18n, "settings.readerMode")}>
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
                <!-- T-1742/T-1743 排版偏好：字号/行距/栏宽/主题循环（纯视图状态，ui-prefs 持久化） -->
                <button
                    class="glean-seg__btn"
                    title={t(i18n, "reader.typographyFont")}
                    onclick={() => cycleFontSize()}
                >A</button>
                <button
                    class="glean-seg__btn"
                    title={t(i18n, "reader.typographyLine")}
                    onclick={() => cycleLineHeight()}
                >{typography.lineHeight === "compact" ? "≡" : typography.lineHeight === "normal" ? "≣" : "☰"}</button>
                <button
                    class="glean-seg__btn"
                    title={t(i18n, "reader.typographyWidth")}
                    onclick={() => cycleWidth()}
                >{typography.width === "narrow" ? "⇥⇤" : typography.width === "medium" ? "⇹" : "⟷"}</button>
                <button
                    class="glean-seg__btn"
                    title={t(i18n, "reader.typographyTheme")}
                    onclick={() => cycleTheme()}
                >{typography.theme === "paper" ? "📄" : typography.theme === "sepia" ? "☕" : "◐"}</button>
            </div>
            {#if context}
                {@const activeDocId = context.id}
                <ClipStatusActions
                    {i18n}
                    status={context.status}
                    disabled={statusBusy}
                    onStartReading={() => void startReading()}
                    onSetStatus={(status) => void writeStatus(status)}
                    onArchive={() => facade.openArchiveDialog(activeDocId)}
                    onRestore={() => facade.openRestoreDialog(activeDocId)}
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
                                {#if aiOn}
                                    <!-- T-1751 AI 问句制卡：生成回忆问句 → 可改 → 确认入卡 -->
                                    <button
                                        class="glean-btn glean-btn--ghost"
                                        disabled={questionBusy || !excerpt.text}
                                        title={t(i18n, "reader.questionCardHint")}
                                        onclick={() => void generateQuestion()}
                                    >{questionBusy ? "…" : "❓"} {t(i18n, "reader.questionCard")}</button>
                                {/if}
                                <button class="glean-btn glean-btn--ghost" onclick={() => void copyExcerpt()}>
                                    {t(i18n, "reader.copy")}
                                </button>
                            </div>
                            {#if questionDraft.trim()}
                                <!-- T-1751：AI 问句草稿（可改）→ 确认入卡 -->
                                <div class="glean-reader__ask">
                                    <input
                                        class="glean-mini-input glean-reader__ask-input"
                                        type="text"
                                        bind:value={questionDraft}
                                        maxlength={120}
                                        aria-label={t(i18n, "reader.questionCard")}
                                    />
                                    <button class="glean-btn glean-btn--ghost" onclick={() => void makeQuestionCard()}>
                                        {t(i18n, "reader.questionCardMake")}
                                    </button>
                                </div>
                            {/if}
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
                                <!-- T-1745 双语对照：全文翻译入对照块 -->
                                <button
                                    class="glean-btn glean-btn--ghost"
                                    disabled={Boolean(aiBusy)}
                                    onclick={() => void runTranslateFull()}
                                >文A+ {t(i18n, "reader.aiTranslateFull")}</button>
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
                            {#if aiResult?.kind === "translateFull"}
                                <!-- T-1745 双语对照块：全文译文折叠展示，可复制；AI 来源同标记 -->
                                <div class="glean-reader__bilingual">
                                    <button
                                        class="glean-btn glean-btn--ghost glean-reader__bilingual-toggle"
                                        aria-expanded={translateFullOpen}
                                        onclick={() => (translateFullOpen = !translateFullOpen)}
                                    >{translateFullOpen ? "▾" : "▸"} {t(i18n, "reader.bilingualTitle")}</button>
                                    {#if translateFullOpen}
                                        {@const fullText = aiResult.text}
                                        <div class="glean-reader__bilingual-text">{fullText}</div>
                                        <div class="glean-reader__ops">
                                            <button class="glean-btn glean-btn--ghost" onclick={() => void copyText(fullText)}>
                                                {t(i18n, "reader.copy")}
                                            </button>
                                        </div>
                                    {/if}
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
                    <button
                        class="glean-btn glean-btn--ghost"
                        disabled={snapping}
                        title={context.snapshot ? t(i18n, "snapshot.open") : t(i18n, "snapshot.take")}
                        onclick={() => void takeSnapshot()}
                    >
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

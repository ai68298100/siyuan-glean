<script lang="ts">
    import AuthorEditor from "./AuthorEditor.svelte";
    /**
     * 内嵌阅读页签（D-0029/T-1730）：左 = 真实思源编辑器（Protyle 实例），右 = 伴生栏。
     * 页签打开文档是"打开动作"，不写五态（D-0021）；伴生栏动作与三画布共用同一服务，
     * 按真实成功数反馈。编辑/标注经 Protyle 走内核事务，插件不另存正文副本。
     */
    import { showMessage, openTab } from "siyuan";
    import type { ProtyleController } from "../libs/protyle-controller";
    import ProtyleHost from "./ProtyleHost.svelte";
    import ReadingPositionControls from "./ReadingPositionControls.svelte";
    import { onMount } from "svelte";
    import { untrack } from "svelte";
    import type { GleanFacade } from "../types";
    import { t } from "../libs/i18n";
    import { fulltextBodyState } from "../domain/content";
    import { canCountReading, createReadingTimer, readingTimerMinutes, setReadingTimerActive, type ReadingTimerState } from "../domain/reading-timer";
    import { hasSourceAction, resolveCarrier, sourceUrlForCarrier } from "../domain/carrier";
    import { chunkSpeechText, clampSpeechRate, speechLanguage } from "../domain/speech";
    import type { ClipStatus } from "../domain/schema";
    import { DEFAULT_SETTINGS } from "../services/settings";
    import {
        batchSetStatus,
        measureClipBody,
        readClipContext,
        saveReadingMinutes,
        writeClip,
        type ReadingClipContext,
    } from "../services/clip-store";
    import { snapshotClip } from "../services/snapshot-service";
    import { recordReadingDone } from "../services/checkin-bridge";
    import { excerptFromSelection, insertQuoteExcerpt, selectionBelongsToHost } from "../services/excerpt-service";
    import { makeQuoteCardPreview } from "./flashcard-dialog";
    import { findRelated } from "../services/enrich-service";
    import { pickNextUnread } from "../services/resurface-service";
    import { articleQuestionEnabled, readerAiEnabled, readerArticleQuestion, readerSummarize, readerTranslate, saveReaderSummary } from "../services/reader-ai";
    import ClipStatusActions from "./ClipStatusActions.svelte";
    import ClipRankControls from "./ClipRankControls.svelte";
    import { openFormattingDialog } from "./formatting-dialog";
    import { loadUiPrefs, saveUiPrefs } from "../services/prefs";
    import { normalizeReaderAppearance, type ReaderAppearance } from "../domain/ui-prefs";
    import { loadReadingOutline } from "../services/outline-service";
    import type { OutlineItem } from "../domain/outline";
    import { readerShortcut } from "../domain/reader-shortcuts";
    import { createLatestRequestGate } from "../libs/latest-request";
    import type { RecentReadingEntry } from "../domain/recent-reading";

    interface Props {
        facade: GleanFacade;
    }

    let { facade }: Props = $props();
    const i18n = $derived(facade.i18n);

    let docId = $state<string | null>(null);
    let mode = $state<"read" | "edit">(DEFAULT_SETTINGS.reader.defaultMode);
    let protyleHost = $state<HTMLDivElement | null>(null);
    let readerRoot = $state<HTMLDivElement | null>(null);
    let sidebarCollapsed = $state(false);
    let sidebarBusy = $state(false);
    let shortcutHelp = $state(false);
    let excerptBusy = $state(false);
    let appearanceTouched = false;
    let sidebarTouched = false;
    const contextRequests = createLatestRequestGate();
    let sessionGeneration = 0;
    let mounted = false;
    let context = $state<ReadingClipContext | null>(null);
    let measuring = $state(false);
    let snapping = $state(false);
    let statusBusy = $state(false);
    let protyle = $state<ProtyleController | null>(null);
    let readerAppearance = $state<ReaderAppearance>(normalizeReaderAppearance(undefined));
    let appearanceBusy = $state(false);
    let outline = $state<OutlineItem[]>([]);
    let outlineLoading = $state(false);
    let outlineError = $state(false);
    let outlineGeneration = 0;
    let recentReadings = $state<RecentReadingEntry[]>([]);
    let readingTimer = $state<ReadingTimerState>(createReadingTimer());
    let readingTimerDocId = "";
    let readingTimerExpectedRaw: string | null = null;
    let readingTimerExpectedLocation: { box: string; hpath: string } | null = null;
    const displayedReadMinutes = $derived(Math.max(context?.readMinutes ?? 0, readingTimerMinutes(readingTimer)));

    function readingTimerHostReady(): boolean {
        const host = protyleHost;
        if (!host || !host.isConnected || host.getClientRects().length === 0) return false;
        return Boolean(host.querySelector(".protyle-wysiwyg, .protyle-content, .protyle-preview"));
    }

    function readingTimerEligible(): boolean {
        return Boolean(docId && context && mode === "read" && typeof document !== "undefined" && canCountReading({
            visible: document.visibilityState === "visible",
            focused: typeof document.hasFocus !== "function" || document.hasFocus(),
            hostReady: readingTimerHostReady(),
            contentType: context.contentType,
            bodyState,
        }));
    }

    function syncReadingTimer(): void {
        if (!readingTimerDocId) return;
        readingTimer = setReadingTimerActive(readingTimer, readingTimerEligible(), Date.now());
    }

    async function flushReadingMinutes(id: string, generation: number): Promise<boolean> {
        if (readingTimerDocId !== id || !readingTimerExpectedLocation) return true;
        readingTimer = setReadingTimerActive(readingTimer, false, Date.now());
        const minutes = readingTimerMinutes(readingTimer);
        const persisted = context?.id === id ? context.readMinutes ?? 0 : 0;
        if (minutes <= persisted || minutes <= 0) return true;
        try {
            const saved = await saveReadingMinutes(facade.pluginInstance, id, {
                raw: readingTimerExpectedRaw,
                location: readingTimerExpectedLocation,
            }, minutes);
            readingTimerExpectedRaw = saved.raw;
            if (currentSession(id, generation) && context?.id === id) {
                context = { ...context, readMinutes: saved.minutes, readMinutesRaw: saved.raw };
            }
            return true;
        } catch (error) {
            console.debug("[glean] 真实阅读分钟写回失败:", error);
            showMessage(t(i18n, "reader.readMinutesSaveFailed"), 3500);
            return false;
        }
    }

    function refreshRecentReadings(): void {
        recentReadings = facade.recentReadingDocuments().map((entry) => ({ ...entry }));
    }

    function openRecentReading(entry: RecentReadingEntry): void {
        if (entry.id === docId) return;
        facade.openReader(entry.id);
    }

    onMount(() => {
        mounted = true;
        docId = facade.consumeReaderFocus();
        refreshRecentReadings();
        mode = facade.settings.reader.defaultMode;
        void loadUiPrefs(facade.pluginInstance).then((prefs) => {
            if (!mounted) return;
            if (!appearanceTouched) readerAppearance = prefs.readerAppearance;
            if (!sidebarTouched) sidebarCollapsed = prefs.readerSidebarCollapsed;
        }).catch(() => undefined);
        const root = readerRoot;
        root?.addEventListener("keydown", onReaderKey);
        return () => {
            readingTimer = setReadingTimerActive(readingTimer, false, Date.now());
            mounted = false;
            sessionGeneration += 1;
            contextRequests.invalidate();
            root?.removeEventListener("keydown", onReaderKey);
        };
    });

    type SpeechState = "idle" | "playing" | "paused";
    type SpeechScope = "full" | "selection";
    let speechState = $state<SpeechState>("idle");
    let speechScope = $state<SpeechScope | null>(null);
    let speechRate = $state(1);
    let speechChunks = $state<string[]>([]);
    let speechChunkIndex = $state(0);
    let speechGeneration = 0;
    const speechSupported = $derived(!facade.isMobile && typeof window !== "undefined" && "speechSynthesis" in window);

    const bodyState = $derived(context ? fulltextBodyState(context.contentType, context.words) : "na");

    // 摘录段（D-0030）：selectionchange 限定正文宿主内；blockId 空=定位失败，仅可复制。
    let excerpt = $state<{ text: string; blockId: string } | null>(null);

    // AI 伴读段（D-0030）：显式动作 + 结果卡；额度与富化共享。
    const aiOn = $derived(readerAiEnabled(facade.settings));
    const relatedOn = $derived(aiOn && facade.settings.ai.relatedWhileReading);
    const articleQuestionOn = $derived(articleQuestionEnabled(facade.settings));
    const channelLabel = $derived(
        facade.settings.ai.channel === "custom"
            ? facade.settings.ai.customModel || "custom"
            : t(i18n, "reader.aiChannelSiyuan")
    );
    let aiBusy = $state("");
    let aiResult = $state<{ kind: "summarize" | "translate"; action: string; text: string } | null>(null);
    let question = $state("");
    let questionMode = $state<"full" | "selection">("full");
    let questionResult = $state<{ answer: string; evidence: string[]; truncated: boolean } | null>(null);
    let relatedItems = $state<Array<{ id: string; title: string }>>([]);
    let relatedShown = $state(false);

    function speechSynthesis(): SpeechSynthesis | null {
        return speechSupported ? window.speechSynthesis : null;
    }

    function stopSpeech(): void {
        speechGeneration += 1;
        speechSynthesis()?.cancel();
        speechState = "idle";
    }

    function speechBodyText(): string {
        const root = protyleHost?.querySelector<HTMLElement>(".protyle-wysiwyg") ?? protyleHost;
        return root?.innerText ?? "";
    }

    function speakCurrent(generation: number): void {
        if (generation !== speechGeneration || speechState !== "playing") return;
        const api = speechSynthesis();
        const chunk = speechChunks[speechChunkIndex];
        if (!api || !chunk) {
            speechState = "idle";
            return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = speechLanguage(chunk);
        utterance.rate = speechRate;
        utterance.onend = () => {
            if (generation !== speechGeneration || speechState !== "playing") return;
            speechChunkIndex += 1;
            if (speechChunkIndex >= speechChunks.length) {
                speechState = "idle";
                return;
            }
            speakCurrent(generation);
        };
        utterance.onerror = (event) => {
            if (generation !== speechGeneration || event.error === "canceled" || event.error === "interrupted") return;
            speechState = "idle";
            showMessage(t(i18n, "reader.speechFailed"), 3000);
        };
        api.speak(utterance);
    }

    function startSpeech(scope: SpeechScope, continueCurrent = false): void {
        const api = speechSynthesis();
        if (!api) return;
        if (!continueCurrent) {
            const text = scope === "selection" ? excerpt?.text ?? "" : speechBodyText();
            speechChunks = chunkSpeechText(text);
            speechChunkIndex = 0;
            speechScope = scope;
        }
        if (speechChunkIndex >= speechChunks.length) {
            showMessage(t(i18n, "reader.speechNoText"), 2500);
            return;
        }
        api.cancel();
        speechGeneration += 1;
        speechState = "playing";
        speakCurrent(speechGeneration);
    }

    function toggleSpeechPause(): void {
        const api = speechSynthesis();
        if (!api) return;
        if (speechState === "playing") {
            api.pause();
            speechState = "paused";
        } else if (speechState === "paused") {
            api.resume();
            speechState = "playing";
        }
    }

    function setSpeechRate(value: number): void {
        const next = clampSpeechRate(value);
        if (next === speechRate) return;
        speechRate = next;
        if (speechState !== "playing" && speechState !== "paused") return;
        const api = speechSynthesis();
        if (!api) return;
        const resumePaused = speechState === "paused";
        api.cancel();
        speechGeneration += 1;
        speechState = "playing";
        const generation = speechGeneration;
        window.setTimeout(() => {
            speakCurrent(generation);
            if (resumePaused && generation === speechGeneration) {
                api.pause();
                speechState = "paused";
            }
        }, 0);
    }

    function modeValue(value: "read" | "edit"): "preview" | "wysiwyg" {
        return value === "edit" ? "wysiwyg" : "preview";
    }

    async function loadContext(id: string): Promise<void> {
        const isCurrent = contextRequests.begin();
        try {
            const next = await readClipContext(id);
            if (mounted && isCurrent() && docId === id) {
                context = next;
                if (next && readingTimerDocId !== id) {
                    readingTimerDocId = id;
                    readingTimerExpectedRaw = next.readMinutesRaw;
                    readingTimerExpectedLocation = next.location;
                    readingTimer = createReadingTimer(next.readMinutes ?? 0);
                }
                if (next) facade.recordRecentReading(id, next.title);
            }
        } catch (error) {
            if (!mounted || !isCurrent() || docId !== id) return;
            console.debug("[glean] 阅读页签读取上下文失败:", error);
            context = null;
            readingTimerDocId = "";
            readingTimerExpectedRaw = null;
            readingTimerExpectedLocation = null;
            readingTimer = createReadingTimer();
        }
    }

    async function loadOutline(id: string): Promise<void> {
        const generation = ++outlineGeneration;
        outlineLoading = true;
        outlineError = false;
        try {
            const next = await loadReadingOutline(id, () => mounted && generation === outlineGeneration && docId === id);
            if (generation !== outlineGeneration || docId !== id) return;
            outline = next;
        } catch (error) {
            if (generation !== outlineGeneration || docId !== id) return;
            console.debug("[glean] 阅读大纲读取失败:", error);
            outline = [];
            outlineError = true;
        } finally {
            if (generation === outlineGeneration) outlineLoading = false;
        }
    }

    function scrollToOutline(item: OutlineItem): void {
        const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(item.id) : item.id;
        const target = protyleHost?.querySelector<HTMLElement>(`[data-node-id="${escaped}"]`);
        if (target) {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
            target.focus({ preventScroll: true });
            return;
        }
        if (docId) void openTab({ app: facade.pluginInstance.app, doc: { id: item.id }, keepCursor: false });
    }

    async function updateAppearance(key: keyof ReaderAppearance, value: string): Promise<void> {
        appearanceTouched = true;
        const next = normalizeReaderAppearance({ ...readerAppearance, [key]: value });
        readerAppearance = next;
        appearanceBusy = true;
        try {
            await saveUiPrefs(facade.pluginInstance, { readerAppearance: next });
        } catch (error) {
            console.debug("[glean] 阅读外观保存失败:", error);
            showMessage(t(i18n, "settings.saveFailed"), 3000);
        } finally {
            appearanceBusy = false;
        }
    }

    async function toggleSidebar(): Promise<void> {
        if (sidebarBusy) return;
        sidebarTouched = true;
        sidebarCollapsed = !sidebarCollapsed;
        sidebarBusy = true;
        try {
            await saveUiPrefs(facade.pluginInstance, { readerSidebarCollapsed: sidebarCollapsed });
        } catch {
            showMessage(t(i18n, "settings.saveFailed"), 3000);
        } finally {
            sidebarBusy = false;
        }
    }

    function currentSession(id: string, generation: number): boolean {
        return mounted && docId === id && sessionGeneration === generation;
    }

    function onReaderKey(event: KeyboardEvent): void {
        const root = readerRoot;
        const target = event.target instanceof Element ? event.target : null;
        const active = document.activeElement;
        const blockedTarget = target?.closest('input, textarea, select, button, a, [role="textbox"], [role="combobox"], [role="menu"], [role="menuitem"], [role="dialog"], [contenteditable]:not([contenteditable="false"])');
        const modalOpen = Array.from(document.querySelectorAll<HTMLElement>('.b3-dialog, .b3-menu, [role="dialog"], [aria-modal="true"]'))
            .some((element) => element.getClientRects().length > 0);
        const action = readerShortcut({
            key: event.key, mode, focused: Boolean(root && active && root.contains(active) && root.getClientRects().length),
            blocked: Boolean(blockedTarget || modalOpen), defaultPrevented: event.defaultPrevented,
            isComposing: event.isComposing, keyCode: event.keyCode, ctrlKey: event.ctrlKey,
            altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey, repeat: event.repeat,
        });
        if (!action || !docId) return;
        if (action === "done" && (!context || context.id !== docId || statusBusy || context.status === "done")) return;
        if (action === "excerpt") {
            excerpt = excerptFromSelection(protyleHost, window.getSelection());
            if (!excerpt?.blockId || !context || context.id !== docId || excerptBusy) return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (action === "scrollDown" || action === "scrollUp") {
            const scroller = Array.from(protyleHost?.querySelectorAll<HTMLElement>(".protyle-content, .protyle-preview") ?? [])
                .find((element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1) ?? protyleHost;
            scroller?.scrollBy({ top: (action === "scrollDown" ? 1 : -1) * Math.max(80, (scroller.clientHeight || 500) / 4), behavior: "auto" });
        } else if (action === "edit") setMode("edit");
        else if (action === "done") void writeStatus("done");
        else if (action === "excerpt") void quoteExcerpt();
        else shortcutHelp = !shortcutHelp;
    }

    $effect(() => {
        void sidebarCollapsed;
        untrack(() => protyle?.resize());
    });

    // 挂载效果只依赖 docId 与宿主节点；模式切换走 switchMode，不重建实例（保留位置）。
    $effect(() => {
        const id = docId;
        const host = protyleHost;
        if (!id || !host) return;
        sessionGeneration += 1;
        contextRequests.invalidate();
        context = null;
        readingTimerDocId = "";
        readingTimerExpectedRaw = null;
        readingTimerExpectedLocation = null;
        readingTimer = createReadingTimer();
        outline = [];
        aiResult = null;
        questionResult = null;
        question = "";
        questionMode = "full";
        relatedShown = false;
        relatedItems = [];
        excerpt = null;
        stopSpeech();
        void untrack(() => loadContext(id));
        void untrack(() => loadOutline(id));
        return () => {
            sessionGeneration += 1;
            contextRequests.invalidate();
            stopSpeech();
            outlineGeneration += 1;
        };
    });

    // 页签聚焦与尺寸事件由壳派发；数据变化后只刷新伴生栏，不动正文实例。
    $effect(() => {
        const onFocus = () => {
            const id = facade.consumeReaderFocus();
            if (id) docId = id;
        };
        const onRecentReading = () => refreshRecentReadings();
        const onResize = () => protyle?.resize();
        const onData = () => {
            if (docId) {
                void loadContext(docId);
                void loadOutline(docId);
            }
        };
        const onVisibility = () => syncReadingTimer();
        const onWindowFocus = () => syncReadingTimer();
        const onWindowBlur = () => syncReadingTimer();
        const onSelect = () => {
            const selection = window.getSelection();
            excerpt = selectionBelongsToHost(protyleHost, selection) ? excerptFromSelection(protyleHost, selection) : null;
        };
        document.addEventListener("glean:focus-reader", onFocus);
        document.addEventListener("glean:recent-reading-changed", onRecentReading);
        document.addEventListener("glean:reader-resize", onResize);
        document.addEventListener("glean:data-changed", onData);
        document.addEventListener("selectionchange", onSelect);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onWindowFocus);
        window.addEventListener("blur", onWindowBlur);
        return () => {
            document.removeEventListener("glean:focus-reader", onFocus);
            document.removeEventListener("glean:recent-reading-changed", onRecentReading);
            document.removeEventListener("glean:reader-resize", onResize);
            document.removeEventListener("glean:data-changed", onData);
            document.removeEventListener("selectionchange", onSelect);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", onWindowFocus);
            window.removeEventListener("blur", onWindowBlur);
        };
    });

    $effect(() => {
        void docId;
        void context;
        void protyleHost;
        void mode;
        void bodyState;
        untrack(syncReadingTimer);
    });

    function openRelatedDoc(id: string, title = ""): void {
        stopSpeech();
        facade.recordRecentReading(id, title);
        docId = id;
        aiResult = null;
        relatedShown = false;
        relatedItems = [];
        excerpt = null;
    }

    async function quoteExcerpt(): Promise<void> {
        if (!excerpt?.blockId || !context || context.id !== docId || excerptBusy) return;
        excerptBusy = true;
        try {
            await insertQuoteExcerpt(excerpt.blockId, excerpt.text);
            showMessage(t(i18n, "reader.excerptDone"), 2500);
            facade.notifyDataChanged();
        } catch (error) {
            console.warn("[glean] 摘录插入失败:", error);
            showMessage(t(i18n, "reader.actionFailed"), 3000);
        } finally {
            excerptBusy = false;
        }
    }

    async function cardFromExcerpt(): Promise<void> {
        if (!excerpt?.text || !context || context.id !== docId) return;
        try {
            makeQuoteCardPreview(facade, { title: context.title, quote: excerpt.text, docId: context.id, blockId: excerpt.blockId });
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
        if (!context || context.id !== docId || aiBusy) return;
        const current = context;
        const generation = sessionGeneration;
        aiBusy = "summarize";
        try {
            const outcome = await readerSummarize(facade.pluginInstance, current.id, facade.settings);
            if (!currentSession(current.id, generation)) return;
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
        if (!context || context.id !== docId || aiBusy || !excerpt?.text) return;
        const current = context;
        const generation = sessionGeneration;
        aiBusy = "translate";
        try {
            const outcome = await readerTranslate(facade.pluginInstance, current.id, excerpt.text, facade.settings);
            if (!currentSession(current.id, generation)) return;
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

    async function runArticleQuestion(): Promise<void> {
        if (!context || context.id !== docId || aiBusy || !articleQuestionOn) return;
        const current = context;
        const generation = sessionGeneration;
        const source = questionMode === "selection" && excerpt?.blockId ? excerpt.text : "";
        if (questionMode === "selection" && !source) {
            showMessage(t(i18n, "reader.articleQuestion.invalid"), 3000);
            return;
        }
        aiBusy = "question";
        questionResult = null;
        try {
            const outcome = await readerArticleQuestion(facade.pluginInstance, current.id, question, facade.settings, source, questionMode === "selection" ? excerpt?.blockId ?? "" : "");
            if (!currentSession(current.id, generation)) return;
            if (outcome.ok && outcome.result) {
                questionResult = { answer: outcome.result.answer, evidence: outcome.result.evidence, truncated: Boolean(outcome.truncated) };
            } else if (outcome.skipped === "cap") {
                showMessage(t(i18n, "ai.capReached", { n: facade.settings.ai.enrichDailyCap }), 4000);
            } else if (outcome.skipped === "changed") {
                showMessage(t(i18n, "reader.articleQuestion.changed"), 3500);
            } else if (outcome.skipped === "invalid") {
                showMessage(t(i18n, "reader.articleQuestion.invalid"), 3000);
            } else if (outcome.skipped !== "off") {
                showMessage(t(i18n, "ai.enrichFailed"), 3000);
            }
        } finally {
            aiBusy = "";
        }
    }

    async function runRelated(): Promise<void> {
        if (!context || context.id !== docId || aiBusy) return;
        const current = context;
        const generation = sessionGeneration;
        aiBusy = "related";
        try {
            const items = await findRelated(current.id, current.title, [], { plugin: facade.pluginInstance, settings: facade.settings });
            if (!currentSession(current.id, generation)) return;
            relatedItems = items;
            relatedShown = true;
            if (relatedItems.length === 0) showMessage(t(i18n, "reader.relatedNone"), 3000);
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
        if (!aiResult || aiResult.kind !== "summarize" || !context || context.id !== docId) return;
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
        protyle.setMode(modeValue(next));
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
        if (!context || context.id !== docId || measuring) return;
        const current = context;
        const generation = sessionGeneration;
        measuring = true;
        try {
            const measured = await measureClipBody(facade.pluginInstance, current.id);
            facade.notifyDataChanged();
            if (!currentSession(current.id, generation)) return;
            if (context?.id === current.id) context = { ...context, words: measured.words };
            showMessage(
                measured.missing
                    ? t(i18n, "clip.bodyMissingConfirm")
                    : t(i18n, "clip.bodyOk", { n: measured.words }),
                3500
            );
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
        if (!context || context.id !== docId || statusBusy) return;
        const current = context;
        const generation = sessionGeneration;
        statusBusy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], status);
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return;
            }
            if (status === "done") await flushReadingMinutes(current.id, generation);
            if (status === "done" && facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            if (currentSession(current.id, generation)) {
                contextRequests.invalidate();
                context = { ...(context?.id === current.id ? context : current), status };
            }
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
        if (!context || context.id !== docId || statusBusy) return;
        const current = context;
        const generation = sessionGeneration;
        statusBusy = true;
        try {
            const changed = await batchSetStatus(facade.pluginInstance, [current.id], "done");
            if (changed !== 1) {
                showMessage(t(i18n, "msg.statusFailed"), 3000);
                return;
            }
            await flushReadingMinutes(current.id, generation);
            if (facade.settings.integration.checkinEnabled && facade.settings.integration.checkinItemId) {
                void recordReadingDone(facade.settings.integration.checkinItemId, current.id, current.title);
            }
            facade.notifyDataChanged();
            const next = await pickNextUnread(facade.pluginInstance, current.id);
            if (!currentSession(current.id, generation)) return;
            if (!next) {
                contextRequests.invalidate();
                context = { ...(context?.id === current.id ? context : current), status: "done" };
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
        if (!context || context.id !== docId || statusBusy) return;
        const current = context;
        const generation = sessionGeneration;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, current.id, { priority: value }, { force: true });
            if (currentSession(current.id, generation)) {
                contextRequests.invalidate();
                context = { ...(context?.id === current.id ? context : current), priority: value };
            }
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function setRating(value: number): Promise<void> {
        if (!context || context.id !== docId || statusBusy) return;
        const current = context;
        const generation = sessionGeneration;
        statusBusy = true;
        try {
            await writeClip(facade.pluginInstance, current.id, { rating: value }, { force: true });
            if (currentSession(current.id, generation)) {
                contextRequests.invalidate();
                context = { ...(context?.id === current.id ? context : current), rating: value };
            }
            facade.notifyDataChanged();
            showMessage(t(i18n, "msg.rankSaved"), 2500);
        } catch {
            showMessage(t(i18n, "msg.statusFailed"), 3000);
        } finally {
            statusBusy = false;
        }
    }

    async function takeSnapshot(): Promise<void> {
        if (!context || context.id !== docId || snapping) return;
        if (context.snapshot) {
            void openTab({ app: facade.pluginInstance.app, asset: { path: context.snapshot } });
            return;
        }
        const current = context;
        const generation = sessionGeneration;
        snapping = true;
        try {
            const { path } = await snapshotClip(facade.pluginInstance, current.id);
            if (currentSession(current.id, generation)) {
                contextRequests.invalidate();
                context = { ...(context?.id === current.id ? context : current), snapshot: path };
            }
            showMessage(t(i18n, "snapshot.done"), 3000);
            facade.notifyDataChanged();
        } catch {
            showMessage(t(i18n, "snapshot.failed"), 3000);
        } finally {
            snapping = false;
        }
    }

    function backToLibrary(): void {
        stopSpeech();
        if (context?.id === docId) void facade.openLibraryArticle(context.id);
    }

    function carrierLabel(value: string | undefined): string {
        return t(i18n, `clip.type.${resolveCarrier(value)}`);
    }
</script>

<div
    class="glean-reader"
    bind:this={readerRoot}
    role="region"
    tabindex="-1"
    aria-label={t(i18n, "reader.title")}
    data-reader-font-size={readerAppearance.fontSize}
    data-reader-line-height={readerAppearance.lineHeight}
    data-reader-width={readerAppearance.width}
    data-reader-theme={readerAppearance.theme}
>
    {#if docId}
        <div class="glean-reader__toolbar">
            <span class="glean-reader__toolbar-title" title={context?.title}>{context?.title || t(i18n, "panel.untitled")}</span>
            <div class="glean-reader__mode" role="group" aria-label={t(i18n, "settings.readerMode")}>
                <button class="glean-seg__btn" class:glean-seg__btn--on={mode === "read"} aria-pressed={mode === "read"} title={t(i18n, "reader.readHint")} onclick={() => setMode("read")}>{t(i18n, "reader.modeRead")}</button>
                <button class="glean-seg__btn" class:glean-seg__btn--on={mode === "edit"} aria-pressed={mode === "edit"} title={t(i18n, "reader.editHint")} onclick={() => setMode("edit")}>{t(i18n, "reader.modeEdit")}</button>
            </div>
            <button class="glean-btn glean-btn--ghost" disabled={sidebarBusy} aria-expanded={!sidebarCollapsed} onclick={() => void toggleSidebar()}>{t(i18n, sidebarCollapsed ? "reader.sidebarShow" : "reader.sidebarHide")}</button>
            <button class="glean-btn glean-btn--ghost" disabled={mode !== "read"} onclick={() => readerRoot?.focus({ preventScroll: true })}>{t(i18n, "reader.keyboardFocus")}</button>
            <button class="glean-btn glean-btn--ghost" aria-expanded={shortcutHelp} onclick={() => shortcutHelp = !shortcutHelp}>{t(i18n, "reader.shortcuts")}</button>
        </div>
        {#if shortcutHelp}
            <div class="glean-reader__shortcuts">
                <p>{t(i18n, "reader.shortcutsHint")}</p>
                <dl>
                    <div><dt><kbd>j</kbd></dt><dd>{t(i18n, "reader.shortcutScrollDown")}</dd></div>
                    <div><dt><kbd>k</kbd></dt><dd>{t(i18n, "reader.shortcutScrollUp")}</dd></div>
                    <div><dt><kbd>e</kbd></dt><dd>{t(i18n, "reader.shortcutEdit")}</dd></div>
                    <div><dt><kbd>m</kbd></dt><dd>{t(i18n, "reader.shortcutDone")}</dd></div>
                    <div><dt><kbd>x</kbd></dt><dd>{t(i18n, "reader.shortcutExcerpt")}</dd></div>
                    <div><dt><kbd>?</kbd></dt><dd>{t(i18n, "reader.shortcutHelp")}</dd></div>
                </dl>
            </div>
        {/if}
    {/if}
    <div class="glean-reader__body">
    <div class="glean-reader__main">
        {#if docId}
            <ProtyleHost app={facade.pluginInstance.app} {docId} mode={modeValue(mode)} {i18n} bind:host={protyleHost} bind:controller={protyle} className="glean-reader__host" onOpenDocument={() => { if (docId) void openTab({ app: facade.pluginInstance.app, doc: { id: docId } }); }} />
        {:else}
            <div class="glean-reader__empty">
                <div class="glean-reader__empty-art">📖</div>
                <div class="glean-reader__empty-title">{t(i18n, "reader.empty")}</div>
                <div class="glean-reader__empty-hint">{t(i18n, "reader.emptyHint")}</div>
            </div>
        {/if}
    </div>
    {#if docId}
        <aside class="glean-reader__side" hidden={sidebarCollapsed} aria-label={t(i18n, "reader.title")}>
            <div class="glean-reader__title" title={context?.title}>{context?.title || t(i18n, "panel.untitled")}</div>
            <div class="glean-reader__meta">
                <span class={`glean-carrier-badge glean-carrier-badge--${resolveCarrier(context?.contentType)}`}>
                    {carrierLabel(context?.contentType)}
                </span>
                {#if context?.site}<span>{context.site}</span>{/if}
                {#if context?.author}<span>{context.author}</span>{/if}
            </div>
            {#if displayedReadMinutes > 0}
                <div class="glean-reader__hint" aria-live="polite">{t(i18n, "reader.readMinutes", { n: displayedReadMinutes })}</div>
            {/if}
            <div class="glean-reader__section glean-reader__recent">
                <div class="glean-reader__section-title">{t(i18n, "reader.recentTitle")}</div>
                <div class="glean-reader__recent-list">
                    {#each recentReadings as item (item.id)}
                        <button
                            class="glean-reader__recent-item"
                            class:glean-reader__recent-item--current={item.id === docId}
                            aria-current={item.id === docId ? "page" : undefined}
                            title={item.title || item.id}
                            onclick={() => openRecentReading(item)}
                        >{item.title || item.id}</button>
                    {:else}
                        <div class="glean-reader__hint">{t(i18n, "reader.recentEmpty")}</div>
                    {/each}
                </div>
            </div>
            {#if context?.id === docId}<AuthorEditor {facade} {docId} onSaved={() => { if (docId) return loadContext(docId); }} />{/if}
            <ReadingPositionControls {facade} {docId} host={protyleHost} />
            <div class="glean-reader__section glean-reader__appearance">
                <div class="glean-reader__section-title">{t(i18n, "reader.appearanceTitle")}</div>
                <label>{t(i18n, "reader.appearanceFontSize")}
                    <select class="b3-select" disabled={appearanceBusy} value={readerAppearance.fontSize} onchange={(event) => void updateAppearance("fontSize", (event.currentTarget as HTMLSelectElement).value)}>
                        <option value="small">{t(i18n, "reader.appearanceSmall")}</option>
                        <option value="normal">{t(i18n, "reader.appearanceNormal")}</option>
                        <option value="large">{t(i18n, "reader.appearanceLarge")}</option>
                    </select>
                </label>
                <label>{t(i18n, "reader.appearanceLineHeight")}
                    <select class="b3-select" disabled={appearanceBusy} value={readerAppearance.lineHeight} onchange={(event) => void updateAppearance("lineHeight", (event.currentTarget as HTMLSelectElement).value)}>
                        <option value="compact">{t(i18n, "reader.appearanceCompact")}</option>
                        <option value="normal">{t(i18n, "reader.appearanceNormal")}</option>
                        <option value="relaxed">{t(i18n, "reader.appearanceRelaxed")}</option>
                    </select>
                </label>
                <label>{t(i18n, "reader.appearanceWidth")}
                    <select class="b3-select" disabled={appearanceBusy} value={readerAppearance.width} onchange={(event) => void updateAppearance("width", (event.currentTarget as HTMLSelectElement).value)}>
                        <option value="narrow">{t(i18n, "reader.appearanceNarrow")}</option>
                        <option value="normal">{t(i18n, "reader.appearanceNormal")}</option>
                        <option value="wide">{t(i18n, "reader.appearanceWide")}</option>
                    </select>
                </label>
                <label>{t(i18n, "reader.appearanceTheme")}
                    <select class="b3-select" disabled={appearanceBusy} value={readerAppearance.theme} onchange={(event) => void updateAppearance("theme", (event.currentTarget as HTMLSelectElement).value)}>
                        <option value="follow">{t(i18n, "reader.appearanceFollow")}</option>
                        <option value="paper">{t(i18n, "reader.appearancePaper")}</option>
                        <option value="eye">{t(i18n, "reader.appearanceEye")}</option>
                    </select>
                </label>
            </div>
            <div class="glean-reader__section">
                <div class="glean-reader__section-title">{t(i18n, "reader.outlineTitle")}</div>
                {#if outlineLoading}
                    <div class="glean-reader__hint" role="status" aria-live="polite">{t(i18n, "reader.outlineLoading")}</div>
                {:else if outlineError}
                    <div class="glean-reader__issue" role="alert">{t(i18n, "reader.outlineFailed")}</div>
                    <button class="glean-btn glean-btn--ghost" onclick={() => docId && void loadOutline(docId)}>{t(i18n, "reader.outlineRetry")}</button>
                {:else if outline.length === 0}
                    <div class="glean-reader__hint">{t(i18n, "reader.outlineEmpty")}</div>
                {:else}
                    <nav class="glean-reader__outline" aria-label={t(i18n, "reader.outlineTitle")}>
                        {#each outline as item (item.id)}
                            <button class="glean-reader__outline-item" style={`--glean-outline-level:${item.level}`} title={item.title} onclick={() => scrollToOutline(item)}>{item.title}</button>
                        {/each}
                    </nav>
                {/if}
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
                                    disabled={!excerpt.blockId || excerptBusy}
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
                    {#if speechSupported}
                        <div class="glean-reader__section">
                            <div class="glean-reader__section-title">{t(i18n, "reader.speechTitle")}</div>
                            <div class="glean-reader__speech-rate">
                                <label for="glean-speech-rate">{t(i18n, "reader.speechRate")}</label>
                                <input
                                    id="glean-speech-rate"
                                    type="range"
                                    min="0.75"
                                    max="1.5"
                                    step="0.25"
                                    value={speechRate}
                                    aria-label={t(i18n, "reader.speechRate")}
                                    oninput={(event) => setSpeechRate(Number((event.currentTarget as HTMLInputElement).value))}
                                />
                                <span>{speechRate}×</span>
                            </div>
                            <div class="glean-reader__ops">
                                {#if excerpt?.text}
                                    <button class="glean-btn glean-btn--ghost" disabled={speechState === "playing" || speechState === "paused"} onclick={() => startSpeech("selection")}>
                                        🔊 {t(i18n, "reader.speechSelection")}
                                    </button>
                                {/if}
                                <button class="glean-btn glean-btn--ghost" disabled={speechState === "playing" || speechState === "paused"} onclick={() => startSpeech("full")}>
                                    🔊 {t(i18n, "reader.speechFull")}
                                </button>
                                {#if speechState === "playing" || speechState === "paused"}
                                    <button class="glean-btn glean-btn--ghost" onclick={toggleSpeechPause}>
                                        {speechState === "playing" ? t(i18n, "reader.speechPause") : t(i18n, "reader.speechResume")}
                                    </button>
                                    <button class="glean-btn glean-btn--ghost" onclick={stopSpeech}>{t(i18n, "reader.speechStop")}</button>
                                {:else if speechChunks.length > 0 && speechChunkIndex < speechChunks.length}
                                    <button class="glean-btn glean-btn--ghost" onclick={() => startSpeech(speechScope ?? "full", true)}>
                                        {t(i18n, "reader.speechContinue")}
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {/if}
                    <div class="glean-reader__section">
                        <div class="glean-reader__section-title">{t(i18n, "reader.aiTitle")}</div>
                        {#if !aiOn}
                            <div class="glean-reader__hint">{t(i18n, "reader.aiOff")}</div>
                        {:else}
                            <div class="glean-reader__ops">
                                <button class="glean-btn glean-btn--ghost" disabled={Boolean(aiBusy)} onclick={() => void runSummarize()}>
                                    <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanSpark" /></svg>{t(i18n, "reader.aiSummarize")}
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
                                {#if articleQuestionOn}
                                    <div class="glean-reader__question">
                                        <input class="glean-mini-input" maxlength="1000" placeholder={t(i18n, "reader.articleQuestion.placeholder")} aria-label={t(i18n, "reader.articleQuestion.action")} bind:value={question} onkeydown={(event) => event.key === "Enter" && void runArticleQuestion()} />
                                        <div class="glean-reader__ops">
                                            <button class="glean-btn glean-btn--ghost" class:glean-seg__btn--on={questionMode === "full"} onclick={() => { questionMode = "full"; }}>{t(i18n, "reader.articleQuestion.full")}</button>
                                            <button class="glean-btn glean-btn--ghost" disabled={!excerpt?.blockId} class:glean-seg__btn--on={questionMode === "selection"} onclick={() => { questionMode = "selection"; }}>{t(i18n, "reader.articleQuestion.selection")}</button>
                                            <button class="glean-btn" disabled={Boolean(aiBusy) || !question.trim()} onclick={() => void runArticleQuestion()}>{t(i18n, "reader.articleQuestion.ask")}</button>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                            {#if aiResult}
                                <div class="glean-reader__ai-card" role="status" aria-live="polite">
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
                            {#if questionResult}
                                <div class="glean-reader__ai-card" role="status" aria-live="polite">
                                    <div class="glean-reader__ai-src">{t(i18n, "reader.articleQuestion.action")}</div>
                                    <div class="glean-reader__ai-text">{questionResult.answer}</div>
                                    {#if questionResult.truncated}<div class="glean-reader__hint">{t(i18n, "reader.articleQuestion.truncated")}</div>{/if}
                                    {#if questionResult.evidence.length > 0}
                                        <div class="glean-reader__ai-src">{t(i18n, "reader.articleQuestion.evidence")}</div>
                                        {#each questionResult.evidence as evidence}<blockquote>{evidence}</blockquote>{/each}
                                    {:else}<div class="glean-reader__hint">{t(i18n, "reader.articleQuestion.insufficient")}</div>{/if}
                                    <button class="glean-btn glean-btn--ghost" onclick={() => void copyText(`${questionResult!.answer}\n\n${questionResult!.evidence.join("\n")}`)}>{t(i18n, "reader.copy")}</button>
                                </div>
                            {/if}
                            {#if relatedShown && relatedItems.length > 0}
                                <div class="glean-reader__related">
                                    {#each relatedItems as item (item.id)}
                                        <button class="glean-reader__related-item" title={item.title} onclick={() => openRelatedDoc(item.id, item.title)}>
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
                    <button class="glean-btn glean-btn--ghost" onclick={() => openFormattingDialog(facade, context!.id)}>{t(i18n, "formatting.open")}</button>
                    {#if hasSourceAction(context.contentType, context.url)}
                        <button class="glean-btn glean-btn--ghost" onclick={openSource}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanExternal" /></svg>{t(i18n, "clip.openSource")}</button>
                    {:else if resolveCarrier(context.contentType) === "link"}
                        <span class="glean-source-missing">{t(i18n, "clip.sourceMissing")}</span>
                    {/if}
                    <button
                        class="glean-btn glean-btn--ghost"
                        disabled={snapping}
                        title={context.snapshot ? t(i18n, "snapshot.open") : t(i18n, "snapshot.take")}
                        aria-label={context.snapshot ? t(i18n, "snapshot.open") : t(i18n, "snapshot.take")}
                        onclick={() => void takeSnapshot()}
                    >
                        <svg class="glean-icon glean-icon--sm" aria-hidden="true"><use href={context.snapshot ? "#iconGleanArchive" : "#iconGleanCamera"} /></svg>
                    </button>
                </div>
                {#if bodyState === "unmeasured"}
                    <button class="glean-btn glean-btn--ghost" disabled={measuring} title={t(i18n, "clip.bodyCheckHint")} onclick={() => void checkBody()}>
                        <svg class="glean-icon" aria-hidden="true"><use href="#iconGleanSearch" /></svg>{t(i18n, "clip.bodyCheck")}
                    </button>
                {:else if bodyState === "missing"}
                    <div class="glean-reader__issue">
                        <span title={t(i18n, "clip.bodyMissingHint")}>{t(i18n, "clip.bodyMissing")}</span>
                        {#if hasSourceAction(context.contentType, context.url)}
                            <button class="glean-btn glean-btn--ghost" onclick={recapture}><svg class="glean-icon" aria-hidden="true"><use href="#iconGleanRefresh" /></svg>{t(i18n, "clip.reclip")}</button>
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
</div>

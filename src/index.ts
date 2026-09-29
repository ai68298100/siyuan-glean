/**
 * 小驴拾遗插件入口（薄壳）：生命周期、UI 挂载、收录入口三件套。
 * 业务编排在 services/，内核交互在 api/，纯函数在 domain/，组件只依赖 types.ts 门面。
 */
import { Plugin, getFrontend, openTab, openMobileFileById, showMessage, getAllEditor } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import DockPanel from "./ui/DockPanel.svelte";
import ReaderTab from "./ui/ReaderTab.svelte";
import { installReadingContext } from "./ui/reading-context-controller";
import MigrateDialog from "./ui/MigrateDialog.svelte";
import ImportDialog from "./ui/ImportDialog.svelte";
import OnboardingDialog from "./ui/OnboardingDialog.svelte";
import { loadUiPrefs } from "./services/prefs";
import SettingsView from "./ui/SettingsView.svelte";
import { svelteDialog } from "./libs/dialog";
import { t, type I18nBundle } from "./libs/i18n";
import { captureDocument } from "./services/clip-store";
import { autoEnrich, enrichClip } from "./services/enrich-service";
import { ensurePresetActions } from "./services/ai-actions";
import { makeQuoteCard } from "./services/flashcard-service";
import { migrateShorthand } from "./services/inbox-service";
import { getShorthand } from "./api/inbox";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GleanSettings } from "./services/settings";
import type { GleanFacade } from "./types";

const DOCK_TYPE = "glean-dock";
const TAB_TYPE = "glean-library";
const READER_TAB_TYPE = "glean-reader";

export default class LvGleanPlugin extends Plugin implements GleanFacade {
    /** 基类构造器已注入 i18n；declare 只收窄类型，不生成会覆盖基类赋值的运行时字段 */
    declare i18n: I18nBundle;

    isMobile = false;
    settings: GleanSettings = DEFAULT_SETTINGS;

    private dockInstance: ReturnType<typeof mount> | null = null;
    private disposeReadingContext: (() => void) | null = null;
    private lastReadingDocId = "";
    private pendingLibraryDocId = "";
    private pendingReaderDocId = "";

    constructor(options: { app: unknown; name: string; displayName: string; i18n: I18nBundle }) {
        super(options as never);
    }

    get pluginInstance(): this {
        return this;
    }

    async onload() {
        const frontend = getFrontend();
        this.isMobile = frontend === "mobile" || frontend === "browser-mobile";

        this.addIcons(`<symbol id="iconGleanWheat" viewBox="0 0 32 32">
<path d="M16 3c.9 2.2 1.4 4.4 1.4 6.6S16.9 13.8 16 16c-.9-2.2-1.4-4.2-1.4-6.4S15.1 5.2 16 3zM9.5 8.5c2 .8 3.7 2 5 3.6 1.2 1.6 1.9 3.4 2 5.4-2-.8-3.7-2-5-3.6-1.2-1.6-1.9-3.4-2-5.4zm13 0c-.1 2-.8 3.8-2 5.4-1.3 1.6-3 2.8-5 3.6.1-2 .8-3.8 2-5.4 1.3-1.6 3-2.8 5-3.6zM16 15c1.7 1.4 2.9 3.1 3.5 5.1.5 2 .4 4-.4 6-1.7-1.4-2.9-3.1-3.5-5.1-.5-2-.4-4 .4-6zm0 0c-1.7 1.4-2.9 3.1-3.5 5.1-.5 2-.4 4 .4 6 1.7-1.4 2.9-3.1 3.5-5.1.5-2 .4-4-.4-6zM15 26h2v3h-2z"/></symbol>
<symbol id="iconGleanGear" viewBox="0 0 32 32">
<path d="M16 11.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2.2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z"/>
<path d="M14 3h4l.7 3.4c.9.3 1.7.7 2.5 1.3l3.3-1.2 2 3.5-2.6 2.3c.1.5.1 1.1.1 1.7s0 1.2-.1 1.7l2.6 2.3-2 3.5-3.3-1.2c-.8.6-1.6 1-2.5 1.3L18 25h-4l-.7-3.4c-.9-.3-1.7-.7-2.5-1.3l-3.3 1.2-2-3.5 2.6-2.3a10 10 0 0 1 0-3.4L5.5 10l2-3.5 3.3 1.2c.8-.6 1.6-1 2.5-1.3L14 3zm1.2 2.2-.6 3-.9.3c-.7.2-1.3.6-1.9 1l-.8.6-2.9-1-1 1.7 2.3 2-.2 1a7.7 7.7 0 0 0 0 2.4l.2 1-2.3 2 1 1.7 2.9-1 .8.6c.6.4 1.2.8 1.9 1l.9.3.6 3h2l.6-3 .9-.3c.7-.2 1.3-.6 1.9-1l.8-.6 2.9 1 1-1.7-2.3-2 .2-1a7.7 7.7 0 0 0 0-2.4l-.2-1 2.3-2-1-1.7-2.9 1-.8-.6c-.6-.4-1.2-.8-1.9-1l-.9-.3-.6-3h-2z"/></symbol>
<symbol id="iconGleanPopup" viewBox="0 0 32 32">
<path d="M6 5h11a2 2 0 0 1 2 2v3h-2.2V7.2H8.2v16.6h8.8V21H19v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
<path d="M17 4h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.2v-2.2h1V6.2H19v3.6H17V5z" transform="translate(0 0)"/>
<path d="M15.2 12.8H29v13.6H15.2zM17.4 15v9.2h9.4V15z"/></symbol>
<symbol id="iconGleanRefresh" viewBox="0 0 32 32">
<path d="M16 6a10 10 0 0 1 8.6 4.9l-2.4 1.4A7.4 7.4 0 0 0 16 8.6 7.4 7.4 0 1 0 23.4 16h2.6A10 10 0 1 1 16 6z"/>
<path d="M22 4h6v6h-2.4V6.4H22z"/></symbol>`);

        // 设置只在此处加载一次；面板/弹窗都读这个缓存
        this.settings = await loadSettings(this);

        const plugin = this;
        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 320, height: 0 },
                icon: "iconGleanWheat",
                title: t(this.i18n, "dock.title"),
                hotkey: "⌥⌘G",
            },
            type: DOCK_TYPE,
            data: {},
            // Custom.element 是 Element；挂载实例挂到 this 上，destroy 时卸载
            init(this: { element: Element; __gleanInstance?: unknown }) {
                const container = document.createElement("div");
                container.className = "glean-dock-root fn__flex-1";
                this.element.appendChild(container);
                this.__gleanInstance = mount(DockPanel, { target: container, props: { facade: plugin } });
            },
            destroy(this: any) {
                if (this.__gleanInstance) {
                    unmount(this.__gleanInstance as ReturnType<typeof mount>);
                    this.__gleanInstance = null;
                }
            },
        });

        this.addCommand({
            langKey: "cmd.openPanel",
            hotkey: "⌥⌘G",
            callback: () => this.openPanel(),
        });

        this.addCommand({
            langKey: "cmd.continueReading",
            callback: () => {
                if (this.lastReadingDocId) this.openReadingDocument(this.lastReadingDocId);
                else showMessage(t(this.i18n, "reading.noRecent"), 3000);
            },
        });

        this.addCommand({
            langKey: "cmd.addToList",
            callback: () => void this.addCurrentDocToLibrary(),
        });

        this.addCommand({
            langKey: "cmd.openMigrate",
            callback: () => this.openMigrate(),
        });

        this.addCommand({
            langKey: "cmd.makeCard",
            callback: () => void this.makeCardFromSelection(),
        });

        // 右键菜单"加入读库"（收录入口三件套之一）
        this.eventBus.on("open-menu-content", this.onMenuContent);

        // M5：收集箱右键"迁入读库"
        this.eventBus.on("open-menu-inbox", this.onMenuInbox);

        // M3：预置 AI 动作（总结/要点/反方观点），幂等静默
        if (this.settings.ai.presetActions) {
            void ensurePresetActions().catch(() => undefined);
        }

        // M3：智能体工具（思源 AI 可发现的读库能力）
        this.registerAgentTools();

        // tab 形态（移动端 / dock 缺席时的回退）：注册 model，openTab 用 custom.id 唤起
        this.addTab({
            type: TAB_TYPE,
            init(this: { element: Element; __gleanTabInstance?: unknown }) {
                const container = document.createElement("div");
                container.className = "glean-tab-root fn__flex-1";
                this.element.appendChild(container);
                this.__gleanTabInstance = mount(DockPanel, { target: container, props: { facade: plugin } });
            },
            destroy(this: any) {
                if (this.__gleanTabInstance) {
                    unmount(this.__gleanTabInstance as ReturnType<typeof mount>);
                    this.__gleanTabInstance = null;
                }
            },
        });

        // 阅读页签（D-0029）：内嵌真实 Protyle + 伴生栏；resize 时让实例自适应。
        this.addTab({
            type: READER_TAB_TYPE,
            init(this: { element: Element; __gleanReaderInstance?: unknown }) {
                const container = document.createElement("div");
                container.className = "glean-reader-root fn__flex-1";
                this.element.appendChild(container);
                this.__gleanReaderInstance = mount(ReaderTab, { target: container, props: { facade: plugin } });
            },
            destroy(this: any) {
                if (this.__gleanReaderInstance) {
                    unmount(this.__gleanReaderInstance as ReturnType<typeof mount>);
                    this.__gleanReaderInstance = null;
                }
            },
            resize() {
                document.dispatchEvent(new CustomEvent("glean:reader-resize"));
            },
        });

        // 阅读上下文挂在原生编辑器容器，事件回调按编辑器根块切换和销毁清理。
        this.disposeReadingContext = installReadingContext(this);
    }

    onLayoutReady() {
        // 首启引导：尚无锚点笔记本且未完成过引导 → 自动弹出（平静原则：可一键跳过）
        if (!this.isMobile) {
            void (async () => {
                const prefs = await loadUiPrefs(this);
                if (prefs.onboardingDone || this.settings.anchorNotebooks.length > 0) return;
                window.setTimeout(() => this.openOnboarding(), 800);
            })();
        }

        if (this.isMobile) return;
        this.addTopBar({
            icon: "iconGleanWheat",
            title: t(this.i18n, "pluginName"),
            position: "right",
            callback: () => this.openPanel(),
        });
    }

    async onunload() {
        this.eventBus.off("open-menu-content", this.onMenuContent);
        this.eventBus.off("open-menu-inbox", this.onMenuInbox);
        this.disposeReadingContext?.();
        this.disposeReadingContext = null;
        if (this.dockInstance) {
            unmount(this.dockInstance);
            this.dockInstance = null;
        }
    }

    /* ---------- GleanFacade ---------- */

    async updateSettings(patch: Partial<GleanSettings>): Promise<void> {
        this.settings = await saveSettings(this, { ...this.settings, ...patch });
        this.notifyDataChanged();
    }

    notifyDataChanged(): void {
        // 在 document 上派发（事件只向上冒泡，不能从父容器传到子面板）
        document.dispatchEvent(new CustomEvent("glean:data-changed"));
    }

    currentDocId(): string {
        const editor = getAllEditor().find((item) => item?.protyle?.block?.rootID);
        return editor?.protyle?.block?.rootID ?? "";
    }

    openReadingDocument(docId: string): void {
        if (!docId) return;
        this.lastReadingDocId = docId;
        if (this.isMobile) {
            openMobileFileById(this.app, docId);
            return;
        }
        // D-0029：设置开启且桌面端时，开始阅读进内嵌阅读页签；默认沿用原生页签。
        if (this.settings.reader.openInTab) {
            void this.openReaderTab(docId);
            return;
        }
        void openTab({ app: this.app, doc: { id: docId }, keepCursor: false });
    }

    /** 显式打开内嵌阅读页签（不写五态；移动端回退原生查看器）。 */
    openReader(docId: string): void {
        if (!docId) return;
        this.lastReadingDocId = docId;
        if (this.isMobile) {
            openMobileFileById(this.app, docId);
            return;
        }
        void this.openReaderTab(docId);
    }

    private async openReaderTab(docId: string): Promise<void> {
        this.pendingReaderDocId = docId;
        await openTab({
            app: this.app,
            custom: {
                id: `${this.name}${READER_TAB_TYPE}`,
                icon: "iconGleanWheat",
                title: t(this.i18n, "reader.title"),
            },
            keepCursor: false,
        });
        document.dispatchEvent(new CustomEvent("glean:focus-reader"));
    }

    consumeReaderFocus(): string {
        const id = this.pendingReaderDocId;
        this.pendingReaderDocId = "";
        return id;
    }

    async openLibraryArticle(docId: string): Promise<void> {
        if (!docId) return;
        this.pendingLibraryDocId = docId;
        await this.openLibraryTab();
        document.dispatchEvent(new CustomEvent("glean:focus-clip", { detail: { id: docId } }));
    }

    consumeLibraryFocus(): string {
        const id = this.pendingLibraryDocId;
        this.pendingLibraryDocId = "";
        return id;
    }

    /* ---------- 面板 ---------- */

    /**
     * 入口分工（UI-STANDARD §3 三档画布）：
     * - 顶栏图标/命令 = 工作台 tab（桌面画布：rail+表格/看板，全宽完整功能）
     * - Dock 侧栏图标 = 窄侧栏速览（toggleModel 切换）
     */
    openPanel(): void {
        void this.openLibraryTab();
    }

    /** 打开/聚焦 Dock 窄侧栏（保留给轻量速览场景）。 */
    toggleDockSidebar(): void {
        const dockId = `${this.name}${DOCK_TYPE}`;
        const dockHost = (window as unknown as { siyuan?: { layout?: Record<string, { toggleModel?: (type: string, show?: boolean) => void }> } }).siyuan?.layout;
        for (const dock of [dockHost?.rightDock, dockHost?.bottomDock, dockHost?.leftDock]) {
            if (dock && typeof dock.toggleModel === "function") {
                try {
                    dock.toggleModel(dockId);
                    return;
                } catch { /* 换下一个容器 */ }
            }
        }
        // 兜底：HTMLElement.click() 产生的点击会冒泡，可被委托监听器捕获
        const dockItem = document.querySelector(`.dock__item[data-type="${dockId}"]`);
        if (dockItem) {
            (dockItem as HTMLElement).click();
            return;
        }
        this.openLibraryTab();
    }

    private async openLibraryTab(): Promise<void> {
        await openTab({
            app: this.app,
            custom: {
                id: `${this.name}${TAB_TYPE}`,
                icon: "iconGleanWheat",
                title: t(this.i18n, "workbench.title"),
            },
            keepCursor: false,
        });
    }

    /** 读当前编辑器内的选区文本（无选区返回空串；FAST-01.3 范式） */
    private readSelection(): string {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return "";
        const editor = getAllEditor().find((item) => item?.protyle?.element?.contains(selection.anchorNode ?? null));
        if (editor?.protyle?.element && !editor.protyle.element.contains(selection.anchorNode)) return "";
        return selection.toString();
    }

    /** 摘录制卡：选中文本 → 问句卡入「拾遗卡片」牌组 */
    async makeCardFromSelection(): Promise<void> {
        const quote = this.readSelection().trim();
        if (!quote) {
            showMessage(t(this.i18n, "flashcard.noSelection"), 3000);
            return;
        }
        const editor = getAllEditor().find((item) => item?.protyle?.block?.rootID);
        const docId = editor?.protyle?.block?.rootID ?? "";
        let docTitle = "";
        try {
            const { querySql } = await import("./api/client");
            const rows = await querySql<{ content: string }>("SELECT content FROM blocks WHERE id = '" + docId.replace(/'/g, "''") + "' LIMIT 1");
            docTitle = rows[0]?.content ?? "";
        } catch { /* 标题取不到就用无来源卡面 */ }
        try {
            await makeQuoteCard(this.settings, docTitle, quote, this);
            showMessage(t(this.i18n, "flashcard.done"), 3000);
        } catch (error) {
            showMessage(String(error).slice(0, 140), 5000);
        }
    }

    /** 收集箱右键"迁入读库"：open-menu-inbox detail.ids → 逐条取详情迁移（T-1500） */
    private migrateFromInbox = async (ids: string[]): Promise<void> => {
        const notebookId = this.settings.anchorNotebooks[0];
        if (!notebookId) {
            showMessage(t(this.i18n, "panel.noAnchorHint"), 4000);
            return;
        }
        let ok = 0;
        let duplicates = 0;
        for (const id of ids) {
            try {
                const shorthand = await getShorthand(id);
                if (!shorthand) continue;
                const result = await migrateShorthand(this, shorthand, { notebookId });
                if (result.duplicate) {
                    duplicates += 1;
                    showMessage(`${t(this.i18n, "inbox.duplicate")}: ${result.existing?.title || result.existing?.hpath || ""}`, 3500);
                    continue;
                }
                ok += 1;
            } catch (error) {
                showMessage(String(error).slice(0, 140), 5000);
            }
        }
        if (ok > 0) showMessage(t(this.i18n, "inbox.migrated"), 3000);
        if (duplicates > 0) showMessage(`${t(this.i18n, "inbox.duplicate")}（${duplicates}）`, 3500);
        this.notifyDataChanged();
        void ok;
    };

    private readonly onMenuInbox = (event: { detail: { ids?: string[]; menu: { addItem: (item: unknown) => void } } }): void => {
        const ids = event.detail.ids ?? [];
        if (ids.length === 0) return;
        event.detail.menu.addItem({
            id: "glean-inbox-migrate",
            iconHTML: "",
            label: t(this.i18n, "pluginName") + "：" + t(this.i18n, "inbox.menuMigrate", { n: ids.length }),
            click: () => void this.migrateFromInbox(ids),
        });
    };

    /* ---------- 收录 ---------- */

    async addCurrentDocToLibrary(): Promise<void> {
        const docId = this.currentDocId();
        if (!docId) {
            showMessage(t(this.i18n, "msg.noSelection"), 3000);
            return;
        }
        const result = await captureDocument(this, docId, { src: "manual" });
        showMessage(
            result.conflict
                ? `${t(this.i18n, "inbox.duplicate")}: ${result.conflict.title || result.conflict.hpath}`
                : t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"),
            3000,
        );
        if (result.captured) autoEnrich(this, docId, this.settings);
        this.notifyDataChanged();
    }

    private readonly onMenuContent = (event: {
        detail: { protyle?: { block?: { rootID?: string } }; menu: { addItem: (item: unknown) => void } };
    }): void => {
        const rootId = event.detail.protyle?.block?.rootID;
        if (!rootId) return;
        const selectionText = this.readSelection().trim();
        if (selectionText) {
            event.detail.menu.addItem({
                id: "glean-make-card",
                iconHTML: "",
                label: t(this.i18n, "flashcard.menuMake", { n: [...selectionText.trim()].length }),
                click: async () => {
                    try {
                        const { querySql } = await import("./api/client");
                        const rows = await querySql<{ content: string }>("SELECT content FROM blocks WHERE id = '" + rootId.replace(/'/g, "''") + "' LIMIT 1");
                        await makeQuoteCard(this.settings, rows[0]?.content ?? "", selectionText, this);
                        showMessage(t(this.i18n, "flashcard.done"), 3000);
                    } catch (error) {
                        showMessage(String(error).slice(0, 140), 5000);
                    }
                },
            });
        }
        event.detail.menu.addItem({
            id: "glean-add-to-library",
            iconHTML: "",
            label: `${t(this.i18n, "pluginName")}：${t(this.i18n, "action.addToInbox")}`,
            click: async () => {
                const result = await captureDocument(this, rootId, { src: "manual" });
                showMessage(
                    result.conflict
                        ? `${t(this.i18n, "inbox.duplicate")}: ${result.conflict.title || result.conflict.hpath}`
                        : t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"),
                    3000,
                );
                if (result.captured) autoEnrich(this, rootId, this.settings);
                this.notifyDataChanged();
            },
        });
    };

    /** 手动 AI 富化（面板卡 ✨ 与命令共用） */
    async enrichCurrentDoc(): Promise<void> {
        const docId = this.currentDocId();
        if (!docId) {
            showMessage(t(this.i18n, "msg.noSelection"), 3000);
            return;
        }
        showMessage(t(this.i18n, "ai.enriching"), 3000);
        const outcome = await enrichClip(this, docId, this.settings);
        if (outcome.ok) {
            showMessage(
                outcome.duplicates.length > 0
                    ? t(this.i18n, "ai.similarFound", { title: outcome.duplicates[0].title })
                    : t(this.i18n, "ai.enrichDone"),
                3500
            );
        } else if (outcome.skipped === "cap") {
            showMessage(t(this.i18n, "ai.capReached", { n: this.settings.ai.enrichDailyCap }), 4000);
        } else {
            showMessage(t(this.i18n, "ai.enrichFailed"), 3000);
        }
        this.notifyDataChanged();
    }

    /* ---------- M3：智能体工具（addAgentCapability，D-0007） ---------- */

    private registerAgentTools(): void {
        const schema = { type: "object", properties: {}, required: [] as string[] };
        this.addAgentCapability({
            name: "list_unread",
            description:
                "列出小驴拾遗读库中未读完的文章（新剪藏/稍后读/阅读中），返回标题、状态、站点与预计阅读分钟。",
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex } = await import("./services/clip-store");
                const index = await reconcileIndex(this, this.settings);
                const unread = Object.values(index.clips)
                    .filter((clip) => clip.status === "inbox" || clip.status === "later" || clip.status === "reading")
                    .sort((a, b) => ((a.time || "") < (b.time || "") ? 1 : -1));
                const lines = unread
                    .slice(0, 50)
                    .map((clip) => "[" + clip.status + "] " + clip.title + "（" + (clip.site || "未知来源") + "，约 " + (clip.minutes || "?") + " 分钟）");
                return {
                    structuredContent: {
                        count: unread.length,
                        items: unread.slice(0, 50).map((clip) => ({
                            id: clip.id,
                            title: clip.title,
                            status: clip.status,
                            site: clip.site,
                            minutes: clip.minutes,
                            url: clip.url,
                        })),
                    },
                    result: lines.length > 0 ? lines.join("\n") : "读库中没有未读文章",
                };
            },
        });
        this.addAgentCapability({
            name: "archive_stale",
            description:
                "把小驴拾遗读库中超过保留期（默认 " + this.settings.staleDays + " 天）未读的新剪藏/稍后读文章归档。",
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex, batchSetStatus } = await import("./services/clip-store");
                const index = await reconcileIndex(this, this.settings);
                const cutoff = Date.now() - this.settings.staleDays * 86_400_000;
                const stale = Object.values(index.clips).filter((clip) => {
                    if (clip.status !== "inbox" && clip.status !== "later") return false;
                    if (!/^\d{14}$/.test(clip.time)) return false;
                    const captured = new Date(
                        Number(clip.time.slice(0, 4)),
                        Number(clip.time.slice(4, 6)) - 1,
                        Number(clip.time.slice(6, 8))
                    ).getTime();
                    return captured < cutoff;
                });
                await batchSetStatus(this, stale.map((clip) => clip.id), "archived");
                return { structuredContent: { archived: stale.length }, result: "已归档 " + stale.length + " 篇超龄文章" };
            },
        });
        this.addAgentCapability({
            name: "weekly_digest",
            description: "生成小驴拾遗读库本周摘要：总量、完成、未读压力与主题分布。",
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex } = await import("./services/clip-store");
                const { buildStats } = await import("./services/stats-service");
                const index = await reconcileIndex(this, this.settings);
                const stats = buildStats(index);
                const lines = [
                    "读库共 " + stats.total + " 篇，已读 " + stats.done + " 篇（" + (stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0) + "%）。",
                    "本周新增收录 " + stats.dailyCaptured.reduce((a, b) => a + b, 0) + " 篇，完成 " + stats.doneThisWeek + " 篇。",
                    "未读压力：新剪藏 " + stats.inbox + " 篇、阅读中 " + stats.reading + " 篇。",
                    stats.byTag.length > 0
                        ? "近期主题：" + stats.byTag.slice(0, 5).map((tag) => tag.name + "×" + tag.count).join("、")
                        : "",
                ];
                return { structuredContent: { stats }, result: lines.filter(Boolean).join("\n") };
            },
        });
    }

    openOnboarding(): void {
        svelteDialog({
            title: t(this.i18n, "onboarding.title"),
            component: OnboardingDialog,
            props: { facade: this },
            width: "600px",
            height: "480px",
        });
    }

    /** 工作台弹出为独立浮窗（全宽画布第三形态） */
    openWorkbenchPopup(): void {
        svelteDialog({
            title: t(this.i18n, "workbench.popupTitle"),
            component: DockPanel,
            props: { facade: this },
            width: "1020px",
            height: "680px",
            containerClass: "glean-tab-root",
        });
    }

    /* ---------- 弹窗 ---------- */

    openMigrate(): void {
        svelteDialog({
            title: t(this.i18n, "migrate.title"),
            component: MigrateDialog,
            props: { facade: this },
            width: "720px",
            height: "560px",
        });
    }

    openImport(): void {
        svelteDialog({
            title: t(this.i18n, "import.title"),
            component: ImportDialog,
            props: { facade: this },
            width: "720px",
            height: "560px",
        });
    }

    openSettings(): void {
        svelteDialog({
            title: t(this.i18n, "settings.title"),
            component: SettingsView,
            props: { facade: this },
            width: "560px",
            height: "620px",
        });
    }
}

/**
 * 小驴拾遗插件入口（薄壳）：生命周期、UI 挂载、收录入口三件套。
 * 业务编排在 services/，内核交互在 api/，纯函数在 domain/，组件只依赖 types.ts 门面。
 */
import { Plugin, getFrontend, openTab, showMessage, getAllEditor } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import DockPanel from "./ui/DockPanel.svelte";
import MigrateDialog from "./ui/MigrateDialog.svelte";
import SettingsView from "./ui/SettingsView.svelte";
import { svelteDialog } from "./libs/dialog";
import { t, type I18nBundle } from "./libs/i18n";
import { captureClip } from "./services/clip-store";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GleanSettings } from "./services/settings";
import type { GleanFacade } from "./types";

const DOCK_TYPE = "glean-dock";
const TAB_TYPE = "glean-library";

export default class LvGleanPlugin extends Plugin implements GleanFacade {
    /** 基类构造器已注入 i18n；declare 只收窄类型，不生成会覆盖基类赋值的运行时字段 */
    declare i18n: I18nBundle;

    isMobile = false;
    settings: GleanSettings = DEFAULT_SETTINGS;

    private dockInstance: ReturnType<typeof mount> | null = null;

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
            langKey: "cmd.addToList",
            callback: () => void this.addCurrentDocToLibrary(),
        });

        this.addCommand({
            langKey: "cmd.openMigrate",
            callback: () => this.openMigrate(),
        });

        // 右键菜单"加入读库"（收录入口三件套之一）
        this.eventBus.on("open-menu-content", this.onMenuContent);

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
    }

    onLayoutReady() {
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
        // Dock/Tab 共用 DockPanel 组件；数据变更后面板下一次 reload 拉取
        document.querySelectorAll(".glean-dock-root, .glean-tab-root").forEach((root) => {
            root.dispatchEvent(new CustomEvent("glean:data-changed"));
        });
    }

    currentDocId(): string {
        const editor = getAllEditor().find((item) => item?.protyle?.block?.rootID);
        return editor?.protyle?.block?.rootID ?? "";
    }

    /* ---------- 面板 ---------- */

    /** 打开面板：dock 已注册则切到该 dock；移动端退化为 tab */
    openPanel(): void {
        if (this.isMobile) {
            this.openLibraryTab();
            return;
        }
        const dockId = `${this.name}${DOCK_TYPE}`;
        const dockItem = document.querySelector(`.dock__item[data-type="${dockId}"]`);
        if (dockItem) {
            (dockItem as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: false }));
            return;
        }
        this.openLibraryTab();
    }

    private openLibraryTab() {
        void openTab({
            app: this.app,
            custom: {
                id: `${this.name}${TAB_TYPE}`,
                icon: "iconGleanWheat",
                title: t(this.i18n, "dock.title"),
            },
            keepCursor: false,
        });
    }

    /* ---------- 收录 ---------- */

    async addCurrentDocToLibrary(): Promise<void> {
        const docId = this.currentDocId();
        if (!docId) {
            showMessage(t(this.i18n, "msg.noSelection"), 3000);
            return;
        }
        const result = await captureClip(this, docId, { src: "manual" });
        showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
        this.notifyDataChanged();
    }

    private readonly onMenuContent = (event: {
        detail: { protyle?: { block?: { rootID?: string } }; menu: { addItem: (item: unknown) => void } };
    }): void => {
        const rootId = event.detail.protyle?.block?.rootID;
        if (!rootId) return;
        event.detail.menu.addItem({
            id: "glean-add-to-library",
            iconHTML: "",
            label: `${t(this.i18n, "pluginName")}：${t(this.i18n, "action.addToInbox")}`,
            click: async () => {
                const result = await captureClip(this, rootId, { src: "manual" });
                showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
                this.notifyDataChanged();
            },
        });
    };

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

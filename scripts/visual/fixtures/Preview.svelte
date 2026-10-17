<script lang="ts">
    import { onMount } from "svelte";
    import DockPanel from "../../../src/ui/DockPanel.svelte";
    import SettingsView from "../../../src/ui/SettingsView.svelte";
    import ContextPreview from "./ContextPreview.svelte";
    import { DEFAULT_SETTINGS } from "../../../src/services/settings";
    import type { GleanFacade } from "../../../src/types";
    import type { Plugin } from "siyuan";

    const params = new URLSearchParams(location.search);
    const view = params.get("view") ?? "resurface";
    const canvas = params.get("canvas") ?? "tab";
    const state = params.get("state") ?? "default";
    const dark = params.get("theme") === "dark";
    document.documentElement.dataset.themeMode = dark ? "dark" : "light";

    const i18n = { ...((globalThis as any).__GLEAN_I18N ?? {}) };
    const memory = new Map<string, unknown>();
    const plugin = {
        app: {},
        async loadData(key: string) { return memory.get(key); },
        async saveData(key: string, value: unknown) { memory.set(key, value); },
    } as unknown as Plugin;
    const notify = (text: string) => window.dispatchEvent(new CustomEvent("glean:preview-message", { detail: text }));
    const facade: GleanFacade = {
        pluginInstance: plugin,
        i18n,
        settings: { ...DEFAULT_SETTINGS, anchorNotebooks: [] },
        isMobile: canvas === "mobile",
        updateSettings: async (patch) => { facade.settings = { ...facade.settings, ...patch } as typeof facade.settings; },
        openMigrate: () => notify("预览：打开迁移"),
        openSettings: () => { window.history.replaceState({}, "", "?view=settings&canvas=" + canvas); location.reload(); },
        openOnboarding: () => notify("预览：打开首启引导"),
        openImport: () => notify("预览：打开导入"),
        openArchiveDialog: () => notify("预览：打开归档"),
        openRestoreDialog: () => notify("预览：打开恢复"),
        addCurrentDocToLibrary: async () => notify("预览：已模拟收录当前文档"),
        openWorkbenchPopup: () => notify("预览：打开浮窗"),
        notifyDataChanged: () => {},
        currentDocId: () => "preview-article-1",
        openReadingDocument: () => notify("预览：打开阅读"),
        recentReadingDocuments: () => [],
        recordRecentReading: () => {},
        openReader: () => notify("预览：打开阅读页签"),
        consumeReaderFocus: () => "",
        openLibraryArticle: async () => {},
        consumeLibraryFocus: () => "",
    };

    let message = "";
    let contextMessages: string[] = [];
    const onMessage = (event: Event) => {
        message = (event as CustomEvent<string>).detail;
        if (view === "context") contextMessages = [...contextMessages.slice(-9), message];
        setTimeout(() => (message = ""), 2200);
    };
    window.addEventListener("glean:preview-message", onMessage);

    const syntheticLabel = `合成数据 · ${canvas} · ${state}`;
    function reload() { location.reload(); }
    onMount(() => {
        if (view === "context" || view === "resurface" || canvas === "mobile") return;
        const labels: Record<string, string> = { library: "库", stats: "统计", highlights: "高亮" };
        const label = labels[view];
        if (!label) return;
        requestAnimationFrame(() => Array.from(document.querySelectorAll<HTMLButtonElement>(".glean-workbench-rail__item")).find((button) => button.textContent?.trim() === label)?.click());
    });
</script>

<svelte:head><title>小驴拾遗 · R54 隔离预览</title></svelte:head>
<div class="glean-preview-app">
    <div class="glean-preview-tools">
        <strong class="glean-preview-label">{syntheticLabel}</strong>
        <label>页面 <select value={view} onchange={(event) => { const next = (event.currentTarget as HTMLSelectElement).value; location.href = `?view=${next}&canvas=${canvas}&state=${state}`; }}><option value="resurface">今日拾遗</option><option value="context">情境选文点验</option><option value="library">读库</option><option value="stats">统计</option><option value="highlights">高亮</option><option value="settings">设置</option></select></label>
        <label>承载 <select value={canvas} onchange={(event) => { const next = (event.currentTarget as HTMLSelectElement).value; location.href = `?view=${view}&canvas=${next}&state=${state}`; }}><option value="tab">宽工作台</option><option value="dock">窄 Dock</option><option value="mobile">移动</option></select></label>
        <label>主题 <button type="button" onclick={() => { location.href = `?view=${view}&canvas=${canvas}&theme=${dark ? "light" : "dark"}`; }}>切换</button></label>
        <button type="button" onclick={reload}>刷新</button>
    </div>
    <div class:glean-tab-root={canvas === "tab"} class:glean-preview-frame--dock={canvas === "dock"} class:glean-preview-frame--mobile={canvas === "mobile"} class:glean-preview-frame--context={view === "context"} class="glean-preview-frame">
        {#if view === "context"}
            <ContextPreview {facade} scenario={state} />
        {:else if view === "settings"}
            <SettingsView {facade} />
        {:else}
            <DockPanel {facade} />
        {/if}
    </div>
    {#if contextMessages.length > 0}
        <div class="glean-preview-events" role="log" aria-label="合成动作记录">
            {#each contextMessages as entry}<div>{entry}</div>{/each}
        </div>
    {/if}
    {#if message}<div class="glean-preview-toast" role="status">{message}</div>{/if}
</div>

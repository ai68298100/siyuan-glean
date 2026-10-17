import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createSourceFile, isCallExpression, isClassDeclaration, isMethodDeclaration, ScriptTarget, transpileModule } from "typescript";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import * as serverRuntime from "svelte/internal/server";
import { createLatestRequestGate } from "../src/libs/latest-request.ts";

const root = resolve(import.meta.dirname, "..");
const reader = readFileSync(resolve(root, "src/ui/ReaderTab.svelte"), "utf8");
const protyle = readFileSync(resolve(root, "src/ui/ProtyleHost.svelte"), "utf8");
const preview = readFileSync(resolve(root, "src/ui/WorkbenchPreview.svelte"), "utf8");
const authorEditor = readFileSync(resolve(root, "src/ui/AuthorEditor.svelte"), "utf8");
const context = readFileSync(resolve(root, "src/ui/ReadingContext.svelte"), "utf8");
const styles = readFileSync(resolve(root, "src/index.scss"), "utf8");
const entry = readFileSync(resolve(root, "src/index.ts"), "utf8");
const guide = readFileSync(resolve(root, "docs/READER-ACCEPTANCE.md"), "utf8");

test("阅读页签覆盖正文诊断、载体降级、摘录、制卡、回跳和状态边界", () => {
    for (const source of [reader, context]) {
        assert.match(source, /fulltextBodyState/);
        assert.match(source, /measureClipBody/);
        assert.match(source, /hasSourceAction/);
        assert.match(source, /sourceUrlForCarrier/);
        assert.match(source, /clip\.bodyMissing/);
        assert.match(source, /clip\.reclip/);
    }
    assert.match(reader, /excerptFromSelection/);
    assert.match(reader, /selectionBelongsToHost/);
    assert.match(preview, /selectionBelongsToHost/);
    assert.match(reader, /insertQuoteExcerpt/);
    assert.match(reader, /makeQuoteCard/);
    assert.match(reader, /if \(!excerpt\?\.text \|\| !excerpt\.blockId \|\| !context/);
    assert.match(reader, /disabled=\{!excerpt\.blockId\} title=\{excerpt\.blockId \? "" : t\(i18n, "reader\.excerptNoBlock"\)\}/);
    assert.match(reader, /openLibraryArticle/);
    assert.match(reader, /doneAndNext/);
    assert.equal((reader.match(/>✓→ \{t\(i18n, "reader\.doneNext"\)\}<\/button>/g) ?? []).length, 1);
});

test("工作台预览写入保留索引待同步结果，作者编辑也显示恢复提示", () => {
    assert.match(preview, /const result = await action\(\);[\s\S]*?result\?\.indexSyncFailed \? "msg\.writeIndexPending" : successKey/);
    assert.match(preview, /const result = await setPreviewStatus[\s\S]*?return result/);
    assert.match(preview, /const result = await confirmPreviewCandidate[\s\S]*?return result/);
    assert.match(authorEditor, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "author\.saved"/);
});

test("阅读状态、评分和今日拾遗写入会提示索引待同步", () => {
    const contextSource = readFileSync(resolve(root, "src/ui/ReadingContext.svelte"), "utf8");
    const dock = readFileSync(resolve(root, "src/ui/DockPanel.svelte"), "utf8");
    const resurface = readFileSync(resolve(root, "src/ui/ResurfaceView.svelte"), "utf8");
    const archive = readFileSync(resolve(root, "src/ui/ArchiveDialog.svelte"), "utf8");
    const restore = readFileSync(resolve(root, "src/ui/RestoreDialog.svelte"), "utf8");
    assert.match(reader, /batchSetStatusDetailed[\s\S]*?result\.indexSyncFailed\.length \? "msg\.statusIndexPending"/);
    assert.match(reader, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "msg\.rankSaved"/);
    assert.match(reader, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "reader\.aiSummarySaved"/);
    assert.match(reader, /measured\.indexSyncFailed[\s\S]*?"msg\.writeIndexPending"/);
    assert.match(reader, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "snapshot\.done"/);
    assert.match(contextSource, /result\.indexSyncFailed\.length \? "msg\.statusIndexPending"/);
    assert.match(contextSource, /measured\.indexSyncFailed[\s\S]*?"msg\.writeIndexPending"/);
    assert.match(dock, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "msg\.rankSaved"/);
    assert.match(resurface, /result\.indexSyncFailed\) showMessage\(t\(i18n, "msg\.statusIndexPending"\)/);
    assert.match(archive, /result\?\.indexSyncFailed \? "msg\.statusIndexPending"/);
    assert.match(restore, /result\.indexSyncFailed \? "msg\.statusIndexPending"/);
    assert.match(dock, /outcome\.indexSyncFailed[\s\S]*?"msg\.writeIndexPending"/);
    assert.match(dock, /result\.indexSyncFailed \? "msg\.writeIndexPending" : "snapshot\.done"/);
});

test("阅读页签快照图标和移动阅读动作可发现且可操作", () => {
    assert.match(reader, /snapshot\.open/);
    assert.match(reader, /snapshot\.take/);
    assert.match(reader, /aria-label=\{context\.snapshot \? t\(i18n, "snapshot\.open"\)/);
    assert.match(context, /glean-reading-context__actions/);
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.glean-reading-context__source-btn[\s\S]*?min-height: 44px/);
});

test("阅读页签桌面首屏保留原型的外观与原文入口，窄屏不增加工具栏高度", () => {
    assert.match(reader, /class="glean-btn glean-btn--ghost glean-reader__toolbar-appearance"/);
    assert.match(reader, /class="glean-btn glean-btn--ghost glean-reader__toolbar-source"/);
    assert.match(reader, /bind:open=\{appearanceOpen\}/);
    assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.glean-reader__toolbar-appearance,[\s\S]*display: none/);
});

test("阅读帮助弹窗使用安全文本节点和主题令牌", () => {
    const start = entry.indexOf("showReaderHelp(): void");
    const end = entry.indexOf("/** 摘录制卡", start);
    assert.ok(start >= 0 && end > start);
    const help = entry.slice(start, end);
    assert.doesNotMatch(help, /innerHTML/);
    assert.match(help, /textContent = t\(this\.i18n, "help\.hint"\)/);
    assert.match(help, /className = "glean-reader-help__row"/);
    assert.match(styles, /\.glean-reader-help\s*\{[\s\S]*var\(--glean-space-2\)/);
    assert.match(styles, /\.glean-reader-help__row\s*\{[\s\S]*var\(--glean-text-md\)/);
});

test("阅读页签切文时收起上篇文章的低频工具状态", () => {
    assert.match(reader, /const id = docId;[\s\S]*?moreToolsOpen = false;\s*appearanceOpen = false;/);
});

test("Protyle 失败态在正文曾获焦时把焦点交给重试动作", () => {
    assert.match(protyle, /let retryButton = \$state<HTMLButtonElement \| null>\(null\);/);
    assert.match(protyle, /element\.addEventListener\("focusin", onFocusIn\)/);
    assert.match(protyle, /stage === "failed" && hostHadFocus/);
    assert.match(protyle, /bind:this=\{retryButton\}/);
    assert.match(protyle, /aria-live=\{stage === "failed" \? "assertive" : "polite"\}/);
});

test("原生阅读上下文把维护动作降级到按需展开，正文缺失时自动展开", () => {
    assert.match(context, /const maintenanceId = `glean-reading-context-maintenance-\$\{instanceId\}`;/);
    assert.match(context, /context = null;\s*loading = true;\s*refreshing = false;\s*loadError = false;\s*maintenanceOpen = false;\s*untrack\(\(\) => void reload\(\)\);/);
    assert.match(context, /bind:open=\{maintenanceOpen\}/);
    assert.match(context, /if \(bodyState === "missing"\) maintenanceOpen = true/);
    assert.match(context, /<details id=\{maintenanceId\}/);
    assert.match(styles, /\.glean-reading-context__maintenance > summary:focus-visible/);
    assert.ok(context.indexOf("<ClipStatusActions") < context.indexOf("<details id={maintenanceId}"));
    assert.ok(context.indexOf("formatting.open") > context.indexOf("<details id={maintenanceId}"));
});

test("原生阅读上下文读取失败保留可重试错误态", () => {
    assert.match(context, /let loadError = \$state\(false\);/);
    assert.match(context, /loadError = true;/);
    assert.match(context, /class="glean-reading-context glean-reading-context--error" role="alert"/);
    assert.match(context, /reading\.contextFailed/);
    assert.match(context, /onclick=\{\(\) => void reload\(\)\}/);
    assert.match(styles, /\.glean-reading-context--error[\s\S]*var\(--glean-error-surface\)/);
});

test("窄屏阅读上下文保持状态动作组完整宽度", () => {
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.glean-reading-context__actions > \.glean-status-actions[\s\S]*width: max-content/);
});

test("阅读上下文标题与元数据保持清晰层级", () => {
    assert.match(styles, /\.glean-reading-context__title[\s\S]*font-size: var\(--glean-text-md\)[\s\S]*font-weight: 700/);
    assert.match(styles, /\.glean-reading-context__meta[\s\S]*font-size: var\(--glean-text-xs\)/);
});

test("朗读增强默认收进辅助工具", () => {
    assert.match(reader, /glean-reader__more-tools-body[\s\S]*context && speechSupported[\s\S]*glean-reader__speech/);
    assert.doesNotMatch(reader, /glean-reader__section--enhanced glean-reader__speech/);
});

test("阅读器验收文档明确真实宿主边界", () => {
    for (const term of ["正文缺失诊断", "原文降级", "选区摘录", "制卡", "回跳", "移动动作面", "B-0002"]) {
        assert.ok(guide.includes(term), `验收文档缺少 ${term}`);
    }
    assert.match(guide, /真实验收边界/);
    assert.match(guide, /可见动作条/);
});

test("阅读页签后台刷新保留当前上下文，首读和失败重试仍反馈加载，迟到旧请求不覆盖", async () => {
    const start = reader.indexOf("async function loadContext(");
    const end = reader.indexOf("function retryContext()", start);
    assert.ok(start >= 0 && end > start);
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
    const current = { id: "current", title: "已读入的文章" };
    const state = {
        context: current as typeof current | null, contextLoading: false, contextError: false,
        mounted: true, docId: "current", contextRequests: createLatestRequestGate(),
        readingTimerDocId: "current", readingTimerExpectedRaw: null, readingTimerExpectedLocation: null,
        readingTimer: {}, createReadingTimer: () => ({}),
        facade: { recordRecentReading() {} }, console: { debug() {} },
        readClipContext: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    };
    const loadSource = transpileModule(reader.slice(start, end), { compilerOptions: { target: ScriptTarget.ESNext } }).outputText;
    const load = runInNewContext(`${loadSource}; loadContext`, state);
    const background = load("current");
    assert.equal(state.context, current);
    assert.equal(state.contextLoading, false);
    pending.shift()!.resolve({ id: "current", title: "已更新文章" });
    await background;
    assert.equal(state.context?.title, "已更新文章");

    state.context = { id: "previous", title: "上篇文章" };
    const switched = load("current");
    assert.equal(state.contextLoading, true);
    pending.shift()!.resolve(current);
    await switched;
    assert.equal(state.context, current);

    state.context = null;
    const first = load("current");
    assert.equal(state.contextLoading, true);
    pending.shift()!.reject(new Error("kernel unavailable"));
    await first;
    assert.equal(state.contextError, true);
    assert.equal(state.contextLoading, false);
    const retry = load("current");
    assert.equal(state.contextLoading, true);
    assert.equal(state.contextError, false);
    const old = pending.shift()!;
    const latest = load("current");
    pending.shift()!.resolve(current);
    await latest;
    old.resolve({ id: "current", title: "迟到响应" });
    await retry;
    assert.equal(state.context?.title, current.title);
    assert.equal(state.contextLoading, false);
});

test("设置用量后台刷新保留旧值，仅最新结果或最新失败改变显示", async () => {
    const settings = readFileSync(resolve(root, "src/ui/SettingsView.svelte"), "utf8");
    const start = settings.indexOf("const refreshUsage = () => {");
    const end = settings.indexOf("refreshUsage();", start);
    assert.ok(start >= 0 && end > start);
    const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = [];
    const state = {
        usageRequest: 0, usageCount: 7 as number | null, active: true,
        facade: { pluginInstance: {} },
        usageToday: () => new Promise<number>((resolve, reject) => pending.push({ resolve, reject })),
    };
    const refresh = runInNewContext(`${settings.slice(start, end)}; refreshUsage`, state);
    refresh();
    assert.equal(state.usageCount, 7);
    const old = pending.shift()!;
    refresh();
    pending.shift()!.resolve(8);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.usageCount, 8);
    old.reject(new Error("stale failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.usageCount, 8);
    refresh();
    assert.equal(state.usageCount, 8);
    pending.shift()!.reject(new Error("current failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.usageCount, null);
});

test("摘录视图已有内容时刷新不插入占位卡，首次读取仍展示骨架", () => {
    const highlights = readFileSync(resolve(root, "src/ui/HighlightView.svelte"), "utf8");
    const skeleton = highlights.match(/\{#if [^\n]+\}\s*<div class="glean-highlights__loading"[\s\S]*?\{\/if\}/)?.[0];
    assert.ok(skeleton);
    const template = `<script>let { loading, items } = $props(); const i18n = {}; const t = (_, key) => key;</script>${skeleton}`;
    const compiled = compile(template, { filename: "HighlightLoading.svelte", generate: "server" }).js.code;
    const Component = new Function("$", compiled.replace(/^import .*;\s*$/gm, "").replace("export default function", "return function"))(serverRuntime);
    const initial = render(Component, { props: { loading: true, items: [] } }).body;
    const background = render(Component, { props: { loading: true, items: [{ id: "saved-highlight" }] } }).body;
    const ready = render(Component, { props: { loading: false, items: [] } }).body;
    assert.equal((initial.match(/glean-highlights__loading-card/g) ?? []).length, 3);
    assert.ok(!background.includes("glean-highlights__loading-card"));
    assert.ok(!ready.includes("glean-highlights__loading-card"));
});

function readerRoutingHarness() {
    const ast = createSourceFile("index.ts", entry, ScriptTarget.Latest, true);
    const declaration = ast.statements.find(isClassDeclaration)!;
    const member = (name: string) => declaration.members.find((item) => item.name?.getText(ast) === name)!;
    const onload = member("onload");
    assert.ok(isMethodDeclaration(onload));
    const readerRegistration = onload.body!.statements.map((statement: any) => statement.expression).find((expression) =>
        expression && isCallExpression(expression) && expression.expression.getText(ast) === "this.addTab"
            && expression.arguments[0].properties.some((property: any) => property.name?.getText(ast) === "type" && property.initializer.getText(ast) === "READER_TAB_TYPE"));
    assert.ok(readerRegistration);
    const code = transpileModule(`class RoutingHarness {
        ${["pendingReaderDocIds", "destroyedReaderTabIds", "readerOpenRequest", "openReaderTab", "consumeReaderFocus", "onunload"].map((name) => member(name).getText(ast)).join("\n")}
        register() { const plugin = this; ${readerRegistration.getText(ast)}; }
    }; globalThis.RoutingHarness = RoutingHarness;`, { compilerOptions: { target: ScriptTarget.ESNext } }).outputText;
    const openRequests: Array<{ resolve: (tab: { id: string }) => void; reject: (error: Error) => void }> = [];
    const openCalls: Array<{ custom?: unknown; doc?: { id: string } }> = [];
    const messages: string[] = [];
    const events = new EventTarget();
    const instances = new Map<string, any>();
    const focusSource = reader.slice(reader.indexOf("const onFocus = (event: Event)"), reader.indexOf("const onRecentReading ="));
    assert.ok(focusSource.includes("consumeReaderFocus(tabId)"));
    let registration: any;
    const scope: any = {
        openTab: (options: { custom?: unknown; doc?: { id: string } }) => {
            openCalls.push(options);
            return new Promise((resolve, reject) => openRequests.push({ resolve, reject }));
        },
        READER_TAB_TYPE: "glean-reader", ReaderTab: {},
        showMessage: (message: string) => messages.push(message), t: (_i18n: unknown, key: string) => key,
        CustomEvent: class extends Event { detail: unknown; constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail; } },
        document: { dispatchEvent: events.dispatchEvent.bind(events), createElement: () => ({ className: "" }) },
        mount: (_component: unknown, options: { props: { facade: unknown; tabId: string } }) => {
            const state: any = { ...options.props, docId: "" };
            const handler = runInNewContext(transpileModule(`${focusSource}; onFocus`, { compilerOptions: { target: ScriptTarget.ESNext } }).outputText, state);
            events.addEventListener("glean:focus-reader", handler);
            state.dispose = () => events.removeEventListener("glean:focus-reader", handler);
            instances.set(options.props.tabId, state);
            return state;
        },
        unmount: (state: any) => state.dispose(),
    };
    runInNewContext(code, scope);
    const plugin = new scope.RoutingHarness();
    Object.assign(plugin, {
        loaded: true, app: {}, name: "siyuan-glean", i18n: {}, onboardingTimer: null,
        eventBus: { off() {} }, addTab: (value: unknown) => { registration = value; },
    });
    plugin.register();
    const mountTab = (id: string) => {
        const model = { tab: { id }, element: { appendChild() {} } };
        registration.init.call(model);
        return { model, state: instances.get(id), destroy: () => registration.destroy.call(model) };
    };
    const waitForRequests = async (count: number): Promise<void> => {
        for (let attempt = 0; openRequests.length < count && attempt < 20; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        assert.ok(openRequests.length >= count, `expected ${count} pending openTab request(s), got ${openRequests.length}`);
    };
    return { plugin, openRequests, openCalls, messages, mountTab, events, scope, waitForRequests };
}

test("真实阅读页签路由只交付openTab返回目标，隐藏旧页签和同时可见分屏均不抢请求", async () => {
    const { plugin, openRequests, mountTab } = readerRoutingHarness();
    const hidden = mountTab("restored-hidden");
    const split = mountTab("visible-split");
    const target = mountTab("target-tab");
    const first = plugin.openReaderTab("long-article");
    openRequests.shift()!.resolve({ id: "target-tab" });
    await first;
    assert.equal(target.state.docId, "long-article");
    assert.equal(hidden.state.docId, "");
    assert.equal(split.state.docId, "");
    const next = plugin.openReaderTab("short-article");
    openRequests.shift()!.resolve({ id: "target-tab" });
    await next;
    assert.equal(target.state.docId, "short-article");
    assert.equal(hidden.state.docId, "");
    assert.equal(split.state.docId, "");
    assert.equal(plugin.consumeReaderFocus("target-tab"), "");
});

test("较早打开的迟到响应不覆盖新文章，晚挂载目标可读取仅属于本页签的待办", async () => {
    const { plugin, openRequests, mountTab } = readerRoutingHarness();
    const target = mountTab("target-tab");
    const earlier = plugin.openReaderTab("old-click");
    const later = plugin.openReaderTab("latest-click");
    openRequests[1].resolve({ id: "target-tab" });
    await later;
    openRequests[0].resolve({ id: "target-tab" });
    await earlier;
    assert.equal(target.state.docId, "latest-click");
    const delayed = plugin.openReaderTab("delayed-mount");
    openRequests[2].resolve({ id: "not-mounted-yet" });
    await delayed;
    assert.equal(plugin.consumeReaderFocus("target-tab"), "");
    assert.equal(plugin.consumeReaderFocus("not-mounted-yet"), "delayed-mount");
    assert.equal(plugin.consumeReaderFocus("not-mounted-yet"), "");
});

test("自定义阅读页签创建失败时回退打开同一篇原生页签", async () => {
    const { plugin, openRequests, openCalls, messages, waitForRequests } = readerRoutingHarness();
    const opening = plugin.openReaderTab("native-fallback");
    openRequests.shift()!.reject(new Error("custom-unavailable"));
    await waitForRequests(1);
    assert.equal(openCalls.length, 2);
    assert.equal(openCalls[1]?.doc?.id, "native-fallback");
    openRequests.shift()!.resolve({ id: "native-tab" });
    await opening;
    assert.deepEqual(messages, []);
});

test("较早请求的自定义页签失败时不再回退打开过时原生文章", async () => {
    const { plugin, openRequests, openCalls } = readerRoutingHarness();
    const earlier = plugin.openReaderTab("old-article");
    const later = plugin.openReaderTab("new-article");
    openRequests[1].resolve({ id: "reader-tab" });
    await later;
    openRequests[0].reject(new Error("stale-custom-unavailable"));
    await earlier;
    assert.equal(openCalls.length, 2);
    assert.equal(openCalls.some((call) => Boolean(call.doc)), false);
});

test("关闭目标和卸载插件都取消待办及未完成打开，打开失败显示反馈且不留下请求", async () => {
    const { plugin, openRequests, openCalls, mountTab, messages, waitForRequests } = readerRoutingHarness();
    const target = mountTab("closing-tab");
    const closing = plugin.openReaderTab("closed-article");
    target.destroy();
    openRequests.shift()!.resolve({ id: "closing-tab" });
    await closing;
    assert.equal(plugin.consumeReaderFocus("closing-tab"), "");
    assert.equal(target.state.docId, "");
    const failed = plugin.openReaderTab("failed-article");
    openRequests.shift()!.reject(new Error("unavailable"));
    await waitForRequests(1);
    openRequests.shift()!.reject(new Error("native-unavailable"));
    await failed;
    assert.deepEqual(messages, ["msg.actionFailed"]);
    assert.equal(openCalls.at(-2)?.custom && typeof openCalls.at(-2)?.custom === "object", true);
    assert.equal(openCalls.at(-1)?.doc?.id, "failed-article");
    const staged = plugin.openReaderTab("pending-article");
    openRequests.shift()!.resolve({ id: "delayed-tab" });
    await staged;
    const unload = plugin.openReaderTab("unloaded-article");
    await plugin.onunload();
    openRequests.shift()!.resolve({ id: "another-tab" });
    await unload;
    assert.equal(plugin.consumeReaderFocus("delayed-tab"), "");
    assert.equal(plugin.consumeReaderFocus("another-tab"), "");
});

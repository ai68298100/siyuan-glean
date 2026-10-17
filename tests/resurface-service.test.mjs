import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "./index-store" && context.parentURL?.endsWith("/src/services/resurface-service.ts")) {
            return { url: "glean-resurface:index-store", shortCircuit: true };
        }
        if (specifier === "./clip-store" && context.parentURL?.endsWith("/src/services/resurface-service.ts")) {
            return { url: "glean-resurface:clip-store", shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-resurface:index-store") return { format: "module", source: "export const loadIndex = async () => ({ clips: {}, candidates: {} });", shortCircuit: true };
        if (url === "glean-resurface:clip-store") return { format: "module", source: `
            const clips = new Map([["doc", { status: "inbox", lastSurfaced: "", pinned: "" }]]);
            const queues = new Map();
            const queuedWrite = async (_plugin, id, patch) => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                clips.set(id, { ...(clips.get(id) || {}), ...patch });
                return { indexSyncFailed: globalThis.__resurfaceIndexFailure === true };
            };
            export const withClipEditQueue = (plugin, id, action) => {
                const previous = queues.get(id) || Promise.resolve();
                const result = previous.then(() => action((patch) => queuedWrite(plugin, id, patch)), () => action((patch) => queuedWrite(plugin, id, patch)));
                queues.set(id, result.catch(() => {}));
                return result;
            };
            export const readClip = async (id) => ({ ...(clips.get(id) || {}) });
            export const writeClip = queuedWrite;
        `, shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { computeDailyFromIndex, actOnSurface, setSurfacePinned, undoSurfaceAction } = await import("../src/services/resurface-service.ts");
const clipStore = await import("glean-resurface:clip-store");

function clip(id, status, doneTime, extra = {}) {
    return {
        id, title: id, status, doneTime, internal: false, priority: 3, time: "20260901000000",
        aiTags: [], surfaced: "", pinned: "", summary: "", contentType: "local", url: "", site: "",
        ...extra,
    };
}

test("今日拾遗投影暴露统计共用的连续完成记录", () => {
    const index = {
        clips: {
            today: clip("today", "done", "20260929100000"),
            yesterday: clip("yesterday", "archived", "20260928100000"),
            twoDaysAgo: clip("two-days-ago", "reading", "20260927100000"),
            internal: clip("internal", "done", "20260926100000", { internal: true }),
        },
        candidates: {},
    };
    const settings = { resurface: { dailyCount: 3, includeDoneHighlights: false } };
    const daily = computeDailyFromIndex(index, settings, new Date(2026, 8, 29, 12));
    assert.equal(daily.completionStreak, 3);
    assert.equal(daily.picks.length, 0);
});

test("重浮属性读改写按文档串行，连续动作不会基于旧快照互相覆盖", async () => {
    const plugin = {};
    const first = actOnSurface(plugin, "doc", "read");
    const second = setSurfacePinned(plugin, "doc", true);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.token.before.status, "inbox");
    assert.equal(firstResult.indexSyncFailed, false);
    assert.match(secondResult.pinned, /^\d{8}$/);
    assert.equal(secondResult.indexSyncFailed, false);
    globalThis.__resurfaceIndexFailure = true;
    assert.equal((await actOnSurface(plugin, "doc", "later")).indexSyncFailed, true);
    assert.equal((await setSurfacePinned(plugin, "doc", false)).indexSyncFailed, true);
    delete globalThis.__resurfaceIndexFailure;
});

test("撤销恢复确切旧状态，后续状态写入会阻止旧回执覆盖", async () => {
    const plugin = {};
    await clipStore.writeClip(plugin, "undo-doc", { status: "inbox", lastSurfaced: "20261001" });
    const first = await actOnSurface(plugin, "undo-doc", "archive");
    await undoSurfaceAction(plugin, "undo-doc", first.token);
    assert.equal((await clipStore.readClip("undo-doc")).status, "inbox");
    assert.equal((await clipStore.readClip("undo-doc")).lastSurfaced, "20261001");

    const stale = await actOnSurface(plugin, "undo-doc", "archive");
    await actOnSurface(plugin, "undo-doc", "read");
    await assert.rejects(undoSurfaceAction(plugin, "undo-doc", stale.token), /文章状态已变化/);
    assert.equal((await clipStore.readClip("undo-doc")).status, "reading");
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((complete, fail) => { resolve = complete; reject = fail; });
    return { promise, resolve, reject };
}

function loadSurfaceControls({ act, undo, pin, replacement, tick, openReading } = {}) {
    const item = clip("desktop-doc", "inbox", "");
    const pick = { item, reasons: [] };
    const calls = { act: [], undo: [], pin: [], opened: [], messages: [], focusedUndo: 0, focusedTitle: 0, focusedTitleIds: [], notified: 0, mutated: 0, events: [] };
    const destroyCallbacks = [];
    const props = {
        facade: {
            isMobile: false, i18n: {}, settings: {}, pluginInstance: {},
            notifyDataChanged() { calls.notified += 1; calls.events.push("notify"); },
            openReadingDocument(id) { calls.opened.push(id); calls.events.push("open"); openReading?.(id); },
        },
        index: { clips: {}, candidates: {} }, currentTime: new Date(), onMutated() { calls.mutated += 1; calls.events.push("mutated"); },
    };
    class ActiveButton {
        isConnected = true;
        closest() { return { getAttribute: () => "glean-resurface-card-title-test-desktop-doc" }; }
    }
    const services = {
        computeDailyFromIndex: () => ({ picks: [pick], recentCount: 0 }),
        pickSurfaceReplacementFromIndex: (...args) => replacement ? replacement(...args) : { item: clip("replacement-doc", "inbox", ""), reasons: [] },
        actOnSurface: async (...args) => { calls.act.push(args); return act ? act(...args) : { token: {} }; },
        setSurfacePinned: async (...args) => { calls.pin.push(args); return pin ? pin(...args) : { pinned: "20261016" }; },
        undoSurfaceAction: async (...args) => { calls.undo.push(args); return undo ? undo(...args) : {}; },
    };
    const modules = {
        svelte: { onDestroy(callback) { destroyCallbacks.push(callback); }, tick: async () => tick?.() },
        siyuan: { showMessage(message) { calls.messages.push(message); } },
        "../libs/i18n": { t: (_dictionary, key) => key },
        "../services/resurface-service": services,
        "../domain/resurface": { todayStamp: () => "20261016" },
        "../domain/carrier": { resolveCarrier: () => "local", openTargetForCarrier: () => "document" },
        "../domain/surface-swipe": {},
    };
    const source = readFileSync(new URL("../src/ui/ResurfaceView.svelte", import.meta.url), "utf8").match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const probe = `globalThis.controls = { act, togglePin, replacePick, undoLastAction, dismissUndo, bind(panel, button) { panelRoot = panel; undoButton = button; }, inspect() { return { actingId, undoingId, undoNotice, startedToday, sessionPicks }; } };`;
    const compiled = transpileModule(`${source}\n${probe}`, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ESNext } }).outputText;
    const context = {
        exports: {}, require: (id) => modules[id],
        $props: Object.assign(() => props, { id: () => "test" }),
        $state: Object.assign((value) => value, { raw: (value) => value }), $derived: Object.assign((value) => value, { by: (value) => value() }), $effect() {},
        HTMLElement: ActiveButton, document: { activeElement: new ActiveButton(), body: { isConnected: true } }, console,
    };
    runInNewContext(compiled, context);
    context.controls.bind(
        {
            contains: () => true,
            querySelector: () => ({ focus() { calls.focusedTitle += 1; } }),
            querySelectorAll: () => ["other-doc", "replacement-doc"].map((id) => ({
                id: `glean-resurface-card-title-test-${id}`,
                focus() { calls.focusedTitle += 1; calls.focusedTitleIds.push(id); },
            })),
        },
        { focus() { calls.focusedUndo += 1; } },
    );
    return { ...context.controls, pick, calls, focusDocument: context.document, destroy: () => destroyCallbacks.forEach((callback) => callback()) };
}

test("桌面改天也显示成功回执，等待期间防重复，撤销后恢复可操作焦点", async () => {
    const action = deferred();
    const undo = deferred();
    const controls = loadSurfaceControls({ act: () => action.promise, undo: () => undo.promise });
    const pending = controls.act(controls.pick, "later");
    await controls.act(controls.pick, "archive");
    await controls.undoLastAction();
    assert.equal(controls.calls.act.length, 1);
    assert.equal(controls.inspect().actingId, "desktop-doc");
    assert.equal(controls.inspect().undoNotice, null);

    action.resolve({ token: { before: {}, after: {} } });
    await pending;
    assert.equal(controls.inspect().undoNotice.title, "desktop-doc");
    assert.equal(controls.inspect().undoNotice.action, "later");
    assert.equal(controls.calls.focusedUndo, 1);
    assert.equal(controls.inspect().actingId, "");

    const pendingUndo = controls.undoLastAction();
    await controls.undoLastAction();
    await controls.act(controls.pick, "archive");
    assert.equal(controls.calls.undo.length, 1);
    assert.equal(controls.calls.act.length, 1);
    undo.resolve({});
    await pendingUndo;
    assert.equal(controls.inspect().undoNotice, null);
    assert.equal(controls.inspect().undoingId, "");
    assert.equal(controls.calls.focusedTitle, 1);
});

test("桌面开始阅读保留编辑器焦点，关闭成功回执后可继续键盘操作", async () => {
    const controls = loadSurfaceControls();
    await controls.act(controls.pick, "read");
    assert.deepEqual(controls.calls.opened, ["desktop-doc"]);
    assert.equal(controls.calls.focusedUndo, 0);
    assert.equal(controls.inspect().undoNotice.action, "read");
    await controls.dismissUndo();
    assert.equal(controls.inspect().undoNotice, null);
    assert.equal(controls.calls.focusedTitle, 1);
});

test("慢写期间主动移焦到其他控件或编辑器，完成与撤销不抢回焦点", async () => {
    const action = deferred();
    const undo = deferred();
    const controls = loadSurfaceControls({ act: () => action.promise, undo: () => undo.promise });
    const pending = controls.act(controls.pick, "later");
    const editor = { isConnected: true };
    controls.focusDocument.activeElement = editor;
    action.resolve({ token: {} });
    await pending;
    assert.equal(controls.calls.focusedUndo, 0);
    assert.equal(controls.focusDocument.activeElement, editor);

    const pendingUndo = controls.undoLastAction();
    const anotherControl = { isConnected: true };
    controls.focusDocument.activeElement = anotherControl;
    undo.resolve({});
    await pendingUndo;
    assert.equal(controls.calls.focusedTitle, 0);
    assert.equal(controls.focusDocument.activeElement, anotherControl);
});

test("原触发控件卸载后焦点退到body才恢复；仍连接时主动失焦不强行恢复", async () => {
    const action = deferred();
    const controls = loadSurfaceControls({ act: () => action.promise });
    const pending = controls.act(controls.pick, "archive");
    controls.focusDocument.activeElement.isConnected = false;
    controls.focusDocument.activeElement = controls.focusDocument.body;
    action.resolve({ token: {} });
    await pending;
    assert.equal(controls.calls.focusedUndo, 1);

    const otherAction = deferred();
    const blurred = loadSurfaceControls({ act: () => otherAction.promise });
    const otherPending = blurred.act(blurred.pick, "archive");
    blurred.focusDocument.activeElement = blurred.focusDocument.body;
    otherAction.resolve({ token: {} });
    await otherPending;
    assert.equal(blurred.calls.focusedUndo, 0);
});

test("关闭回执后的渲染间隙若移焦，保留用户新焦点", async () => {
    let controls;
    controls = loadSurfaceControls({ tick: () => { controls.focusDocument.activeElement = { isConnected: true }; } });
    await controls.act(controls.pick, "read");
    await controls.dismissUndo();
    assert.equal(controls.calls.focusedTitle, 0);
});

test("开始阅读导航同步失败仍保留真实成功回执、投影和刷新", async () => {
    const controls = loadSurfaceControls({ openReading: () => { throw new Error("open failed"); } });
    await controls.act(controls.pick, "read");
    assert.equal(controls.calls.notified, 1);
    assert.equal(controls.calls.mutated, 1);
    assert.deepEqual(controls.calls.events, ["notify", "mutated", "open"]);
    assert.equal(controls.inspect().undoNotice.action, "read");
    assert.equal(controls.inspect().sessionPicks.length, 0);
    assert.equal(controls.inspect().startedToday[0].id, "desktop-doc");
    assert.deepEqual(controls.calls.messages, ["resurface.openFailed"]);
    assert.equal(controls.inspect().actingId, "");
});

test("等待写入时销毁组件，成功后仅广播真实数据而不导航或回填UI", async () => {
    const action = deferred();
    const controls = loadSurfaceControls({ act: () => action.promise });
    const pending = controls.act(controls.pick, "read");
    controls.destroy();
    action.resolve({ token: {}, indexSyncFailed: true });
    await pending;
    assert.equal(controls.calls.notified, 1);
    assert.equal(controls.calls.mutated, 0);
    assert.equal(controls.calls.opened.length, 0);
    assert.equal(controls.inspect().undoNotice, null);
    assert.equal(controls.inspect().sessionPicks, null);
    assert.equal(controls.inspect().startedToday.length, 0);
    assert.equal(controls.calls.focusedUndo, 0);
    assert.deepEqual(controls.calls.messages, []);
});

test("等待撤销时销毁组件，成功后仅广播真实数据而不回填旧UI或提示", async () => {
    const undo = deferred();
    const controls = loadSurfaceControls({ undo: () => undo.promise });
    await controls.act(controls.pick, "later");
    const notice = controls.inspect().undoNotice;
    const pending = controls.undoLastAction();
    controls.destroy();
    undo.resolve({ indexSyncFailed: true });
    await pending;
    assert.equal(controls.calls.notified, 2);
    assert.equal(controls.calls.mutated, 1);
    assert.equal(controls.inspect().undoNotice, notice);
    assert.equal(controls.inspect().undoingId, "desktop-doc");
    assert.equal(controls.calls.focusedTitle, 0);
    assert.deepEqual(controls.calls.messages, []);
    await controls.undoLastAction();
    assert.equal(controls.calls.undo.length, 1, "销毁后不能再次发起撤销");
});

test("等待撤销时销毁组件，失败后不弹旧页面错误或触发回调", async () => {
    const undo = deferred();
    const controls = loadSurfaceControls({ undo: () => undo.promise });
    await controls.act(controls.pick, "archive");
    const notice = controls.inspect().undoNotice;
    const pending = controls.undoLastAction();
    controls.destroy();
    undo.reject(new Error("undo unavailable"));
    await pending;
    assert.equal(controls.calls.notified, 1);
    assert.equal(controls.calls.mutated, 1);
    assert.equal(controls.inspect().undoNotice, notice);
    assert.equal(controls.inspect().undoingId, "desktop-doc");
    assert.equal(controls.calls.focusedTitle, 0);
    assert.deepEqual(controls.calls.messages, []);
});

test("换一篇卸载原卡片后将焦点交给确切替补文章", async () => {
    let controls;
    controls = loadSurfaceControls({ tick: () => {
        controls.focusDocument.activeElement.isConnected = false;
        controls.focusDocument.activeElement = controls.focusDocument.body;
    } });
    await controls.replacePick(0, controls.pick);
    assert.equal(controls.inspect().sessionPicks[0].item.id, "replacement-doc");
    assert.deepEqual(controls.calls.focusedTitleIds, ["replacement-doc"]);
    assert.equal(controls.calls.notified, 0, "会话换文不广播文章数据变更");
});

test("换一篇渲染间隙主动移焦或销毁时不恢复旧页面焦点", async () => {
    let moved;
    const otherControl = { isConnected: true };
    moved = loadSurfaceControls({ tick: () => { moved.focusDocument.activeElement = otherControl; } });
    await moved.replacePick(0, moved.pick);
    assert.equal(moved.calls.focusedTitle, 0);
    assert.equal(moved.focusDocument.activeElement, otherControl);

    let destroyed;
    destroyed = loadSurfaceControls({ tick: () => destroyed.destroy() });
    await destroyed.replacePick(0, destroyed.pick);
    assert.equal(destroyed.calls.focusedTitle, 0);
    const currentPicks = destroyed.inspect().sessionPicks;
    await destroyed.replacePick(0, destroyed.pick);
    assert.equal(destroyed.inspect().sessionPicks, currentPicks, "销毁后不能再替换会话卡片");
});

test("没有替补文章时保留原卡片及焦点", async () => {
    const controls = loadSurfaceControls({ replacement: () => null });
    const focusOrigin = controls.focusDocument.activeElement;
    await controls.replacePick(0, controls.pick);
    assert.equal(controls.inspect().sessionPicks, null);
    assert.equal(controls.calls.focusedTitle, 0);
    assert.equal(controls.focusDocument.activeElement, focusOrigin);
    assert.deepEqual(controls.calls.messages, ["resurface.noAlternative"]);
});

test("慢置顶期间防重复，销毁后成功只广播真实变更", async () => {
    const pin = deferred();
    const controls = loadSurfaceControls({ pin: () => pin.promise });
    const pending = controls.togglePin(controls.pick);
    await controls.togglePin(controls.pick);
    await controls.act(controls.pick, "archive");
    assert.equal(controls.calls.pin.length, 1);
    assert.equal(controls.calls.act.length, 0);
    controls.destroy();
    pin.resolve({ pinned: "20261016", indexSyncFailed: true });
    await pending;
    assert.equal(controls.calls.notified, 1);
    assert.equal(controls.calls.mutated, 0);
    assert.equal(controls.inspect().actingId, "desktop-doc", "销毁后不回填旧组件忙态");
    assert.deepEqual(controls.calls.messages, []);
    await controls.togglePin(controls.pick);
    assert.equal(controls.calls.pin.length, 1, "销毁后不能再次启动置顶");
});

test("慢置顶销毁后失败不弹旧页面提示或触发回调", async () => {
    const pin = deferred();
    const controls = loadSurfaceControls({ pin: () => pin.promise });
    const pending = controls.togglePin(controls.pick);
    controls.destroy();
    pin.reject(new Error("pin unavailable"));
    await pending;
    assert.equal(controls.calls.notified, 0);
    assert.equal(controls.calls.mutated, 0);
    assert.equal(controls.inspect().actingId, "desktop-doc");
    assert.deepEqual(controls.calls.messages, []);
});

test("撤销开始阅读成功清除对应会话回执，失败则保留", async () => {
    const controls = loadSurfaceControls();
    await controls.act(controls.pick, "read");
    assert.equal(controls.inspect().startedToday.length, 1);
    await controls.undoLastAction();
    assert.equal(controls.inspect().startedToday.length, 0);
    assert.equal(controls.inspect().undoNotice, null);

    const failed = loadSurfaceControls({ undo: () => Promise.reject(new Error("undo unavailable")) });
    await failed.act(failed.pick, "read");
    await failed.undoLastAction();
    assert.equal(failed.inspect().startedToday[0].id, "desktop-doc");
    assert.equal(failed.inspect().undoNotice.action, "read");
    assert.deepEqual(failed.calls.messages, ["resurface.undoUnavailable"]);
});

test("异步拾遗动作使用可聚焦忙态语义，避免原生 disabled 导致失败时丢失触发焦点", () => {
    const source = readFileSync(new URL("../src/ui/ResurfaceView.svelte", import.meta.url), "utf8");
    const buttons = source.split(/\r?\n/).filter((line) => line.includes("<button")
        && /onclick=\{\(\) => void (?:undoLastAction|togglePin|replacePick|act)\(/.test(line));
    assert.equal(buttons.length, 6, "撤销、置顶、换文和三个状态动作都遵守焦点协议");
    for (const button of buttons) {
        assert.match(button, /\saria-disabled=\{/);
        assert.match(button, /\saria-busy=\{/);
        assert.doesNotMatch(button, /\sdisabled(?:=|\s|>)/);
    }
    const styles = readFileSync(new URL("../src/index.scss", import.meta.url), "utf8");
    assert.match(styles, /\.glean-surf-undo__button\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*wait/);
    assert.match(styles, /&\[aria-disabled="true"\]\s*\{[^}]*opacity:\s*0\.5;[^}]*cursor:\s*wait/);
});

test("改天、归档、开始阅读失败后保留触发控件，忙态阻止重复写入而失败后允许重试", async (context) => {
    for (const action of ["later", "archive", "read"]) await context.test(action, async () => {
        const writing = deferred();
        let attempts = 0;
        const controls = loadSurfaceControls({ act: () => attempts++ === 0 ? writing.promise : { token: {} } });
        const focusOrigin = controls.focusDocument.activeElement;
        const pending = controls.act(controls.pick, action);
        await controls.act(controls.pick, action);
        await controls.togglePin(controls.pick);
        await controls.replacePick(0, controls.pick);
        assert.equal(controls.calls.act.length, 1);
        assert.equal(controls.calls.pin.length, 0);
        assert.equal(controls.inspect().sessionPicks, null);
        writing.reject(new Error("write conflict"));
        await pending;
        assert.equal(controls.focusDocument.activeElement, focusOrigin);
        assert.equal(controls.inspect().actingId, "");
        assert.equal(controls.inspect().undoNotice, null);
        assert.equal(controls.inspect().startedToday.length, 0);
        assert.equal(controls.calls.focusedUndo, 0);
        assert.equal(controls.calls.focusedTitle, 0);
        assert.equal(controls.calls.notified, 0);
        assert.deepEqual(controls.calls.messages, ["msg.actionFailed"]);
        await controls.act(controls.pick, action);
        assert.equal(controls.calls.act.length, 2);
        assert.equal(controls.inspect().undoNotice.action, action);
    });
});

test("置顶失败后保留触发控件，清除忙态后可重试", async () => {
    const pin = deferred();
    let attempts = 0;
    const controls = loadSurfaceControls({ pin: () => attempts++ === 0 ? pin.promise : { pinned: "20261016" } });
    const focusOrigin = controls.focusDocument.activeElement;
    const pending = controls.togglePin(controls.pick);
    await controls.togglePin(controls.pick);
    assert.equal(controls.calls.pin.length, 1);
    pin.reject(new Error("pin conflict"));
    await pending;
    assert.equal(controls.focusDocument.activeElement, focusOrigin);
    assert.equal(controls.inspect().actingId, "");
    assert.equal(controls.calls.focusedUndo, 0);
    assert.equal(controls.calls.focusedTitle, 0);
    assert.equal(controls.calls.notified, 0);
    assert.deepEqual(controls.calls.messages, ["msg.actionFailed"]);
    await controls.togglePin(controls.pick);
    assert.equal(controls.calls.pin.length, 2);
    assert.equal(controls.calls.notified, 1);
    assert.equal(controls.calls.mutated, 1);
});

test("撤销冲突保留回执和撤销触发焦点，防重入并允许显式重试", async () => {
    const undo = deferred();
    let attempts = 0;
    const controls = loadSurfaceControls({ undo: () => attempts++ === 0 ? undo.promise : {} });
    await controls.act(controls.pick, "later");
    const notice = controls.inspect().undoNotice;
    const undoTrigger = { isConnected: true };
    controls.focusDocument.activeElement = undoTrigger;
    const pending = controls.undoLastAction();
    await controls.undoLastAction();
    await controls.act(controls.pick, "archive");
    await controls.togglePin(controls.pick);
    await controls.replacePick(0, controls.pick);
    assert.equal(controls.calls.undo.length, 1);
    assert.equal(controls.calls.act.length, 1);
    assert.equal(controls.calls.pin.length, 0);
    undo.reject(new Error("文章状态已变化，无法撤销"));
    await pending;
    assert.equal(controls.focusDocument.activeElement, undoTrigger);
    assert.equal(controls.inspect().undoNotice, notice);
    assert.equal(controls.inspect().undoingId, "");
    assert.equal(controls.calls.focusedTitle, 0);
    assert.equal(controls.calls.notified, 1, "冲突不能宣称写入成功");
    assert.deepEqual(controls.calls.messages, ["resurface.undoUnavailable"]);
    await controls.undoLastAction();
    assert.equal(controls.calls.undo.length, 2);
    assert.equal(controls.inspect().undoNotice, null);
});

test("写入和撤销失败期间主动移焦，错误回执不抢回焦点", async () => {
    const writing = deferred();
    const controls = loadSurfaceControls({ act: () => writing.promise });
    const pending = controls.act(controls.pick, "later");
    const editor = { isConnected: true };
    controls.focusDocument.activeElement = editor;
    writing.reject(new Error("write conflict"));
    await pending;
    assert.equal(controls.focusDocument.activeElement, editor);
    assert.equal(controls.calls.focusedUndo, 0);

    const undo = deferred();
    const undoControls = loadSurfaceControls({ undo: () => undo.promise });
    await undoControls.act(undoControls.pick, "later");
    const pendingUndo = undoControls.undoLastAction();
    undoControls.focusDocument.activeElement = editor;
    undo.reject(new Error("undo conflict"));
    await pendingUndo;
    assert.equal(undoControls.focusDocument.activeElement, editor);
    assert.equal(undoControls.calls.focusedTitle, 0);
});

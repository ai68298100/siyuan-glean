/** UI 偏好单测：首启恢复状态只能是可校验的界面进度。 */
import test from "node:test";
import assert from "node:assert/strict";

import { deleteSavedViewPref, loadUiPrefs, normalizeUiPrefs, saveLastViewPref, setDefaultSavedViewPref, upsertSavedViewPref, saveUiPrefs } from "../src/services/prefs.ts";
import type { ReaderAppearance } from "../src/domain/ui-prefs.ts";

function createPlugin(initial: unknown = undefined) {
    let data = initial;
    return {
        plugin: {
            async loadData() {
                return data;
            },
            async saveData(_name: string, value: unknown) {
                data = value;
            },
        } as never,
        read() {
            return data;
        },
    };
}

test("loadUiPrefs：旧存档补齐首启进度默认值", async () => {
    const harness = createPlugin({ lastView: "library", onboardingDone: false });
    assert.deepEqual(await loadUiPrefs(harness.plugin), {
        lastView: "library",
        onboardingDone: false,
        onboardingStep: 1,
        onboardingInterrupted: false,
        onboardingHintDismissed: false,
        readerAppearance: { fontSize: "normal", lineHeight: "normal", width: "normal", theme: "follow" },
        readerSidebarCollapsed: false,
        workbenchPreviewEnabled: true,
        workbenchPreviewRatio: 0.45,
        libraryRailGroups: { queues: { collapsed: false, expanded: false }, sites: { collapsed: false, expanded: false }, authors: { collapsed: false, expanded: false }, tags: { collapsed: false, expanded: false }, aiTags: { collapsed: false, expanded: false } },
        savedViews: [],
        defaultSavedViewId: "",
        governanceMuted: { quota: "", stale: "", candidates: "" },
    });
});

test("normalizeUiPrefs：非法步骤与已完成状态不会产生可恢复脏状态", () => {
    assert.deepEqual(normalizeUiPrefs({ onboardingStep: 99, onboardingInterrupted: true }), {
        lastView: "",
        onboardingDone: false,
        onboardingStep: 1,
        onboardingInterrupted: true,
        onboardingHintDismissed: false,
        readerAppearance: { fontSize: "normal", lineHeight: "normal", width: "normal", theme: "follow" },
        readerSidebarCollapsed: false,
        workbenchPreviewEnabled: true,
        workbenchPreviewRatio: 0.45,
        libraryRailGroups: { queues: { collapsed: false, expanded: false }, sites: { collapsed: false, expanded: false }, authors: { collapsed: false, expanded: false }, tags: { collapsed: false, expanded: false }, aiTags: { collapsed: false, expanded: false } },
        savedViews: [],
        defaultSavedViewId: "",
        governanceMuted: { quota: "", stale: "", candidates: "" },
    });
    assert.deepEqual(normalizeUiPrefs({ onboardingDone: true, onboardingStep: 4, onboardingInterrupted: true }), {
        lastView: "",
        onboardingDone: true,
        onboardingStep: 1,
        onboardingInterrupted: false,
        onboardingHintDismissed: true,
        readerAppearance: { fontSize: "normal", lineHeight: "normal", width: "normal", theme: "follow" },
        readerSidebarCollapsed: false,
        workbenchPreviewEnabled: true,
        workbenchPreviewRatio: 0.45,
        libraryRailGroups: { queues: { collapsed: false, expanded: false }, sites: { collapsed: false, expanded: false }, authors: { collapsed: false, expanded: false }, tags: { collapsed: false, expanded: false }, aiTags: { collapsed: false, expanded: false } },
        savedViews: [],
        defaultSavedViewId: "",
        governanceMuted: { quota: "", stale: "", candidates: "" },
    });
});

test("saveUiPrefs：增量保存保留其他偏好并记录中断步骤", async () => {
    const harness = createPlugin({ lastView: "library", onboardingDone: false });
    const saved = await saveUiPrefs(harness.plugin, { onboardingStep: 3, onboardingInterrupted: true });
    assert.equal(saved.lastView, "library");
    assert.equal(saved.onboardingStep, 3);
    assert.equal(saved.onboardingInterrupted, true);
    assert.equal(saved.onboardingHintDismissed, false);
    assert.deepEqual(harness.read(), saved);
});

test("saveUiPrefs：完成或跳过会清除恢复标记", async () => {
    const harness = createPlugin({ onboardingStep: 4, onboardingInterrupted: true });
    const saved = await saveUiPrefs(harness.plugin, { onboardingDone: true });
    assert.equal(saved.onboardingDone, true);
    assert.equal(saved.onboardingStep, 1);
    assert.equal(saved.onboardingInterrupted, false);
    assert.equal(saved.onboardingHintDismissed, true);
});

test("saveUiPrefs：用户隐藏新手提示后保留引导进度", async () => {
    const harness = createPlugin({ onboardingStep: 2, onboardingInterrupted: true });
    const saved = await saveUiPrefs(harness.plugin, { onboardingHintDismissed: true });
    assert.equal(saved.onboardingStep, 2);
    assert.equal(saved.onboardingInterrupted, true);
    assert.equal(saved.onboardingHintDismissed, true);
});

test("saveUiPrefs：并发入口串行读改写并复制调用方草稿", async () => {
    let data: unknown = undefined;
    let active = 0;
    let maximumActive = 0;
    const plugin = {
        async loadData() {
            await new Promise((resolve) => setTimeout(resolve, 5));
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            const value = data;
            active -= 1;
            return value;
        },
        async saveData(_name: string, value: unknown) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            data = value;
        },
    } as never;
    const appearance: ReaderAppearance = { fontSize: "small", lineHeight: "relaxed", width: "wide", theme: "paper" };
    const first = saveUiPrefs(plugin, { readerAppearance: appearance });
    appearance.fontSize = "large";
    const second = saveUiPrefs(plugin, { lastView: "library" });
    const [, saved] = await Promise.all([first, second]);
    assert.equal(maximumActive, 1);
    assert.equal(saved.lastView, "library");
    assert.equal(saved.readerAppearance.fontSize, "small");
});

test("saveUiPrefs：一次读取失败后队列仍可恢复", async () => {
    let data: unknown = undefined;
    let fail = true;
    const plugin = {
        async loadData() {
            if (fail) {
                fail = false;
                throw new Error("temporary read failure");
            }
            return data;
        },
        async saveData(_name: string, value: unknown) {
            data = value;
        },
    } as never;
    await assert.rejects(saveUiPrefs(plugin, { lastView: "first" }));
    const saved = await saveUiPrefs(plugin, { lastView: "second" });
    assert.equal(saved.lastView, "second");
});

test("伴生栏偏好：只恢复布尔 true，非法和旧数据保留展开默认", () => {
    assert.equal(normalizeUiPrefs({ readerSidebarCollapsed: true }).readerSidebarCollapsed, true);
    for (const value of [undefined, null, false, "true", 1, {}, []]) {
        assert.equal(normalizeUiPrefs({ readerSidebarCollapsed: value }).readerSidebarCollapsed, false);
    }
});

test("伴生栏偏好：跨入口保存和重新加载不覆盖阅读外观或首启进度", async () => {
    const harness = createPlugin({ onboardingStep: 3, readerAppearance: { fontSize: "large" } });
    await Promise.all([
        saveUiPrefs(harness.plugin, { readerSidebarCollapsed: true }),
        saveUiPrefs(harness.plugin, { lastView: "highlights" }),
    ]);
    const prefs = await loadUiPrefs(harness.plugin);
    assert.equal(prefs.readerSidebarCollapsed, true);
    assert.equal(prefs.readerAppearance.fontSize, "large");
    assert.equal(prefs.onboardingStep, 3);
    assert.equal(prefs.lastView, "highlights");
});

test("侧栏偏好：并发分组增量保存、草稿复制和重载保留其他组", async () => {
    const harness = createPlugin({ readerSidebarCollapsed: true });
    const tags = { collapsed: true, expanded: false };
    const first = saveUiPrefs(harness.plugin, { libraryRailGroups: { tags } });
    tags.collapsed = false;
    await Promise.all([
        first,
        saveUiPrefs(harness.plugin, { libraryRailGroups: { aiTags: { collapsed: false, expanded: true } } }),
        saveUiPrefs(harness.plugin, { lastView: "library" }),
    ]);
    const prefs = await loadUiPrefs(harness.plugin);
    assert.equal(prefs.libraryRailGroups.tags.collapsed, true);
    assert.equal(prefs.libraryRailGroups.aiTags.expanded, true);
    assert.equal(prefs.libraryRailGroups.sites.expanded, false);
    assert.equal(prefs.readerSidebarCollapsed, true);
    assert.equal(prefs.lastView, "library");
});

test("治理提醒按日静默：只接受日期，跨日自动恢复", async () => {
    const { governanceCueMuted, localDateStamp, normalizeGovernanceMuted } = await import("../src/domain/ui-prefs.ts");
    const today = new Date(2026, 9, 4, 12, 0, 0);
    const tomorrow = new Date(2026, 9, 5, 12, 0, 0);
    const muted = normalizeGovernanceMuted({ quota: localDateStamp(today), stale: "2026-02-30", candidates: "2026-10-04" });
    assert.deepEqual(muted, { quota: "2026-10-04", stale: "", candidates: "2026-10-04" });
    assert.equal(governanceCueMuted("quota", muted, today), true);
    assert.equal(governanceCueMuted("quota", muted, tomorrow), false);
    const harness = createPlugin();
    const saved = await saveUiPrefs(harness.plugin, { governanceMuted: muted });
    assert.deepEqual(saved.governanceMuted, muted);
});

test("保存视图精确写：双实例 upsert/delete 互不覆盖，删除不复活（T-3318）", async () => {
    const harness = createPlugin(undefined);
    // 实例 A（dock）新建 v1；实例 B（工作台 tab）新建 v2——精确写基于最新文件，互不覆盖
    await upsertSavedViewPref(harness.plugin, { id: "v1", name: "视图一", createdAt: "2026-10-09T00:00:00.000Z", filter: {}, layout: "list" });
    await upsertSavedViewPref(harness.plugin, { id: "v2", name: "视图二", createdAt: "2026-10-09T01:00:00.000Z", filter: {}, layout: "list" });
    let prefs = await loadUiPrefs(harness.plugin);
    assert.deepEqual(prefs.savedViews.map((view) => view.id).sort(), ["v1", "v2"]);
    // 实例 A 删除 v1：精确删除，不把 v2 拉回来
    await deleteSavedViewPref(harness.plugin, "v1");
    prefs = await loadUiPrefs(harness.plugin);
    assert.deepEqual(prefs.savedViews.map((view) => view.id), ["v2"]);
    // 设默认后重命名 v2：upsert 幂等覆盖且默认保持
    await setDefaultSavedViewPref(harness.plugin, "v2");
    await upsertSavedViewPref(harness.plugin, { id: "v2", name: "视图二改", createdAt: "2026-10-09T01:00:00.000Z", filter: {}, layout: "list" });
    prefs = await loadUiPrefs(harness.plugin);
    assert.equal(prefs.savedViews.length, 1);
    assert.equal(prefs.savedViews[0].name, "视图二改");
    assert.equal(prefs.defaultSavedViewId, "v2");
});

test("保存视图精确写：读取失败拒绝写回，不用空快照清空用户数据（T-3318）", async () => {
    const harness = createPlugin({ lastView: "library", savedViews: [
        { id: "v1", name: "重要视图", createdAt: "2026-10-09T00:00:00.000Z", filter: {}, layout: "list" },
    ] });
    harness.plugin.loadData = async () => { throw new Error("transient io failure"); };
    await assert.rejects(upsertSavedViewPref(harness.plugin, { id: "v9", name: "x", createdAt: "2026-10-09T00:00:00.000Z", filter: {}, layout: "list" }), /Preferences changed/);
    await assert.rejects(deleteSavedViewPref(harness.plugin, "v1"), /Preferences changed/);
    await assert.rejects(saveLastViewPref(harness.plugin, "resurface"), /Preferences changed/);
    harness.plugin.loadData = async () => harness.read();
    const prefs = await loadUiPrefs(harness.plugin);
    assert.equal(prefs.savedViews.length, 1);
    assert.equal(prefs.savedViews[0].name, "重要视图");
});

test("deleteSavedViewPref：默认视图指向被删视图时一并清空（T-3318）", async () => {
    const harness = createPlugin(undefined);
    await upsertSavedViewPref(harness.plugin, { id: "v1", name: "默认", createdAt: "2026-10-09T00:00:00.000Z", filter: {}, layout: "list" });
    await setDefaultSavedViewPref(harness.plugin, "v1");
    await deleteSavedViewPref(harness.plugin, "v1");
    const prefs = await loadUiPrefs(harness.plugin);
    assert.equal(prefs.savedViews.length, 0);
    assert.equal(prefs.defaultSavedViewId, "");
});

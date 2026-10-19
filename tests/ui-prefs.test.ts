import { normalizeUiPrefs } from "../src/services/prefs.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { applySavedView, createSavedView, deleteSavedView, normalizeReaderAppearance, normalizeSavedViews, normalizeTagAliases, displayTagAlias, setDefaultSavedView, SMART_VIEW_PRESETS, instantiateSmartViewPreset } from "../src/domain/ui-prefs.ts";

test("ui prefs normalizes reader appearance and drops invalid saved views", () => {
    assert.deepEqual(normalizeReaderAppearance({ fontSize: "huge", theme: "eye" }), {
        fontSize: "normal", lineHeight: "normal", width: "normal", theme: "eye",
    });
    assert.deepEqual(normalizeSavedViews([
        { id: "a", name: "  Inbox  ", layout: "list", filter: { status: "inbox", includeCandidates: true } },
        { id: "b", name: "inbox", layout: "kanban", filter: { status: "done" } },
        { id: "c", name: "Other", layout: "bad", filter: {} },
    ]), [{ id: "a", name: "Inbox", layout: "list", filter: { status: "inbox" } }]);
});

test("作者时间线保存视图保留作者与全状态，不保存编辑草稿", () => {
    const result = normalizeSavedViews([{ id: "author", name: "作者文章", layout: "list", filter: { author: "  Daily  ", site: "example.com", status: "all", sortBy: "time", direction: "desc", authorDraft: "private", expectedAuthor: "private" } }]);
    assert.deepEqual(result[0].filter, { author: "Daily", site: "example.com", status: "all", sortBy: "time", direction: "desc" });
    const applied = applySavedView(result, "author")!;
    applied.filter.author = "Changed";
    assert.equal(result[0].filter.author, "Daily");
});

test("saved view operations clone filters and reject duplicate names", () => {
    const first = createSavedView("Current", { status: "reading", keyword: "x" }, "list", [], "view-1");
    assert.ok(first);
    assert.equal(createSavedView(" current ", {}, "list", [first], "view-2"), null);
    assert.deepEqual(applySavedView([first], "view-1"), first);
    assert.equal(setDefaultSavedView([first], "missing"), "");
    assert.deepEqual(deleteSavedView([first], "view-1", "view-1"), { views: [], defaultSavedViewId: "" });
    assert.equal(deleteSavedView([first], "view-1", "other").defaultSavedViewId, "other");
});

test("tag aliases normalize to unique UI mappings and display the original tag", () => {
    const aliases = normalizeTagAliases([
        { id: "a", name: "  Focus  ", tag: "#Read#" },
        { id: "b", name: "focus", tag: "Other" },
        { id: "c", name: "Other name", tag: "read" },
        { id: "d", name: "Research", tag: "  # Research #  " },
        { id: "bad", name: "", tag: "lost" },
    ]);
    assert.deepEqual(aliases, [
        { id: "a", name: "Focus", tag: "Read" },
        { id: "d", name: "Research", tag: "Research" },
    ]);
    assert.equal(displayTagAlias(aliases, "READ"), "Focus (READ)");
    assert.equal(displayTagAlias(aliases, "Other"), "Other");
});

test("tag aliases enforce the persisted size limit and clone values", () => {
    const aliases = normalizeTagAliases(Array.from({ length: 22 }, (_, index) => ({
        id: `id-${index}`, name: `Alias ${index}`, tag: `tag-${index}`,
    })));
    assert.equal(aliases.length, 20);
    const clone = structuredClone(aliases);
    clone[0].name = "changed";
    assert.equal(aliases[0].name, "Alias 0");
});

test("normalizeUiPrefs：归一化 speechRate 偏好与默认回退（T-3383）", () => {
    assert.equal(normalizeUiPrefs({ speechRate: 1.25 }).speechRate, 1.25);
    assert.equal(normalizeUiPrefs({ speechRate: 2 }).speechRate, 1.5); // 超限钳制
    assert.equal(normalizeUiPrefs({ speechRate: 0.1 }).speechRate, 0.75); // 下限钳制
    assert.equal(normalizeUiPrefs({}).speechRate, 1); // 缺省回退 1
    assert.equal(normalizeUiPrefs({ speechRate: "invalid" as any }).speechRate, 1); // 非法回退 1
});

test("saved views preserve readingTimeTier and favoriteOnly in filter (T-3393)", () => {
    const views = normalizeSavedViews([
        {
            id: "view-quick",
            name: "短文速读",
            layout: "list",
            filter: { status: "inbox", readingTimeTier: "short", favoriteOnly: true, sortBy: "time", direction: "desc" },
        },
        {
            id: "view-invalid-tier",
            name: "无效分档",
            layout: "list",
            filter: { readingTimeTier: "all", favoriteOnly: false },
        },
    ]);
    assert.equal(views.length, 2);
    assert.deepEqual(views[0].filter, {
        status: "inbox",
        readingTimeTier: "short",
        favoriteOnly: true,
        sortBy: "time",
        direction: "desc",
    });
    // readingTimeTier="all" 和 favoriteOnly=false 被安全归一忽略
    assert.deepEqual(views[1].filter, {});
});

test("smart view presets instantiate with unique names and respect capacity (T-3393)", () => {
    assert.ok(SMART_VIEW_PRESETS.length >= 4);
    const first = instantiateSmartViewPreset("quick-reads", [], undefined, "smart-1");
    assert.ok(first);
    assert.equal(first.name, "短文速读");
    assert.equal(first.layout, "list");
    assert.deepEqual(first.filter, {
        status: "inbox",
        readingTimeTier: "short",
        sortBy: "time",
        direction: "desc",
    });

    // 重名时自动追加序号
    const second = instantiateSmartViewPreset("quick-reads", [first], undefined, "smart-2");
    assert.ok(second);
    assert.equal(second.name, "短文速读 2");

    // 不存在的预设返回 null
    assert.equal(instantiateSmartViewPreset("non-existent", []), null);

    // 达到 20 个上限时拒绝创建
    const maxViews = Array.from({ length: 20 }, (_, index) => ({
        id: `v-${index}`,
        name: `View ${index}`,
        layout: "list" as const,
        filter: {},
    }));
    assert.equal(instantiateSmartViewPreset("deep-reads", maxViews), null);
});

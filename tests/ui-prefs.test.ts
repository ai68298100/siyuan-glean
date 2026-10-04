import test from "node:test";
import assert from "node:assert/strict";
import { applySavedView, createSavedView, deleteSavedView, normalizeReaderAppearance, normalizeSavedViews, setDefaultSavedView } from "../src/domain/ui-prefs.ts";

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

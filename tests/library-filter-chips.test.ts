import test from "node:test";
import assert from "node:assert/strict";
import { libraryFilterChips, removeLibraryFilter } from "../src/domain/library-filter-chips.ts";
import { filterAndSortLibrary, type LibraryFilter } from "../src/domain/library-view.ts";

test("激活条件：用户/AI标签独立，空白不显示，状态和排序不冒充筛选chip", () => {
    assert.deepEqual(libraryFilterChips({ status: "later", tag: " reading ", aiTag: "reading", keyword: " ", sortBy: "priority", direction: "asc" }), [
        { key: "tag", value: "reading" }, { key: "aiTag", value: "reading" },
    ]);
});

test("移除单个条件保持其他筛选和顺序，不修改原视图或保存视图草稿", () => {
    const filter: LibraryFilter = { status: "later", tag: "topic", aiTag: "topic", author: "Writer", site: "example.com", sortBy: "priority", direction: "desc" };
    const next = removeLibraryFilter(filter, "aiTag");
    assert.deepEqual(next, { status: "later", tag: "topic", author: "Writer", site: "example.com", sortBy: "priority", direction: "desc" });
    assert.equal(removeLibraryFilter(next, "author").site, "example.com");
    assert.equal(filter.aiTag, "topic");
    const items = [
        { id: "a", kind: "clip" as const, title: "A", hpath: "/a", updated: "", status: "later" as const, site: "example.com", author: "Writer", tags: ["topic"], aiTags: ["topic"], priority: 2 },
        { id: "b", kind: "clip" as const, title: "B", hpath: "/b", updated: "", status: "later" as const, site: "example.com", author: "Writer", tags: ["topic"], aiTags: [], priority: 5 },
        { id: "c", kind: "clip" as const, title: "C", hpath: "/c", updated: "", status: "later" as const, site: "elsewhere.com", tags: ["topic"], aiTags: [], priority: 3 },
    ];
    assert.deepEqual(filterAndSortLibrary(items, filter).map((item) => item.id), ["a"]);
    assert.deepEqual(filterAndSortLibrary(items, next).map((item) => item.id), ["b", "a"]);
    assert.deepEqual(items.map((item) => item.status), ["later", "later", "later"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countSecondaryActiveFilters, libraryFilterChips, removeLibraryFilter } from "../src/domain/library-filter-chips.ts";
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

test("countSecondaryActiveFilters：准确统计更多筛选浮层内激活条件的数量（T-1808 / T-3386）", () => {
    // 1. 无次级筛选条件
    assert.equal(countSecondaryActiveFilters({}), 0);
    assert.equal(countSecondaryActiveFilters({ site: "example.com", tag: "reading" }), 0); // 常用筛选不计入

    // 2. 次级筛选激活项统计（author, aiTag, src, timeSource, contentType）
    assert.equal(countSecondaryActiveFilters({ author: "张三" }), 1);
    assert.equal(countSecondaryActiveFilters({ author: "张三", aiTag: "AI", contentType: "fulltext" }), 3);
    assert.equal(countSecondaryActiveFilters({
        site: "example.com", // 忽略
        author: "张三",
        aiTag: "  ", // 空白忽略
        src: "web-clipper",
        timeSource: "source",
        contentType: "link",
    }), 4);
});

test("LibraryFilters 接线：各分面下拉支持 Escape 单项快捷清空（T-3403）", () => {
    const filters = readFileSync(new URL("../src/ui/LibraryFilters.svelte", import.meta.url), "utf8");
    assert.match(filters, /bind:value=\{site\}\s+onkeydown=\{\(e\) => \{ if \(e\.key === "Escape" && site\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); site = ""; \} \}\}/);
    assert.match(filters, /bind:value=\{tag\}\s+onkeydown=\{\(e\) => \{ if \(e\.key === "Escape" && tag\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); tag = ""; \} \}\}/);
    assert.match(filters, /bind:value=\{author\}\s+onkeydown=\{\(e\) => \{ if \(e\.key === "Escape" && author\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); author = ""; \} \}\}/);
    assert.match(filters, /bind:value=\{readingTimeTier\}\s+onkeydown=\{\(e\) => \{ if \(e\.key === "Escape" && readingTimeTier !== "all"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); readingTimeTier = "all"; \} \}\}/);
});

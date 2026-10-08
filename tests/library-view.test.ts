/** 读库时间线筛选/排序纯函数（S3 / T-1715）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortLibrary, libraryFacets, type LibraryItem } from "../src/domain/library-view.ts";
import { parseUserTags } from "../src/domain/schema.ts";
import { normalizeRailGroups, projectRailFacets, railFacetSelected } from "../src/domain/library-rail.ts";

const clip = (part: Partial<LibraryItem>): LibraryItem => ({
    kind: "clip",
    id: "20260929000000-a",
    title: "文章",
    hpath: "/读库/文章",
    updated: "20260929010000",
    status: "inbox",
    url: "https://example.com/a",
    site: "example.com",
    tags: ["技术"],
    aiTags: ["AI"],
    src: "web-clipper",
    contentType: "fulltext",
    timeSource: "source",
    time: "20260928000000",
    words: 400,
    priority: 3,
    rating: 0,
    ...part,
});

test("侧栏投影：Top8 之外的当前项可见，展开保留全部且不改原数组", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ value: `tag-${index}`, count: 20 - index }));
    const before = structuredClone(items);
    const collapsed = projectRailFacets(items, false, "", "TAG-19");
    assert.equal(collapsed.length, 9);
    assert.equal(collapsed[8].value, "tag-19");
    assert.equal(projectRailFacets(items, false, "", "tag-3").length, 8);
    const expanded = projectRailFacets(items, true, "", "tag-19");
    assert.equal(expanded.length, 20);
    expanded.pop();
    assert.deepEqual(items, before);
});

test("侧栏检索：大小写与空白归一，不被 Top8 截断，未匹配仍保留当前项", () => {
    const items = [{ value: "TypeScript", count: 4 }, { value: "Rust", count: 2 }, { value: "typescript-tools", count: 1 }];
    assert.deepEqual(projectRailFacets(items, false, "  TYPESCRIPT ", ""), [items[0], items[2]]);
    assert.deepEqual(projectRailFacets(items, false, "missing", "rust"), [items[1]]);
    assert.deepEqual(projectRailFacets(items, false, "missing", ""), []);
    assert.equal(railFacetSelected(" Rust ", "rust"), true);
    assert.equal(railFacetSelected("Rust", ""), false);
});

test("侧栏偏好：丢弃未知组、非布尔值与文章字段，默认对象互不共享", () => {
    const prefs = normalizeRailGroups({ tags: { collapsed: true, expanded: "true", ids: ["secret"] }, aiTags: 1, unknown: { collapsed: true } });
    assert.deepEqual(prefs.tags, { collapsed: true, expanded: false });
    assert.deepEqual(prefs.aiTags, { collapsed: false, expanded: false });
    assert.deepEqual(Object.keys(prefs), ["queues", "sites", "authors", "tags", "aiTags"]);
    prefs.sites.expanded = true;
    assert.equal(prefs.queues.expanded, false);
    assert.equal(normalizeRailGroups(undefined).sites.expanded, false);
});

test("作者筛选与站点、标签独立，聚合包含所有状态且候选不计分面", () => {
    const items = [
        clip({ id: "a", status: "inbox", site: "mp.weixin.qq.com", author: "Daily", time: "20261003120000" }),
        clip({ id: "b", status: "archived", site: "mp.weixin.qq.com", author: "daily", time: "20261004120000" }),
        clip({ id: "c", status: "done", site: "other.example", author: "Daily", time: "20261001120000" }),
        clip({ id: "d", author: "Another", tags: ["Daily"] }),
        { ...clip({ id: "candidate", author: "Daily" }), kind: "candidate" as const, status: undefined },
    ];
    assert.deepEqual(filterAndSortLibrary(items, { status: "all", author: " DAILY " }).map((item) => item.id), ["b", "a", "c"]);
    assert.deepEqual(filterAndSortLibrary(items, { author: "daily", site: "mp.weixin.qq.com", status: "inbox" }).map((item) => item.id), ["a"]);
    assert.equal(filterAndSortLibrary(items, { keyword: "daily" }).length, 4);
    assert.deepEqual(libraryFacets(items).authors, [{ value: "Daily", count: 3 }, { value: "Another", count: 1 }]);
    assert.equal(filterAndSortLibrary(items, { author: "Another", tag: "Daily" }).length, 1);
});

test("用户标签只读解析根块 IAL.tags，去掉包裹井号并去重", () => {
    assert.deepEqual(parseUserTags("#技术#,#AI# 技术 #AI#"), ["技术", "AI"]);
});

test("统一筛选：状态、站点、用户标签、入口来源和时间来源可组合", () => {
    const items = [
        clip({ id: "a", status: "inbox", site: "example.com", tags: ["技术"], src: "web-clipper", timeSource: "source" }),
        clip({ id: "b", status: "later", site: "other.test", tags: ["生活"], src: "migration", timeSource: "document" }),
    ];
    const result = filterAndSortLibrary(items, {
        status: "inbox",
        site: "EXAMPLE.COM",
        tag: "技术",
        src: "web-clipper",
        timeSource: "source",
    });
    assert.deepEqual(result.map((item) => item.id), ["a"]);
});

test("候选只有在 inbox 明确开启时显示，其他状态不混入", () => {
    const items = [clip({ id: "clip" }), { ...clip({ id: "candidate" }), kind: "candidate", status: undefined }];
    assert.deepEqual(filterAndSortLibrary(items, { status: "inbox", includeCandidates: true }).map((item) => item.id), ["clip", "candidate"]);
    assert.deepEqual(filterAndSortLibrary(items, { status: "later", includeCandidates: true }).map((item) => item.id), []);
    assert.deepEqual(filterAndSortLibrary(items, { status: "inbox" }).map((item) => item.id), ["clip"]);
});

test("排序使用真实 clip-time，默认降序并以 id 稳定收尾；标题默认升序", () => {
    const items = [
        clip({ id: "b", title: "B", time: "20260101000000", words: 900 }),
        clip({ id: "a", title: "A", time: "20260101000000", words: 100 }),
        clip({ id: "c", title: "C", time: "20260901000000", words: 300 }),
    ];
    assert.deepEqual(filterAndSortLibrary(items).map((item) => item.id), ["c", "b", "a"]);
    assert.deepEqual(filterAndSortLibrary(items, { sortBy: "words" }).map((item) => item.id), ["b", "c", "a"]);
    assert.deepEqual(filterAndSortLibrary(items, { sortBy: "title" }).map((item) => item.title), ["A", "B", "C"]);
    const chinese = [
        clip({ id: "b", title: "乙" }),
        clip({ id: "a", title: "甲" }),
        clip({ id: "c", title: "丙" }),
    ];
    assert.deepEqual(filterAndSortLibrary(chinese, { sortBy: "title" }).map((item) => item.title), ["丙", "乙", "甲"]);
});

test("分面只从已收录条目的根块用户标签投影生成，AI 标签不冒充用户标签", () => {
    const facets = libraryFacets([
        clip({ id: "a", tags: ["技术"], aiTags: ["AI"], site: "example.com" }),
        clip({ id: "b", tags: ["技术", "阅读"], aiTags: ["AI"], site: "EXAMPLE.COM" }),
        { ...clip({ id: "candidate", tags: ["候选"] }), kind: "candidate", status: undefined },
    ]);
    assert.deepEqual(facets.tags, [
        { value: "技术", count: 2 },
        { value: "阅读", count: 1 },
    ]);
    assert.deepEqual(facets.sites, [{ value: "example.com", count: 2 }]);
    assert.equal(facets.tags.some((tag) => tag.value === "AI"), false);
});

test("筛选排序返回新数组，不改变输入顺序或条目字段", () => {
    const items = [clip({ id: "a" }), clip({ id: "b", status: "done" })];
    const before = structuredClone(items);
    const result = filterAndSortLibrary(items, { status: "inbox" });
    assert.notEqual(result, items);
    assert.deepEqual(items, before);
    assert.deepEqual(result[0], before[0]);
});


test("AI 标签独立分面与筛选，不冒充用户标签（T-1729）", () => {
    const items = [
        clip({ id: "a", tags: ["技术"], aiTags: ["机器学习"] }),
        clip({ id: "b", tags: ["生活"], aiTags: ["机器学习", "健康"] }),
        clip({ id: "c", tags: ["技术"], aiTags: [] }),
    ];
    const facets = libraryFacets(items);
    assert.deepEqual(facets.tags.map((f) => f.value), ["技术", "生活"]);
    assert.deepEqual(facets.aiTags.map((f) => f.value), ["机器学习", "健康"]);
    assert.equal(facets.aiTags[0].count, 2);
    // aiTag 筛选只命中 AI 标签，与用户 tag 互不混用
    const byAi = filterAndSortLibrary(items, { aiTag: "机器学习" });
    assert.deepEqual(byAi.map((item) => item.id).sort(), ["a", "b"]); // 排序按 time/id，与筛选无关
    assert.deepEqual(filterAndSortLibrary(items, { tag: "机器学习" }).map((item) => item.id), []);
    assert.deepEqual(filterAndSortLibrary(items, { aiTag: "技术" }).map((item) => item.id), []);
    // 大小写不敏感与关键词搜索仍同时匹配 AI 标签
    assert.equal(filterAndSortLibrary(items, { aiTag: "机器学习".toUpperCase() }).length, 2);
    assert.equal(filterAndSortLibrary(items, { keyword: "机器学习" }).length, 2);
});

test("favoriteOnly：仅保留收藏的收录条目，候选不参与（T-1755）", () => {
    const items = [
        { kind: "clip" as const, id: "20260101000000-aaaaaaa", title: "已收藏", hpath: "/a", updated: "20260101000000", favorite: true },
        { kind: "clip" as const, id: "20260101000001-aaaaaaa", title: "未收藏", hpath: "/b", updated: "20260102000000" },
        { kind: "candidate" as const, id: "20260101000002-aaaaaaa", title: "候选", hpath: "/c", updated: "20260103000000", favorite: true },
    ];
    const filtered = filterAndSortLibrary(items, { favoriteOnly: true });
    assert.deepEqual(filtered.map((item) => item.id), ["20260101000000-aaaaaaa"]);
    assert.equal(filterAndSortLibrary(items, {}).length, 2); // 候选默认不显示（includeCandidates 既有语义）
});

test("author：作者筛选与分面（T-1811/T-1812）", () => {
    const items = [
        { kind: "clip" as const, id: "20260101000000-aaaaaaa", title: "A", hpath: "/a", updated: "20260101000000", author: "张三", site: "mp.weixin.qq.com" },
        { kind: "clip" as const, id: "20260101000001-aaaaaaa", title: "B", hpath: "/b", updated: "20260102000000", author: "张三" },
        { kind: "clip" as const, id: "20260101000002-aaaaaaa", title: "C", hpath: "/c", updated: "20260103000000" },
    ];
    const filtered = filterAndSortLibrary(items, { author: "张三" });
    assert.equal(filtered.length, 2);
    const facets = libraryFacets(items);
    assert.deepEqual(facets.authors, [{ value: "张三", count: 2 }]);
});

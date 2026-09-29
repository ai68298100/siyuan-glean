/** 读库时间线筛选/排序纯函数（S3 / T-1715）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortLibrary, libraryFacets, type LibraryItem } from "../src/domain/library-view.ts";
import { parseUserTags } from "../src/domain/schema.ts";

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

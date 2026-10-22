/** 读库时间线筛选/排序纯函数（S3 / T-1715）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortLibrary, groupCandidatesBySite, libraryFacets, matchLibraryReason, matchReadingTimeTier, resolveReadingTimeTier, type LibraryItem } from "../src/domain/library-view.ts";
import { parseUserTags } from "../src/domain/schema.ts";
import { applyRailGroupToggle, normalizeRailGroups, projectRailFacets, railFacetSelected } from "../src/domain/library-rail.ts";

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

test("标签别名只映射显示名，筛选仍精确匹配根块原标签", () => {
    const items = [clip({ id: "a", tags: ["稍后"] }), clip({ id: "b", tags: ["重点"] })];
    assert.deepEqual(filterAndSortLibrary(items, { tag: "稍后" }).map((item) => item.id), ["a"]);
    assert.deepEqual(filterAndSortLibrary(items, { tag: "我的待读" }).map((item) => item.id), []);
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

test("keyword：关键词支持检索文章 summary 摘要字段", () => {
    const items = [
        clip({ id: "1", title: "普通文章", summary: "这是一篇关于量子计算核心突破的总结" }),
        clip({ id: "2", title: "量子计算论文", summary: "介绍基本原理" }),
        clip({ id: "3", title: "无相关内容", summary: "日常工作汇报" }),
    ];
    const filtered = filterAndSortLibrary(items, { keyword: "量子计算" });
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered.map((item) => item.id).sort(), ["1", "2"]);
});

test("matchLibraryReason：按优先级判定关键词命中字段", () => {
    const item = clip({
        title: "Rust 异步编程指南",
        summary: "深入 Tokio 运行时机制与并发原语",
        tags: ["系统编程", "网络"],
        aiTags: ["底层技术"],
        author: "张三",
        site: "rust-lang.org",
        url: "https://rust-lang.org/async-book",
    });

    // 命中标题优先
    assert.deepEqual(matchLibraryReason(item, "Rust"), { kind: "title" });
    // 命中摘要
    assert.deepEqual(matchLibraryReason(item, "Tokio"), { kind: "summary" });
    // 命中用户标签
    assert.deepEqual(matchLibraryReason(item, "网络"), { kind: "tag", value: "网络" });
    // 命中 AI 标签
    assert.deepEqual(matchLibraryReason(item, "底层技术"), { kind: "aiTag", value: "底层技术" });
    // 命中作者
    assert.deepEqual(matchLibraryReason(item, "张三"), { kind: "author", value: "张三" });
    // 命中站点
    assert.deepEqual(matchLibraryReason(item, "rust-lang"), { kind: "site", value: "rust-lang.org" });
    // 命中 URL
    assert.deepEqual(matchLibraryReason(item, "async-book"), { kind: "url" });
    // 未命中或空
    assert.equal(matchLibraryReason(item, "不存在的内容"), null);
    assert.equal(matchLibraryReason(item, ""), null);
    assert.equal(matchLibraryReason(item, undefined), null);
});

test("libraryFacets 与 groupCandidatesBySite：支持未确认候选站点分面与聚类分组（T-1801 / T-3373）", () => {
    const items: LibraryItem[] = [
        { kind: "clip", id: "1", title: "已收录文章", hpath: "/a", updated: "20261019010000", site: "zhihu.com" },
        { kind: "candidate", id: "2", title: "微信候选1", hpath: "/b", updated: "20261019020000", site: "mp.weixin.qq.com" },
        { kind: "candidate", id: "3", title: "微信候选2", hpath: "/c", updated: "20261019030000", site: "mp.weixin.qq.com" },
        { kind: "candidate", id: "4", title: "无站点候选", hpath: "/d", updated: "20261019040000", site: "" },
    ];

    // 默认不包含候选站点
    const defaultFacets = libraryFacets(items, false);
    assert.deepEqual(defaultFacets.sites.map((s) => s.value), ["zhihu.com"]);

    // 显式包含候选站点
    const inboxFacets = libraryFacets(items, true);
    assert.deepEqual(inboxFacets.sites.map((s) => s.value), ["mp.weixin.qq.com", "zhihu.com"]);
    assert.equal(inboxFacets.sites.find((s) => s.value === "mp.weixin.qq.com")?.count, 2);

    // 候选站点聚类分组
    const groups = groupCandidatesBySite(items);
    assert.equal(groups.length, 2);
    // 第一组：微信公众号（2条）
    assert.equal(groups[0].site, "mp.weixin.qq.com");
    assert.equal(groups[0].count, 2);
    // 第二组：无站点（1条）
    assert.equal(groups[1].site, "");
    assert.equal(groups[1].count, 1);
});

test("applyRailGroupToggle：普通模式保留其他分组，手风琴模式展开时收起其他组（T-1810 / T-3377）", () => {
    const initial = normalizeRailGroups({
        queues: { collapsed: false, expanded: false },
        sites: { collapsed: false, expanded: false },
        authors: { collapsed: true, expanded: false },
        tags: { collapsed: true, expanded: false },
        aiTags: { collapsed: true, expanded: false },
    });

    // 1. 普通模式（accordion = false）：展开 authors 不影响其他组
    const normalNext = applyRailGroupToggle(initial, "authors", { collapsed: false }, false);
    assert.equal(normalNext.authors.collapsed, false);
    assert.equal(normalNext.queues.collapsed, false);
    assert.equal(normalNext.sites.collapsed, false);

    // 2. 手风琴模式（accordion = true）：展开 authors 自动收起其余所有组
    const accordionNext = applyRailGroupToggle(initial, "authors", { collapsed: false }, true);
    assert.equal(accordionNext.authors.collapsed, false);
    assert.equal(accordionNext.queues.collapsed, true);
    assert.equal(accordionNext.sites.collapsed, true);
    assert.equal(accordionNext.tags.collapsed, true);
    assert.equal(accordionNext.aiTags.collapsed, true);

    // 3. 手风琴模式折叠某组时，不改变其他组的状态
    const foldNext = applyRailGroupToggle(accordionNext, "authors", { collapsed: true }, true);
    assert.equal(foldNext.authors.collapsed, true);
    assert.equal(foldNext.queues.collapsed, true);
});

test("matchReadingTimeTier：预计阅读时间分档纯函数与读库过滤（T-3391）", () => {
    // 纯函数边界测试：短文 (≤5m)、中篇 (6-15m)、长篇 (>15m)
    assert.equal(matchReadingTimeTier("all", 3), true);
    assert.equal(matchReadingTimeTier("all", 10), true);
    assert.equal(matchReadingTimeTier("all", undefined), true);
    assert.equal(matchReadingTimeTier(undefined, 5), true);

    // 短文: <= 5 分钟
    assert.equal(matchReadingTimeTier("short", 1), true);
    assert.equal(matchReadingTimeTier("short", 5), true);
    assert.equal(matchReadingTimeTier("short", 6), false);
    assert.equal(matchReadingTimeTier("short", undefined), false);
    assert.equal(matchReadingTimeTier("short", 0), false);

    // 中篇: 6 - 15 分钟
    assert.equal(matchReadingTimeTier("medium", 5), false);
    assert.equal(matchReadingTimeTier("medium", 6), true);
    assert.equal(matchReadingTimeTier("medium", 15), true);
    assert.equal(matchReadingTimeTier("medium", 16), false);

    // 长篇: > 15 分钟
    assert.equal(matchReadingTimeTier("long", 15), false);
    assert.equal(matchReadingTimeTier("long", 16), true);
    assert.equal(matchReadingTimeTier("long", 60), true);

    // 读库列表联动筛选测试
    const items = [
        clip({ id: "short-doc", title: "短文", minutes: 3 }),
        clip({ id: "med-doc", title: "中篇", minutes: 10 }),
        clip({ id: "long-doc", title: "长篇", minutes: 25 }),
        clip({ id: "unknown-doc", title: "未知时长", minutes: undefined }),
    ];

    assert.deepEqual(filterAndSortLibrary(items, { readingTimeTier: "short" }).map((i) => i.id), ["short-doc"]);
    assert.deepEqual(filterAndSortLibrary(items, { readingTimeTier: "medium" }).map((i) => i.id), ["med-doc"]);
    assert.deepEqual(filterAndSortLibrary(items, { readingTimeTier: "long" }).map((i) => i.id), ["long-doc"]);
    assert.equal(filterAndSortLibrary(items, { readingTimeTier: "all" }).length, 4);
});

test("resolveReadingTimeTier：准确归档为 short, medium, long 或 unknown", () => {
    assert.equal(resolveReadingTimeTier(undefined), "unknown");
    assert.equal(resolveReadingTimeTier(0), "unknown");
    assert.equal(resolveReadingTimeTier(-5), "unknown");
    assert.equal(resolveReadingTimeTier(1), "short");
    assert.equal(resolveReadingTimeTier(5), "short");
    assert.equal(resolveReadingTimeTier(6), "medium");
    assert.equal(resolveReadingTimeTier(15), "medium");
    assert.equal(resolveReadingTimeTier(16), "long");
    assert.equal(resolveReadingTimeTier(120), "long");
});

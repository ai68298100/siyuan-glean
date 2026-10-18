import assert from "node:assert/strict";
import test from "node:test";
import {
    addRecentReading,
    normalizeRecentReading,
    projectActiveRecentReadings,
    type RecentReadingClipSource,
    type RecentReadingEntry,
} from "../src/domain/recent-reading.ts";

test("最近阅读：同文档置顶并更新标题，最多保留八条", () => {
    let entries = Array.from({ length: 8 }, (_, index) => ({ id: `doc-${index}`, title: `旧文 ${index}` }));
    entries = addRecentReading(entries, { id: "doc-3", title: "更新后的标题" });
    assert.equal(entries[0].id, "doc-3");
    assert.equal(entries[0].title, "更新后的标题");
    assert.equal(entries.length, 8);
    assert.equal(entries.filter((item) => item.id === "doc-3").length, 1);
    entries = addRecentReading(entries, { id: "doc-new", title: "新文" });
    assert.equal(entries.length, 8);
    assert.equal(entries[0].id, "doc-new");
    assert.equal(entries.some((item) => item.id === "doc-7"), false);
});

test("最近阅读：空 ID 不改变列表，恢复快照时清洗并去重", () => {
    const initial = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    assert.deepEqual(addRecentReading(initial, { id: "  " }), initial);
    assert.deepEqual(normalizeRecentReading([
        { id: "a", title: "旧" },
        { id: "b", title: "B" },
        { id: "a", title: "新" },
        { id: "", title: "忽略" },
    ]), [
        { id: "a", title: "旧" },
        { id: "b", title: "B" },
    ]);
    assert.equal(addRecentReading(initial, { id: "a" })[0].title, "A");
    assert.deepEqual(normalizeRecentReading(initial, 0), []);
});

test("projectActiveRecentReadings：结合读库索引投影有效最近阅读条目", () => {
    const entries: RecentReadingEntry[] = [
        { id: "doc-1", title: "" },
        { id: "doc-2", title: "本地标题 2" },
        { id: "doc-deleted", title: "已删除文章" },
        { id: "doc-3", title: "带有书签的文章" },
    ];

    const clipsMap: Record<string, RecentReadingClipSource> = {
        "doc-1": {
            title: "索引补齐标题 1",
            status: "reading",
            contentType: "fulltext",
            minutes: 5,
        },
        "doc-2": {
            title: "索引标题 2",
            status: "later",
            contentType: "link",
            minutes: 2,
        },
        "doc-3": {
            title: "带有书签的文章",
            status: "reading",
            contentType: "fulltext",
            minutes: 10,
            readingPosition: '{"version":1,"blockId":"20261019120000-xxxxxxx","offset":200,"at":"2026-10-19T04:00:00.000Z"}',
        },
    };

    const active = projectActiveRecentReadings(entries, clipsMap, 3);
    assert.equal(active.length, 3);

    // 第一项：标题被索引补齐，无书签
    assert.equal(active[0].id, "doc-1");
    assert.equal(active[0].title, "索引补齐标题 1");
    assert.equal(active[0].status, "reading");
    assert.equal(active[0].contentType, "fulltext");
    assert.equal(active[0].minutes, 5);
    assert.equal(active[0].hasBookmark, false);

    // 第二项：优先使用 entry.title
    assert.equal(active[1].id, "doc-2");
    assert.equal(active[1].title, "本地标题 2");
    assert.equal(active[1].contentType, "link");

    // doc-deleted 不在 clipsMap 中，被安全过滤
    // 第三项：doc-3 有显式书签
    assert.equal(active[2].id, "doc-3");
    assert.equal(active[2].hasBookmark, true);

    // 空边界和 limit 校验
    assert.deepEqual(projectActiveRecentReadings([], clipsMap), []);
    assert.deepEqual(projectActiveRecentReadings(entries, null), []);
    assert.deepEqual(projectActiveRecentReadings(entries, clipsMap, 1).length, 1);
});

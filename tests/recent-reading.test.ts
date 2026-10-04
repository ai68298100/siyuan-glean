import assert from "node:assert/strict";
import test from "node:test";
import { addRecentReading, normalizeRecentReading } from "../src/domain/recent-reading.ts";

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

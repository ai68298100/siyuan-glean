import test from "node:test";
import assert from "node:assert/strict";
import { buildOutline, orderOutline } from "../src/domain/outline.ts";

const root = "20261004120000-root123";
test("大纲次序必须完整且唯一，原生顺序输出不变异原列表", () => {
    const items = [{ id: "second", level: 2 as const, title: "第二章" }, { id: "first", level: 1 as const, title: "第一章" }];
    const ordered = orderOutline(items, ["first", "second"]);
    assert.equal(ordered[0].title, "第一章");
    ordered[0].title = "修改";
    assert.equal(items[1].title, "第一章");
    for (const ids of [["first"], ["first", "first"], ["first", "outside"]]) assert.throws(() => orderOutline(items, ids), /incomplete or duplicated/);
});
test("outline preserves heading levels and ignores invalid rows", () => {
    assert.deepEqual(buildOutline([
        { id: "20261004120001-head001", root_id: root, type: "h", subtype: "h2", content: "二级", sort: 1 },
        { id: "20261004120002-head002", root_id: root, type: "h", subtype: "h6", content: "六级", sort: 2 },
        { id: "20261004120003-head003", root_id: "other", type: "h1", content: "外部", sort: 3 },
        { id: "bad", root_id: root, type: "h1", content: "坏 ID", sort: 4 },
    ], root), [
        { id: "20261004120001-head001", level: 2, title: "二级" },
        { id: "20261004120002-head002", level: 6, title: "六级" },
    ]);
});

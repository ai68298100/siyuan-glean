import test from "node:test";
import assert from "node:assert/strict";
import { buildOutline, findMatchingOutlineItemId, orderOutline } from "../src/domain/outline.ts";
import { findActiveOutlineItemInHost } from "../src/libs/reading-position.ts";

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

test("findMatchingOutlineItemId 准确匹配大纲节点 ID（T-3414）", () => {
    const items = [
        { id: "h1", level: 1 as const, title: "章节一" },
        { id: "h2", level: 2 as const, title: "小节 1.1" },
    ];
    assert.equal(findMatchingOutlineItemId(items, "h1"), "h1");
    assert.equal(findMatchingOutlineItemId(items, "h2"), "h2");
    assert.equal(findMatchingOutlineItemId(items, "h3"), null);
    assert.equal(findMatchingOutlineItemId(items, null), null);
    assert.equal(findMatchingOutlineItemId(items, undefined), null);
    assert.equal(findMatchingOutlineItemId([], "h1"), null);
});

test("findActiveOutlineItemInHost 在 DOM 宿主中按包含/跟随关系定位所属章节（T-3414）", () => {
    // 模拟 DOM 树
    const elements = new Map<string, any>();
    const makeEl = (id: string, index: number) => {
        const el = {
            id,
            dataset: { nodeId: id },
            getAttribute: (attr: string) => attr === "data-node-id" ? id : null,
            compareDocumentPosition: (other: any) => {
                if (el === other) return 0;
                return other.index > el.index ? 4 : 2; // 4: FOLLOWING, 2: PRECEDING
            },
            index,
        };
        elements.set(id, el);
        return el;
    };

    makeEl("h1", 1);
    makeEl("p1", 2);
    makeEl("h2", 3);
    makeEl("p2", 4);

    const host = {
        isConnected: true,
        querySelector: (selector: string) => {
            const match = selector.match(/\[data-node-id="([^"]+)"\]/);
            return match ? elements.get(match[1]) ?? null : null;
        },
    } as unknown as HTMLElement;

    const items = [
        { id: "h1", level: 1 as const, title: "第一章" },
        { id: "h2", level: 2 as const, title: "第二章" },
    ];

    // 直接命中标题
    assert.equal(findActiveOutlineItemInHost(host, items, "h1"), "h1");
    assert.equal(findActiveOutlineItemInHost(host, items, "h2"), "h2");

    // 段落 p1 位于 h1 之后、h2 之前 -> 所属章节是 h1
    assert.equal(findActiveOutlineItemInHost(host, items, "p1"), "h1");

    // 段落 p2 位于 h2 之后 -> 所属章节是 h2
    assert.equal(findActiveOutlineItemInHost(host, items, "p2"), "h2");

    // 未知块或空块
    assert.equal(findActiveOutlineItemInHost(host, items, "unknown"), null);
    assert.equal(findActiveOutlineItemInHost(host, items, null), null);
    assert.equal(findActiveOutlineItemInHost(null, items, "p1"), null);
});

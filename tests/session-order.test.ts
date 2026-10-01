/** 会话阅读队列重排纯函数（T-1903，D-0034）：顺序只存 ui-prefs，不改文章属性。 */
import test from "node:test";
import assert from "node:assert/strict";

import { applySessionOrder, pinToSessionTop, moveWithinSession, shuffleIds } from "../src/domain/session-order.ts";

const item = (id: string) => ({ id });

test("applySessionOrder：order 内按相对次序在前，未入列按原序追加尾部", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    assert.deepEqual(applySessionOrder(items, ["c", "a"]).map((i) => i.id), ["c", "a", "b", "d"]);
    assert.deepEqual(applySessionOrder(items, []).map((i) => i.id), ["a", "b", "c", "d"], "空 order 不改变原序");
    // order 中不存在的 id（已删文档）被忽略
    assert.deepEqual(applySessionOrder(items, ["x", "b", "y"]).map((i) => i.id), ["b", "a", "c", "d"]);
    // order 内重复 id 只取首次位次
    assert.deepEqual(applySessionOrder(items, ["d", "d", "a"]).map((i) => i.id), ["d", "a", "b", "c"]);
});

test("pinToSessionTop：置顶去重；moveWithinSession：邻位交换与越界保护", () => {
    assert.deepEqual(pinToSessionTop(["a", "b", "c"], "c"), ["c", "a", "b"]);
    assert.deepEqual(pinToSessionTop([], "a"), ["a"]);
    assert.deepEqual(moveWithinSession(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveWithinSession(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
    assert.deepEqual(moveWithinSession(["a", "b"], "a", -1), ["a", "b"], "首位上移越界原样返回");
    assert.deepEqual(moveWithinSession(["a", "b"], "b", 1), ["a", "b"], "末位下移越界原样返回");
    assert.deepEqual(moveWithinSession(["a", "b"], "x", -1), ["a", "b"], "未入列 id 原样返回");
});

test("shuffleIds：同种子可复现、换种子大概率不同序、是原集合的重排", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const first = shuffleIds(ids, 42);
    assert.deepEqual(shuffleIds(ids, 42), first, "同种子结果可复现");
    assert.deepEqual([...first].sort(), [...ids].sort(), "洗牌是原集合重排");
    assert.notDeepEqual(shuffleIds(ids, 43), first, "换种子换序（8 元素下碰撞概率可忽略）");
    assert.deepEqual(shuffleIds([], 1), []);
    assert.deepEqual(shuffleIds(["a"], 1), ["a"]);
});

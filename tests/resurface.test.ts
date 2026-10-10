/** domain/resurface 纯函数单测（T-1400，插件灵魂算法） */
import test from "node:test";
import assert from "node:assert/strict";

import {
    ageDays,
    pickDaily,
    pickRandomSurfaceReplacement,
    recentlySurfaced,
    stableHash,
    staleCandidates,
    surfaceReasons,
    surfaceScore,
    todayStamp,
    type SurfaceItem,
} from "../src/domain/resurface.ts";

const NOW = new Date(2026, 8, 29, 12, 0, 0); // 2026-09-29

function item(partial: Partial<SurfaceItem>): SurfaceItem {
    return {
        id: "20260901-aaaaaaa",
        title: "t",
        status: "inbox",
        priority: 3,
        time: "20260901000000",
        aiTags: [],
        lastSurfaced: "",
        summary: "",
        ...partial,
    };
}

test("ageDays：按 YYYYMMDDHHmmss 计算", () => {
    assert.equal(ageDays("20260922120000", NOW), 7);
    assert.equal(ageDays("20260929120000", NOW), 0);
    assert.equal(ageDays("bad", NOW), 0);
});

test("stableHash：确定性且分散", () => {
    assert.equal(stableHash("20260901-aaa20260929"), stableHash("20260901-aaa20260929"));
    assert.notEqual(stableHash("a"), stableHash("b"));
});

test("pickDaily：同池同日两次挑选结果一致（跨重启稳定）", () => {
    const pool = [
        item({ id: "1", time: "20260601000000" }),
        item({ id: "2", time: "20260701000000" }),
        item({ id: "3", time: "20260801000000" }),
        item({ id: "4", time: "20260901000000" }),
        item({ id: "5", time: "20260910000000" }),
    ];
    const a = pickDaily(pool, [], { count: 3, now: NOW });
    const b = pickDaily(pool, [], { count: 3, now: NOW });
    assert.deepEqual(a.map((p) => p.item.id), b.map((p) => p.item.id));
    assert.equal(a.length, 3);
});

test("pickDaily：吃灰更久的排前面", () => {
    const pool = [
        item({ id: "new", time: "20260928000000" }),
        item({ id: "old", time: "20260601000000" }),
    ];
    const picks = pickDaily(pool, [], { count: 1, now: NOW });
    assert.equal(picks[0].item.id, "old");
});

test("pickDaily：当天已 surfaced 的不再出现（幂等）", () => {
    const pool = [
        item({ id: "a", time: "20260601000000", lastSurfaced: "20260929" }),
        item({ id: "b", time: "20260701000000" }),
    ];
    const picks = pickDaily(pool, [], { count: 3, now: NOW });
    assert.deepEqual(picks.map((p) => p.item.id), ["b"]);
});

test("pickRandomSurfaceReplacement：从当前排除集之外取一篇，允许当天已 surfaced 的补位", () => {
    const pool = [
        item({ id: "shown", lastSurfaced: "20261010" }),
        item({ id: "new", lastSurfaced: "" }),
        item({ id: "done", status: "done", lastSurfaced: "" }),
    ];
    const pick = pickRandomSurfaceReplacement(pool, ["new"], false, () => 0);
    assert.equal(pick?.item.id, "shown");
    assert.equal(pickRandomSurfaceReplacement(pool, ["shown", "new", "done"], false, () => 0), null);
});

test("pickRandomSurfaceReplacement：includeDone 控制已读文章是否可补位且随机值越界安全", () => {
    const pool = [item({ id: "done", status: "done" }), item({ id: "later", status: "later" })];
    assert.equal(pickRandomSurfaceReplacement(pool, [], false, () => 0)?.item.id, "later");
    assert.equal(pickRandomSurfaceReplacement(pool, [], true, () => 0)?.item.id, "done");
    assert.equal(pickRandomSurfaceReplacement(pool, [], true, () => 99)?.item.id, "later");
});

test("pickDaily：priority 高者优先（同吃灰天数）", () => {
    const pool = [
        item({ id: "p3", time: "20260815000000", priority: 3 }),
        item({ id: "p5", time: "20260815000000", priority: 5 }),
    ];
    const picks = pickDaily(pool, [], { count: 1, now: NOW });
    assert.equal(picks[0].item.id, "p5");
});

test("pickDaily：当天置顶优先，但跨日置顶自然失效", () => {
    const pool = [
        item({ id: "old", time: "20260601000000" }),
        item({ id: "pinned", time: "20260928000000", pinned: "20260929" }),
    ];
    assert.equal(pickDaily(pool, [], { count: 1, now: NOW })[0].item.id, "pinned");
    assert.equal(pickDaily(pool, [], { count: 1, now: new Date(2026, 8, 30, 12) })[0].item.id, "old");
});

test("pickDaily：与近 7 天重浮标签重叠者被多样性降权", () => {
    const recentTagSets = [new Set(["ai", "架构"])];
    const pool = [
        item({ id: "same", time: "20260601000000", aiTags: ["AI"] }),
        item({ id: "diff", time: "20260602000000", aiTags: ["设计"] }),
    ];
    const picks = pickDaily(pool, recentTagSets, { count: 2, now: NOW });
    assert.equal(picks[0].item.id, "diff");
});

test("pickDaily：includeDone 才把已读纳入池", () => {
    const pool = [item({ id: "done", status: "done", time: "20260601000000" })];
    assert.equal(pickDaily(pool, [], { count: 3, now: NOW }).length, 0);
    assert.equal(pickDaily(pool, [], { count: 3, includeDone: true, now: NOW }).length, 1);
});

test("recentlySurfaced：只算近 7 天且不含今天", () => {
    const items = [
        item({ id: "today", lastSurfaced: "20260929" }),
        item({ id: "3d", lastSurfaced: "20260926" }),
        item({ id: "8d", lastSurfaced: "20260921" }),
        item({ id: "bad", lastSurfaced: "xxx" }),
    ];
    const recent = recentlySurfaced(items, NOW);
    assert.deepEqual(recent.map((r) => r.id), ["3d"]);
});

test("staleCandidates：inbox/later 且 ≥ 限值", () => {
    const items = [
        item({ id: "in90", status: "inbox", time: "20260701000000" }),
        item({ id: "later90", status: "later", time: "20260701000000" }),
        item({ id: "done90", status: "done", time: "20260701000000" }),
        item({ id: "in10", status: "inbox", time: "20260919000000" }),
    ];
    const stale = staleCandidates(items, 90, NOW);
    assert.deepEqual(stale.map((s) => s.id), ["in90", "later90"]);
});

test("todayStamp：YYYYMMDD", () => {
    assert.equal(todayStamp(NOW), "20260929");
});

test("surfaceReasons：只列事实理由，不用欠账口吻（T-1717）", () => {
    const explained = surfaceReasons(
        item({ time: "20260901000000", priority: 5, site: "example.com" }),
        [],
        NOW
    );
    assert.deepEqual(explained.map((reason) => reason.kind), ["stale", "priority", "site"]);
    // 刚收录、普通优先级、无站点：不需要解释
    const fresh = item({ time: "20260928000000", priority: 3 });
    assert.equal(surfaceReasons(fresh, [], NOW).length, 0);
});

test("surfaceReasons：与近 7 天重浮无标签重叠才算主题新鲜", () => {
    const target = item({ aiTags: ["ai", "架构"] });
    const noOverlap = surfaceReasons(target, [new Set(["阅读"])], NOW);
    assert.ok(noOverlap.some((reason) => reason.kind === "freshTopic"));
    const overlap = surfaceReasons(target, [new Set(["ai"])], NOW);
    assert.ok(!overlap.some((reason) => reason.kind === "freshTopic"));
    // 近期没有重浮历史时没有可比对象，不给新鲜理由
    assert.ok(!surfaceReasons(target, [], NOW).some((reason) => reason.kind === "freshTopic"));
});

test("pickDaily：钉住当日置顶优先且覆盖改天过滤，隔日自然回池（T-1797）", () => {
    const now = new Date(2026, 8, 29, 12, 0, 0);
    const base = { title: "t", status: "inbox" as const, priority: 3, time: "20260901000000", aiTags: [] };
    const pool = [
        { ...base, id: "20260101000000-aaaaaaa", pinned: "20260929" },       // 钉住当日
        { ...base, id: "20260101000001-aaaaaaa", lastSurfaced: "20260929" }, // 今天已"改天"
        { ...base, id: "20260101000002-aaaaaaa" },                            // 普通高优
    ];
    const picks = pickDaily(pool, [], { count: 3, includeDone: false, now });
    // 钉住置顶第一；"改天"被钉住语义覆盖的场景仅对钉住项生效
    assert.equal(picks[0].item.id, "20260101000000-aaaaaaa");
    // 隔日（pinned 不匹配今天）自然回池
    const tomorrow = new Date(2026, 8, 30, 12, 0, 0);
    const nextDay = pickDaily(pool, [], { count: 3, includeDone: false, now: tomorrow });
    assert.equal(nextDay.some((pick) => pick.item.id === "20260101000000-aaaaaaa"), true);
});

test("pickDaily：有钉住时其余候选仍正常入选，不坍缩为仅置顶项（T-3313）", () => {
    const now = new Date(2026, 8, 29, 12, 0, 0);
    const base = { title: "t", status: "inbox" as const, priority: 3, time: "20260901000000", aiTags: [] };
    const pool = [
        { ...base, id: "20260101000000-aaaaaaa", pinned: "20260929" },
        { ...base, id: "20260101000001-aaaaaaa", time: "20260910000000" },
        { ...base, id: "20260101000002-aaaaaaa", time: "20260915000000" },
        { ...base, id: "20260101000003-aaaaaaa", time: "20260920000000" },
    ];
    const picks = pickDaily(pool, [], { count: 4, includeDone: false, now });
    assert.equal(picks[0].item.id, "20260101000000-aaaaaaa");
    assert.equal(picks.length, 4);
});

test("pickDaily：分数差距大但无标签重叠的候选按序入选，仅重叠降分过多的才淘汰（T-3313）", () => {
    const now = new Date(2026, 8, 29, 12, 0, 0);
    const base = { title: "t", status: "inbox" as const, priority: 3, aiTags: [] };
    const pool = [
        { ...base, id: "20260101000001-aaaaaaa", time: "20260928000000" },
        { ...base, id: "20260101000002-aaaaaaa", time: "20260815000000" },
        { ...base, id: "20260101000003-aaaaaaa", time: "20260601000000" },
        { ...base, id: "20260101000004-aaaaaaa", time: "20260601000000" },
    ];
    const picks = pickDaily(pool, [], { count: 4, includeDone: false, now });
    assert.equal(picks.length, 4);
    // 同批 AI 标签高度重叠时，重叠降分过多者被淘汰（同批不做同主题）
    const sameTopic = [
        { ...base, id: "20260101000001-aaaaaaa", time: "20260928000000", aiTags: ["ai"] },
        { ...base, id: "20260101000002-aaaaaaa", time: "20260927000000", aiTags: ["ai"] },
        { ...base, id: "20260101000003-aaaaaaa", time: "20260926000000", aiTags: ["ai"] },
    ];
    const deduped = pickDaily(sameTopic, [], { count: 3, includeDone: false, now });
    assert.equal(deduped.length < 3, true);
});

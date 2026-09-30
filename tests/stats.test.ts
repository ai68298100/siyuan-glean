/** domain/stats 纯函数单测（T-1201） */
import test from "node:test";
import assert from "node:assert/strict";

import { aggregateStats, buildWeeklyReportMarkdown, captureFunnel, readingHeatmap, weeklyReportDocPath, type StatsInput } from "../src/domain/stats.ts";

function item(partial: Partial<StatsInput>): StatsInput {
    return {
        id: "20260929-aaaaaaa",
        title: "t",
        site: "",
        status: "inbox",
        words: 0,
        minutes: 0,
        rating: 0,
        time: "20260929000000",
        doneTime: "",
        aiTags: [],
        updated: "20260929000000",
        ...partial,
    };
}

const NOW = new Date(2026, 8, 29, 12, 0, 0); // 2026-09-29

test("aggregateStats：状态计数/字数/本周完成只按完成时间（D-0028）", () => {
    const stats = aggregateStats(
        [
            item({ status: "inbox", words: 100 }),
            item({ status: "done", words: 200, doneTime: "20260928000000" }),
            item({ status: "reading", words: 300 }),
            item({ status: "archived", doneTime: "20260927000000" }),
        ],
        NOW
    );
    assert.equal(stats.total, 4);
    assert.equal(stats.done, 1);
    assert.equal(stats.reading, 1);
    assert.equal(stats.inbox, 1);
    assert.equal(stats.totalWords, 600);
    // T-1885：完成事实由 doneTime 表达，归档不抹除本周完成记录 → 两条都计入
    assert.equal(stats.doneThisWeek, 2);
});

test("aggregateStats：归档后带完成时间的文章仍计入本周完成（T-1885）", () => {
    const stats = aggregateStats(
        [
            item({ status: "archived", doneTime: "20260929080000" }), // 本周读完→归档
            item({ status: "archived", doneTime: "20260925000000" }), // 本周读完→归档
            item({ status: "later", doneTime: "20260928000000" }),    // 归档后恢复重读也保留事实
        ],
        NOW
    );
    assert.equal(stats.done, 0);
    assert.equal(stats.doneThisWeek, 3);
});

test("aggregateStats：无完成时间或超一周的已读不计入本周（不用 updated 伪造）", () => {
    const stats = aggregateStats(
        [
            item({ status: "done", updated: "20260928000000" }), // 只有 updated，无 done-time
            item({ status: "done", doneTime: "20260920000000" }), // 超出 7 天
            item({ status: "done", doneTime: "20260929080000" }), // 本周
        ],
        NOW
    );
    assert.equal(stats.done, 3);
    assert.equal(stats.doneThisWeek, 1);
});

test("aggregateStats：近 7 天收录桶（今天在最后一位）", () => {
    const stats = aggregateStats(
        [
            item({ time: "20260929080000" }),
            item({ time: "20260929090000" }),
            item({ time: "20260923080000" }),
            item({ time: "20260901080000" }), // 超出 7 天
        ],
        NOW
    );
    assert.deepEqual(stats.dailyCaptured, [1, 0, 0, 0, 0, 0, 2]);
});

test("aggregateStats：站点与标签计数排序", () => {
    const stats = aggregateStats(
        [
            item({ site: "a.com", aiTags: ["x", "y"] }),
            item({ site: "A.com", aiTags: ["x"] }),
            item({ site: "b.com", aiTags: ["x", "z"] }),
        ],
        NOW
    );
    assert.equal(stats.bySite[0].count, 2); // 大小写归一
    assert.equal(stats.byTag[0].name, "x");
    assert.equal(stats.byTag[0].count, 3);
});

test("weeklyReportDocPath：七天区间标题", () => {
    const { title, rangeLabel } = weeklyReportDocPath(NOW);
    assert.equal(title, "20260923-20260929");
    assert.match(rangeLabel, /09\.23 – 09\.29/);
});

test("buildWeeklyReportMarkdown：含概览/已读列表/分布", () => {
    const stats = aggregateStats(
        [item({ status: "done", title: "深度文章", site: "a.com", rating: 4, updated: "20260928000000" })],
        NOW
    );
    const md = buildWeeklyReportMarkdown({
        stats,
        doneItems: [item({ status: "done", title: "深度文章", site: "a.com", rating: 4 })],
        rangeLabel: "09.23 – 09.29",
    });
    assert.ok(md.includes("# 阅读周报 · 09.23 – 09.29"));
    assert.ok(md.includes("深度文章"));
    assert.ok(md.includes("a.com"));
    assert.ok(md.includes("siyuan://blocks/"));
});

test("readingHeatmap：按 doneTime 聚合周列网格，当前周截断到今天（T-1770）", () => {
    // 2026-09-29 是周二；3 周网格从 09-14（周一）开始，到 09-29 截断
    const grid = readingHeatmap(
        [
            "20260929080000", // 今天
            "20260929120000", // 今天第二篇
            "20260928000000", // 昨天
            "20260915000000", // 第一周
            "bad-stamp",
            "",
        ],
        3,
        NOW
    );
    assert.equal(grid.cells.length, 16); // 09-14..09-29 = 14+2 天（两周 7 天 + 当前周 2 天）
    assert.equal(grid.cells[0].date, "20260914");
    const today = grid.cells[grid.cells.length - 1];
    assert.equal(today.date, "20260929");
    assert.equal(today.count, 2);
    assert.equal(grid.maxCount, 2);
    assert.equal(grid.activeDays, 3);
    assert.equal(grid.totalDone, 4);
});

test("readingHeatmap：空输入给全零网格（当前周截断）", () => {
    const grid = readingHeatmap([], 2, NOW); // 09-21（周一）..09-29 = 9 天
    assert.equal(grid.cells.length, 9);
    assert.equal(grid.maxCount, 0);
    assert.equal(grid.totalDone, 0);
});

test("captureFunnel：候选→收录→完成转化率（T-1773）", () => {
    const funnel = captureFunnel(80, 20, 20);
    assert.deepEqual(funnel, {
        candidates: 20, captured: 80, done: 20, captureRate: 80, doneRate: 25,
    });
    assert.deepEqual(captureFunnel(0, 0, 0), {
        candidates: 0, captured: 0, done: 0, captureRate: 0, doneRate: 0,
    });
});

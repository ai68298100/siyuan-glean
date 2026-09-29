/** domain/stats 纯函数单测（T-1201） */
import test from "node:test";
import assert from "node:assert/strict";

import { aggregateStats, buildWeeklyReportMarkdown, weeklyReportDocPath, type StatsInput } from "../src/domain/stats.ts";

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
    assert.equal(stats.doneThisWeek, 1);
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

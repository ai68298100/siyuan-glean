/** domain/stats 纯函数单测（T-1201） */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { summarizeDistribution } from "../src/domain/distribution.ts";

import {
    aggregateStats, aggregateReadingReview, buildReadingReviewCsv, buildReadingReviewMarkdown, buildWeeklyReportMarkdown,
    completedReviewItems, csvCell, parseLocalTimestamp, parseReviewDate, reviewPeriod, weeklyReportDocPath, withinWeek,
    type ReadingReview, type StatsInput,
} from "../src/domain/stats.ts";

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

test("作者分布复用可信完成范围，二级计数与缺失之和等于站点总数", () => {
    const items = [
        item({ id: "a", status: "done", doneTime: "20260928080000", site: " MP.WEIXIN.QQ.COM ", author: "Daily" }),
        item({ id: "b", status: "archived", doneTime: "20260929080000", site: "mp.weixin.qq.com", author: " daily " }),
        item({ id: "c", status: "done", doneTime: "20260929080000", site: "mp.weixin.qq.com" }),
        item({ id: "d", status: "reading", doneTime: "20260929080000", site: "", author: "Daily" }),
        item({ id: "e", status: "done", doneTime: "20260929080000", site: "other.site", author: "非法\n署名" }),
        item({ id: "internal", status: "done", doneTime: "20260929080000", site: "mp.weixin.qq.com", author: "内部署名", internal: true }),
        item({ id: "candidate", status: "", doneTime: "20260929080000", site: "mp.weixin.qq.com", author: "候选署名" }),
        item({ id: "future", status: "done", doneTime: "20260930080000", site: "mp.weixin.qq.com", author: "未来署名" }),
    ];
    const before = structuredClone(items);
    const stats = aggregateReadingReview(items, NOW);
    assert.equal(stats.periodCompleted, 5);
    assert.equal(stats.total, 6);
    assert.deepEqual(stats.periodByAuthor, [{ name: "Daily", count: 3 }]);
    assert.equal(stats.periodAuthorUnknown, 2);
    assert.deepEqual(stats.periodSiteAuthors, [
        { site: "mp.weixin.qq.com", count: 3, authors: [{ name: "Daily", count: 2 }], unknownAuthorCount: 1 },
        { site: "other.site", count: 1, authors: [], unknownAuthorCount: 1 },
    ]);
    for (const site of stats.periodSiteAuthors) assert.equal(site.authors.reduce((total, author) => total + author.count, 0) + site.unknownAuthorCount, site.count);
    assert.equal(completedReviewItems(items, stats.period, NOW).length, 5);
    assert.deepEqual(items, before);
});

test("Top8及其他保留全部计数，不把多标签出现次数当作去重文章数", () => {
    const groups = Array.from({ length: 14 }, (_, index) => ({ name: `group-${index}`, count: index + 1 }));
    const before = structuredClone(groups);
    const grouped = summarizeDistribution(groups);
    assert.equal(grouped.top.length, 8);
    assert.equal(grouped.top[0].count, 14);
    assert.equal(grouped.others.length, 6);
    assert.equal(grouped.otherCount, 21);
    assert.equal(grouped.top.reduce((total, group) => total + group.count, 0) + grouped.otherCount, groups.reduce((total, group) => total + group.count, 0));
    grouped.top[0].count = 999;
    assert.deepEqual(groups, before);
    assert.equal(summarizeDistribution(groups, -1).top.length, 8);
    assert.deepEqual(summarizeDistribution([{ name: "", count: 3 }, { name: "bad", count: NaN }, { name: "zero", count: 0 }]), { top: [], others: [], otherCount: 0 });
});

test("作者报告导出保留全部长尾与站点关系，署名内容转义及公式保护", () => {
    const items = Array.from({ length: 20 }, (_, index) => item({ id: `article-${index}`, status: "archived", doneTime: "20260928080000", site: "source.site", author: index === 0 ? "=Formula" : `作者${index}` }));
    const stats = aggregateReadingReview(items, NOW);
    const review: ReadingReview = { stats, completedItems: items, candidateCount: 0, snapshotAt: "now" };
    const markdown = buildReadingReviewMarkdown(review);
    const csv = buildReadingReviewCsv(review);
    assert.equal(stats.periodByAuthor.length, 20);
    assert.ok(markdown.includes("作者19 × 1"));
    assert.ok(markdown.includes("未记录作者 × 0"));
    assert.ok(csv.includes('"words","author"'));
    assert.ok(csv.includes('"\'=Formula"'));
    assert.equal(csv.split("\r\n").filter((row) => row.startsWith('"site-author"')).length, 20);
    assert.equal(csv.split("\r\n").filter((row) => row.startsWith('"author"')).length, 20);
    assert.ok(csv.includes('"site-author-unknown","source.site","0"'));
});

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

test("阅读回顾按完整本地日历周/月/年选择，跨年周从周一开始", () => {
    const reference = new Date(2027, 0, 1, 12);
    assert.deepEqual(reviewPeriod("week", reference), {
        kind: "week", start: "20261228", end: "20270103", endExclusive: "20270104", label: "2026-12-28 – 2027-01-03",
    });
    assert.equal(reviewPeriod("month", new Date(2024, 1, 15)).end, "20240229");
    assert.equal(reviewPeriod("month", new Date(2026, 1, 15)).end, "20260228");
    assert.equal(reviewPeriod("year", reference).endExclusive, "20280101");
    assert.throws(() => reviewPeriod("day" as never, NOW), /Invalid review period/);
    assert.throws(() => reviewPeriod("week", new Date(NaN)), /Invalid review date/);
    assert.throws(() => aggregateReadingReview([], new Date(NaN)), /Invalid snapshot date/);
});

test("时间戳严格校验闰年、月份、日期和时分秒，拒绝自动日期滚动", () => {
    for (const stamp of ["", "20260929", "20260229080000", "20260431080000", "20261301000000", "20260001000000", "20260900000000", "20260929240000", "20260929126000", "20260929125960", "00000101000000"]) {
        assert.equal(parseLocalTimestamp(stamp), null, stamp);
    }
    assert.ok(parseLocalTimestamp("20240229080000"));
    assert.equal(parseLocalTimestamp("00010101080000")?.getFullYear(), 1);
    assert.equal(parseReviewDate("2026-02-29"), null);
    assert.equal(parseReviewDate("2026-9-29"), null);
    assert.equal(parseReviewDate("9999-01-01"), null);
    assert.equal(parseReviewDate("2024-02-29")?.getDate(), 29);
    assert.equal(withinWeek("20260931000000", NOW.getTime()), false);
});

test("新回顾保留归档及重读的可信完成事实，未知、未来和候选状态不猜测", () => {
    const items = [
        item({ id: "20260929000000-aaaaaaa", status: "done", doneTime: "20260928120000", words: 200 }),
        item({ id: "20260929000000-bbbbbbb", status: "archived", doneTime: "20260927120000", words: 300 }),
        item({ id: "20260929000000-ccccccc", status: "reading", doneTime: "20260928100000" }),
        item({ status: "done", doneTime: "", updated: "20260929090000" }),
        item({ status: "done", doneTime: "20260230000000" }),
        item({ status: "done", doneTime: "20260929130000" }),
        item({ status: "archived", doneTime: "" }),
        item({ status: "", doneTime: "20260928120000", words: 9999 }),
    ];
    const before = structuredClone(items);
    const weekly = aggregateReadingReview(items, NOW);
    assert.equal(weekly.total, 7);
    assert.equal(weekly.done, 4);
    assert.equal(weekly.archived, 2);
    assert.equal(weekly.completed, 3);
    assert.equal(weekly.periodCompleted, 2);
    assert.equal(weekly.unknownDoneTime, 3);
    assert.equal(weekly.archivedWithoutCompletion, 1);
    assert.equal(weekly.totalWords, 500);
    assert.equal(aggregateReadingReview(items, NOW, "month").periodCompleted, 3);
    assert.equal(aggregateReadingReview(items, NOW, "year").periodCompleted, 3);
    assert.equal(weekly.heatmap.find((day) => day.date === "2026-09-27")?.count, 1);
    assert.equal(weekly.heatmap.find((day) => day.date === "2026-09-28")?.count, 2);
    assert.deepEqual(items, before);
    assert.equal(aggregateStats(items.filter((entry) => entry.status), NOW).doneThisWeek, 1);
});

test("月度/年度边界与未来时间不越界；收录和完成分别按各自时刻", () => {
    const now = new Date(2026, 9, 4, 12);
    const items = [
        item({ doneTime: "20260930235959", time: "20261001000000", status: "done" }),
        item({ doneTime: "20261001000000", time: "20260930235959", status: "archived" }),
        item({ doneTime: "20261005000000", time: "20261005000000", status: "done" }),
        item({ doneTime: "20261004120001", time: "20261004120001", status: "done" }),
        item({ doneTime: "20260230000000", time: "20260230000000", status: "done" }),
    ];
    const september = aggregateReadingReview(items, now, "month", new Date(2026, 8, 12));
    assert.equal(september.periodCompleted, 1);
    assert.equal(september.periodCaptured, 1);
    const october = aggregateReadingReview(items, now, "month");
    assert.equal(october.periodCompleted, 1);
    assert.equal(october.periodCaptured, 1);
    assert.equal(october.unknownDoneTime, 3);
    assert.equal(aggregateReadingReview(items, now, "year").periodCompleted, 2);
    assert.equal(october.heatmap.filter((day) => day.count > 0).length, 2);
});

test("每篇同名标签仅计一次，用户标签与 AI 标签不混算，站点大小写归一", () => {
    const items = [
        item({ status: "done", doneTime: "20260928080000", site: " A.COM ", tags: ["共同", "共同", "用户"], aiTags: ["共同", "共同", " AI "] }),
        item({ status: "archived", doneTime: "20260929080000", site: "a.com", tags: ["用户"], aiTags: ["共同"] }),
        item({ status: "done", doneTime: "20260801000000", site: "old.com", tags: ["旧"], aiTags: ["旧"] }),
    ];
    const stats = aggregateReadingReview(items, NOW);
    assert.deepEqual(stats.periodBySite, [{ name: "a.com", count: 2 }]);
    assert.equal(stats.periodByUserTag.find((group) => group.name === "共同")?.count, 1);
    assert.equal(stats.periodByAiTag.find((group) => group.name === "共同")?.count, 2);
    assert.equal(stats.periodByAiTag.find((group) => group.name === "用户"), undefined);
    assert.equal(stats.periodByUserTag.find((group) => group.name === "AI"), undefined);
    assert.equal(stats.periodByUserTag.find((group) => group.name === "旧"), undefined);
});

test("年度热力图含每个零值日期，闰年 366 天；完成仅保留最近一次", () => {
    const now = new Date(2026, 8, 29, 12);
    const stats = aggregateReadingReview([item({ status: "archived", doneTime: "20240229120000" })], now, "year", new Date(2024, 1, 29));
    assert.equal(stats.heatmap.length, 366);
    assert.equal(stats.heatmap[0].date, "2024-01-01");
    assert.equal(stats.heatmap.at(-1)?.date, "2024-12-31");
    assert.equal(stats.heatmap.reduce((count, day) => count + day.count, 0), 1);
    assert.equal(aggregateReadingReview([], now).heatmap.length, 365);
});

test("最近完成趋势按参考日回溯 30 个本地日历日，跨年补零且不纳入参考日之后的完成", () => {
    const now = new Date(2026, 8, 20, 12, 0, 0);
    const reference = new Date(2026, 0, 5, 12, 0, 0);
    const stats = aggregateReadingReview([
        item({ id: "dec", status: "done", doneTime: "20251231080000" }),
        item({ id: "jan", status: "done", doneTime: "20260105080000" }),
        item({ id: "future", status: "done", doneTime: "20260106080000" }),
    ], now, "week", reference);
    assert.equal(stats.recentCompletionTrend.length, 30);
    assert.equal(stats.recentCompletionTrend[0].date, "2025-12-07");
    assert.equal(stats.recentCompletionTrend.at(-1)?.date, "2026-01-05");
    assert.equal(stats.recentCompletionTrend.find((day) => day.date === "2025-12-31")?.count, 1);
    assert.equal(stats.recentCompletionTrend.find((day) => day.date === "2026-01-05")?.count, 1);
    assert.equal(stats.recentCompletionTrend.find((day) => day.date === "2026-01-06")?.count, undefined);
    assert.equal(stats.heatmap.find((day) => day.date === "2026-01-06")?.count, 0);
});

test("跨夏令时按日历分桶，拒绝春季不存在的时间，秋季重复时间按一条事实统计", () => {
    const sourceUrl = new URL("../src/domain/stats.ts", import.meta.url).href;
    const script = `
        import assert from 'node:assert/strict';
        import { aggregateReadingReview, aggregateStats, parseLocalTimestamp, reviewPeriod, withinWeek } from ${JSON.stringify(sourceUrl)};
        const makeItem = (stamp) => ({ id: stamp, title: '', site: '', status: 'done', words: 0, minutes: 0, rating: 0, time: stamp, doneTime: stamp, aiTags: [], updated: '' });
        const springNow = new Date(2026, 2, 10, 12);
        const spring = ['20260304080000', '20260307080000', '20260308080000', '20260309080000', '20260310080000'].map(makeItem);
        assert.equal(parseLocalTimestamp('20260308023000'), null);
        assert.deepEqual(aggregateStats(spring, springNow).dailyCaptured, [1, 0, 0, 1, 1, 1, 1]);
        assert.equal(withinWeek('20260304080000', springNow.getTime()), true);
        assert.equal(aggregateReadingReview(spring, springNow).periodCompleted, 2);
        assert.equal(reviewPeriod('week', new Date(2026, 2, 8, 12)).end, '20260308');
        const fallNow = new Date(2026, 10, 3, 12);
        const fall = ['20261028080000', '20261031080000', '20261101013000', '20261102080000', '20261103080000'].map(makeItem);
        assert.ok(parseLocalTimestamp('20261101013000'));
        assert.deepEqual(aggregateStats(fall, fallNow).dailyCaptured, [1, 0, 0, 1, 1, 1, 1]);
        assert.equal(aggregateReadingReview(fall, fallNow).heatmap.find((day) => day.date === '2026-11-01').count, 1);
    `;
    for (const timezone of ["America/New_York", "America/Los_Angeles"]) {
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TZ: timezone } });
        assert.equal(result.status, 0, `${timezone}: ${result.stderr}`);
    }
});

test("回顾 Markdown 包含全部可信完成文章、独立候选和口径；转义标题和站点", () => {
    const items = Array.from({ length: 15 }, (_, index) => item({ id: `20260929000000-${String(index).padStart(7, "0")}`, title: `文章 ${index}`, status: "done", doneTime: "20260928080000", tags: ["用户"], aiTags: ["AI"] }));
    items[0].title = "[标题](javascript:alert(1))\n# 注入";
    items[0].site = "<img src=x>";
    const stats = aggregateReadingReview(items, NOW);
    const review: ReadingReview = { stats, completedItems: completedReviewItems(items, stats.period, NOW), candidateCount: 9, snapshotAt: "2026-09-29T04:00:00.000Z" };
    const markdown = buildReadingReviewMarkdown(review);
    assert.equal(markdown.match(/siyuan:\/\/blocks\//g)?.length, 15);
    assert.ok(markdown.includes("文章 14"));
    assert.ok(markdown.includes("\\[标题\\]\\(javascript:alert\\(1\\)\\)"));
    assert.ok(markdown.includes("\\<img src=x\\>"));
    assert.ok(!markdown.includes("\n# 注入"));
    assert.ok(markdown.includes("用户标签"));
    assert.ok(markdown.includes("AI 标签"));
    assert.ok(markdown.includes("不代表完整重读历史"));
    assert.ok(markdown.includes("独立"));
    assert.ok(markdown.includes(review.snapshotAt));
    assert.equal(stats.total, 15);
});

test("CSV 所有字符串列防公式注入，按 RFC 引号转义，保留快照与标签命名空间", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@cmd", " \t=1", "\uFEFF=1", "\r\n@cmd", "\ttext"]) assert.ok(csvCell(value).startsWith('"\''), value);
    assert.equal(csvCell('普通,"标题"'), '"普通,""标题"""');
    const items = [item({ status: "archived", doneTime: "20260928080000", title: "=HYPERLINK(\"x\")", site: "@evil", tags: ["+用户"], aiTags: ["-AI"] })];
    const stats = aggregateReadingReview(items, NOW);
    const review: ReadingReview = { stats, completedItems: items, candidateCount: 4, snapshotAt: "2026-09-29T04:00:00.000Z" };
    const csv = buildReadingReviewCsv(review);
    assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
    assert.ok(csv.includes('"\'@evil"'));
    assert.ok(csv.includes('"user-tag","\'+用户","1"'));
    assert.ok(csv.includes('"ai-tag","\'-AI","1"'));
    assert.ok(csv.includes('"candidate-snapshot","unconfirmed","4"'));
    assert.ok(csv.includes('"metadata","snapshot_at"'));
    assert.equal(csv.split("\r\n").filter((row) => row.startsWith('"heatmap"')).length, 365);
});

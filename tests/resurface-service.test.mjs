import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "./index-store" && context.parentURL?.endsWith("/src/services/resurface-service.ts")) {
            return { url: "glean-resurface:index-store", shortCircuit: true };
        }
        if (specifier === "./clip-store" && context.parentURL?.endsWith("/src/services/resurface-service.ts")) {
            return { url: "glean-resurface:clip-store", shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-resurface:index-store") return { format: "module", source: "export const loadIndex = async () => ({ clips: {}, candidates: {} });", shortCircuit: true };
        if (url === "glean-resurface:clip-store") return { format: "module", source: "export const readClip = async () => ({}); export const writeClip = async () => {};", shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { computeDailyFromIndex } = await import("../src/services/resurface-service.ts");

function clip(id, status, doneTime, extra = {}) {
    return {
        id, title: id, status, doneTime, internal: false, priority: 3, time: "20260901000000",
        aiTags: [], surfaced: "", pinned: "", summary: "", contentType: "local", url: "", site: "",
        ...extra,
    };
}

test("今日拾遗投影暴露统计共用的连续完成记录", () => {
    const index = {
        clips: {
            today: clip("today", "done", "20260929100000"),
            yesterday: clip("yesterday", "archived", "20260928100000"),
            twoDaysAgo: clip("two-days-ago", "reading", "20260927100000"),
            internal: clip("internal", "done", "20260926100000", { internal: true }),
        },
        candidates: {},
    };
    const settings = { resurface: { dailyCount: 3, includeDoneHighlights: false } };
    const daily = computeDailyFromIndex(index, settings, new Date(2026, 8, 29, 12));
    assert.equal(daily.completionStreak, 3);
    assert.equal(daily.picks.length, 0);
});

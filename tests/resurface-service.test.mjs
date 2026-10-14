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
        if (url === "glean-resurface:clip-store") return { format: "module", source: `
            const clips = new Map([["doc", { status: "inbox", lastSurfaced: "", pinned: "" }]]);
            const queues = new Map();
            const queuedWrite = async (_plugin, id, patch) => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                clips.set(id, { ...(clips.get(id) || {}), ...patch });
            };
            export const withClipEditQueue = (plugin, id, action) => {
                const previous = queues.get(id) || Promise.resolve();
                const result = previous.then(() => action((patch) => queuedWrite(plugin, id, patch)), () => action((patch) => queuedWrite(plugin, id, patch)));
                queues.set(id, result.catch(() => {}));
                return result;
            };
            export const readClip = async (id) => ({ ...(clips.get(id) || {}) });
            export const writeClip = queuedWrite;
        `, shortCircuit: true };
        return nextLoad(url, context);
    },
});

const { computeDailyFromIndex, actOnSurface, setSurfacePinned } = await import("../src/services/resurface-service.ts");

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

test("重浮属性读改写按文档串行，连续动作不会基于旧快照互相覆盖", async () => {
    const plugin = {};
    const first = actOnSurface(plugin, "doc", "read");
    const second = setSurfacePinned(plugin, "doc", true);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.before.status, "inbox");
    assert.match(secondResult, /^\d{8}$/);
});

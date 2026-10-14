import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "./index-store" && context.parentURL?.endsWith("/src/services/ai-tag-service.ts")) {
            return { url: "glean-ai-tags:index", shortCircuit: true };
        }
        if (specifier === "./clip-store" && context.parentURL?.endsWith("/src/services/ai-tag-service.ts")) {
            return { url: "glean-ai-tags:clip", shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-ai-tags:index") {
            return {
                format: "module",
                source: "export const loadIndex = async (_plugin, options = {}) => { if (globalThis.__gleanAiTagLoadError && options.strict) throw new Error('index unavailable'); return globalThis.__gleanAiTagIndex; };",
                shortCircuit: true,
            };
        }
        if (url === "glean-ai-tags:clip") {
            return {
                format: "module",
                source: `
                    const queues = new Map();
                    export const withClipEditQueue = (_plugin, id, action) => {
                        const previous = queues.get(id) || Promise.resolve();
                        const result = previous.then(() => action((patch, options = {}) => writeClip(_plugin, id, patch, options)), () => action((patch, options = {}) => writeClip(_plugin, id, patch, options)));
                        queues.set(id, result.catch(() => {}));
                        return result;
                    };
                    export const writeClip = async (_plugin, id, patch, options) => {
                        await new Promise((resolve) => setTimeout(resolve, 1));
                        const current = globalThis.__gleanAiTagAttrs.get(id) ?? null;
                        if ((current ?? null) !== options.expectedAttrs["custom-clip-ai-tags"]) throw new Error("changed");
                        globalThis.__gleanAiTagWrites.push({ id, patch });
                        globalThis.__gleanAiTagAttrs.set(id, patch.aiTags.join(","));
                    };
                `,
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { applyAiTagMerge, suggestAiTagMerges } = await import("../src/services/ai-tag-service.ts");

function setup(current = "ai,AI") {
    const id = "20261004120000-aaaaaaa";
    globalThis.__gleanAiTagIndex = { clips: { [id]: { id, aiTags: ["ai", "AI"] } } };
    globalThis.__gleanAiTagAttrs = new Map([[id, current]]);
    globalThis.__gleanAiTagWrites = [];
    globalThis.__gleanAiTagLoadError = false;
    return { id, plugin: {} };
}

test("AI 标签扫描和合并在索引读取失败时明确失败，不伪报空结果或成功", async () => {
    const { plugin } = setup();
    globalThis.__gleanAiTagLoadError = true;
    await assert.rejects(suggestAiTagMerges(plugin), /index unavailable/);
    await assert.rejects(applyAiTagMerge(plugin, ["ai", "AI"], "ai"), /index unavailable/);
    assert.deepEqual(globalThis.__gleanAiTagWrites, []);
});

test("AI 标签合并使用快照原值写入并收敛重复变体", async () => {
    const { id, plugin } = setup();
    const result = await applyAiTagMerge(plugin, ["ai", "AI"], "ai");
    assert.deepEqual(result, { applied: 1, failed: 0 });
    assert.equal(globalThis.__gleanAiTagAttrs.get(id), "ai");
    assert.deepEqual(globalThis.__gleanAiTagWrites, [{ id, patch: { aiTags: ["ai"] } }]);
});

test("AI 标签合并遇到并发更新时保留新标签并报告失败", async () => {
    const { id, plugin } = setup();
    const pending = applyAiTagMerge(plugin, ["ai", "AI"], "ai");
    globalThis.__gleanAiTagAttrs.set(id, "ai,AI,new-tag");
    const result = await pending;
    assert.deepEqual(result, { applied: 0, failed: 1 });
    assert.equal(globalThis.__gleanAiTagAttrs.get(id), "ai,AI,new-tag");
    assert.deepEqual(globalThis.__gleanAiTagWrites, []);
});

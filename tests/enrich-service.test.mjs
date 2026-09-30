/** AI 富化服务集成测试：模拟思源端点，保留真实队列、属性服务与索引同步。 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node 测试环境没有思源运行时；仅在本测试进程为端点传输提供替身。
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-test:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-test:siyuan") {
            return {
                format: "module",
                source: "export const fetchPost = (...args) => globalThis.__gleanTestFetchPost(...args); export const getFrontend = () => 'desktop';",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { autoEnrich, enrichClip, usageToday } = await import("../src/services/enrich-service.ts");
const { readerSummarize, readerTranslate } = await import("../src/services/reader-ai.ts");

function harness() {
    const attrs = new Map();
    const files = new Map();
    const calls = [];
    const answers = [];
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) { files.set(name, structuredClone(value)); },
    };
    globalThis.__gleanTestFetchPost = (route, body, callback) => {
        calls.push({ route, body });
        const id = body.id;
        let data;
        switch (route) {
            case "/api/export/exportMdContent":
                data = { hPath: "/测试", content: `# 测试文章\n\n这是 ${id} 的正文。` };
                break;
            case "/api/ai/chatGPT": {
                const answer = answers.shift();
                if (answer instanceof Error) {
                    callback({ code: 1, msg: answer.message });
                    return;
                }
                data = answer ?? JSON.stringify({ summary: `摘要 ${id}`, tags: ["阅读"] });
                break;
            }
            case "/api/attr/getBlockAttrs":
                data = { "custom-clip-status": "inbox", ...attrs.get(id) };
                break;
            case "/api/attr/setBlockAttrs":
                attrs.set(id, { "custom-clip-status": "inbox", ...attrs.get(id), ...body.attrs });
                data = null;
                break;
            case "/api/query/sql": {
                const docId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                data = docId ? [{ id: docId, content: `标题 ${docId}`, hpath: "/测试", box: "test-box", updated: "20260929000000" }] : [];
                break;
            }
            default:
                throw new Error(`未模拟端点：${route}`);
        }
        callback({ code: 0, data });
    };
    const settings = (enrichMode, enrichDailyCap = 20) => ({
        ai: { enrichMode, enrichDailyCap, dedupOnEnrich: false, channel: "siyuan" },
    });
    return { attrs, files, calls, answers, plugin, settings };
}

async function within(promise, milliseconds = 1500) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("富化队列未完成")), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test("off 关闭手动与自动富化，manual 只响应手动触发", async () => {
    const h = harness();
    autoEnrich(h.plugin, "off-auto", h.settings("off"));
    assert.deepEqual(await enrichClip(h.plugin, "off-manual", h.settings("off")), {
        ok: false, duplicates: [], skipped: "off",
    });
    autoEnrich(h.plugin, "manual-auto", h.settings("manual"));
    assert.equal(h.calls.length, 0);

    const outcome = await within(enrichClip(h.plugin, "manual", h.settings("manual")));
    assert.equal(outcome.ok, true);
    assert.equal(h.attrs.get("manual")["custom-clip-summary"].length > 0, true);
    assert.equal(h.files.get("glean-index.json").clips.manual.summary, h.attrs.get("manual")["custom-clip-summary"]);
    assert.equal(await usageToday(h.plugin), 1);
});

test("手动和自动共享每日上限，超过上限不再调用模型", async () => {
    const h = harness();
    const settings = h.settings("manual", 1);
    assert.equal((await enrichClip(h.plugin, "first", settings)).ok, true);
    assert.equal((await enrichClip(h.plugin, "second", settings)).skipped, "cap");
    autoEnrich(h.plugin, "third", h.settings("auto", 1));
    // 队列屏障：排在自动任务后面的调用返回时，自动任务也已结束。
    assert.equal((await within(enrichClip(h.plugin, "fourth", settings))).skipped, "cap");
    assert.equal(h.calls.filter((call) => call.route === "/api/ai/chatGPT").length, 1);
    assert.equal(h.attrs.has("third"), false);
    assert.equal(await usageToday(h.plugin), 1);
});

test("模型错误与解析失败后队列继续执行，失败不占额度", async () => {
    const h = harness();
    h.answers.push(new Error("模型未配置"), "无法解析", JSON.stringify({ summary: "恢复后的摘要", tags: ["主题"] }));
    const settings = h.settings("manual", 1);
    assert.equal((await enrichClip(h.plugin, "llm-error", settings)).skipped, "error");
    assert.equal((await enrichClip(h.plugin, "bad", settings)).skipped, "parse");
    assert.equal((await enrichClip(h.plugin, "good", settings)).ok, true);
    assert.equal(h.attrs.get("good")["custom-clip-summary"], "恢复后的摘要");
    // T-1763：成功也留痕（stage=ok），供卡片"失败待重试"标记按最近一条判定
    assert.deepEqual(h.files.get("ai-log.json").map((entry) => entry.stage), ["llm", "parse", "ok"]);
    assert.equal(await usageToday(h.plugin), 1);
});

test("auto 富化只入队一次，两篇完成后队列仍可处理后续手动任务", async () => {
    const h = harness();
    autoEnrich(h.plugin, "auto-one", h.settings("auto"));
    autoEnrich(h.plugin, "auto-two", h.settings("auto"));
    const outcome = await within(enrichClip(h.plugin, "manual-after-auto", h.settings("manual")));
    assert.equal(outcome.ok, true);
    for (const id of ["auto-one", "auto-two", "manual-after-auto"]) {
        assert.equal(typeof h.attrs.get(id)?.["custom-clip-summary"], "string");
    }
    assert.equal(await usageToday(h.plugin), 3);
});

test("T-1883：富化与伴读并发生态度租约，剩余 1 次时只放行一个调用", async () => {
    const h = harness();
    const settings = h.settings("manual", 2);
    // 预置一篇文章属性（伴读路径只读额度，不写属性；富化路径走 writeClip）
    // 并发发出 4 个 AI 消耗：1 富化 + 1 总结 + 1 翻译 + 1 富化，上限 2 → 只应有 2 次模型调用。
    const pending = [
        enrichClip(h.plugin, "lease-a", settings),
        readerSummarize(h.plugin, "lease-b", settings),
        readerTranslate(h.plugin, "lease-b", "待翻译文本", settings),
        enrichClip(h.plugin, "lease-c", settings),
    ];
    const outcomes = await Promise.all(pending.map((task) => within(task)));
    const modelCalls = h.calls.filter((call) => call.route === "/api/ai/chatGPT").length;
    assert.equal(modelCalls, 2, "额度 2 次时并发 4 个 AI 任务只应放行 2 次模型调用");
    assert.equal(await usageToday(h.plugin), 2);
    const succeeded = outcomes.filter((outcome) => outcome.ok).length;
    const capped = outcomes.filter((outcome) => outcome.skipped === "cap").length;
    assert.equal(succeeded, 2);
    assert.equal(capped, 2);
});

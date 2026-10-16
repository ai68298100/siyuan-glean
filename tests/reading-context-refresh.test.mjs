import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const componentUrl = new URL("../src/ui/ReadingContext.svelte", import.meta.url);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("glean-context-refresh:")) return { url: specifier, shortCircuit: true };
        if (context.parentURL?.startsWith("glean-context-refresh:component-")) {
            if (specifier === "svelte" || specifier === "siyuan" || specifier.endsWith(".svelte") || specifier === "./formatting-dialog" || specifier === "../services/checkin-bridge" || specifier === "../services/clip-store") {
                return { url: `glean-context-refresh:${specifier}`, shortCircuit: true };
            }
            const qualified = specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) ? `${specifier}.ts` : specifier;
            return nextResolve(new URL(qualified, componentUrl).href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === "glean-context-refresh:svelte") return { format: "module", source: "export const untrack = callback => callback();", shortCircuit: true };
        if (url === "glean-context-refresh:siyuan") return { format: "module", source: "export const showMessage = () => {};", shortCircuit: true };
        if (url === "glean-context-refresh:../services/clip-store") return {
            format: "module", shortCircuit: true,
            source: "export const readClipContext = (...args) => globalThis.__gleanContextRefreshRead(...args); export const batchSetStatusDetailed = () => {}; export const measureClipBody = () => {};",
        };
        if (url === "glean-context-refresh:../services/checkin-bridge") return { format: "module", source: "export const recordReadingDone = () => {};", shortCircuit: true };
        if (url === "glean-context-refresh:./formatting-dialog") return { format: "module", source: "export const openFormattingDialog = () => {};", shortCircuit: true };
        if (url.endsWith(".svelte")) return { format: "module", source: "export default {};", shortCircuit: true };
        if (url.startsWith("glean-context-refresh:component-")) {
            const script = readFileSync(componentUrl, "utf8").match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
            const runes = `const $props = Object.assign(() => globalThis.__gleanContextRefreshProps, { id: () => "test" }); const $state = value => value; const $derived = value => value; const $effect = callback => globalThis.__gleanContextRefreshEffects.push(callback);`;
            const probe = `export const controls = { reload, change(id) { docId = id; }, inspect() { return { context, loading, refreshing, loadError }; } };`;
            const source = ts.transpileModule(`${runes}\n${script}\n${probe}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
            return { format: "module", source, shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});

let serial = 0;
const article = { id: "article-a", title: "Article", status: "reading" };
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

async function harness(firstResult = article) {
    const effects = [];
    const pending = [];
    const calls = [];
    const events = new EventTarget();
    globalThis.document = events;
    globalThis.__gleanContextRefreshProps = { facade: { i18n: {}, pluginInstance: {} }, docId: article.id };
    globalThis.__gleanContextRefreshEffects = effects;
    globalThis.__gleanContextRefreshRead = (id) => {
        calls.push(id);
        return pending.length ? pending.shift().promise : Promise.resolve(firstResult);
    };
    const { controls } = await import(`glean-context-refresh:component-${++serial}`);
    const dispose = effects[0]();
    await Promise.resolve();
    return { controls, calls, pending, dispose, remount: () => effects[0]() };
}

test("阅读上下文：后台重读保留已有栏，直到新属性返回", async () => {
    const current = await harness();
    const read = deferred();
    current.pending.push(read);
    const request = current.controls.reload();
    assert.deepEqual(current.controls.inspect(), { context: article, loading: false, refreshing: true, loadError: false });
    read.resolve({ ...article, status: "done" });
    await request;
    assert.equal(current.controls.inspect().context.status, "done");
    assert.equal(current.controls.inspect().refreshing, false);
    current.dispose();
});

test("普通文档：判定无阅读栏后，后续刷新不闪现骨架屏", async () => {
    const current = await harness(null);
    const read = deferred();
    current.pending.push(read);
    const request = current.controls.reload();
    assert.equal(current.controls.inspect().context, null);
    assert.equal(current.controls.inspect().loading, false);
    read.resolve(null);
    await request;
    assert.equal(current.controls.inspect().loading, false);
    current.dispose();
});

test("阅读上下文：旧请求不能覆盖后续结果，卸载后不回填", async () => {
    const current = await harness();
    const older = deferred();
    const newer = deferred();
    current.pending.push(older, newer);
    const oldRequest = current.controls.reload();
    const newRequest = current.controls.reload();
    newer.resolve({ ...article, status: "done" });
    await newRequest;
    older.resolve({ ...article, status: "later" });
    await oldRequest;
    assert.equal(current.controls.inspect().context.status, "done");
    const late = deferred();
    current.pending.push(late);
    const request = current.controls.reload();
    current.dispose();
    late.resolve({ ...article, status: "archived" });
    await request;
    assert.equal(current.controls.inspect().context.status, "done");
});

test("阅读上下文：重读失败可见，重试期间保留错误反馈，切文重置首读状态", async () => {
    const current = await harness();
    const failed = deferred();
    current.pending.push(failed);
    const request = current.controls.reload();
    failed.reject(new Error("Read failed"));
    await request;
    assert.equal(current.controls.inspect().loadError, true);
    const retry = deferred();
    current.pending.push(retry);
    const retryRequest = current.controls.reload();
    assert.equal(current.controls.inspect().loadError, true);
    assert.equal(current.controls.inspect().refreshing, true);
    retry.resolve(article);
    await retryRequest;
    assert.equal(current.controls.inspect().loadError, false);
    current.dispose();
    const next = deferred();
    current.pending.push(next);
    current.controls.change("article-b");
    const dispose = current.remount();
    assert.equal(current.controls.inspect().loading, true);
    assert.equal(current.controls.inspect().context, null);
    next.resolve({ ...article, id: "article-b" });
    await Promise.resolve();
    assert.equal(current.controls.inspect().context.id, "article-b");
    dispose();
});

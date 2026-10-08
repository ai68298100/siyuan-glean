import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

const componentUrl = new URL("../src/ui/AiBatchPanel.svelte", import.meta.url);
const compiledUrl = new URL("../src/ui/AiBatchPanel.test-render.mjs", import.meta.url).href;
const source = compile(readFileSync(componentUrl, "utf8"), { filename: componentUrl.pathname, generate: "server" }).js.code;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === compiledUrl) return { url: compiledUrl, shortCircuit: true };
        if (specifier === "siyuan") return { url: "glean-ai-batch-ui:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === compiledUrl) return { format: "module", source, shortCircuit: true };
        if (url === "glean-ai-batch-ui:siyuan") return { format: "module", source: "export const fetchSyncPost = () => { throw new Error('Rendering must not call the kernel'); }; export const getFrontend = () => 'desktop';", shortCircuit: true };
        return nextLoad(url, context);
    },
});
const { default: AiBatchPanel } = await import(compiledUrl);

function facade(language) {
    const i18n = JSON.parse(readFileSync(new URL(`../public/i18n/${language}.json`, import.meta.url), "utf8"));
    return { i18n, pluginInstance: { loadData() { throw new Error("Rendering must not load tasks"); }, saveData() { throw new Error("Rendering must not save tasks"); } } };
}

test("真实 Svelte 组件首屏先展示预览、覆盖/额度/关闭语义；没有确认前不渲染开始按钮或调用服务", () => {
    for (const language of ["zh_CN", "en_US"]) {
        const context = facade(language);
        const { body } = render(AiBatchPanel, { props: { facade: context, open: true, docIds: ["20261004000000-first01"] } });
        assert.ok(body.includes(context.i18n["aiBatch.title"]));
        assert.ok(body.includes(context.i18n["aiBatch.previewNew"]));
        assert.ok(body.includes(context.i18n["aiBatch.stopHint"]));
        assert.ok(!body.includes(context.i18n["aiBatch.start"]));
        assert.ok(!body.includes("aiBatch.error."));
    }
});

test("没有勾选文章时预览按钮禁用；无任务的收起面板不展示虚假恢复任务", () => {
    const context = facade("en_US");
    const { body } = render(AiBatchPanel, { props: { facade: context, open: true, docIds: [] } });
    assert.match(body, /<button[^>]*disabled[^>]*>Preview selected articles<\/button>/);
    const collapsed = render(AiBatchPanel, { props: { facade: context, open: false, docIds: [] } });
    assert.ok(!collapsed.body.includes(context.i18n["aiBatch.previewResume"]));
    assert.ok(!collapsed.body.includes("<button"));
});

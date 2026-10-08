import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

const componentUrl = new URL("../src/ui/AiTagMergePanel.svelte", import.meta.url);
const compiledUrl = new URL("../src/ui/AiTagMergePanel.test-render.mjs", import.meta.url).href;
const source = compile(readFileSync(componentUrl, "utf8"), { filename: componentUrl.pathname, generate: "server" }).js.code;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === compiledUrl) return { url: compiledUrl, shortCircuit: true };
        if (specifier === "siyuan") return { url: "glean-ai-tag-ui:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === compiledUrl) return { format: "module", source, shortCircuit: true };
        if (url === "glean-ai-tag-ui:siyuan") return { format: "module", source: "export const fetchSyncPost = () => { throw new Error('Rendering must not call the kernel'); };", shortCircuit: true };
        return nextLoad(url, context);
    },
});
const { default: AiTagMergePanel } = await import(compiledUrl);

function facade(language) {
    const i18n = JSON.parse(readFileSync(new URL(`../public/i18n/${language}.json`, import.meta.url), "utf8"));
    return { i18n, pluginInstance: {}, notifyDataChanged() {} };
}

test("AI 标签合并面板首屏只展示说明和扫描入口，不调用服务", () => {
    for (const language of ["zh_CN", "en_US"]) {
        const context = facade(language);
        const { body } = render(AiTagMergePanel, { props: { facade: context } });
        assert.ok(body.includes(context.i18n["aiTagMerge.title"]));
        assert.ok(body.includes(context.i18n["aiTagMerge.scan"]));
        assert.ok(body.includes(context.i18n["aiTagMerge.hint"]));
        assert.ok(!body.includes(context.i18n["aiTagMerge.apply"]));
    }
});

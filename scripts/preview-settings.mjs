// 临时工具（T-3314 视觉验证）：SSR 渲染设置页组件并生成可截图的静态 fixture。
// 用法：node scripts/preview-settings.mjs [输出路径]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { registerHooks } from "node:module";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const componentUrl = new URL("../src/ui/SettingsView.svelte", import.meta.url);
const compiledUrl = new URL("../src/ui/SettingsView.test-render.mjs", import.meta.url).href;

const compiledCache = new Map();
function compileSvelte(source, filename) {
    const out = compile(source, { filename, generate: "server" });
    compiledCache.set(`css:${filename}`, out.css?.code ?? "");
    return out.js.code;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === compiledUrl) return { url: compiledUrl, shortCircuit: true };
        if (specifier === "siyuan") return { url: "glean-preview:siyuan", shortCircuit: true };
        if (specifier.startsWith(".") && specifier.endsWith(".svelte")) {
            const resolved = new URL(specifier, context.parentURL ?? componentUrl);
            return { url: resolved.href, shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === compiledUrl) {
            const source = compileSvelte(readFileSync(componentUrl, "utf8"), componentUrl.pathname);
            return { format: "module", source, shortCircuit: true };
        }
        if (url.startsWith("file://") && url.endsWith(".svelte")) {
            const cached = compiledCache.get(url);
            if (cached) return { format: "module", source: cached, shortCircuit: true };
            const source = compileSvelte(readFileSync(fileURLToPath(url), "utf8"), fileURLToPath(url));
            compiledCache.set(url, source);
            return { format: "module", source, shortCircuit: true };
        }
        if (url === "glean-preview:siyuan") {
            return {
                format: "module",
                source: "export const showMessage = () => {}; export const getFrontend = () => 'desktop'; export const openTab = () => {}; export const openMobileFileById = () => {};",
                shortCircuit: true,
            };
        }
        return nextLoad(url, context);
    },
});

const { default: SettingsView } = await import(compiledUrl);
const { DEFAULT_SETTINGS } = await import(new URL("../src/services/settings.ts", import.meta.url).href);

const i18n = JSON.parse(readFileSync(new URL("../public/i18n/zh_CN.json", import.meta.url), "utf8"));
const facade = {
    i18n,
    isMobile: false,
    settings: DEFAULT_SETTINGS,
    pluginInstance: { app: {} },
    notifyDataChanged() {},
    openImport() {},
    openSettings() {},
    openMigrate() {},
};

const { body } = render(SettingsView, { props: { facade } });
const css = readFileSync(new URL("../dist/index.css", import.meta.url), "utf8");
// 组件 scoped CSS 需要与 SSR 渲染时的哈希类名一致：用本脚本编译产物里的 css 源码
const scopedCss = [...compiledCache.entries()].filter(([k]) => k.startsWith("css:")).map(([, v]) => v).join("\n");
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>settings fixture</title>
<style>${css}</style>
<style>${scopedCss}</style>
<style>
    body { margin: 0; padding: 24px; background: #f0f0f0; display: flex; flex-direction: column; gap: 24px; align-items: center; }
    .frame { height: 640px; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.18); background: var(--b3-theme-background, #fff); }
    .frame--wide { width: 720px; }
    .frame--narrow { width: 460px; }
</style></head>
<body>
<div class="frame frame--wide"><div style="height:100%">${body}</div></div>
<div class="frame frame--narrow"><div style="height:100%">${body}</div></div>
</body></html>`;

const outPath = process.argv[2] ?? "output/playwright/settings-ssr.html";
mkdirSync(dirname(resolve(root, outPath)), { recursive: true });
writeFileSync(resolve(root, outPath), html, "utf8");
console.log("written:", resolve(root, outPath));

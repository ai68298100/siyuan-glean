/**
 * 真实 Svelte 页面隔离预览。只使用合成 fixture；不连接思源内核或 AI。
 * node scripts/visual/preview-workbench.mjs [--port 4179] [--build]
 * ?view=library|resurface|stats|highlights|settings|context&state=default|empty|loading|failure
 * context 专用状态还支持 unknown|source-missing，包含长标题/主题和标签刷新按钮。
 * &canvas=tab|dock|mobile&theme=light|dark
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = resolve(repo, "scripts/visual/fixtures");
const output = resolve(repo, "output/r54-preview");
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex < 0 ? 4179 : Number(args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须为 1–65535");
const symbols = readFileSync(resolve(repo, "src/index.ts"), "utf8").match(/<symbol\b[\s\S]*?<\/symbol>/g)?.join("\n") ?? "";

const config = {
    configFile: false,
    root: fixtures,
    publicDir: false,
    base: "./",
    resolve: { alias: { siyuan: resolve(fixtures, "siyuan-mock.mjs") } },
    plugins: [
        svelte(),
        {
            name: "glean-isolated-preview",
            transformIndexHtml(html) { return html.replace("<!-- GLEAN_ICONS -->", `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`); },
            configureServer(server) {
                // 本服务器从未配置 proxy。任何漏出 mock 的内核请求明确拒绝。
                server.middlewares.use((req, res, next) => {
                    if (!req.url?.startsWith("/api/")) return next();
                    res.statusCode = 403;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ code: -1, msg: "隔离预览禁止连接内核", data: null }));
                });
            },
        },
    ],
    server: { host: "127.0.0.1", port, strictPort: true, fs: { allow: [repo] } },
    build: { outDir: output, emptyOutDir: true, sourcemap: false },
};

if (args.includes("--build")) {
    await build(config);
    console.log(`隔离预览已生成：${output}`);
} else {
    const server = await createServer(config);
    await server.listen();
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, "session.json"), JSON.stringify({ pid: process.pid, base: `http://127.0.0.1:${port}`, synthetic: true, kernel: false, ai: false }, null, 2));
    console.log(`隔离预览：http://127.0.0.1:${port}/（合成数据；无内核/AI连接）`);
    const close = async () => { await server.close(); process.exit(0); };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
}

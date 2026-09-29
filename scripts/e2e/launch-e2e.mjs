/* E2E UI 冒烟启动器：隔离内核 + 真实 dist 插件 → 输出可浏览器访问的 URL。
   安全纪律同 spike（独立工作区/标记/回环）；服务保持运行供外部浏览器驱动，Ctrl+C 退出清理。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    waitForBoot,
    shutdownKernel,
} from "../spike/kernel-harness.mjs";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Glean-E2E");
const HOST = "127.0.0.1";
const PORT = 6833;
const BASE = `http://${HOST}:${PORT}`;
const PLUGIN_NAME = "siyuan-glean";

async function main() {
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(WORKSPACE, "glean-e2e.json", "glean-e2e");

    // dist → 插件目录（真实构建产物）
    const distDir = path.join(process.cwd(), "dist");
    if (!fs.existsSync(path.join(distDir, "index.js"))) {
        throw new Error("dist/index.js 不存在，先 pnpm build");
    }
    const target = path.join(WORKSPACE, "data", "plugins", PLUGIN_NAME);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(distDir, target, { recursive: true });

    await assertTestPortAvailable(HOST, PORT);
    const client = createApiClient(BASE);
    const { child, lines } = startKernel(kernel, appDir, WORKSPACE, PORT);
    client.onGuard(() => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("内核已退出");
    });

    const version = await waitForBoot(BASE, lines, () => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("内核已退出");
    }, client);
    client.setToken((JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "");
    console.log(`内核 ${JSON.stringify(version)} @ ${BASE}`);

    // 集市信任 + 启用插件
    await client.api("/api/setting/setBazaar", { trust: true, petalDisabled: false });
    const enabled = await client.api("/api/petal/setPetalEnabled", { packageName: PLUGIN_NAME, enabled: true, frontend: "desktop" });
    const petals = await client.api("/api/petal/loadPetals", { frontend: "desktop" });
    const found = Array.isArray(petals.data) ? petals.data.find((p) => p.name === PLUGIN_NAME) : null;
    console.log(`插件启用=${enabled.code === 0} loadPetals含插件=${Boolean(found)} i18n键=${Object.keys(found?.i18n ?? {}).length}`);

    // 演示数据：锚点笔记本 + 几篇不同状态的剪藏
    const notebooks = await client.apiChecked("/api/notebook/lsNotebooks", {});
    let box = (notebooks.notebooks || []).find((n) => n.name === "GleanE2E")?.id;
    if (!box) {
        await client.apiChecked("/api/notebook/createNotebook", { name: "GleanE2E" });
        const refreshed = await client.apiChecked("/api/notebook/lsNotebooks", {});
        box = (refreshed.notebooks || []).find((n) => n.name === "GleanE2E")?.id;
    }
    const demoDocs = [
        ["本地优先软件浪潮", "https://inkandswitch.com/local-first", "inbox", "20260601000000"],
        ["液态玻璃设计原则", "https://design.weekly.dev/glass", "reading", "20260901000000"],
        ["事件驱动架构入门", "https://zh.dev.to/eda", "later", "20260915000000"],
        ["CUDA 心智模型", "https://gpu.dev/cuda", "done", "20260920000000"],
    ];
    for (const [title, url, status, time] of demoDocs) {
        const existing = await client.apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND content='${title}' LIMIT 1`,
        });
        const docId = existing[0]?.id
            ?? await client.apiChecked("/api/filetree/createDocWithMd", {
                notebook: box, path: `/剪藏/${title}`, markdown: `# ${title}\n\n- [${url}](${url})\n\n${"演示正文。".repeat(30)}`,
            });
        await client.apiChecked("/api/attr/setBlockAttrs", {
            id: docId,
            attrs: {
                "custom-clip-url": url,
                "custom-clip-site": new URL(url).hostname,
                "custom-clip-time": time,
                "custom-clip-status": status,
                "custom-clip-words": "1200",
                "custom-clip-minutes": "3",
                "custom-clip-src": "web-clipper",
            },
        });
    }
    console.log(`演示数据就绪：笔记本 GleanE2E（${demoDocs.length} 篇剪藏）`);

    console.log(`\n== E2E 环境就绪：浏览器打开 ${BASE} （用户名任意/本地无密码则直接进入） ==`);
    console.log("保持运行中，Ctrl+C 退出并清理内核…");

    const cleanup = async () => {
        await shutdownKernel(client, child);
        process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    // 兜底：内核意外退出则跟随
    child.once("exit", () => process.exit(1));
}

main().catch((error) => {
    console.error("E2E LAUNCH ERROR:", error.message);
    process.exit(2);
});

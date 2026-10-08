import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    waitForBoot,
    shutdownKernel,
} from "../spike/kernel-harness.mjs";
import { cleanupScratch, prepareWriteSmoke } from "../lib/smoke-kernel.mjs";
import {
    E2E_CREATED_BY,
    E2E_MANIFEST_VERSION,
    E2E_SESSION_DIR_NAME,
    resolvePluginBundle,
} from "./plugin-identity.mjs";

const HOST = "127.0.0.1";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const startedAt = new Date().toISOString();

function parseArgs() {
    const values = {};
    for (let index = 2; index < process.argv.length; index += 1) {
        const argument = process.argv[index];
        if (argument === "--help") {
            console.log("node scripts/e2e/launch-e2e.mjs [--plugin-dir path] [--name name] [--workspace path] [--port port|0] [--manifest path] [--log path]");
            process.exit(0);
        }
        if (!argument.startsWith("--")) throw new Error("未知参数: " + argument);
        const key = argument.slice(2);
        const value = process.argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("参数缺少值: --" + key);
        values[key] = value;
        index += 1;
    }
    return values;
}

function safeName(value) {
    const normalized = String(value || "run").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized.slice(0, 48) || "run";
}

function parsePort(value) {
    if (value === undefined || value === "0") return 0;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port 必须是 0 或 1-65535");
    return port;
}

async function choosePort() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const port = 30000 + Math.floor(Math.random() * 25000);
        try {
            await assertTestPortAvailable(HOST, port);
            return port;
        } catch (error) {
            if (attempt === 39) throw error;
        }
    }
    throw new Error("没有可用的回环测试端口");
}

function writeManifest(manifestPath, manifest) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const temporary = manifestPath + ".tmp-" + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n");
    fs.renameSync(temporary, manifestPath);
}

const options = parseArgs();
const name = safeName(options.name || "run-" + Date.now());
const plugin = resolvePluginBundle(options["plugin-dir"] || REPO);
const workspace = path.resolve(options.workspace || path.join(os.tmpdir(), "siyuan-plugin-e2e-" + plugin.name + "-" + name + "-" + Date.now() + "-" + process.pid));
const marker = plugin.name + "-e2e-" + name + ".json";
const defaultManifestDir = path.join(os.tmpdir(), E2E_SESSION_DIR_NAME);
const manifestPath = path.resolve(options.manifest || path.join(defaultManifestDir, name + "-" + Date.now() + "-" + process.pid + ".json"));
const requestedPort = parsePort(options.port);
const manifest = {
    version: E2E_MANIFEST_VERSION,
    createdBy: E2E_CREATED_BY,
    pluginName: plugin.name,
    pluginVersion: plugin.version,
    pluginDir: plugin.root,
    name,
    ownerPid: process.pid,
    kernelPid: null,
    workspace,
    marker,
    host: HOST,
    port: null,
    base: null,
    status: "starting",
    startedAt,
    logPath: options.log ? path.resolve(options.log) : null,
};
if (manifestPath.startsWith(workspace + path.sep)) {
    throw new Error("manifest 必须放在工作区之外，避免破坏隔离工作区标记");
}
writeManifest(manifestPath, manifest);

let stopping = false;
let child;
let client;

async function setStatus(status, extra = {}) {
    Object.assign(manifest, { status, ...extra });
    writeManifest(manifestPath, manifest);
}

async function cleanup(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    await setStatus("stopping", { stoppedAt: new Date().toISOString() }).catch(() => undefined);
    if (client && child && child.exitCode === null && child.signalCode === null) await cleanupScratch((route, body) => client.api(route, body), { log: console }).catch((error) => console.warn(`临时库收尾清扫失败：${error.message}`));
    if (client && child) await shutdownKernel(client, child);
    await setStatus("stopped", { stoppedAt: new Date().toISOString() }).catch(() => undefined);
    process.exit(exitCode);
}

async function main() {
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(workspace, marker, E2E_CREATED_BY);

    const target = path.join(workspace, "data", "plugins", plugin.name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(plugin.distDir, target, { recursive: true });

    const port = requestedPort || await choosePort();
    await assertTestPortAvailable(HOST, port);
    const base = "http://" + HOST + ":" + port;
    client = createApiClient(base);
    const started = startKernel(kernel, appDir, workspace, port);
    child = started.child;
    manifest.kernelPid = child.pid;
    manifest.port = port;
    manifest.base = base;
    await setStatus("booting");
    client.onGuard(() => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("内核已退出");
    });

    const kernelVersion = await waitForBoot(base, started.lines, () => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("内核已退出");
    }, client);
    const confPath = path.join(workspace, "conf", "conf.json");
    // API 鉴权用的是 conf.json 的 api.token；accessAuthCode 是网页访问密码（未设置时为空），只作后备
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
    const token = options.token || process.env.SIYUAN_TOKEN || (conf.api && conf.api.token) || conf.accessAuthCode || "";
    if (!token) throw new Error("隔离内核未生成 token；请传入 --token 或设置 SIYUAN_TOKEN");
    client.setToken(token);
    await prepareWriteSmoke((route, body) => client.api(route, body), { base, log: console });

    await client.api("/api/setting/setBazaar", { trust: true, petalDisabled: false });
    const enabled = await client.api("/api/petal/setPetalEnabled", { packageName: plugin.name, enabled: true, frontend: "desktop" });
    const petals = await client.api("/api/petal/loadPetals", { frontend: "desktop" });
    const found = Array.isArray(petals.data) ? petals.data.find((item) => item.name === plugin.name) : null;
    console.log("插件启用=" + (enabled.code === 0) + " loadPetals含插件=" + Boolean(found) + " i18n键=" + Object.keys(found?.i18n ?? {}).length);

    const notebooks = await client.apiChecked("/api/notebook/lsNotebooks", {});
    const notebookName = `siyuan-glean-smoke-e2e-${process.pid}`;
    let box = (notebooks.notebooks || []).find((item) => item.name === notebookName)?.id;
    if (!box) {
        await client.apiChecked("/api/notebook/createNotebook", { name: notebookName });
        const refreshed = await client.apiChecked("/api/notebook/lsNotebooks", {});
        box = (refreshed.notebooks || []).find((item) => item.name === notebookName)?.id;
    }
    const demoDocs = [
        ["本地优先软件浪潮", "https://inkandswitch.com/local-first", "inbox", "20260601000000"],
        ["液态玻璃设计原则", "https://design.weekly.dev/glass", "reading", "20260901000000"],
        ["事件驱动架构入门", "https://zh.dev.to/eda", "later", "20260915000000"],
        ["CUDA 心智模型", "https://gpu.dev/cuda", "done", "20260920000000"],
    ];
    for (const [title, url, status, time] of demoDocs) {
        const existing = await client.apiChecked("/api/query/sql", {
            stmt: "SELECT id FROM blocks WHERE type='d' AND box='" + box + "' AND content='" + title + "' LIMIT 1",
        });
        const docId = existing[0]?.id
            ?? await client.apiChecked("/api/filetree/createDocWithMd", {
                notebook: box,
                path: "/剪藏/" + title,
                markdown: "# " + title + "\n\n- [" + url + "](" + url + ")\n\n" + "演示正文。".repeat(30),
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
    await setStatus("ready", { kernelVersion, notebookId: box, demoDocumentCount: demoDocs.length, readyAt: new Date().toISOString() });
    console.log("E2E_MANIFEST=" + manifestPath);
    console.log("E2E_WORKSPACE=" + workspace);
    console.log("E2E_URL=" + base);
    console.log("演示数据就绪：笔记本 " + notebookName + "（" + demoDocs.length + " 篇剪藏）");
    console.log("保持运行中，Ctrl+C 退出并清理内核…");

    process.on("SIGINT", () => void cleanup(0));
    process.on("SIGTERM", () => void cleanup(0));
    child.once("exit", () => {
        if (!stopping) void setStatus("failed", { failedAt: new Date().toISOString() }).finally(() => process.exit(1));
    });
}

main().catch(async (error) => {
    if (client && child && !stopping) {
        stopping = true;
        await shutdownKernel(client, child).catch(() => undefined);
    }
    await setStatus("failed", { failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    console.error("E2E LAUNCH ERROR:", error instanceof Error ? error.message : String(error));
    process.exit(2);
});

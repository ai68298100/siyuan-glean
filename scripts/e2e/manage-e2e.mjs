import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CREATED_BY = "siyuan-glean-e2e-session";
const HOSTS = new Set(["127.0.0.1", "::1"]);
const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const launcher = path.join(repo, "scripts", "e2e", "launch-e2e.mjs");
const sessionDir = path.join(os.tmpdir(), "siyuan-glean-e2e-sessions");

function usage() {
    console.log("node scripts/e2e/manage-e2e.mjs start [--name name] [--workspace path] [--port port|0]");
    console.log("node scripts/e2e/manage-e2e.mjs stop --manifest path");
    console.log("node scripts/e2e/manage-e2e.mjs status --manifest path");
    console.log("node scripts/e2e/manage-e2e.mjs list");
}

function parseOptions(argumentsList) {
    const options = {};
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        if (!argument.startsWith("--")) throw new Error("未知参数: " + argument);
        const key = argument.slice(2);
        const value = argumentsList[index + 1];
        if (!value || value.startsWith("--")) throw new Error("参数缺少值: --" + key);
        options[key] = value;
        index += 1;
    }
    return options;
}

function readManifest(manifestPath) {
    const resolved = path.resolve(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (manifest.createdBy !== CREATED_BY || !Number.isInteger(manifest.ownerPid) || !Number.isInteger(manifest.kernelPid)) {
        throw new Error("manifest 不是本插件创建的有效 E2E 会话");
    }
    if (!HOSTS.has(manifest.host) || !path.isAbsolute(manifest.workspace) || !path.isAbsolute(resolved) || !Number.isInteger(manifest.port) || manifest.port < 1 || manifest.port > 65535 || manifest.base !== `http://${manifest.host}:${manifest.port}`) {
        throw new Error("manifest 的工作区或地址不满足隔离约束");
    }
    const markerPath = path.join(manifest.workspace, manifest.marker);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker.createdBy !== CREATED_BY) throw new Error("工作区标记不匹配，拒绝操作");
    return { path: resolved, manifest };
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function writeManifest(manifestPath, manifest) {
    const temporary = manifestPath + ".tmp-" + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n");
    fs.renameSync(temporary, manifestPath);
}

async function waitForManifest(manifestPath, pid) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (manifest.status === "ready") return manifest;
            if (manifest.status === "failed") throw new Error(manifest.error || "E2E 启动失败");
        }
        if (!isAlive(pid)) throw new Error("E2E 启动进程已退出");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("等待 E2E 内核就绪超时");
}

async function start(options) {
    fs.mkdirSync(sessionDir, { recursive: true });
    const name = options.name || "run-" + Date.now() + "-" + process.pid;
    const stamp = Date.now() + "-" + process.pid;
    const manifestPath = path.join(sessionDir, name.replace(/[^a-zA-Z0-9._-]+/g, "-") + "-" + stamp + ".json");
    const logPath = manifestPath.replace(/\.json$/i, ".log");
    const output = fs.openSync(logPath, "a");
    const argumentsList = [launcher, "--name", name, "--manifest", manifestPath, "--log", logPath];
    if (options.workspace) argumentsList.push("--workspace", path.resolve(options.workspace));
    if (options.port) argumentsList.push("--port", options.port);
    const child = spawn(process.execPath, argumentsList, {
        cwd: repo,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", output, output],
    });
    child.unref();
    fs.closeSync(output);
    const manifest = await waitForManifest(manifestPath, child.pid);
    console.log(JSON.stringify({ manifest: manifestPath, log: logPath, pid: child.pid, url: manifest.base, workspace: manifest.workspace }));
}

async function stop(options) {
    if (!options.manifest) throw new Error("stop 需要 --manifest");
    const { path: manifestPath, manifest } = readManifest(options.manifest);
    if (manifest.status === "stopped") {
        console.log("会话已经停止：" + manifestPath);
        return;
    }
    if (!isAlive(manifest.ownerPid) && !isAlive(manifest.kernelPid)) {
        const updated = { ...manifest, status: "stopped", stoppedAt: new Date().toISOString() };
        writeManifest(manifestPath, updated);
        console.log("会话进程已退出，已安全收口：" + manifestPath);
        return;
    }
    if (!manifest.base || !manifest.port) throw new Error("manifest 尚未进入可停止状态");
    const confPath = path.join(manifest.workspace, "conf", "conf.json");
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
    const headers = { "Content-Type": "application/json" };
    if (conf.accessAuthCode) headers.Authorization = "Token " + conf.accessAuthCode;
    const response = await fetch(manifest.base + "/api/system/exit", {
        method: "POST",
        headers,
        body: JSON.stringify({ force: true }),
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("停止内核失败，HTTP " + response.status);
    const payload = await response.json().catch(() => ({}));
    if (payload.code !== 0) throw new Error("停止内核失败，code=" + payload.code + " msg=" + (payload.msg || "未知错误"));
    if (isAlive(manifest.ownerPid)) process.kill(manifest.ownerPid, "SIGTERM");
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && (isAlive(manifest.ownerPid) || isAlive(manifest.kernelPid))) {
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (isAlive(manifest.ownerPid) || isAlive(manifest.kernelPid)) throw new Error("内核已请求停止，但会话进程仍在运行；保留会话供人工检查");
    const updated = { ...manifest, status: "stopped", stoppedAt: new Date().toISOString() };
    writeManifest(manifestPath, updated);
    console.log("会话已停止：" + manifestPath);
}

function status(options) {
    if (!options.manifest) throw new Error("status 需要 --manifest");
    const { manifest } = readManifest(options.manifest);
    console.log(JSON.stringify({ ...manifest, ownerAlive: isAlive(manifest.ownerPid), kernelAlive: isAlive(manifest.kernelPid) }, null, 2));
}

function list() {
    if (!fs.existsSync(sessionDir)) return;
    for (const filename of fs.readdirSync(sessionDir).filter((item) => item.endsWith(".json"))) {
        try {
            const { manifest } = readManifest(path.join(sessionDir, filename));
            console.log(JSON.stringify({ manifest: path.join(sessionDir, filename), status: manifest.status, url: manifest.base, ownerAlive: isAlive(manifest.ownerPid) }));
        } catch (error) {
            console.error("跳过无效 manifest " + filename + "：" + (error instanceof Error ? error.message : String(error)));
        }
    }
}

async function main() {
    const command = process.argv[2];
    if (!command || command === "--help") {
        usage();
        return;
    }
    const options = parseOptions(process.argv.slice(3));
    if (command === "start") return start(options);
    if (command === "stop") return stop(options);
    if (command === "status") return status(options);
    if (command === "list") return list();
    throw new Error("未知命令: " + command);
}

main().catch((error) => {
    console.error("E2E SESSION ERROR:", error instanceof Error ? error.message : String(error));
    process.exit(2);
});

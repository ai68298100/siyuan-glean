/* 隔离内核 harness（M0 spike / 后续 E2E 共用）。
   安全纪律：独立临时工作区 + 标记文件 + 回环地址 + 端口占用预检，绝不触碰用户真实笔记。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";

export function resolveKernel() {
    const candidates = [
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    const appDir = path.resolve(path.dirname(kernel), "..");
    for (const required of ["stage", "appearance"]) {
        if (!fs.existsSync(path.join(appDir, required))) throw new Error(`app 目录缺少 ${required}: ${appDir}`);
    }
    return { kernel, appDir };
}

/** 隔离工作区准备：必须带本 spike 专属标记，拒绝复用任何非测试目录 */
export function prepareWorkspace(workspace, marker, createdBy) {
    const resolved = path.resolve(workspace);
    const relRepo = path.relative(resolved, process.cwd());
    const repoOutside = relRepo === ".." || relRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relRepo);
    if (resolved === path.parse(resolved).root || path.relative(os.homedir(), resolved) === "" || !repoOutside) {
        throw new Error(`拒绝使用宽泛或项目目录作为测试工作区: ${resolved}`);
    }
    if (fs.existsSync(resolved)) {
        let metadata;
        try {
            metadata = JSON.parse(fs.readFileSync(path.join(resolved, marker), "utf8"));
        } catch {
            throw new Error(`拒绝使用非测试工作区，标记缺失或损坏: ${resolved}`);
        }
        if (metadata?.createdBy !== createdBy) throw new Error(`测试工作区标记不匹配: ${resolved}`);
        return;
    }
    fs.mkdirSync(path.join(resolved, "data"), { recursive: true });
    fs.writeFileSync(path.join(resolved, marker), JSON.stringify({ createdBy, createdIso: new Date().toISOString() }) + "\n");
}

export function assertTestPortAvailable(host, port) {
    if (!["127.0.0.1", "::1"].includes(host)) return Promise.reject(new Error("测试内核只允许回环地址"));
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", (error) => reject(new Error(`测试端口 ${port} 不可用: ${error.code}`)));
        server.listen({ host, port, exclusive: true }, () => server.close((error) => (error ? reject(error) : resolve())));
    });
}

export function startKernel(kernel, appDir, workspace, port) {
    const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    const lines = [];
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => {
                if (line) {
                    lines.push(line);
                    if (lines.length > 2000) lines.shift();
                }
            });
        });
    }
    return { child, lines };
}

export function createApiClient(baseUrl) {
    let token = "";
    let assertKernelRunning;
    const api = async (route, body = {}) => {
        assertKernelRunning?.();
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Token ${token}`;
        const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        const text = await response.text();
        assertKernelRunning?.();
        let payload;
        try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`${route} 非 JSON 响应: ${text.slice(0, 200)}`); }
        return payload;
    };
    const apiChecked = async (route, body = {}) => {
        const payload = await api(route, body);
        if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
        return payload.data;
    };
    return {
        api,
        apiChecked,
        setToken: (value) => { token = value; },
        onGuard: (fn) => { assertKernelRunning = fn; },
    };
}

export function newNodeID() {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) rand += charset[Math.floor(Math.random() * charset.length)];
    return `${stamp}-${rand}`;
}

export async function waitForBoot(baseUrl, lines, assertRunning, client) {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) {
            throw new Error(`工作区被锁定：有残留内核。请先结束该进程。`);
        }
        const progress = await client.api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) {
            return client.apiChecked("/api/system/version");
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时。日志尾部:\n${lines.slice(-25).join("\n")}`);
}

export async function shutdownKernel(client, child) {
    if (child.exitCode === null && child.signalCode === null) {
        await client.api("/api/system/exit", { force: true }).catch(() => undefined);
    }
    const exited = await Promise.race([
        new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true)))),
        new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
    if (!exited) child.kill("SIGKILL");
}

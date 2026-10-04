import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CREATED_BY = "siyuan-glean-acceptance-session";
const DEFAULT_ROOT = path.join(os.tmpdir(), "siyuan-glean-acceptance-sessions");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const CLOSED_STATUSES = new Set(["passed", "failed", "blocked", "skipped"]);
const ACTIVE_STATUSES = new Set(["planned", "running"]);

export const SESSION_KINDS = {
    "isolated-kernel": { evidenceClass: "service-e2e", requiresDevice: false },
    "desktop-host": { evidenceClass: "desktop-host", requiresDevice: true },
    "android-device": { evidenceClass: "real-device", requiresDevice: true, realDevice: true },
    "ios-device": { evidenceClass: "real-device", requiresDevice: true, realDevice: true },
    "android-emulator": { evidenceClass: "emulator", requiresDevice: true },
    "ios-simulator": { evidenceClass: "emulator", requiresDevice: true },
    ai: { evidenceClass: "real-model", requiresDevice: false },
    "external-file": { evidenceClass: "external-file", requiresDevice: false },
    "dual-plugin": { evidenceClass: "dual-plugin", requiresDevice: true },
};

function safeName(value) {
    const normalized = String(value || "session")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized.slice(0, 64) || "session";
}

function values(options, key) {
    return options[key] || [];
}

function one(options, key) {
    return values(options, key).at(-1);
}

function parseBoolean(value, key) {
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`--${key} 必须是 true 或 false`);
}

function parsePort(value) {
    if (value === undefined || value === "") return null;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port 必须是 1-65535");
    return port;
}

function absoluteOptional(value) {
    return value ? path.resolve(value) : null;
}

function parseArgs(argumentList) {
    const options = {};
    for (let index = 0; index < argumentList.length; index += 1) {
        const argument = argumentList[index];
        if (!argument.startsWith("--")) throw new Error("未知参数: " + argument);
        const key = argument.slice(2);
        const value = argumentList[index + 1];
        if (!value || value.startsWith("--")) throw new Error("参数缺少值: --" + key);
        (options[key] ||= []).push(value);
        index += 1;
    }
    return options;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = filePath + ".tmp-" + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(temporary, filePath);
}

function sessionPath(value) {
    if (!value) throw new Error("需要 --session");
    return path.resolve(value);
}

function readSession(filePath) {
    const resolved = sessionPath(filePath);
    const session = readJson(resolved);
    validateSessionRecord(session);
    return { path: resolved, session };
}

function packageVersion() {
    try {
        return readJson(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json")).version || null;
    } catch {
        return null;
    }
}

export function validateSessionRecord(session) {
    if (!session || session.createdBy !== CREATED_BY || session.version !== 1) {
        throw new Error("验收会话账本格式或创建者不匹配");
    }
    const kind = SESSION_KINDS[session.kind];
    if (!kind) throw new Error("未知验收会话类型: " + session.kind);
    if (!ACTIVE_STATUSES.has(session.status) && !CLOSED_STATUSES.has(session.status)) {
        throw new Error("未知验收会话状态: " + session.status);
    }
    if (kind.requiresDevice && !String(session.device || "").trim()) {
        throw new Error(`${session.kind} 会话必须记录 device`);
    }
    if (session.workspace !== null && session.workspace !== undefined && !path.isAbsolute(session.workspace)) {
        throw new Error("workspace 必须是绝对路径");
    }
    if (session.host !== null && session.host !== undefined && !LOOPBACK_HOSTS.has(session.host)) {
        throw new Error("验收会话 host 只能是回环地址");
    }
    if (session.port !== null && session.port !== undefined && (!Number.isInteger(session.port) || session.port < 1 || session.port > 65535)) {
        throw new Error("验收会话 port 不合法");
    }
    if (!Array.isArray(session.evidence) || !Array.isArray(session.failedItems) || !Array.isArray(session.notes)) {
        throw new Error("验收会话 evidence/failedItems/notes 必须是数组");
    }
    return true;
}

function assertCanClose(session, status) {
    if (!CLOSED_STATUSES.has(status)) throw new Error("关闭状态必须是 passed、failed、blocked 或 skipped");
    if (status !== "passed") return;
    if (session.evidence.length === 0) throw new Error("没有证据文件或记录，不能登记 passed");
    const missingEvidence = session.evidence.filter((filePath) => !fs.existsSync(filePath));
    if (missingEvidence.length > 0) throw new Error("证据文件不存在，不能登记 passed: " + missingEvidence.join(", "));
    const kind = SESSION_KINDS[session.kind];
    if (kind.realDevice && session.realDeviceConfirmed !== true) {
        throw new Error("真实设备会话必须先记录 --real-device-confirmed true");
    }
    if (session.kind === "desktop-host" && session.hostConfirmed !== true) {
        throw new Error("桌面宿主会话必须先记录 --host-confirmed true");
    }
    if (session.kind === "dual-plugin" && session.dualPluginConfirmed !== true) {
        throw new Error("双插件会话必须先记录 --dual-plugin-confirmed true");
    }
    if (session.failedItems.length > 0) throw new Error("仍有 failedItems，不能登记 passed");
}

function usage() {
    console.log("node scripts/e2e/acceptance-session.mjs create --kind kind --name name [--device device] [--root path]");
    console.log("node scripts/e2e/acceptance-session.mjs link --session path --manifest e2e-manifest");
    console.log("node scripts/e2e/acceptance-session.mjs record --session path [--status running] [--evidence path] [--failed item] [--note text]");
    console.log("node scripts/e2e/acceptance-session.mjs close --session path --status passed|failed|blocked|skipped [--evidence path]");
    console.log("node scripts/e2e/acceptance-session.mjs status --session path");
    console.log("node scripts/e2e/acceptance-session.mjs list [--root path]");
}

function create(options) {
    const kindName = one(options, "kind");
    const kind = SESSION_KINDS[kindName];
    if (!kind) throw new Error("create 需要受支持的 --kind: " + Object.keys(SESSION_KINDS).join(", "));
    const name = safeName(one(options, "name") || kindName + "-" + Date.now());
    const root = path.resolve(one(options, "root") || DEFAULT_ROOT);
    const createdAt = new Date().toISOString();
    const session = {
        version: 1,
        createdBy: CREATED_BY,
        id: name + "-" + Date.now() + "-" + process.pid,
        name,
        kind: kindName,
        evidenceClass: kind.evidenceClass,
        status: "planned",
        device: one(options, "device") || null,
        workspace: absoluteOptional(one(options, "workspace")),
        host: one(options, "host") || null,
        port: parsePort(one(options, "port")),
        pluginVersion: one(options, "plugin-version") || packageVersion(),
        evidence: values(options, "evidence").map((item) => path.resolve(item)),
        failedItems: values(options, "failed"),
        notes: values(options, "note"),
        realDeviceConfirmed: false,
        hostConfirmed: false,
        dualPluginConfirmed: false,
        runtime: null,
        createdAt,
        updatedAt: createdAt,
        closedAt: null,
    };
    validateSessionRecord(session);
    const filePath = path.join(root, name + "-" + Date.now() + "-" + process.pid + ".json");
    writeJson(filePath, session);
    console.log(JSON.stringify({ session: filePath, ...session }, null, 2));
}

function link(options) {
    const { path: sessionFile, session } = readSession(one(options, "session"));
    const manifestFile = path.resolve(one(options, "manifest"));
    const manifest = readJson(manifestFile);
    if (manifest.createdBy !== "siyuan-glean-e2e-session" || manifest.version !== 1) {
        throw new Error("E2E manifest 创建者或版本不匹配");
    }
    if (manifest.host && !LOOPBACK_HOSTS.has(manifest.host)) throw new Error("E2E manifest host 不是回环地址");
    if (manifest.workspace && !path.isAbsolute(manifest.workspace)) throw new Error("E2E manifest workspace 必须是绝对路径");
    const now = new Date().toISOString();
    const updated = {
        ...session,
        status: manifest.status === "ready" ? "running" : session.status,
        workspace: manifest.workspace || session.workspace,
        host: manifest.host || session.host,
        port: manifest.port || session.port,
        pluginVersion: session.pluginVersion || manifest.pluginVersion || packageVersion(),
        evidence: [...new Set([...session.evidence, manifestFile])],
        runtime: {
            ...(session.runtime || {}),
            e2eManifest: manifestFile,
            kernelVersion: manifest.kernelVersion || null,
            notebookId: manifest.notebookId || null,
            ownerPid: manifest.ownerPid || null,
            kernelPid: manifest.kernelPid || null,
        },
        updatedAt: now,
    };
    validateSessionRecord(updated);
    writeJson(sessionFile, updated);
    console.log(JSON.stringify({ session: sessionFile, linkedManifest: manifestFile, ...updated }, null, 2));
}

function record(options, close = false) {
    const { path: sessionFile, session } = readSession(one(options, "session"));
    const status = one(options, "status");
    if (status) {
        if (!close && !ACTIVE_STATUSES.has(status)) throw new Error("record 只允许 planned 或 running");
    }
    const next = {
        ...session,
        status: status || session.status,
        device: one(options, "device") || session.device,
        workspace: absoluteOptional(one(options, "workspace")) || session.workspace,
        host: one(options, "host") || session.host,
        port: parsePort(one(options, "port")) || session.port,
        evidence: [...new Set([...session.evidence, ...values(options, "evidence").map((item) => path.resolve(item))])],
        failedItems: [...session.failedItems, ...values(options, "failed")],
        notes: [...session.notes, ...values(options, "note")],
        realDeviceConfirmed: parseBoolean(one(options, "real-device-confirmed"), "real-device-confirmed") ?? session.realDeviceConfirmed,
        hostConfirmed: parseBoolean(one(options, "host-confirmed"), "host-confirmed") ?? session.hostConfirmed,
        dualPluginConfirmed: parseBoolean(one(options, "dual-plugin-confirmed"), "dual-plugin-confirmed") ?? session.dualPluginConfirmed,
        updatedAt: new Date().toISOString(),
        closedAt: close ? new Date().toISOString() : session.closedAt,
    };
    validateSessionRecord(next);
    if (close) assertCanClose(next, next.status);
    writeJson(sessionFile, next);
    console.log(JSON.stringify({ session: sessionFile, ...next }, null, 2));
}

function status(options) {
    const { path: sessionFile, session } = readSession(one(options, "session"));
    console.log(JSON.stringify({ session: sessionFile, ...session }, null, 2));
}

function list(options) {
    const root = path.resolve(one(options, "root") || DEFAULT_ROOT);
    if (!fs.existsSync(root)) return;
    for (const filename of fs.readdirSync(root).filter((item) => item.endsWith(".json"))) {
        const filePath = path.join(root, filename);
        try {
            const session = readJson(filePath);
            validateSessionRecord(session);
            console.log(JSON.stringify({ session: filePath, id: session.id, name: session.name, kind: session.kind, status: session.status }));
        } catch (error) {
            console.error("跳过无效验收账本 " + filename + "：" + (error instanceof Error ? error.message : String(error)));
        }
    }
}

export async function main(argv = process.argv.slice(2)) {
    const command = argv[0];
    if (!command || command === "--help") {
        usage();
        return;
    }
    const options = parseArgs(argv.slice(1));
    if (command === "create") return create(options);
    if (command === "link") return link(options);
    if (command === "record") return record(options);
    if (command === "close") return record(options, true);
    if (command === "status") return status(options);
    if (command === "list") return list(options);
    throw new Error("未知命令: " + command);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error("ACCEPTANCE SESSION ERROR:", error instanceof Error ? error.message : String(error));
        process.exit(2);
    });
}

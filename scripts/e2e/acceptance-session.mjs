import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isSupportedE2EManifest, isValidPluginName, resolvePluginBundle } from "./plugin-identity.mjs";

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
    session.checks ??= [];
    session.resolvedItems ??= [];
    validateSessionRecord(session);
    return { path: resolved, session };
}

function mutateSession(filePath, update) {
    const resolved = path.resolve(filePath);
    const lockPath = resolved + ".lock";
    let lock;
    try {
        lock = fs.openSync(lockPath, "wx");
    } catch (error) {
        if (error.code === "EEXIST") throw new Error("验收会话正在被修改，请重试");
        throw error;
    }
    try {
        const { session } = readSession(resolved);
        if (!ACTIVE_STATUSES.has(session.status)) throw new Error("会话已关闭，复测请新建会话");
        const updated = update(session, resolved);
        updated.updatedAt = new Date().toISOString();
        validateSessionRecord(updated);
        writeJson(resolved, updated);
        return { path: resolved, session: updated };
    } finally {
        fs.closeSync(lock);
        fs.rmSync(lockPath, { force: true });
    }
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
    if (session.pluginName !== null && session.pluginName !== undefined && !isValidPluginName(session.pluginName)) {
        throw new Error("pluginName 不是合法插件名");
    }
    if (session.host !== null && session.host !== undefined && !LOOPBACK_HOSTS.has(session.host)) {
        throw new Error("验收会话 host 只能是回环地址");
    }
    if (session.port !== null && session.port !== undefined && (!Number.isInteger(session.port) || session.port < 1 || session.port > 65535)) {
        throw new Error("验收会话 port 不合法");
    }
    if (!Array.isArray(session.evidence) || !Array.isArray(session.failedItems) || !Array.isArray(session.notes) || !Array.isArray(session.checks) || !Array.isArray(session.resolvedItems)) {
        throw new Error("验收会话 evidence/failedItems/notes/checks/resolvedItems 必须是数组");
    }
    for (const check of session.checks) {
        if (!check?.id || !CLOSED_STATUSES.has(check.status) || !Array.isArray(check.evidence)) throw new Error("逐项验收记录不合法");
        if (check.status === "passed" && check.evidence.length === 0) throw new Error("通过项必须记录证据");
        for (const evidence of check.evidence) {
            if (!evidence?.path || !path.isAbsolute(evidence.path) || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error("逐项证据路径或哈希不合法");
        }
    }
    return true;
}

function evidenceRecord(filePath, sessionPath, session) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error("证据文件不存在或不是普通文件: " + resolved);
    if (resolved === sessionPath || resolved === session.runtime?.e2eManifest) throw new Error("账本和运行 manifest 不能直接作为逐项验收证据");
    return {
        path: resolved,
        sha256: createHash("sha256").update(fs.readFileSync(resolved)).digest("hex"),
    };
}

function assertCanClose(session, status, sessionPath) {
    if (!CLOSED_STATUSES.has(status)) throw new Error("关闭状态必须是 passed、failed、blocked 或 skipped");
    if (status !== "passed") return;
    if (session.checks.length === 0) throw new Error("没有逐项验收结果，不能登记 passed");
    const latest = new Map(session.checks.map((check) => [check.id, check]));
    if ([...latest.values()].some((check) => check.status !== "passed")) throw new Error("仍有未通过验收项，不能登记 passed");
    for (const check of latest.values()) {
        for (const evidence of check.evidence) {
            const current = evidenceRecord(evidence.path, sessionPath, session);
            if (current.sha256 !== evidence.sha256) throw new Error("证据文件已变化，必须重新验收: " + evidence.path);
        }
    }
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
    console.log("node scripts/e2e/acceptance-session.mjs create --kind kind --name name [--plugin-dir path|--plugin-name name] [--device device] [--root path]");
    console.log("node scripts/e2e/acceptance-session.mjs link --session path --manifest e2e-manifest");
    console.log("node scripts/e2e/acceptance-session.mjs record --session path --case case-id --result passed|failed|blocked|skipped --evidence path");
    console.log("node scripts/e2e/acceptance-session.mjs report --session path --report spike-results.json");
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
    const plugin = one(options, "plugin-dir") ? resolvePluginBundle(one(options, "plugin-dir")) : null;
    const createdAt = new Date().toISOString();
    const session = {
        version: 1,
        createdBy: CREATED_BY,
        id: name + "-" + Date.now() + "-" + process.pid,
        name,
        kind: kindName,
        evidenceClass: kind.evidenceClass,
        pluginName: one(options, "plugin-name") || plugin?.name || null,
        status: "planned",
        device: one(options, "device") || null,
        workspace: absoluteOptional(one(options, "workspace")),
        host: one(options, "host") || null,
        port: parsePort(one(options, "port")),
        pluginVersion: one(options, "plugin-version") || plugin?.version || packageVersion(),
        evidence: values(options, "evidence").map((item) => path.resolve(item)),
        failedItems: values(options, "failed"),
        resolvedItems: [],
        notes: values(options, "note"),
        checks: [],
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
    return { session: filePath, ...session };
}

function link(options) {
    const manifestFile = path.resolve(one(options, "manifest"));
    const manifest = readJson(manifestFile);
    if (!isSupportedE2EManifest(manifest)) {
        throw new Error("E2E manifest 创建者或版本不匹配");
    }
    if (manifest.pluginName && !isValidPluginName(manifest.pluginName)) throw new Error("E2E manifest pluginName 不合法");
    if (manifest.host && !LOOPBACK_HOSTS.has(manifest.host)) throw new Error("E2E manifest host 不是回环地址");
    if (manifest.workspace && !path.isAbsolute(manifest.workspace)) throw new Error("E2E manifest workspace 必须是绝对路径");
    const sessionFile = one(options, "session");
    const result = mutateSession(sessionFile, (session) => {
        if (session.pluginName && manifest.pluginName && session.pluginName !== manifest.pluginName) throw new Error("E2E manifest 插件与验收会话不匹配");
        if (session.pluginVersion && manifest.pluginVersion && session.pluginVersion !== manifest.pluginVersion) throw new Error("E2E manifest 版本与验收会话不匹配");
        const updated = {
            ...session,
            status: manifest.status === "ready" ? "running" : session.status,
            workspace: manifest.workspace || session.workspace,
            host: manifest.host || session.host,
            port: manifest.port || session.port,
            pluginName: session.pluginName || manifest.pluginName || null,
            pluginVersion: session.pluginVersion || manifest.pluginVersion || packageVersion(),
            evidence: [...new Set([...session.evidence, manifestFile])],
            runtime: {
                ...(session.runtime || {}),
                e2eManifest: manifestFile,
                kernelVersion: manifest.kernelVersion || null,
                notebookId: manifest.notebookId || null,
                ownerPid: manifest.ownerPid || null,
                kernelPid: manifest.kernelPid || null,
                pluginDir: manifest.pluginDir || null,
            },
        };
        return updated;
    });
    return { session: result.path, linkedManifest: manifestFile, ...result.session };
}

function record(options, close = false) {
    const status = one(options, "status");
    if (status) {
        if (!close && !ACTIVE_STATUSES.has(status)) throw new Error("record 只允许 planned 或 running");
    }
    const caseId = one(options, "case");
    const result = one(options, "result");
    if (Boolean(caseId) !== Boolean(result) || (result && !CLOSED_STATUSES.has(result))) throw new Error("--case 和合法 --result 必须同时提供");
    const sessionFile = path.resolve(one(options, "session"));
    const resultRecord = mutateSession(sessionFile, (session) => {
        const next = {
            ...session,
            status: status || session.status,
            device: one(options, "device") || session.device,
            workspace: absoluteOptional(one(options, "workspace")) || session.workspace,
            host: one(options, "host") || session.host,
            port: parsePort(one(options, "port")) || session.port,
            evidence: [...new Set([...session.evidence, ...values(options, "evidence").map((item) => path.resolve(item))])],
            failedItems: [...new Set([...session.failedItems, ...values(options, "failed")])],
            notes: [...session.notes, ...values(options, "note")],
            checks: [...session.checks],
            resolvedItems: [...session.resolvedItems],
            realDeviceConfirmed: parseBoolean(one(options, "real-device-confirmed"), "real-device-confirmed") ?? session.realDeviceConfirmed,
            hostConfirmed: parseBoolean(one(options, "host-confirmed"), "host-confirmed") ?? session.hostConfirmed,
            dualPluginConfirmed: parseBoolean(one(options, "dual-plugin-confirmed"), "dual-plugin-confirmed") ?? session.dualPluginConfirmed,
            closedAt: close ? new Date().toISOString() : session.closedAt,
        };
        if (caseId) {
            const evidence = values(options, "evidence").map((item) => evidenceRecord(item, sessionFile, next));
            next.checks.push({ id: caseId, status: result, evidence, at: new Date().toISOString() });
        }
        const resolved = values(options, "resolve-failed");
        if (resolved.length) {
            if (result !== "passed" || values(options, "note").length === 0) throw new Error("解决失败项必须同时记录通过复测与 --note");
            if (resolved.some((item) => !next.failedItems.includes(item))) throw new Error("待解决失败项不在会话中");
            next.failedItems = next.failedItems.filter((item) => !resolved.includes(item));
            next.resolvedItems.push(...resolved);
        }
        if (close) assertCanClose(next, next.status, sessionFile);
        return next;
    });
    return { session: resultRecord.path, ...resultRecord.session };
}

function status(options) {
    const { path: sessionFile, session } = readSession(one(options, "session"));
    return { session: sessionFile, ...session };
}

function report(options) {
    const reportPath = path.resolve(one(options, "report"));
    const report = readJson(reportPath);
    if (!Array.isArray(report.results) || report.results.length === 0 || report.results.some((item) => !item?.name || typeof item.ok !== "boolean")) {
        throw new Error("报告必须包含非空逐项布尔 results");
    }
    if (report.results.some((item, index, all) => all.findIndex((other) => other.name === item.name) !== index)) throw new Error("报告验收项编号重复");
    const result = mutateSession(one(options, "session"), (session, sessionFile) => {
        if (session.kind !== "isolated-kernel") throw new Error("服务报告只允许导入隔离内核会话");
        if (!report.workspace || !path.isAbsolute(report.workspace) || !LOOPBACK_HOSTS.has(report.host)) throw new Error("报告缺少隔离工作区或回环 host");
        if (session.workspace && path.resolve(session.workspace) !== path.resolve(report.workspace)) throw new Error("报告工作区与会话不匹配");
        if (session.host && session.host !== report.host || session.port && session.port !== report.port) throw new Error("报告端口与会话不匹配");
        if (report.pluginVersion && report.pluginVersion !== session.pluginVersion) throw new Error("报告插件版本与会话不匹配");
        if (session.checks.some((check) => report.results.some((item) => item.name === check.id))) throw new Error("报告验收项已存在，复测请新建会话");
        const evidence = evidenceRecord(reportPath, sessionFile, session);
        return {
            ...session,
            status: "running",
            workspace: report.workspace,
            host: report.host,
            port: report.port,
            evidence: [...new Set([...session.evidence, reportPath])],
            checks: [...session.checks, ...report.results.map((item) => ({ id: item.name, status: item.ok ? "passed" : "failed", evidence: [evidence], at: new Date().toISOString() }))],
            runtime: { ...session.runtime, kernelVersion: report.kernelVersion || null },
        };
    });
    return { session: result.path, report: reportPath, ...result.session };
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
    let result;
    if (command === "create") result = create(options);
    else if (command === "link") result = link(options);
    else if (command === "record") result = record(options);
    else if (command === "close") result = record(options, true);
    else if (command === "report") result = report(options);
    else if (command === "status") result = status(options);
    else if (command === "list") result = list(options);
    else throw new Error("未知命令: " + command);
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
    return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error("ACCEPTANCE SESSION ERROR:", error instanceof Error ? error.message : String(error));
        process.exit(2);
    });
}

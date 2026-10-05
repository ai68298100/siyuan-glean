/*
 * Shared guardrails for write-type SiYuan smoke/E2E scripts.
 *
 * A write smoke must run against an isolated kernel.  The helper deliberately
 * does not know anything about a plugin's data model: it only discovers the
 * target, authenticates requests, removes this project's old scratch
 * notebooks, and refuses a shared workspace before any test data is written.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Notebook prefixes owned by this repository.  Keep old prefixes here so a
 * crashed run from an earlier revision is still cleaned on the next run.
 * New scripts should use `siyuan-glean-smoke-*` (or a more specific prefix
 * beginning with `siyuan-glean-`).
 */
export const SCRATCH_PREFIXES = Object.freeze([
    "siyuan-glean-smoke-",
    "siyuan-glean-s1-",
    "siyuan-glean-av-",
    "siyuan-glean-t3220-",
    "siyuan-glean-outline-",
    "siyuan-glean-av-projection-",
    "siyuan-glean-flashcard-",
    "siyuan-glean-backup-",
    "siyuan-glean-library-",
    "siyuan-glean-e2e-",
    "GleanS1Flow",
    "GleanSpike",
    "GleanAV",
    "GleanOutline",
    "GleanT3220",
    "GleanE2E",
    "GleanAvProjectionFlow",
    "GleanFlashcardFlow",
    "GleanBackupFlow",
    "GleanLibraryFlow",
]);

export function isScratchName(name, prefixes = SCRATCH_PREFIXES) {
    const value = String(name ?? "");
    return prefixes.some((prefix) => value.startsWith(prefix));
}

export function parseTargetArgs(argv = []) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument.startsWith("--")) continue;
        const key = argument.slice(2);
        if (!["base-url", "token"].includes(key)) continue;
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`参数缺少值: --${key}`);
        options[key] = value;
        index += 1;
    }
    return options;
}

function normaliseBase(value) {
    const base = String(value ?? "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("缺少思源内核地址：请传入 --base-url 或设置 SIYUAN_BASE_URL");
    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        throw new Error(`思源内核地址无效：${base}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("思源内核地址必须使用 http 或 https");
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
        throw new Error(`写型冒烟只允许回环地址，当前目标为 ${parsed.hostname}；请使用隔离靶场实例`);
    }
    return base;
}

/** Resolve argv > environment.  No token is ever invented by this module. */
export function resolveTarget({ argv = [], baseArg, tokenArg, env = process.env, requireToken = true } = {}) {
    const parsed = parseTargetArgs(argv);
    const base = normaliseBase(baseArg ?? parsed["base-url"] ?? env.SIYUAN_BASE_URL ?? "http://127.0.0.1:6806");
    const token = String(tokenArg ?? parsed.token ?? env.SIYUAN_TOKEN ?? "").trim();
    if (requireToken && !token) {
        throw new Error("缺少思源 token：请传入 --token 或设置 SIYUAN_TOKEN；不会使用默认 token");
    }
    return { base, token };
}

export function makeApi(base, token, { timeoutMs = 20000 } = {}) {
    const target = normaliseBase(base);
    const auth = String(token ?? "").trim();
    return async function api(route, body = {}) {
        const response = await fetch(`${target}${route}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Token ${auth}` } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let payload;
        try { payload = text ? JSON.parse(text) : {}; }
        catch { throw new Error(`${route} 返回非 JSON 响应：${text.slice(0, 200)}`); }
        if (!response.ok) throw new Error(`${route} HTTP ${response.status}`);
        return payload;
    };
}

export async function apiChecked(api, route, body = {}) {
    const payload = await api(route, body);
    if (payload?.code !== 0) throw new Error(`${route} code=${payload?.code} msg=${payload?.msg || "未知错误"}`);
    return payload.data;
}

export async function listNotebooks(api) {
    const data = await apiChecked(api, "/api/notebook/lsNotebooks", {});
    return Array.isArray(data) ? data : (data?.notebooks ?? []);
}

/** Remove only notebooks whose names match this repository's registered prefixes. */
export async function sweepOrphans(api, { prefixes = SCRATCH_PREFIXES, log = console.log } = {}) {
    const notebooks = await listNotebooks(api);
    const orphans = notebooks.filter((notebook) => isScratchName(notebook.name, prefixes));
    for (const notebook of orphans) {
        await apiChecked(api, "/api/notebook/removeNotebook", { notebook: notebook.id });
        if (typeof log === "function") log(`  清扫残留临时库：${notebook.name}`);
    }
    return orphans;
}

/**
 * Remove this project's temporary notebooks at the end of a successful or
 * failed write smoke.  Unlike startup sweeping, cleanup is strict: a delete
 * failure is surfaced so the caller cannot report a green run while leaving
 * test data behind.
 */
export async function cleanupScratch(api, { prefixes = SCRATCH_PREFIXES, log = console.log } = {}) {
    const notebooks = await listNotebooks(api);
    const owned = notebooks.filter((notebook) => isScratchName(notebook.name, prefixes));
    for (const notebook of owned) {
        await apiChecked(api, "/api/notebook/removeNotebook", { notebook: notebook.id });
        if (typeof log === "function") log(`  清理本次临时库：${notebook.name}`);
    }
    return owned;
}

/** Refuse to write when a target contains a notebook outside our prefix registry. */
export async function guardScratch(api, { base = "目标内核", prefixes = SCRATCH_PREFIXES, allowShared = process.env.SIYUAN_E2E_ALLOW_SHARED === "1", log = console } = {}) {
    const notebooks = await listNotebooks(api);
    const foreign = notebooks.filter((notebook) => !isScratchName(notebook.name, prefixes));
    if (!foreign.length || allowShared) {
        if (foreign.length && allowShared && typeof log?.warn === "function") log.warn(`⚠ SIYUAN_E2E_ALLOW_SHARED=1：已显式放行共享内核（${foreign.length} 个既有笔记本）`);
        return { foreign, allowed: true };
    }
    const example = foreign[0]?.name || "未知笔记本";
    throw new Error([
        `目标内核 ${base} 不是隔离靶场：存在 ${foreign.length} 个非本项目临时笔记本（如「${example}」）。`,
        "写型冒烟需要建删笔记本并写入文档，请使用独立 workspace 起第二个思源实例（端口建议自动顺延为 6807），只安装被测插件。",
        "如已确认风险，设置 SIYUAN_E2E_ALLOW_SHARED=1 才能显式放行。",
    ].join("\n"));
}

/** Startup sequence required by every write smoke. */
export async function prepareWriteSmoke(api, options = {}) {
    const swept = await sweepOrphans(api, options);
    const guard = await guardScratch(api, options);
    return { swept, ...guard };
}

export function isAiEnabled(env = process.env) {
    return env.SIYUAN_E2E_AI === "1";
}

/** Return false by default so checks never send article content to a model. */
export function assertAiAllowed({ env = process.env, log = console.log } = {}) {
    if (isAiEnabled(env)) return true;
    if (typeof log === "function") log("  跳过真实 AI 外发检查（设置 SIYUAN_E2E_AI=1 才启用）");
    return false;
}

export { LOOPBACK_HOSTS };

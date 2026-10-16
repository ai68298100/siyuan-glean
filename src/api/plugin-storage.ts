/** Raw private-file responses have no code=0 envelope; see DATA-CONTRACT §5.1. */
import { KernelRequestError, type KernelErrorKind } from "./client";

const GET_FILE_ROUTE = "/api/file/getFile";
export const PLUGIN_JSON_READ_TIMEOUT_MS = 10_000;

function failure(kind: KernelErrorKind, code?: number): KernelRequestError {
    return new KernelRequestError(GET_FILE_ROUTE, kind, `插件 JSON 文件读取失败（${kind}）`, code, false);
}

function safeSegments(pluginName: string, filename: string): boolean {
    return typeof pluginName === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(pluginName)
        && typeof filename === "string" && filename.length <= 128
        && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(filename) && !filename.includes("..");
}

/** Read fresh JSON; only a confirmed missing-file response becomes null. No cache fallback. */
export async function readPluginJsonFile(pluginName: string, filename: string): Promise<unknown | null> {
    if (!safeSegments(pluginName, filename)) throw failure("protocol");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(failure("timeout"));
        }, PLUGIN_JSON_READ_TIMEOUT_MS);
    });
    try {
        const request = (async () => {
            const response = await fetch(GET_FILE_ROUTE, {
                method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: `/data/storage/petal/${pluginName}/${filename}` }),
                signal: controller.signal,
            });
            const text = await response.text();
            let value: unknown;
            try { value = JSON.parse(text); }
            catch { throw failure(response.status === 401 || response.status === 403 ? "permission" : "protocol"); }
            if (response.status === 200) return value;
            const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
            if (response.status === 202 && payload?.code === 404 && payload.data === null) return null;
            const code = typeof payload?.code === "number" && Number.isFinite(payload.code) ? payload.code : undefined;
            if (response.status === 401 || response.status === 403 || (code !== undefined && [401, 403, -401, -403].includes(code))) throw failure("permission", code);
            throw failure(response.status === 202 ? "protocol" : "kernel", code);
        })();
        return await Promise.race([request, timeout]);
    } catch (error) {
        if (error instanceof KernelRequestError) throw error;
        throw failure(timedOut ? "timeout" : "network");
    } finally {
        clearTimeout(timer);
    }
}

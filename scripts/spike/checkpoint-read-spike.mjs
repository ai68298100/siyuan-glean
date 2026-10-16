/** Checkpoint read transport shapes against an explicitly selected isolated E2E kernel. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing --${name}`);
    return process.argv[index + 1];
}

async function main() {
    const manifest = JSON.parse(fs.readFileSync(option("manifest"), "utf8"));
    const workspace = path.resolve(manifest.workspace);
    const temporary = path.relative(path.resolve(os.tmpdir()), workspace);
    const base = new URL(manifest.base);
    assert.equal(manifest.createdBy, "siyuan-plugin-e2e-session");
    assert.ok(temporary && !temporary.startsWith("..") && !path.isAbsolute(temporary));
    assert.ok(["127.0.0.1", "[::1]"].includes(base.hostname));
    assert.equal(base.protocol, "http:");
    assert.equal(Number(base.port), manifest.port);
    assert.notEqual(Number(base.port), 6806);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, manifest.marker), "utf8")).createdBy, manifest.createdBy);

    const request = async (route, body, headers = {}) => {
        const response = await fetch(new URL(route, base), {
            method: "POST", headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
        });
        return { status: response.status, text: await response.text() };
    };
    // AGENTS.md requires the Bazaar trust gate before isolated plugin tests.
    const trusted = await request("/api/setting/setBazaar", { trust: true });
    assert.equal(JSON.parse(trusted.text).code, 0);
    const version = JSON.parse((await request("/api/system/version", {})).text).data;

    const storageRoot = path.join(workspace, "data", "storage", "petal");
    fs.mkdirSync(storageRoot, { recursive: true });
    const scratch = fs.mkdtempSync(path.join(storageRoot, "glean-checkpoint-read-"));
    const pluginName = path.basename(scratch);
    const fixtures = { "valid.json": '{"version":1,"probe":true}', "invalid.json": "{broken", "empty.json": "", "null.json": "null" };
    const results = [];
    try {
        for (const [filename, content] of Object.entries(fixtures)) fs.writeFileSync(path.join(scratch, filename), content);
        const getFile = (filename, headers) => request("/api/file/getFile", { path: `/data/storage/petal/${pluginName}/${filename}` }, headers);

        const missing = await getFile("missing.json");
        const missingBody = JSON.parse(missing.text);
        assert.equal(missing.status, 202);
        assert.equal(missingBody.code, 404);
        assert.equal(missingBody.data, null);
        results.push({ name: "missing", status: missing.status, code: missingBody.code, data: missingBody.data });

        const valid = await getFile("valid.json");
        assert.equal(valid.status, 200);
        assert.deepEqual(JSON.parse(valid.text), { version: 1, probe: true });
        results.push({ name: "valid", status: valid.status, value: JSON.parse(valid.text) });

        const invalid = await getFile("invalid.json");
        assert.equal(invalid.status, 200);
        assert.throws(() => JSON.parse(invalid.text));
        results.push({ name: "invalid-json", status: invalid.status, jsonValid: false });

        const empty = await getFile("empty.json");
        assert.equal(empty.status, 200);
        assert.equal(empty.text, "");
        results.push({ name: "empty-file", status: empty.status, bytes: 0 });

        const cleared = await getFile("null.json");
        assert.equal(cleared.status, 200);
        assert.equal(JSON.parse(cleared.text), null);
        results.push({ name: "json-null", status: cleared.status, value: null });

        // Deliberately invalid auth affects this read only; it does not change kernel settings.
        const denied = await getFile("valid.json", { Authorization: "Token invalid-checkpoint-read-spike" });
        assert.equal(denied.status, 401);
        const deniedBody = JSON.parse(denied.text);
        assert.equal(deniedBody.code, -1);
        results.push({ name: "permission-denied", status: denied.status, code: deniedBody.code });

        if (process.argv.includes("--adapter")) {
            registerHooks({
                resolve(specifier, context, nextResolve) {
                    if (specifier === "siyuan") return { url: "data:text/javascript,export{}", shortCircuit: true };
                    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
                    return nextResolve(specifier, context);
                },
            });
            const { readPluginJsonFile } = await import("../../src/api/plugin-storage.ts");
            const nativeFetch = globalThis.fetch;
            let deniedRead = false;
            try {
                // Node needs an absolute origin; all production request options remain intact.
                globalThis.fetch = (route, options) => {
                    assert.equal(route, "/api/file/getFile");
                    const headers = new Headers(options.headers);
                    if (deniedRead) headers.set("Authorization", "Token invalid-checkpoint-read-spike");
                    return nativeFetch(new URL(route, base), { ...options, headers });
                };
                assert.equal(await readPluginJsonFile(pluginName, "missing.json"), null);
                assert.deepEqual(await readPluginJsonFile(pluginName, "valid.json"), { version: 1, probe: true });
                assert.equal(await readPluginJsonFile(pluginName, "null.json"), null);
                await assert.rejects(readPluginJsonFile(pluginName, "invalid.json"), { kind: "protocol" });
                await assert.rejects(readPluginJsonFile(pluginName, "empty.json"), { kind: "protocol" });
                deniedRead = true;
                await assert.rejects(readPluginJsonFile(pluginName, "valid.json"), { kind: "permission" });
                results.push({ name: "production-adapter", cases: 6, passed: true });
            } finally {
                globalThis.fetch = nativeFetch;
            }
        }

        const reportPath = path.join(workspace, "checkpoint-read-report.json");
        fs.writeFileSync(reportPath, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), kernelVersion: version, base: base.origin, workspace, results }, null, 2) + "\n");
        console.log(JSON.stringify({ reportPath, kernelVersion: version, results }));
    } finally {
        // Only the exact files created in this fresh namespace are removed.
        for (const filename of Object.keys(fixtures)) fs.unlinkSync(path.join(scratch, filename));
        fs.rmdirSync(scratch);
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { resolveKernel, prepareWorkspace, assertTestPortAvailable, startKernel, createApiClient, waitForBoot, shutdownKernel } from "./kernel-harness.mjs";
import { cleanupScratch, prepareWriteSmoke, resolveTarget } from "../lib/smoke-kernel.mjs";

const workspace = path.join(os.tmpdir(), `siyuan-glean-outline-${Date.now()}-${process.pid}`);
const expected = ["首章", "二章", "嵌套标题", "末章"];
function optionValue(name) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数缺少值: --${name}`);
    return value;
}

const baseOverride = optionValue("base-url") || process.env.SIYUAN_BASE_URL || "";
const tokenOverride = optionValue("token");

async function main() {
    let port;
    let lifecycle = { child: null, lines: [] };
    let base;
    let token;
    if (baseOverride) {
        fs.mkdirSync(workspace, { recursive: true });
        const target = resolveTarget({ baseArg: baseOverride, tokenArg: tokenOverride });
        base = target.base;
        token = target.token;
        port = Number(new URL(base).port || 0);
    } else {
        prepareWorkspace(workspace, "glean-outline-spike.json", "siyuan-glean-outline-spike");
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const candidate = 30000 + Math.floor(Math.random() * 25000);
            try { await assertTestPortAvailable("127.0.0.1", candidate); port = candidate; break; }
            catch (error) { if (attempt === 29) throw error; }
        }
        const { kernel, appDir } = resolveKernel();
        lifecycle = startKernel(kernel, appDir, workspace, port);
        base = `http://127.0.0.1:${port}`;
    }
    const client = createApiClient(base);
    const guard = () => {
        if (lifecycle.child && (lifecycle.child.exitCode !== null || lifecycle.child.signalCode !== null)) throw new Error("大纲测试内核已退出");
    };
    client.onGuard(guard);
    try {
        const version = baseOverride ? await client.apiChecked("/api/system/version", {}) : await waitForBoot(base, lifecycle.lines, guard, client);
        if (!baseOverride) {
            const conf = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8"));
            token = tokenOverride || process.env.SIYUAN_TOKEN || conf.accessAuthCode || "";
            if (!token) throw new Error("隔离内核未生成 token；请传入 --token 或设置 SIYUAN_TOKEN");
        }
        client.setToken(token);
        await prepareWriteSmoke((route, body) => client.api(route, body), { base, log: console });
        await client.apiChecked("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        const name = `siyuan-glean-outline-${process.pid}`;
        await client.apiChecked("/api/notebook/createNotebook", { name });
        const boxes = await client.apiChecked("/api/notebook/lsNotebooks", {});
        const box = boxes.notebooks.find((item) => item.name === name)?.id;
        assert.match(box, /^\d{14}-[0-9a-z]{7}$/);
        const docId = await client.apiChecked("/api/filetree/createDocWithMd", {
            notebook: box, path: "/outline-order",
            markdown: "# 首章\n\n## 二章\n\n> ### 嵌套标题\n>\n> 嵌套正文。\n\n## 末章\n\n末尾正文。",
        });
        const children = await client.apiChecked("/api/block/getChildBlocks", { id: docId });
        assert.ok(Array.isArray(children));
        assert.deepEqual(children.filter((item) => item.type === "h").map((item) => item.content), ["首章", "二章", "末章"]);
        const quote = children.find((item) => item.type === "b");
        assert.ok(quote);
        const nested = await client.apiChecked("/api/block/getChildBlocks", { id: quote.id });
        assert.equal(nested[0].type, "h");
        assert.equal(nested[0].subType, "h3");
        assert.equal(nested[0].content, "嵌套标题");
        const report = { version, workspace, docId, rootOrder: children.map((item) => ({ id: item.id, type: item.type, content: item.content })), nestedOrder: nested, expected };
        if (process.argv.includes("--service")) {
            globalThis.__gleanOutlinePost = (...args) => client.api(...args);
            registerHooks({
                resolve(specifier, context, nextResolve) {
                    if (specifier === "siyuan") return { url: "glean-outline:siyuan", shortCircuit: true };
                    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
                    return nextResolve(specifier, context);
                },
                load(url, context, nextLoad) {
                    if (url === "glean-outline:siyuan") return { format: "module", source: "export const fetchSyncPost = (...args) => globalThis.__gleanOutlinePost(...args);", shortCircuit: true };
                    return nextLoad(url, context);
                },
            });
            const { loadReadingOutline } = await import("../../src/services/outline-service.ts");
            report.outline = await loadReadingOutline(docId);
            assert.deepEqual(report.outline.map((item) => item.title), expected);
        }
        fs.writeFileSync(path.join(workspace, "outline-report.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(`大纲只读探针通过：${version}，${workspace}${report.outline ? "，生产服务顺序通过" : ""}`);
    } finally {
        if (!lifecycle.child || (lifecycle.child.exitCode === null && lifecycle.child.signalCode === null)) await cleanupScratch((route, body) => client.api(route, body), { log: console });
        fs.writeFileSync(path.join(workspace, "kernel-tail.log"), lifecycle.lines.join("\n") + "\n");
        if (lifecycle.child) await shutdownKernel(client, lifecycle.child);
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

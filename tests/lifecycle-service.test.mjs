import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const apiStub = `
export const createDocWithMd = (...args) => globalThis.__lifecycleApi.createDocWithMd(...args);
export const getBlockAttrs = (...args) => globalThis.__lifecycleApi.getBlockAttrs(...args);
export const isKernelRequestError = (error) => Boolean(error && typeof error.kind === "string" && typeof error.route === "string" && typeof error.retryable === "boolean");
export const moveDocs = (...args) => globalThis.__lifecycleApi.moveDocs(...args);
export const querySql = (...args) => globalThis.__lifecycleApi.querySql(...args);
export const removeDoc = (...args) => globalThis.__lifecycleApi.removeDoc(...args);
`;
const storeStub = `export const writeClip = (...args) => globalThis.__lifecycleApi.writeClip(...args);`;
const indexStub = `export const loadIndex = () => ({}); export const removeDocFromIndex = () => {}; export const saveIndex = async () => {}; export const withIndexLock = (fn) => fn();`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        const parent = context.parentURL ?? "";
        if (parent.endsWith("/lifecycle-service.ts")) {
            if (specifier === "../api/client") return { url: `data:text/javascript,${encodeURIComponent(apiStub)}`, shortCircuit: true };
            if (specifier === "./clip-store") return { url: `data:text/javascript,${encodeURIComponent(storeStub)}`, shortCircuit: true };
            if (specifier === "./index-store") return { url: `data:text/javascript,${encodeURIComponent(indexStub)}`, shortCircuit: true };
            if (specifier === "../domain/schema") return { url: "data:text/javascript,export const ATTR = {};", shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
});

const { ensureHost } = await import("../src/services/lifecycle-service.ts");

function harness({ beforeCreate, createFailure, createBeforeFailure = false } = {}) {
    const docs = new Map();
    const calls = [];
    const plugin = {};
    const controls = { beforeCreate, createFailure, createBeforeFailure };
    globalThis.__lifecycleApi = {
        async querySql(stmt) {
            calls.push(["sql", stmt]);
            const value = (field) => {
                const escaped = new RegExp(`${field} = '((?:''|[^'])*)'`).exec(stmt)?.[1];
                return escaped?.replace(/''/g, "'");
            };
            const id = value("id");
            if (id) return docs.has(id) ? [structuredClone(docs.get(id))] : [];
            const box = value("box");
            const hpath = value("hpath");
            return [...docs.values()].filter((row) => row.box === box && row.hpath === hpath).map((row) => structuredClone(row));
        },
        async createDocWithMd(box, hpath, markdown) {
            calls.push(["create", box, hpath, markdown]);
            if (controls.beforeCreate) await controls.beforeCreate();
            const id = `20261014120000-${String(calls.filter((call) => call[0] === "create").length).padStart(7, "0")}`;
            const row = { id, path: `${hpath}.sy`, hpath, box, title: hpath.split("/").at(-1) };
            if (controls.createBeforeFailure) docs.set(id, row);
            if (controls.createFailure) throw controls.createFailure;
            docs.set(id, row);
            return id;
        },
        async writeClip(...args) { calls.push(["writeClip", ...args]); },
        async getBlockAttrs() { return {}; },
        async moveDocs() {},
        async removeDoc() {},
    };
    return { plugin, calls, docs, controls };
}

test("concurrent ensureHost calls share one lookup/create across plugin objects", async () => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const current = harness({ beforeCreate: async () => { entered.resolve(); await release.promise; } });
    const first = ensureHost(current.plugin, "box-concurrent", "/folder/article-a", "archive");
    await entered.promise;
    const second = ensureHost(current.plugin, "box-concurrent", "/folder/article-b", "archive");
    release.resolve();

    const [firstHost, secondHost] = await Promise.all([first, second]);
    assert.equal(firstHost.id, secondHost.id);
    assert.equal(firstHost.hpath, "/folder/【归档】");
    assert.equal(current.calls.filter((call) => call[0] === "create").length, 1);
    assert.equal(current.calls.filter((call) => call[0] === "writeClip").length, 1);
});

test("create response loss reconciles the exact host path before returning", async () => {
    const current = harness({
        createFailure: Object.assign(new Error("network lost"), { kind: "network", route: "/api/filetree/createDocWithMd", retryable: true }),
        createBeforeFailure: true,
    });

    const host = await ensureHost(current.plugin, "box-reconcile", "/article", "recycle");
    assert.equal(host.hpath, "/【回收】");
    assert.equal(host.id, "20261014120000-0000001");
    assert.equal(current.calls.filter((call) => call[0] === "create").length, 1);
});

test("同一目标已有多个宿主时拒绝任取其中一个", async () => {
    const current = harness();
    current.docs.set("20261014120000-first01", { id: "20261014120000-first01", path: "/folder/【归档】.sy", hpath: "/folder/【归档】", box: "box-ambiguous", title: "【归档】" });
    current.docs.set("20261014120001-second1", { id: "20261014120001-second1", path: "/folder/【归档】.sy", hpath: "/folder/【归档】", box: "box-ambiguous", title: "【归档】" });
    await assert.rejects(ensureHost(current.plugin, "box-ambiguous", "/folder/article", "archive"), /多个宿主文档/);
    assert.equal(current.calls.filter((call) => call[0] === "create").length, 0);
});

test("unresolved create response is not blindly submitted again in the same session", async () => {
    const current = harness({
        createFailure: Object.assign(new Error("network lost"), { kind: "network", route: "/api/filetree/createDocWithMd", retryable: true }),
    });
    await assert.rejects(ensureHost(current.plugin, "box-unknown", "/article", "archive"), /结果暂时无法确认/);
    await assert.rejects(ensureHost(current.plugin, "box-unknown", "/article", "archive"), /结果暂时无法确认/);
    assert.equal(current.calls.filter((call) => call[0] === "create").length, 1);
});

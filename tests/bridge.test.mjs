import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

const bridgeUrl = new URL("../src/services/bridge.ts", import.meta.url).href;
const indexUrl = new URL("../src/index.ts", import.meta.url).href;
const transformedSources = new Map();
for (const sourceUrl of [bridgeUrl, indexUrl]) {
    const source = readFileSync(new URL(sourceUrl), "utf8");
    const transformed = await transformWithOxc(source, fileURLToPath(sourceUrl));
    transformedSources.set(sourceUrl, transformed.code);
}

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const indexDependencies = new Map();
for (const imported of transformedSources.get(indexUrl).matchAll(/import\s+(?:\{([^}]+)\}|([\w]+))\s+from\s+["']([^"']+)["']/g)) {
    const [, named, defaultName, specifier] = imported;
    if (["siyuan", "./services/bridge", "./services/settings"].includes(specifier)) continue;
    let source;
    if (specifier === "../plugin.json") {
        source = `export default ${JSON.stringify(manifest)};`;
    } else if (defaultName) {
        source = "export default {};";
    } else {
        source = named.split(",").map((entry) => {
            const name = entry.trim().split(/\s+as\s+/)[0];
            return name === "installReadingContext"
                ? `export const ${name} = () => () => undefined;`
                : name === "ensurePresetActions"
                ? `export const ${name} = async () => undefined;`
                : `export const ${name} = () => undefined;`;
        }).join("\n");
    }
    indexDependencies.set(specifier, `data:text/javascript,${encodeURIComponent(source)}`);
}

const siyuanSource = `
export const fetchSyncPost = (...args) => globalThis.__gleanBridgePost(...args);
export const getFrontend = () => "desktop";
export const openTab = () => undefined;
export const openMobileFileById = () => undefined;
export const showMessage = () => undefined;
export const getAllEditor = () => [];
export class Plugin {
    constructor(options) {
        Object.assign(this, options);
        this.eventBus = { on() {}, off() {} };
    }
    loadData(name) { return globalThis.__gleanBridgePlugin.loadData(name); }
    saveData(name, value) { return globalThis.__gleanBridgePlugin.saveData(name, value); }
    addIcons() {}
    addDock() {}
    addCommand() {}
    addTab() {}
    addAgentCapability() {}
}
`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { url: "glean-bridge-test:siyuan", shortCircuit: true };
        if (context.parentURL === indexUrl) {
            if (specifier.endsWith(".scss")) return { url: "data:text/javascript,export {};", shortCircuit: true };
            const dependency = indexDependencies.get(specifier);
            if (dependency) return { url: dependency, shortCircuit: true };
        }
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
    },
    load(sourceUrl, context, nextLoad) {
        if (sourceUrl === "glean-bridge-test:siyuan") return { format: "module", source: siyuanSource, shortCircuit: true };
        const source = transformedSources.get(sourceUrl);
        if (source !== undefined) return { format: "module", source, shortCircuit: true };
        return nextLoad(sourceUrl, context);
    },
});

const { installBridge } = await import(bridgeUrl);
const { normalizeSettings, saveSettings } = await import("../src/services/settings.ts");
const { CLIP_STATUSES, siyuanTimestamp } = await import("../src/domain/schema.ts");
const { default: LvGleanPlugin } = await import(indexUrl);

function documentId(index) {
    return `20261004080000-${String(index).padStart(7, "0")}`;
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function harness({ enabled = false, host = {} } = {}) {
    const docs = new Map();
    const attrs = new Map();
    const files = new Map();
    const calls = [];
    const failures = new Map();
    const controls = { beforeRequest: null, saveError: null };
    let notifications = 0;
    const plugin = {
        async loadData(name) { return structuredClone(files.get(name)); },
        async saveData(name, value) {
            if (controls.saveError && name === "glean-index.json") throw controls.saveError;
            files.set(name, structuredClone(value));
        },
    };
    const facade = {
        pluginInstance: plugin,
        settings: normalizeSettings({ integration: { bridgeWriteEnabled: enabled } }),
        notifyDataChanged() { notifications += 1; },
    };
    function add(index, ial = {}, meta = {}) {
        const id = documentId(index);
        docs.set(id, { id, content: `Article ${index}`, hpath: `/Library/${index}`, box: "library", updated: `20261004${String(index).padStart(6, "0")}`, type: "d", ...meta });
        attrs.set(id, { "custom-clip-status": "later", ...ial });
        return id;
    }
    globalThis.__gleanBridgePost = async (route, body) => {
        calls.push({ route, body: structuredClone(body) });
        if (controls.beforeRequest) await controls.beforeRequest(route, body);
        const failure = failures.get(route);
        if (failure instanceof Error) throw failure;
        if (failure) return failure;
        let data;
        switch (route) {
            case "/api/query/sql": {
                const exactId = /WHERE id = '([^']+)'/.exec(body.stmt)?.[1];
                let rows = [...docs.values()].filter((row) => row.type === "d");
                if (exactId) {
                    rows = rows.filter((row) => row.id === exactId);
                } else if (body.stmt.includes("box IN")) {
                    const boxes = [...body.stmt.matchAll(/'([^']+)'/g)].map((match) => match[1]);
                    rows = rows.filter((row) => boxes.includes(row.box));
                } else if (body.stmt.includes("tag LIKE")) {
                    rows = rows.filter((row) => (row.tag || attrs.get(row.id)?.tags || "").includes("剪藏"));
                } else {
                    rows = rows.filter((row) => attrs.get(row.id)?.["custom-clip-status"] || attrs.get(row.id)?.["custom-clip-url"]);
                }
                rows.sort((left, right) => right.updated.localeCompare(left.updated) || right.id.localeCompare(left.id));
                const limit = Number(/LIMIT (\d+)/.exec(body.stmt)?.[1] ?? 500);
                const offset = Number(/OFFSET (\d+)/.exec(body.stmt)?.[1] ?? 0);
                data = rows.slice(offset, offset + limit);
                break;
            }
            case "/api/attr/batchGetBlockAttrs":
                data = Object.fromEntries(body.ids.filter((id) => docs.has(id) && attrs.has(id)).map((id) => [id, attrs.get(id)]));
                break;
            case "/api/attr/getBlockAttrs":
                data = attrs.get(body.id) ?? {};
                break;
            case "/api/attr/setBlockAttrs": {
                const current = { ...attrs.get(body.id) };
                for (const [key, value] of Object.entries(body.attrs)) {
                    if (value === null) delete current[key];
                    else current[key] = value;
                }
                attrs.set(body.id, current);
                data = null;
                break;
            }
            case "/api/export/exportMdContent":
                data = { content: "普通文档正文", hPath: "/Library" };
                break;
            default:
                throw new Error(`Unmocked endpoint: ${route}`);
        }
        return { code: 0, data: structuredClone(data) };
    };
    const dispose = installBridge(facade, "1.2.3", host);
    return { docs, attrs, files, calls, failures, controls, plugin, facade, host, add, dispose, bridge: host.siyuanGlean, notifications: () => notifications };
}

function attributeWrites(context) {
    return context.calls.filter((call) => call.route === "/api/attr/setBlockAttrs");
}

test("listClips 对账当前库、排除候选及 internal，并按稳定 ID 双向分页", async () => {
    const context = harness();
    const laterId = context.add(3);
    const firstId = context.add(1);
    context.add(2, { "custom-clip-status": "", "custom-clip-url": "https://example.com/candidate" });
    context.add(4, { "custom-clip-internal": "TRUE" });
    context.add(5, { "custom-clip-status": "invalid", "custom-clip-url": "https://example.com/invalid" });
    context.files.set("glean-index.json", { clips: { ghost: { id: "ghost", status: "done" } }, candidates: {} });
    assert.equal(context.bridge.apiVersion, 1);
    assert.equal(context.bridge.version, "1.2.3");
    assert.deepEqual((await context.bridge.listClips()).map((clip) => clip.id), [firstId, laterId]);
    assert.deepEqual((await context.bridge.listClips({ limit: 1, offset: 1 })).map((clip) => clip.id), [laterId]);
    assert.deepEqual((await context.bridge.listClips({ limit: 1, direction: "desc" })).map((clip) => clip.id), [laterId]);
    assert.deepEqual(await context.bridge.listClips({ offset: 20 }), []);
    context.docs.delete(firstId);
    context.add(6);
    assert.deepEqual((await context.bridge.listClips()).map((clip) => clip.id), [laterId, documentId(6)]);
    assert.equal(context.files.get("glean-index.json").clips.ghost, undefined);
    assert.equal(attributeWrites(context).length, 0);
});

test("状态、站点、用户标签、AI 标签和关键词可组合且两个标签来源分离", async () => {
    const context = harness();
    const wantedId = context.add(1, { "custom-clip-site": "Example.COM", tags: "#技术#,UserOnly", "custom-clip-ai-tags": "AIOnly,主题", "custom-clip-url": "https://example.com/source" }, { content: "阅读设计" });
    context.add(2, { "custom-clip-status": "done", "custom-clip-site": "Example.COM", tags: "技术", "custom-clip-ai-tags": "AIOnly" });
    context.add(3, { tags: "技术技巧", "custom-clip-ai-tags": "技术" });
    const filter = { status: "later", site: " example.com ", tag: " 技术 ", aiTag: " aionly ", keyword: " 设计 " };
    assert.deepEqual((await context.bridge.listClips(filter)).map((clip) => clip.id), [wantedId]);
    assert.deepEqual(await context.bridge.listClips({ tag: "AIOnly" }), []);
    assert.deepEqual(await context.bridge.listClips({ aiTag: "UserOnly" }), []);
    assert.equal((await context.bridge.listClips({ keyword: "SOURCE", status: "all" })).length, 1);
    assert.equal((await context.bridge.listClips({ keyword: "Library/1" })).length, 1);
});

test("分页严格拒绝类型漂移、小数和越界值，拒绝非法筛选且不访问内核", async () => {
    const context = harness();
    const invalid = [null, [], "later", { status: "candidate" }, { direction: "time" }, { tag: [] }, { aiTag: 1 }, { site: false }, { keyword: {} }];
    for (const limit of [0, -1, 201, 1.5, "20", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ limit });
    for (const offset of [-1, 1.5, "0", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ offset });
    for (const filter of invalid) await assert.rejects(context.bridge.listClips(filter));
    assert.equal(context.calls.length, 0);
    assert.deepEqual(await context.bridge.listClips({ limit: 200, offset: 0 }), []);
});

test("listClips 读完全部扫描页，回读属性每批至多 200 条后再分页", async () => {
    const context = harness();
    for (let index = 0; index < 501; index += 1) context.add(index);
    const clips = await context.bridge.listClips({ limit: 200, offset: 200 });
    assert.equal(clips.length, 200);
    assert.equal(clips[0].id, documentId(200));
    assert.equal(clips.at(-1).id, documentId(399));
    assert.ok(context.calls.some((call) => call.route === "/api/query/sql" && call.body.stmt.includes("OFFSET 500")));
    assert.ok(context.calls.filter((call) => call.route === "/api/attr/batchGetBlockAttrs").every((call) => call.body.ids.length <= 200));
});

test("对账后回读当前属性，状态与 internal 变化不沿用旧索引投影", async () => {
    const context = harness();
    const id = context.add(1);
    const internalId = context.add(2);
    let batchCount = 0;
    context.controls.beforeRequest = (route) => {
        if (route === "/api/attr/batchGetBlockAttrs" && ++batchCount === 2) {
            context.attrs.set(id, { "custom-clip-status": "done", tags: "Current", "custom-clip-ai-tags": "Fresh" });
            context.attrs.set(internalId, { "custom-clip-status": "done", "custom-clip-internal": "true" });
        }
    };
    const clips = await context.bridge.listClips({ status: "done", tag: "Current", aiTag: "Fresh" });
    assert.deepEqual(clips.map((clip) => clip.id), [id]);
    assert.equal(clips[0].status, "done");
    assert.equal(context.files.get("glean-index.json").clips[id].status, "later");
});

test("单篇与列表仅返回脱离缓存和属性的白名单投影，未知测量保持未知", async () => {
    const context = harness();
    const id = context.add(1, { tags: "UserOnly", "custom-clip-ai-tags": "AIOnly", "custom-clip-time": "20200101000000", "custom-secret": "private", markdown: "private body" });
    const listed = (await context.bridge.listClips())[0];
    const clip = await context.bridge.getClip(id);
    assert.equal(clip.timeSource, "legacy");
    assert.equal(clip.words, undefined);
    assert.equal(clip.minutes, undefined);
    assert.equal(clip.contentType, undefined);
    assert.equal(clip.internal, undefined);
    assert.equal(clip.excluded, undefined);
    assert.equal(clip.markdown, undefined);
    assert.equal(clip["custom-secret"], undefined);
    assert.equal(JSON.stringify(clip).includes("private"), false);
    assert.notEqual(listed, clip);
    assert.notEqual(listed.tags, clip.tags);
    listed.tags.push("changed");
    clip.aiTags.push("changed");
    clip.status = "archived";
    assert.deepEqual((await context.bridge.getClip(id)).aiTags, ["AIOnly"]);
    assert.deepEqual(context.files.get("glean-index.json").clips[id].tags, ["UserOnly"]);
    assert.equal(context.attrs.get(id)["custom-clip-status"], "later");
});

test("getClip 校验根文档 ID，缺失/候选/internal 返回 null，合法状态不凭标题排除", async () => {
    const context = harness();
    for (const invalid of [null, 123, "", "doc-1", "20261004080000-ABCDEFG", "20261004080000-0000001' OR 1=1"]) await assert.rejects(context.bridge.getClip(invalid), /Invalid document ID/);
    assert.equal(context.calls.length, 0);
    const candidateId = context.add(1, { "custom-clip-status": "", "custom-clip-url": "https://example.com/candidate" });
    const internalId = context.add(2, { "custom-clip-internal": "true" });
    const blockId = context.add(3, {}, { type: "p" });
    const invalidStatusId = context.add(4, { "custom-clip-status": "invalid" });
    const confirmedId = context.add(5, {}, { content: "读库数据库", hpath: "/读库数据库" });
    for (const id of [documentId(0), candidateId, internalId, blockId, invalidStatusId]) assert.equal(await context.bridge.getClip(id), null);
    assert.equal((await context.bridge.getClip(confirmedId)).id, confirmedId);
    assert.equal(context.calls.some((call) => call.route === "/api/export/exportMdContent"), false);
});

test("getClip 文档在属性读取前被删除返回 null，连接及权限错误保持真实错误", async () => {
    const context = harness();
    const id = context.add(1);
    context.controls.beforeRequest = (route) => {
        if (route === "/api/attr/batchGetBlockAttrs") context.docs.delete(id);
    };
    assert.equal(await context.bridge.getClip(id), null);
    context.controls.beforeRequest = null;
    context.add(1);
    for (const route of ["/api/query/sql", "/api/attr/batchGetBlockAttrs"]) {
        const error = new TypeError(`offline ${route}`);
        context.failures.set(route, error);
        await assert.rejects(context.bridge.getClip(id), (actual) => actual === error);
        context.failures.delete(route);
    }
    context.failures.set("/api/query/sql", { code: -1, msg: "permission denied" });
    await assert.rejects(context.bridge.getClip(id), /permission denied/);
});

test("对账查询、属性、索引保存和后续属性回读失败均拒绝，不能返回旧缓存", async () => {
    const context = harness();
    context.add(1);
    await context.bridge.listClips();
    const cached = structuredClone(context.files.get("glean-index.json"));
    for (const route of ["/api/query/sql", "/api/attr/batchGetBlockAttrs"]) {
        const error = new Error(`failed ${route}`);
        context.failures.set(route, error);
        await assert.rejects(context.bridge.listClips(), (actual) => actual === error);
        assert.deepEqual(context.files.get("glean-index.json"), cached);
        context.failures.delete(route);
    }
    const saveError = new Error("index save failed");
    context.controls.saveError = saveError;
    await assert.rejects(context.bridge.listClips(), (actual) => actual === saveError);
    context.controls.saveError = null;
    let batchCount = 0;
    const readError = new Error("fresh attributes failed");
    context.controls.beforeRequest = (route) => {
        if (route === "/api/attr/batchGetBlockAttrs" && ++batchCount === 2) throw readError;
    };
    await assert.rejects(context.bridge.listClips(), (actual) => actual === readError);
    context.controls.beforeRequest = null;
    assert.equal((await context.bridge.listClips()).length, 1);
});

test("写开关默认关闭但读取始终可用，保存开启和关闭影响后续写入", async () => {
    const context = harness();
    const id = context.add(1);
    await assert.rejects(context.bridge.setClipStatus(id, "done"), /disabled/);
    assert.equal(context.calls.length, 0);
    assert.equal((await context.bridge.getClip(id)).status, "later");
    assert.equal((await context.bridge.listClips()).length, 1);
    context.facade.settings = await saveSettings(context.plugin, normalizeSettings({ integration: { bridgeWriteEnabled: true, checkinEnabled: false } }));
    assert.equal(await context.bridge.setClipStatus(id, "reading"), undefined);
    assert.equal(context.attrs.get(id)["custom-clip-status"], "reading");
    context.facade.settings = await saveSettings(context.plugin, normalizeSettings({ integration: { bridgeWriteEnabled: false, checkinEnabled: true } }));
    await assert.rejects(context.bridge.setClipStatus(id, "done"), /disabled/);
    assert.equal(attributeWrites(context).length, 1);
    assert.equal((await context.bridge.getClip(id)).status, "reading");
});

test("开启后只接受五态并通过真实 clip-store 显式写入、同步索引及完成时间", async () => {
    const context = harness({ enabled: true });
    const protectedAttrs = { "custom-clip-url": "https://example.com/user", "custom-clip-priority": "5", "custom-clip-rating": "4", tags: "UserOnly", "custom-clip-summary": "Existing summary" };
    const id = context.add(1, protectedAttrs);
    let doneTime;
    for (const status of CLIP_STATUSES) {
        const before = siyuanTimestamp();
        await context.bridge.setClipStatus(id, status);
        const current = context.attrs.get(id);
        assert.equal(current["custom-clip-status"], status);
        assert.equal(context.files.get("glean-index.json").clips[id].status, status);
        for (const [key, value] of Object.entries(protectedAttrs)) assert.equal(current[key], value);
        if (status === "done") {
            doneTime = current["custom-clip-done-time"];
            assert.match(doneTime, /^\d{14}$/);
            assert.ok(doneTime >= before && doneTime <= siyuanTimestamp());
        } else {
            assert.equal(current["custom-clip-done-time"], doneTime);
        }
    }
    assert.equal(context.notifications(), 5);
    assert.ok(attributeWrites(context).every((call) => Object.keys(call.body.attrs).every((key) => ["custom-clip-status", "custom-clip-done-time"].includes(key))));
});

test("写入非法状态/ID/候选/internal/缺失文档均拒绝且不落属性", async () => {
    const context = harness({ enabled: true });
    const id = context.add(1);
    for (const status of [null, "", "all", "candidate", "DONE", {}, 1]) await assert.rejects(context.bridge.setClipStatus(id, status), /Invalid clip status/);
    await assert.rejects(context.bridge.setClipStatus("bad-id", "done"), /Invalid document ID/);
    assert.equal(context.calls.length, 0);
    const candidateId = context.add(2, { "custom-clip-status": "", "custom-clip-url": "https://example.com/candidate" });
    const internalId = context.add(3, { "custom-clip-internal": "true" });
    for (const rejectedId of [candidateId, internalId, documentId(4)]) await assert.rejects(context.bridge.setClipStatus(rejectedId, "done"), /Not a confirmed/);
    assert.equal(attributeWrites(context).length, 0);
});

test("真实属性写入及索引保存失败传播且不通知成功，失败后队列继续", async () => {
    const context = harness({ enabled: true });
    const id = context.add(1);
    const writeError = new Error("attribute write denied");
    context.failures.set("/api/attr/setBlockAttrs", writeError);
    await assert.rejects(context.bridge.setClipStatus(id, "done"), (actual) => actual === writeError);
    assert.equal(context.attrs.get(id)["custom-clip-status"], "later");
    assert.equal(context.notifications(), 0);
    context.failures.delete("/api/attr/setBlockAttrs");
    const saveError = new Error("index save denied");
    context.controls.saveError = saveError;
    await assert.rejects(context.bridge.setClipStatus(id, "reading"), (actual) => actual === saveError);
    assert.equal(context.attrs.get(id)["custom-clip-status"], "reading");
    assert.equal(context.notifications(), 0);
    context.controls.saveError = null;
    await context.bridge.setClipStatus(id, "archived");
    assert.equal(context.notifications(), 1);
    assert.equal(context.files.get("glean-index.json").clips[id].status, "archived");
});

test("注册不覆盖既有、空值或继承属性，卸载只删除自身对象", async () => {
    for (const existing of [{ owner: "other" }, null, undefined]) {
        const host = { siyuanGlean: existing };
        const context = harness({ host });
        context.dispose();
        assert.equal(host.siyuanGlean, existing);
        assert.equal(Object.hasOwn(host, "siyuanGlean"), true);
    }
    const inherited = Object.create({ siyuanGlean: { owner: "parent" } });
    const inheritedContext = harness({ host: inherited });
    inheritedContext.dispose();
    assert.equal(Object.hasOwn(inherited, "siyuanGlean"), false);
    const context = harness();
    const replacement = { owner: "replacement" };
    context.host.siyuanGlean = replacement;
    context.dispose();
    assert.equal(context.host.siyuanGlean, replacement);
    await assert.rejects(context.bridge.listClips(), /unloaded/);
});

test("卸载使所有旧对象/方法引用失效，重复清理安全，重载不恢复旧引用", async () => {
    const context = harness({ enabled: true });
    const id = context.add(1);
    const { listClips, getClip, setClipStatus } = context.bridge;
    context.dispose();
    context.dispose();
    assert.equal(Object.hasOwn(context.host, "siyuanGlean"), false);
    await assert.rejects(listClips(), /unloaded/);
    await assert.rejects(getClip(id), /unloaded/);
    await assert.rejects(setClipStatus(id, "done"), /unloaded/);
    assert.equal(context.calls.length, 0);
    const disposeNew = installBridge(context.facade, "1.2.4", context.host);
    assert.notEqual(context.host.siyuanGlean, context.bridge);
    assert.equal((await context.host.siyuanGlean.getClip(id)).status, "later");
    await assert.rejects(context.bridge.getClip(id), /unloaded/);
    disposeNew();
});

test("卸载拒绝正在读取和排队的写入，未派发属性写入", async () => {
    const context = harness({ enabled: true });
    const id = context.add(1);
    const entered = deferred();
    const release = deferred();
    context.controls.beforeRequest = async (route) => {
        if (route === "/api/query/sql") {
            entered.resolve();
            await release.promise;
        }
    };
    const reading = context.bridge.listClips();
    const queued = context.bridge.setClipStatus(id, "done");
    const readingRejected = assert.rejects(reading, /unloaded/);
    const queuedRejected = assert.rejects(queued, /unloaded/);
    await entered.promise;
    context.dispose();
    release.resolve();
    await Promise.all([readingRejected, queuedRejected]);
    assert.equal(attributeWrites(context).length, 0);
    assert.equal(context.notifications(), 0);
});

test("资格读取期间撤销开关可阻止写入，已提交写入卸载后拒绝且不通知", async () => {
    for (const stage of ["qualification", "submitted"]) {
        const context = harness({ enabled: true });
        const id = context.add(1);
        const entered = deferred();
        const release = deferred();
        const routeToBlock = stage === "qualification" ? "/api/query/sql" : "/api/attr/setBlockAttrs";
        context.controls.beforeRequest = async (route) => {
            if (route === routeToBlock) {
                entered.resolve();
                await release.promise;
            }
        };
        const writing = context.bridge.setClipStatus(id, "done");
        const rejected = assert.rejects(writing, stage === "qualification" ? /disabled/ : /unloaded/);
        await entered.promise;
        if (stage === "qualification") context.facade.settings = normalizeSettings({});
        else context.dispose();
        release.resolve();
        await rejected;
        assert.equal(attributeWrites(context).length, stage === "qualification" ? 0 : 1);
        assert.equal(context.notifications(), 0);
    }
});

test("同桥接并发对账与写入按顺序完成，后续读取反映真实成功状态", async () => {
    const context = harness({ enabled: true });
    const id = context.add(1);
    const reading = context.bridge.listClips();
    const writing = context.bridge.setClipStatus(id, "done");
    const after = context.bridge.getClip(id);
    assert.equal((await reading)[0].status, "later");
    await writing;
    assert.equal((await after).status, "done");
    assert.equal(context.files.get("glean-index.json").clips[id].status, "done");
});

test("插件生命周期从 manifest 注册版本，设置加载后可用，卸载撤销", async () => {
    const context = harness();
    const id = context.add(1);
    globalThis.__gleanBridgePlugin = context.plugin;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = [];
    globalThis.window = {};
    globalThis.document = { dispatchEvent(event) { events.push(event.type); } };
    try {
        const plugin = new LvGleanPlugin({ app: {}, name: manifest.name, displayName: "Glean", i18n: {} });
        await plugin.onload();
        const bridge = window.siyuanGlean;
        assert.equal(bridge.apiVersion, 1);
        assert.equal(bridge.version, manifest.version);
        assert.equal((await bridge.getClip(id)).status, "later");
        await assert.rejects(bridge.setClipStatus(id, "done"), /disabled/);
        await plugin.updateSettings({ integration: { ...plugin.settings.integration, bridgeWriteEnabled: true } });
        assert.equal(context.files.get("settings.json").integration.bridgeWriteEnabled, true);
        await bridge.setClipStatus(id, "done");
        assert.equal((await bridge.getClip(id)).status, "done");
        assert.deepEqual(events, ["glean:data-changed", "glean:data-changed"]);
        await plugin.updateSettings({ integration: { ...plugin.settings.integration, bridgeWriteEnabled: false } });
        await assert.rejects(bridge.setClipStatus(id, "later"), /disabled/);
        await plugin.onunload();
        assert.equal(Object.hasOwn(window, "siyuanGlean"), false);
        await assert.rejects(bridge.getClip(id), /unloaded/);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("设置加载仍挂起时卸载，完成加载也不能重新注册桥接", async () => {
    const loading = deferred();
    globalThis.__gleanBridgePlugin = { loadData: () => loading.promise };
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
        const plugin = new LvGleanPlugin({ app: {}, name: manifest.name, displayName: "Glean", i18n: {} });
        const onload = plugin.onload();
        await plugin.onunload();
        loading.resolve({});
        await onload;
        assert.equal(Object.hasOwn(window, "siyuanGlean"), false);
    } finally {
        globalThis.window = previousWindow;
    }
});

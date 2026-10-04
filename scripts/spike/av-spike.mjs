/* M2 前置 spike：复验「挂库向导」要用的思源数据库（AV）端点（v3.8.5）。
   端点形状源自小驴人脉同版本内核实证（其 docs/DATA-CONTRACT.md + src/api/av.ts），
   本脚本在我们自己的隔离内核上复验关键闭环：建库→建字段→绑文档行→itemID 换算→写值回读→渲染。
   产出 scripts/spike/av-spike-results.json。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    resolveKernel,
    prepareWorkspace,
    assertTestPortAvailable,
    startKernel,
    createApiClient,
    newNodeID,
    waitForBoot,
    shutdownKernel,
} from "./kernel-harness.mjs";

function parseOptions() {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
        const argument = process.argv[index];
        if (!argument.startsWith("--")) throw new Error("未知参数: " + argument);
        const key = argument.slice(2);
        const value = process.argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("参数缺少值: --" + key);
        if (!["workspace", "port", "results"].includes(key)) throw new Error("未知参数: --" + key);
        options[key] = value;
        index += 1;
    }
    return options;
}

const options = parseOptions();
const WORKSPACE = path.resolve(options.workspace || path.join(os.tmpdir(), `siyuan-glean-av-spike-${Date.now()}-${process.pid}`));
const HOST = "127.0.0.1";
let PORT = options.port === "0" || options.port === undefined ? 0 : Number(options.port);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error("port 必须是 0 或 1-65535");
let BASE = `http://${HOST}:${PORT}`;
const RESULTS_PATH = path.resolve(options.results || path.join(WORKSPACE, "av-spike-results.json"));
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version;

const results = [];
const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function choosePort() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const port = 30000 + Math.floor(Math.random() * 25000);
        try {
            await assertTestPortAvailable(HOST, port);
            return port;
        } catch (error) {
            if (attempt === 39) throw error;
        }
    }
    throw new Error("没有可用的回环测试端口");
}

async function main() {
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace(WORKSPACE, "glean-spike.json", "glean-spike");
    if (PORT === 0) PORT = await choosePort();
    BASE = `http://${HOST}:${PORT}`;
    await assertTestPortAvailable(HOST, PORT);
    const client = createApiClient(BASE);
    const { child, lines } = startKernel(kernel, appDir, WORKSPACE, PORT);
    client.onGuard(() => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
    });

    let exitCode = 0;
    let booted = false;
    try {
        const version = await waitForBoot(BASE, lines, client.onGuard && (() => {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出");
        }), client);
        booted = true;
        const kernelVersion = typeof version === "string" ? version : version.version;
        console.log(`内核 ${kernelVersion} @ ${BASE}\n`);
        client.setToken((JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "");
        const { apiChecked } = client;

        // 桌面信任门槛 + 笔记本
        await client.api("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        let notebookID = (notebooks.notebooks || []).find((n) => n.name === "GleanSpike")?.id;
        if (!notebookID) {
            await apiChecked("/api/notebook/createNotebook", { name: "GleanSpike" });
            const refreshed = await apiChecked("/api/notebook/lsNotebooks", {});
            notebookID = (refreshed.notebooks || []).find((n) => n.name === "GleanSpike")?.id;
        }

        // 宿主文档（挂库向导会在第一个锚点笔记本建「读库数据库」宿主文档）
        const hostDoc = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/读库数据库", markdown: "# 读库数据库\n\n",
        });

        // ① 插入数据库块 + createIfNotExist 物化
        const avId = newNodeID();
        const dom = `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`;
        const inserted = await client.api("/api/block/insertBlock", { dataType: "dom", parentID: hostDoc, data: dom });
        const dbBlockId = inserted.data?.[0]?.doOperations?.[0]?.id || "";
        const rendered = await client.api("/api/av/renderAttributeView", {
            id: avId, blockID: dbBlockId, pageSize: -1, createIfNotExist: true,
        });
        record("① 建库块 + 物化(createIfNotExist)", inserted.code === 0 && rendered.code === 0 && !!dbBlockId,
            `dbBlockId=${dbBlockId} render=${rendered.code}`);

        // ② 建字段（keyIcon 必传空串；previousKeyID 顺序）
        const fields = [
            ["状态", "select"], ["评分", "number"], ["字数", "number"], ["时长", "number"], ["来源", "url"],
        ];
        const keyIds = {};
        let prev = "";
        for (const [name, type] of fields) {
            const keyId = newNodeID();
            const added = await client.api("/api/av/addAttributeViewKey", {
                avID: avId, keyID: keyId, keyName: name, keyType: type, keyIcon: "", previousKeyID: prev,
            });
            if (added.code !== 0) { record("② 建字段", false, `${name} code=${added.code} msg=${added.msg}`); break; }
            keyIds[name] = keyId;
            prev = keyId;
        }
        if (Object.keys(keyIds).length === fields.length) {
            const av = await apiChecked("/api/av/getAttributeView", { id: avId });
            const keyCount = av.av?.keyValues?.length ?? av.av?.keys?.length ?? Object.keys(av.av?.keyIDs ?? {}).length;
            record("② 建字段(select/number/url)", true, `字段声明成功 ${fields.length} 个; av keys 探测=${keyCount}`);
        }

        // ③ 两篇剪藏文档绑行为行（isDetached:false）
        const docA = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/剪藏/库向导文章A", markdown: "# 库向导文章A\n\n- [https://a.com/1](https://a.com/1)\n",
        });
        const docB = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookID, path: "/剪藏/库向导文章B", markdown: "# 库向导文章B\n\n- [https://b.com/2](https://b.com/2)\n",
        });
        const bound = await client.api("/api/av/addAttributeViewBlocks", {
            avID: avId, blockID: dbBlockId,
            srcs: [{ id: docA, isDetached: false, content: "库向导文章A" }, { id: docB, isDetached: false, content: "库向导文章B" }],
        });
        record("③ 绑文档为行(isDetached:false)", bound.code === 0, `code=${bound.code}`);

        // ④ itemID 换算
        const mapped = await apiChecked("/api/av/getAttributeViewItemIDsByBoundIDs", { avID: avId, blockIDs: [docA, docB] });
        const itemA = mapped[docA];
        const mapOk = Boolean(itemA);
        record("④ itemID 换算(getAttributeViewItemIDsByBoundIDs)", mapOk, JSON.stringify(mapped).slice(0, 120));

        // ⑤ 写值回读（select 用 content 自动建选项；number 写数字）
        const setSel = await client.api("/api/av/setAttributeViewBlockAttr", {
            avID: avId, keyID: keyIds["状态"], itemID: itemA, value: { mSelect: [{ content: "reading" }] },
        });
        const setNum = await client.api("/api/av/setAttributeViewBlockAttr", {
            avID: avId, keyID: keyIds["字数"], itemID: itemA, value: { number: { content: 1234, isNotEmpty: true } },
        });
        // 事务落库异步，渲染重试至多 5 次
        let re = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            re = await apiChecked("/api/av/renderAttributeView", { id: avId, blockID: dbBlockId, query: "", pageSize: -1, createIfNotExist: false });
            if ((re?.view?.rows ?? []).length > 0) break;
            await new Promise((r) => setTimeout(r, 600));
        }
        if (!(re?.view?.rows ?? []).length) {
            console.log("RENDER DUMP:", JSON.stringify(re).slice(0, 600));
        }
        const rowA = re?.view?.rows?.find((r) => r.id === itemA);
        const cells = rowA?.cells ?? [];
        const cellByKey = new Map(cells.map((c) => [c.value.keyID, c.value]));
        const selVal = cellByKey.get(keyIds["状态"])?.mSelect?.[0]?.content;
        const numVal = cellByKey.get(keyIds["字数"])?.number?.content;
        const writeOk = setSel.code === 0 && setNum.code === 0 && selVal === "reading" && Number(numVal) === 1234;
        record("⑤ 写值回读(select content / number)", writeOk, `sel=${selVal} num=${numVal}`);

        // ⑥ 渲染行数与主键映射
        const rows = re?.view?.rows ?? [];
        const pkOk = rows.length >= 2;
        record("⑥ 渲染行数", pkOk, `rows=${rows.length}`);

        const failures = results.filter((r) => !r.ok);
        exitCode = failures.length > 0 ? 1 : 0;
        fs.writeFileSync(
            RESULTS_PATH,
            `${JSON.stringify({ version: kernelVersion, kernelVersion, pluginVersion: PLUGIN_VERSION, workspace: WORKSPACE, host: HOST, port: PORT, at: new Date().toISOString(), results }, null, 2)}\n`
        );
        console.log(`\n== AV spike 完成：${results.length - failures.length}/${results.length} 通过，结果已写入 ${RESULTS_PATH} ==`);
    } finally {
        if (booted) await shutdownKernel(client, child);
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("AV SPIKE ERROR:", error.message);
    process.exit(2);
});

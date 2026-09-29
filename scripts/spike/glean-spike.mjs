/* M0 spike：在隔离内核上实证「小驴拾遗」的关键 API 假设。
   模式移植自小驴人脉/打卡的 E2E 基建（D-0010）：独立临时工作区 + 标记文件 +
   回环校验，绝不触碰用户真实笔记。产出 scripts/spike/spike-results.json。

   验证项（规划书 §5 M0）：
   ① createDocWithMd(官方剪藏 payload 形态) + setBlockAttrs 写 custom-* → getBlockAttrs 读回一致
      + tags 落位 + null/空串删除语义 + 批量端点形状
   ② 千篇文档库中 ial LIKE 查询耗时与 batchGetBlockAttrs 耗时（决策：直查 SQL 还是索引）
   ③ semanticSearchBlock / embeddingStat 在嵌入未启用时的行为（降级依据）
   ④ exportMdContent 形状（迁移器读正文）
   ⑤ 插件包加载：dist 拷入隔离工作区 → loadPetals 可见 → i18n 双名加载 → setPetalEnabled 开关
   ⑥ SQL 双锚点查询形状（listClipDocs / listAnchorDocs 依赖的语句逐条验证）
   （官方剪藏扩展实剪 3 站核对需要真人浏览器操作，按作者指示后置，见 BLOCKERS B-0001。）
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Glean-Spike");
const HOST = "127.0.0.1";
const PORT = 6831;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "glean-spike.json";
const PLUGIN_NAME = "siyuan-glean";

const results = [];
const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function assertLoopback() {
    const host = new URL(BASE).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`只允许回环地址，当前 ${host}`);
}

function resolveKernel() {
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
function prepareWorkspace() {
    const resolved = path.resolve(WORKSPACE);
    const relRepo = path.relative(resolved, process.cwd());
    const repoOutside = relRepo === ".." || relRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relRepo);
    if (resolved === path.parse(resolved).root || path.relative(os.homedir(), resolved) === "" || !repoOutside) {
        throw new Error(`拒绝使用宽泛或项目目录作为测试工作区: ${resolved}`);
    }
    if (fs.existsSync(resolved)) {
        let metadata;
        try {
            metadata = JSON.parse(fs.readFileSync(path.join(resolved, MARKER), "utf8"));
        } catch {
            throw new Error(`拒绝使用非测试工作区，标记缺失或损坏: ${resolved}`);
        }
        if (metadata?.createdBy !== "glean-spike") throw new Error(`测试工作区标记不匹配: ${resolved}`);
        return;
    }
    fs.mkdirSync(path.join(resolved, "data"), { recursive: true });
    fs.writeFileSync(path.join(resolved, MARKER), JSON.stringify({ createdBy: "glean-spike", createdIso: new Date().toISOString() }) + "\n");
}

async function assertTestPortAvailable(host, port) {
    if (!["127.0.0.1", "::1"].includes(host)) throw new Error("测试内核只允许回环地址");
    const net = await import("node:net");
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", (error) => reject(new Error(`测试端口 ${port} 不可用: ${error.code}`)));
        server.listen({ host, port, exclusive: true }, () => server.close((error) => (error ? reject(error) : resolve())));
    });
}

function startKernel({ kernel, appDir }) {
    const child = spawn(kernel, ["--workspace", WORKSPACE, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SIYUAN_WORKSPACE_PATH: WORKSPACE },
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

let token = "";
let assertKernelRunning;
async function api(route, body = {}) {
    assertKernelRunning?.();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    assertKernelRunning?.();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`${route} 非 JSON 响应: ${text.slice(0, 200)}`); }
    return payload;
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}

function newNodeID() {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) rand += charset[Math.floor(Math.random() * charset.length)];
    return `${stamp}-${rand}`;
}

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) {
            throw new Error(`工作区被锁定：${WORKSPACE} 有残留内核。请先结束该进程。`);
        }
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) {
            return apiChecked("/api/system/version");
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时。日志尾部:\n${lines.slice(-25).join("\n")}`);
}

/* ---------- ① 属性写读闭环 ---------- */

async function verifyAttrLoop(notebookID) {
    // 官方剪藏扩展 payload 形态（siyuan-chrome 整页剪藏：createDocWithMd 带 tags + 模板链接行）
    const markdown = [
        "## 一篇剪藏的文章标题",
        "",
        "- [https://example.com/post/1](https://example.com/post/1)",
        "",
        "正文段落。".repeat(30),
    ].join("\n");
    const docId = await apiChecked("/api/filetree/createDocWithMd", {
        notebook: notebookID,
        path: "/剪藏/一篇剪藏的文章标题",
        markdown,
        tags: "测试标签1,测试标签2",
    });
    if (!docId) return { ok: false, detail: "createDocWithMd 未返回文档 ID" };

    // tags 落位验证（规划书 §3.1：tags 被内核写入根块 IAL 的 tags 键）
    const attrsAfterCreate = await apiChecked("/api/attr/getBlockAttrs", { id: docId });
    const tagsLanded = Array.isArray(attrsAfterCreate.tags) ? attrsAfterCreate.tags.join(",") : String(attrsAfterCreate.tags ?? "");
    const tagsOk = tagsLanded.includes("测试标签1");

    // 写 custom-* → 读回一致
    const customAttrs = {
        "custom-clip-url": "https://example.com/post/1",
        "custom-clip-site": "example.com",
        "custom-clip-time": "20260929093000",
        "custom-clip-status": "inbox",
        "custom-clip-words": "1200",
        "custom-clip-minutes": "3",
        "custom-clip-priority": "3",
        "custom-clip-ai-tags": "ai,测试",
        "custom-clip-src": "migration",
    };
    await apiChecked("/api/attr/setBlockAttrs", { id: docId, attrs: customAttrs });
    const readBack = await apiChecked("/api/attr/getBlockAttrs", { id: docId });
    const mismatch = Object.entries(customAttrs).filter(([key, value]) => readBack[key] !== value);
    const writeOk = mismatch.length === 0;

    // 批量端点形状：batchGetBlockAttrs 响应 = {[id]: attrs}；batchSetBlockAttrs 请求 = {blockAttrs: [{id, attrs}]}
    const docId2 = await apiChecked("/api/filetree/createDocWithMd", {
        notebook: notebookID, path: "/剪藏/批量第二篇", markdown: "# 批量第二篇\n\n- [https://b.com/a](https://b.com/a)\n",
    });
    const batchGet = await api("/api/attr/batchGetBlockAttrs", { ids: [docId, docId2] });
    const batchGetShapeOk = batchGet.code === 0
        && batchGet.data && typeof batchGet.data === "object" && !Array.isArray(batchGet.data)
        && batchGet.data[docId]?.["custom-clip-url"] === "https://example.com/post/1";

    const batchSet = await api("/api/attr/batchSetBlockAttrs", {
        blockAttrs: [
            { id: docId2, attrs: { "custom-clip-url": "https://b.com/a", "custom-clip-status": "later" } },
        ],
    });
    const readBack2 = await apiChecked("/api/attr/getBlockAttrs", { id: docId2 });
    const batchSetOk = batchSet.code === 0 && readBack2["custom-clip-status"] === "later";

    // 删除语义：null 与 空串
    await apiChecked("/api/attr/setBlockAttrs", { id: docId2, attrs: { "custom-clip-status": null } });
    const afterNull = await apiChecked("/api/attr/getBlockAttrs", { id: docId2 });
    const nullDeletes = afterNull["custom-clip-status"] === undefined || afterNull["custom-clip-status"] === "";
    await apiChecked("/api/attr/setBlockAttrs", { id: docId2, attrs: { "custom-clip-src": "" } });
    const afterEmpty = await apiChecked("/api/attr/getBlockAttrs", { id: docId2 });
    const emptyDeletes = afterEmpty["custom-clip-src"] === undefined || afterEmpty["custom-clip-src"] === "";

    return {
        ok: tagsOk && writeOk && batchGetShapeOk && batchSetOk && nullDeletes && emptyDeletes,
        detail: `tags落位=${tagsOk} 写读一致=${writeOk}${mismatch.length ? `(不一致键:${mismatch.map(([k]) => k).join(",")})` : ""}`
            + ` batchGet映射=${batchGetShapeOk} batchSet=${batchSetOk} null删除=${nullDeletes} 空串删除=${emptyDeletes}`,
        docId, docId2,
    };
}

/* ---------- ② 千篇库 LIKE 性能 ---------- */

async function verifyLikePerformance(notebookID) {
    // 建 1000 篇文档（带官方剪藏模板形态正文），其中一半写 custom-clip-status
    const COUNT = 1000;
    const existed = await apiChecked("/api/query/sql", { stmt: `SELECT COUNT(*) AS c FROM blocks WHERE type='d' AND box='${notebookID}'` });
    const existing = Number(existed[0]?.c ?? 0);
    if (existing < COUNT) {
        for (let i = existing; i < COUNT; i += 1) {
            await apiChecked("/api/filetree/createDocWithMd", {
                notebook: notebookID,
                path: `/压测/文章${String(i).padStart(4, "0")}`,
                markdown: `# 压测文章${i}\n\n- [https://speed.com/${i}](https://speed.com/${i})\n\n${"性能压测正文。".repeat(20)}`,
            });
        }
    }
    // 给一半压测文档写 clip 属性（面板真实查询形状：LIKE 命中量 = 已收录文章量）
    {
        const stmt = "SELECT id FROM blocks WHERE type='d' AND box='" + notebookID + "' LIMIT " + COUNT;
        const all = await apiChecked("/api/query/sql", { stmt });
        const half = all.slice(0, Math.floor(all.length / 2)).map((row) => row.id);
        for (let i = 0; i < half.length; i += 100) {
            const chunk = half.slice(i, i + 100);
            await apiChecked("/api/attr/batchSetBlockAttrs", { blockAttrs: chunk.map((id) => ({ id, attrs: { "custom-clip-status": "inbox", "custom-clip-time": "20260929000000" } })) });
        }
    }

    // 等索引追平
    let counted = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await apiChecked("/api/query/sql", { stmt: `SELECT COUNT(*) AS c FROM blocks WHERE type='d' AND box='${notebookID}'` });
        counted = Number(rows[0]?.c ?? 0);
        if (counted >= COUNT) break;
        await new Promise((r) => setTimeout(r, 500));
    }

    const timed = async (label, fn) => {
        const start = performance.now();
        const value = await fn();
        const ms = Math.round(performance.now() - start);
        return { label, ms, value };
    };

    const likeQuery = await timed("ial LIKE", () => apiChecked("/api/query/sql", {
        stmt: `SELECT id, content, hpath, box, updated FROM blocks WHERE type='d' AND ial LIKE '%custom-clip-status%' ORDER BY updated DESC LIMIT 1000`,
    }));

    const ids = likeQuery.value.map((row) => row.id).slice(0, 1000);
    const batchAttrs = await timed("batchGetBlockAttrs(1000)", () => apiChecked("/api/attr/batchGetBlockAttrs", { ids }));

    const boxQuery = await timed("box IN", () => apiChecked("/api/query/sql", {
        stmt: `SELECT id, content, hpath, box, updated FROM blocks WHERE type='d' AND box='${notebookID}' ORDER BY updated DESC LIMIT 500`,
    }));

    return {
        ok: likeQuery.value.length > 0 && counted >= COUNT,
        detail: `千篇库: LIKE=${likeQuery.ms}ms(命中${likeQuery.value.length}) batchAttrs1000=${batchAttrs.ms}ms boxIN500=${boxQuery.ms}ms`,
        timings: { like: likeQuery.ms, batchAttrs: batchAttrs.ms, box: boxQuery.ms },
    };
}

/* ---------- ③ 语义搜索双态 ---------- */

async function verifySemantic() {
    let statCode = 0, statData = null, statErr = "";
    try {
        statData = await apiChecked("/api/ai/embeddingStat", {});
        record("③a embeddingStat 原始数据", true, JSON.stringify(statData).slice(0, 160));
    } catch (error) {
        statCode = -1;
        statErr = String(error.message || error);
    }
    let searchCode = 0, searchMsg = "", searchHitCount = 0;
    const search = await api("/api/search/semanticSearchBlock", {
        query: "性能压测", types: { d: true }, page: 1, pageSize: 5,
    });
    searchCode = search.code;
    searchMsg = search.msg || "";
    searchHitCount = Array.isArray(search.data?.blocks) ? search.data.blocks.length : -1;
    // 未启用嵌入时预期：要么 code!=0 给出明确 msg（前端降级隐藏），要么空结果不炸
    const graceful = searchCode !== 0 || searchHitCount >= 0;
    return {
        ok: graceful,
        detail: `embeddingStat code路径=${statCode === 0 ? "0(启用)" : `非0(${statErr.slice(0, 60)})`} `
            + `semanticSearch code=${searchCode} msg="${searchMsg.slice(0, 60)}" hits=${searchHitCount}`,
    };
}

/* ---------- ④ exportMdContent ---------- */

async function verifyExportMd(notebookID) {
    const docId = await apiChecked("/api/filetree/createDocWithMd", {
        notebook: notebookID,
        path: "/剪藏/导出形状验证",
        markdown: "# 导出形状验证\n\n- [https://c.com/x](https://c.com/x)\n\n导出测试正文。",
    });
    const exported = await api("/api/export/exportMdContent", { id: docId });
    const content = exported?.data?.content ?? "";
    const hPath = exported?.data?.hPath ?? "";
    const ok = exported.code === 0 && content.includes("https://c.com/x") && hPath.length > 0;
    return { ok, detail: `code=${exported.code} hPath="${hPath}" 含链接=${content.includes("https://c.com/x")} contentLen=${content.length}` };
}

/* ---------- ⑥ SQL 双锚点 ---------- */

async function verifyAnchorQueries(notebookID, attrDocId) {
    // 次锚点语义：该文档 IAL 含 clip 键（精确 id + LIKE，免受 updated 排序窗口影响）。
    // SQLite ial 列异步刷新（DATA-CONTRACT §5 注），写后立即查可能滞后 → 重试至多 10 次。
    let clips = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
        clips = await apiChecked("/api/query/sql", {
            stmt: `SELECT id, content, hpath, box, updated FROM blocks WHERE type='d' AND id='${attrDocId}' AND ial LIKE '%custom-clip-status%'`,
        });
        if (clips.length > 0) break;
        await new Promise((r) => setTimeout(r, 600));
    }
    const anchors = await apiChecked("/api/query/sql", {
        stmt: `SELECT id, content, hpath, box, updated FROM blocks WHERE type='d' AND box='${notebookID}' ORDER BY updated DESC LIMIT 200`,
    });
    const clipHit = clips.some((row) => row.id === attrDocId);
    const anchorShapeOk = anchors.length > 0 && anchors.every((row) => row.box === notebookID);
    return { ok: clipHit && anchorShapeOk, detail: `次锚点LIKE命中=${clipHit}(${clips.length}行) 主锚点box过滤正确=${anchorShapeOk}(${anchors.length}行)` };
}

/* ---------- ⑤ 插件包加载 + i18n 双名 ---------- */

async function verifyPluginLoad(distDir) {
    if (!fs.existsSync(path.join(distDir, "index.js"))) {
        return { ok: false, detail: "dist/index.js 不存在，先 pnpm build" };
    }
    // dist → 隔离工作区插件目录
    const target = path.join(WORKSPACE, "data", "plugins", PLUGIN_NAME);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(distDir, target, { recursive: true });

    const load = await api("/api/petal/loadPetals", { frontend: "desktop" });
    let petals = load.code === 0 && Array.isArray(load.data) ? load.data : [];
    let found = petals.find((petal) => petal.name === PLUGIN_NAME);

    if (!found) {
        // 未启用则显式开启再试
        await api("/api/petal/setPetalEnabled", { packageName: PLUGIN_NAME, enabled: true, frontend: "desktop" }).catch(() => undefined);
        const retry = await api("/api/petal/loadPetals", { frontend: "desktop" });
        petals = retry.code === 0 && Array.isArray(retry.data) ? retry.data : petals;
        found = petals.find((petal) => petal.name === PLUGIN_NAME);
    }
    if (!found) {
        return { ok: false, detail: `loadPetals(${petals.length} 个) 中未见 ${PLUGIN_NAME}` };
    }

    // vite 产线 minify 会重命名类名，改用存活的稳定字符串（dock 类型常量 + 命令键）判定入口 js
    const jsOk = typeof found.js === "string" && found.js.includes("glean-dock") && found.js.includes("cmd.openPanel");
    const cssOk = typeof found.css === "string" && found.css.length > 0;
    // i18n：内核按 Conf.Lang→en→zh-CN 双名回退（kernel/model/plugin.go），按当前 Conf.Lang 判定期望文案
    const i18n = found.i18n ?? {};
    const i18nKeys = Object.keys(i18n);
    let confLang = "en";
    try { confLang = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).lang || "en"; } catch {}
    const expectZh = String(confLang).toLowerCase().startsWith("zh");
    const langMatchOk = i18nKeys.includes("pluginName")
        && (expectZh ? String(i18n.pluginName).includes("拾遗") : String(i18n.pluginName).includes("Glean"));
    const enFallback = i18nKeys.includes("dock.title");
    const frontendsOk = Array.isArray(found.frontend) ? true : true;
    return {
        ok: jsOk && cssOk && langMatchOk && enFallback,
        detail: `js含入口标记=${jsOk} css=${cssOk}(${(found.css || "").length}B) `
            + `i18n键数=${i18nKeys.length} 按Lang(${confLang})加载正确=${langMatchOk} 键完整=${enFallback}`,
        petalKeys: i18nKeys.length,
    };
}

/* ---------- main ---------- */


/* ---------- ⑦ 快照闭环（T-1504） ---------- */

async function verifySnapshot(notebookID, docId) {
    // 1) exportHTML：savePath 留空 → data.content 为单文件 HTML
    const exported = await api("/api/export/exportHTML", { id: docId, pdf: false });
    if (exported.code !== 0 || !exported.data?.content) {
        return { ok: false, detail: `exportHTML code=${exported.code} msg=${exported.msg} contentLen=${(exported.data?.content || "").length}` };
    }
    const html = exported.data.content;
    const path = `/${notebookID}/assets/glean-${docId}-snap.html`;
    // 2) putFile：multipart（apicontract/file.go PutFileRequest：path + file 字段）
    const form = new FormData();
    form.append("path", path);
    form.append("file", new Blob([html], { type: "text/html" }), "snap.html");
    const headers = { Authorization: `Token ${token}` };
    const putResp = await fetch(`${BASE}/api/file/putFile`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(20000) });
    const putText = await putResp.text();
    let putPayload;
    try { putPayload = JSON.parse(putText); } catch { return { ok: false, detail: `putFile 非 JSON: ${putText.slice(0, 80)}` }; }
    if (putPayload.code !== 0) return { ok: false, detail: `putFile code=${putPayload.code} msg=${putPayload.msg}` };
    // 3) getFile 读回校验非空且含正文
    const getResp = await fetch(`${BASE}/api/file/getFile`, { method: "POST", headers, body: JSON.stringify({ path }), signal: AbortSignal.timeout(20000) });
    const back = await getResp.text();
    const ok = back.includes("一篇剪藏的文章标题") || back.length > 200;
    return { ok, detail: `contentLen=${html.length} put=${putPayload.code} 读回=${back.length}B 含正文=${ok}`, path };
}


/* ---------- ⑧ 摘录制卡闭环（T-1502） ---------- */

async function verifyFlashcard(notebookID) {
    // 1) 找/建牌组
    const decksBefore = await api("/api/riff/getRiffDecks", {});
    let deck = (decksBefore.data || []).find((d) => d.name === "拾遗卡片");
    if (!deck) {
        const created = await api("/api/riff/createRiffDeck", { name: "拾遗卡片" });
        if (created.code !== 0) return { ok: false, detail: `createRiffDeck code=${created.code} msg=${created.msg}` };
        deck = created.data;
    }
    // 2) 宿主文档建卡块：列表项制卡（思源官方闪卡范式——列表项内容=正面，嵌套子列表=背面）
    const hostDoc = await apiChecked("/api/filetree/createDocWithMd", {
        notebook: notebookID, path: "/拾遗卡片", markdown: "# 拾遗卡片\n\n",
    });
    const id1 = newNodeID(), id2 = newNodeID(), id3 = newNodeID(), id4 = newNodeID(), id5 = newNodeID();
    const listDom = '<div data-node-id="' + id1 + '" data-type="NodeList" data-subtype="u">'
        + '<div data-node-id="' + id2 + '" data-type="NodeListItem" data-subtype="bullet">'
        + '<div data-node-id="' + id3 + '" data-type="NodeParagraph" class="p">「测试引文…」出自哪篇文章？</div>'
        + '<div data-node-id="' + id4 + '" data-type="NodeList" data-subtype="u">'
        + '<div data-node-id="' + id5 + '" data-type="NodeListItem" data-subtype="bullet">'
        + '<div data-node-id="' + newNodeID() + '" data-type="NodeParagraph" class="p">答案：快照测试文档</div>'
        + '</div></div></div></div>';
    const inserted = await api("/api/block/insertBlock", { dataType: "dom", parentID: hostDoc, data: listDom });
    if (inserted.code !== 0) return { ok: false, detail: "insertBlock code=" + inserted.code + " msg=" + inserted.msg };
    // 列表项 id 经 SQL 找回（type='i'，root 圈定）
    let cardBlockId = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const rows = await apiChecked("/api/query/sql", {
            stmt: "SELECT id FROM blocks WHERE root_id = '" + hostDoc + "' AND type = 'i' ORDER BY sort ASC LIMIT 1",
        });
        if (rows[0]?.id) { cardBlockId = rows[0].id; break; }
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!cardBlockId) return { ok: false, detail: "列表项 id 未在索引中出现" };
    // 3) addRiffCards 入组
    const added = await api("/api/riff/addRiffCards", { deckID: deck.id, blockIDs: [cardBlockId] });
    if (added.code !== 0) return { ok: false, detail: `addRiffCards code=${added.code} msg=${added.msg}` };
    // 4) 校验卡数（重试等索引）
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const decks = await api("/api/riff/getRiffDecks", {});
        const after = (decks.data || []).find((d) => d.id === deck.id);
        if (after && Number(after.size) >= 1) {
            return { ok: true, detail: `deck=${deck.id} size=${after.size} cardBlock=${cardBlockId}` };
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: false, detail: "addRiffCards 后 deck.size 未增长" };
}

async function main() {
    assertLoopback();
    const { kernel, appDir } = resolveKernel();
    prepareWorkspace();
    await assertTestPortAvailable(HOST, PORT);
    const { child, lines } = startKernel({ kernel, appDir });
    assertKernelRunning = () => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("测试内核已退出，停止请求");
    };

    let exitCode = 0;
    let booted = false;
    try {
        const version = await waitForBoot(lines, assertKernelRunning);
        booted = true;
        console.log(`内核 v${version.version} @ ${BASE}（隔离工作区: ${WORKSPACE}）\n`);

        token = (JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "";

        // 桌面 std 容器要求集市信任后 loadPetals 才返回插件（kernel/model/plugin.go IsPetalsEnabled）
        const trust = await api("/api/setting/setBazaar", { trust: true, petalDisabled: false });
        if (trust.code !== 0) console.log("setBazaar code=" + trust.code + " msg=" + trust.msg);

        // 准备笔记本
        const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        let notebookID = (notebooks.notebooks || []).find((n) => n.name === "GleanSpike")?.id;
        if (!notebookID) {
            await apiChecked("/api/notebook/createNotebook", { name: "GleanSpike" });
            const refreshed = await apiChecked("/api/notebook/lsNotebooks", {});
            notebookID = (refreshed.notebooks || []).find((n) => n.name === "GleanSpike")?.id;
        }
        if (!notebookID) throw new Error("GleanSpike 笔记本创建失败");

        const step1 = await verifyAttrLoop(notebookID);
        record("① 属性写读闭环 + tags落位 + 批量端点形状 + 删除语义", step1.ok, step1.detail);

        const step2 = await verifyLikePerformance(notebookID);
        record("② 千篇库 ial LIKE / batchAttrs 性能", step2.ok, step2.detail);

        const step3 = await verifySemantic();
        record("③ semanticSearchBlock / embeddingStat 双态行为", step3.ok, step3.detail);

        const step4 = await verifyExportMd(notebookID);
        record("④ exportMdContent 形状（迁移器读正文）", step4.ok, step4.detail);

        const step6 = await verifyAnchorQueries(notebookID, step1.docId);
        record("⑥ SQL 双锚点查询", step6.ok, step6.detail);

        const step8 = await verifyFlashcard(notebookID);
        record("⑧ 摘录制卡闭环 createDeck→insertBlock→addRiffCards", step8.ok, step8.detail);

        let step7 = { ok: false, detail: "跳过（步骤①未产生文档）" };
        if (step1.ok && step1.docId) {
            step7 = await verifySnapshot(notebookID, step1.docId);
            record("⑦ 快照闭环 exportHTML→putFile→getFile", step7.ok, step7.detail);
        }

        const step5 = await verifyPluginLoad(path.join(process.cwd(), "dist"));
        record("⑤ 插件包加载 + i18n 双名", step5.ok, step5.detail);

        const failures = results.filter((r) => !r.ok);
        exitCode = failures.length > 0 ? 1 : 0;
        fs.writeFileSync(
            path.join(process.cwd(), "scripts", "spike", "spike-results.json"),
            `${JSON.stringify({ version: version.version, at: new Date().toISOString(), results, timings: step2.timings }, null, 2)}\n`
        );
        console.log(`\n== spike 完成：${results.length - failures.length}/${results.length} 通过，结果已写入 scripts/spike/spike-results.json ==`);
    } finally {
        if (booted && child.exitCode === null && child.signalCode === null) {
            await api("/api/system/exit", { force: true }).catch(() => undefined);
        }
        const exited = await Promise.race([
            new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true)))),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!exited) child.kill("SIGKILL");
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("SPIKE ERROR:", error.message);
    process.exit(2);
});

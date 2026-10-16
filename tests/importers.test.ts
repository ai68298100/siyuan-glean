/** domain/importers 四格式解析器单测（T-1501） */
import test from "node:test";
import assert from "node:assert/strict";

import {
    detectFormat,
    normalizeImportFolder,
    parseCsv,
    parseImport,
    parseOmnivoreJson,
    parsePocketCsv,
    parsePocketHtml,
    parseWallabagJson,
    toSiyuanTime,
} from "../src/domain/importers.ts";

const POCKET_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/><title>Pocket Export</title></head><body>
<h1>Pocket Export</h1>
<ul>
<li><a href="https://example.com/a" time_added="1484250667" tags="ai, 架构">An AI Article</a></li>
<li><a href="https://example.com/b" time_added="1484250667" tags="">No Tags</a></li>
<li><a time_added="1484250667" href="https://example.com/c" tags="read-later">Swapped attrs</a></li>
</ul>
</body></html>`;

const POCKET_CSV = `"title","url","time_added","status","favorite","tags"
"Deep Read","https://deep.example.com/1","1484250667","unread","0","ai"
"Already Read","https://deep.example.com/2","1484250667","read","0",""
"Archived One","https://deep.example.com/3","1484250667","archive","0","tools"`;

const OMNIVORE_JSON = JSON.stringify([
    {
        id: "p1",
        title: "Local-first software",
        siteName: "inkandswitch.com",
        originalArticleUrl: "https://inkandswitch.com/local-first",
        savedAt: "2023-05-01T10:00:00Z",
        labels: [{ name: "crdt" }, { name: "sync" }],
        state: "SUCCEEDED",
    },
    {
        id: "p2",
        title: "Archived page",
        url: "https://example.com/archived",
        isArchived: true,
    },
]);

const WALLABAG_JSON = JSON.stringify({
    entries: [
        {
            title: "W1",
            url: "https://w.example.com/1",
            domain_name: "w.example.com",
            created_at: "2024-01-02T03:04:05+0000",
            tags: [{ label: "read" }, { label: "tech" }],
            is_archived: 0,
            is_read: 0,
        },
        {
            title: "W2 archived",
            url: "https://w.example.com/2",
            is_archived: 1,
        },
    ],
});

test("detectFormat：四种格式识别", () => {
    assert.equal(detectFormat(POCKET_HTML), "pocket-html");
    assert.equal(detectFormat(POCKET_CSV), "pocket-csv");
    assert.equal(detectFormat(OMNIVORE_JSON), "omnivore-json");
    assert.equal(detectFormat(WALLABAG_JSON), "wallabag-json");
    assert.equal(detectFormat("随便一段文字"), null);
});

test("parsePocketHtml：href/time/tags 属性顺序无关 + 标题去标签", () => {
    const result = parsePocketHtml(POCKET_HTML);
    assert.equal(result.format, "pocket-html");
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].title, "An AI Article");
    assert.deepEqual(result.items[0].tags, ["ai", "架构"]);
    assert.equal(result.items[0].time, "20170113035107"); // epoch 秒 → 本地时区墙钟(UTC+8)
    assert.equal(result.items[2].url, "https://example.com/c");
});

test("parsePocketHtml：畸形标签和换行标题不会留下活动标记或 Markdown 块", () => {
    const source = '<ul><li><a href="https://example.com/safe"><b>正常</b>\n\n# 注入 <scr<script>ipt>alert(1)</script> & <img src=x onerror=alert(1)></a></li></ul>';
    const result = parsePocketHtml(source);
    assert.equal(result.items[0].title, "正常 # 注入 ipt&gt;alert(1) &");
    assert.doesNotMatch(result.items[0].title, /<|>/);
});

test("parsePocketCsv：引号包裹与状态映射", () => {
    const result = parsePocketCsv(POCKET_CSV);
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].status, "inbox");
    assert.equal(result.items[1].status, "done");
    assert.equal(result.items[2].status, "archived");
    assert.deepEqual(result.items[2].tags, ["tools"]);
});

test("time_read：Pocket HTML/CSV 的已读时间进 doneTime，其余格式为空（D-0028）", () => {
    const html = parsePocketHtml(POCKET_HTML.replace(
        "time_added=\"1484250667\" tags=\"ai, 架构\"",
        "time_added=\"1484250667\" time_read=\"1484300000\" tags=\"ai, 架构\""
    ));
    assert.equal(html.items[0].doneTime, toSiyuanTime(1484300000));
    assert.equal(html.items[1].doneTime, "");
    const csv = parsePocketCsv(POCKET_CSV.replace(
        '"title","url","time_added","status","favorite","tags"',
        '"title","url","time_added","time_read","status","favorite","tags"'
    ).replace(
        '"Already Read","https://deep.example.com/2","1484250667","read","0",""',
        '"Already Read","https://deep.example.com/2","1484250667","1484300000","read","0",""'
    ));
    assert.equal(csv.items[1].doneTime, toSiyuanTime(1484300000));
    assert.equal(csv.items[1].status, "done");
    assert.equal(csv.items[0].doneTime, "");
    assert.equal(parseOmnivoreJson(OMNIVORE_JSON).items[0].doneTime, "");
    assert.equal(parseWallabagJson(WALLABAG_JSON).items[0].doneTime, "");
});

test("parseCsv：转义引号与逗号", () => {
    const rows = parseCsv('"a","x,y""z"\nb,c');
    assert.deepEqual(rows[0], ["a", "x,y\"z"]);
    assert.deepEqual(rows[1], ["b", "c"]);
});

test("parseOmnivoreJson：originalArticleUrl 优先 + isArchived 映射", () => {
    const result = parseOmnivoreJson(OMNIVORE_JSON);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].url, "https://inkandswitch.com/local-first");
    assert.deepEqual(result.items[0].tags, ["crdt", "sync"]);
    assert.equal(result.items[0].site, "inkandswitch.com");
    assert.equal(result.items[1].status, "archived");
    assert.ok(result.items[0].time.startsWith("20230501"));
});

test("parseWallabagJson：{entries} 包裹 + is_archived/is_read 映射", () => {
    const result = parseWallabagJson(WALLABAG_JSON);
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0].tags, ["read", "tech"]);
    assert.equal(result.items[0].status, "inbox");
    assert.equal(result.items[1].status, "archived");
});

test("toSiyuanTime：unix 秒与 ISO 双支持，非法为空", () => {
    assert.equal(toSiyuanTime(1484250667), "20170113035107"); // 本地时区
    assert.equal(toSiyuanTime("2023-05-01T10:00:00Z").slice(0, 8), "20230501");
    assert.equal(toSiyuanTime("not-a-date"), "");
    assert.equal(toSiyuanTime("2026-02-30T10:00:00Z"), "");
    assert.equal(toSiyuanTime("2024-02-29T10:00:00Z").slice(0, 8), "20240229");
});

test("parseImport auto + 文件内 URL 去重", () => {
    const dupHtml = POCKET_HTML.replace(
        "</ul>",
        '<li><a href="https://example.com/a/" time_added="1484250667" tags="">Dup</a></li>\n</ul>'
    );
    const result = parseImport(dupHtml, "auto");
    assert.equal(result.format, "pocket-html");
    assert.equal(result.items.length, 3); // 尾斜杠 URL 视为同一篇
    assert.equal(result.dropped, 1);
});

test("parseImport：全部无效输入返回空而不抛错", () => {
    const result = parseImport("not parseable", "auto");
    assert.equal(result.items.length, 0);
    assert.equal(result.format, null);
    assert.equal(result.issue, "unrecognized");
});

test("parseImport：空白和 BOM 文件单独诊断，不假冒 Pocket 格式", () => {
    for (const source of ["", " \r\n\t", "\uFEFF", "\uFEFF \n"]) {
        assert.deepEqual(parseImport(source, "auto"), { format: null, items: [], dropped: 0, issue: "empty" });
        assert.deepEqual(parseImport(source, "omnivore-json"), { format: "omnivore-json", items: [], dropped: 0, issue: "empty" });
    }
});

test("detectFormat：JSON 原始值和非记录首行不抛错，并继续寻找有格式证据的对象", () => {
    for (const source of ["[null]", "[1]", '["text"]', "[true]", "[[]]", "[{}]", "[]", "{}", "null", "{bad json"]) {
        assert.equal(detectFormat(source), null, source);
        assert.equal(parseImport(source, "auto").issue, "unrecognized", source);
    }
    assert.equal(detectFormat('[null, 1, [], {}, {"originalArticleUrl":"https://example.com/a"}]'), "omnivore-json");
    assert.equal(detectFormat('{"entries":[null, 1, [], {}, {"url":"https://example.com/a"}]}'), "wallabag-json");
    assert.equal(detectFormat('{"entries":[]}'), "wallabag-json");
});

test("parseImport：手动 JSON 格式区分语法或容器错误与未找到有效链接", () => {
    for (const source of ["{bad json", "null", "1", '"text"', "{}", '{"entries":[]}']) {
        assert.equal(parseImport(source, "omnivore-json").issue, "invalid", source);
    }
    for (const source of ["{bad json", "null", "1", '"text"', "{}", '{"entries":{}}']) {
        assert.equal(parseImport(source, "wallabag-json").issue, "invalid", source);
    }
    for (const format of ["omnivore-json", "wallabag-json"] as const) {
        for (const source of ["[]", "[null,1,true,[],{}]"]) {
            assert.equal(parseImport(source, format).issue, "no-items", `${format}: ${source}`);
        }
    }
    assert.equal(parseImport('{"entries":[]}', "auto").issue, "no-items");
    assert.equal(parseImport('{"entries":[null,{}, {"url":"javascript:alert(1)"}]}', "wallabag-json").issue, "no-items");
});

test("parseImport：CSV 必需 URL 表头与其他格式误选单独诊断", () => {
    for (const source of ["title,time_added\n文章,1484250667", "https://example.com/a", POCKET_HTML, OMNIVORE_JSON, WALLABAG_JSON]) {
        assert.equal(parseImport(source, "pocket-csv").issue, "invalid", source);
    }
    for (const source of ["title,url,time_added", '"title","url","time_added"\r\n', "url"]) {
        assert.equal(parseImport(source, "pocket-csv").issue, "no-items", source);
    }
    assert.equal(parseImport("title,url,time_added\n没有链接,,1484250667", "auto").issue, "no-items");
    assert.equal(parseImport("title,url,time_added\n无效链接,ftp://example.com/a,1484250667", "auto").issue, "no-items");
    for (const firstHeader of ["[id]", "{id}", "<id>"]) {
        const source = `${firstHeader},url,time_added\n1,https://example.com/a,`;
        assert.deepEqual(parseImport(source, "pocket-csv"), { ...parsePocketCsv(source), issue: null });
    }
});

test("parseImport：HTML 标签结构无合法链接与纯文本误选区分，继续兼容片段", () => {
    assert.equal(parseImport("这是一段普通文字", "pocket-html").issue, "invalid");
    for (const source of ["<!DOCTYPE html><html><body></body></html>", "<p>没有链接</p>", '<ul><li><a href="javascript:alert(1)">无效链接</a></li></ul>']) {
        assert.equal(parseImport(source, "pocket-html").issue, "no-items", source);
    }
    assert.equal(parseImport('<a href="https://example.com/a">文章</a>', "pocket-html").issue, null);
});

test("parseImport：四格式有效输出保留原解析顺序、状态与 dropped", () => {
    const cases = [
        ["pocket-html", POCKET_HTML, parsePocketHtml],
        ["pocket-csv", POCKET_CSV, parsePocketCsv],
        ["omnivore-json", OMNIVORE_JSON, parseOmnivoreJson],
        ["wallabag-json", WALLABAG_JSON, parseWallabagJson],
    ] as const;
    for (const [format, source, parse] of cases) {
        assert.deepEqual(parseImport(source, format), { ...parse(source), issue: null }, format);
        assert.deepEqual(parseImport(source, "auto"), { ...parse(source), issue: null }, format);
    }
});

test("parseImport：混合无效行与合法条目仍可预览，JSON BOM 不妨碍结构诊断", () => {
    const source = '[null, 1, [], {}, {"originalArticleUrl":"javascript:alert(1)"}, {"title":"合法文章","originalArticleUrl":"https://example.com/a"}, {"originalArticleUrl":"https://example.com/a#dup"}]';
    const result = parseImport(`\uFEFF${source}`, "auto");
    assert.equal(result.format, "omnivore-json");
    assert.equal(result.issue, null);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "合法文章");
    assert.equal(result.dropped, parseOmnivoreJson(source).dropped);
});

test("normalizeImportFolder：清理斜杠/空段/越级/非法字符（T-1988）", () => {
    assert.equal(normalizeImportFolder("/导入/"), "导入");
    assert.equal(normalizeImportFolder("a//b"), "a/b");
    assert.equal(normalizeImportFolder("../外部"), "外部");
    assert.equal(normalizeImportFolder("a/./../b"), "a/b");
    assert.equal(normalizeImportFolder(".."), "导入");
    assert.equal(normalizeImportFolder("."), "导入");
    assert.equal(normalizeImportFolder("  "), "导入");
    assert.equal(normalizeImportFolder("a\\b"), "a/b");
    assert.equal(normalizeImportFolder('文件:名?'), "文件 名");
    assert.equal(normalizeImportFolder('文/件:名?'), "文/件 名");
    assert.equal(normalizeImportFolder("web-clip"), "web-clip");
});

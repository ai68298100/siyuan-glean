/** domain/importers 四格式解析器单测（T-1501） */
import test from "node:test";
import assert from "node:assert/strict";

import {
    detectFormat,
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
});

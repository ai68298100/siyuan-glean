/** domain/csv 转义纯函数单测（T-1772，RFC 4180） */
import test from "node:test";
import assert from "node:assert/strict";

import { csvCell, toCsv } from "../src/domain/csv.ts";

test("csvCell：逗号/引号/换行加引号转义，普通值原样", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
    assert.equal(csvCell(42), "42");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
});

test("toCsv：多行 CRLF 行尾", () => {
    assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a,b\r\nc,d");
    assert.equal(toCsv([["x,1", 'y"2'], ["", 3]]), '"x,1","y""2"\r\n,3');
});

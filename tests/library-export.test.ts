import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, renderLibraryCsv } from "../src/domain/library-export.ts";

test("library CSV keeps unknown values empty and protects formulas", () => {
    assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
    const csv = renderLibraryCsv([{
        id: "id", title: "=title", path: "", notebook: "", status: "inbox", url: "https://x",
        site: "", author: "=Author", time: "", doneTime: "", words: "", minutes: "", readMinutes: "", priority: "", rating: "",
        source: "", contentType: "", timeSource: "", lastSurfaced: "", pinned: "20260929", userTags: [], aiTags: [], summary: "", snapshot: "",
    }]);
    assert.match(csv, /'=title/);
    assert.match(csv, /site,author,time/);
    assert.match(csv, /'=Author/);
    assert.match(csv, /inbox/);
    assert.match(csv, /lastSurfaced,pinned/);
    assert.match(csv, /words,minutes,readMinutes,priority/);
    assert.match(csv, /20260929/);
});

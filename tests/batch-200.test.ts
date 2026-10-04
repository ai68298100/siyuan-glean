import test from "node:test";
import assert from "node:assert/strict";

import { isActivationKey } from "../src/domain/keyboard.ts";
import { resolveCarrier, hasSourceAction, openTargetForCarrier } from "../src/domain/carrier.ts";
import { fulltextBodyState, inspectClipMarkdown } from "../src/domain/content.ts";
import { canTransition, type ClipStatus } from "../src/domain/schema.ts";
import { chunkSpeechText, clampSpeechRate, normalizeSpeechText, speechLanguage } from "../src/domain/speech.ts";
import { normalizeSettings } from "../src/services/settings.ts";
import { filterAndSortLibrary, matchesLibraryFilter, type LibraryItem } from "../src/domain/library-view.ts";
import { normalizeUrl } from "../src/domain/url.ts";

const batch = (id: number, label: string) => `BATCH-200-${String(id).padStart(3, "0")} ${label}`;

const keyboardCases: Array<[string, boolean]> = [
    ["Enter", true], [" ", true], ["Tab", false], ["Escape", false], ["ArrowUp", false],
    ["ArrowDown", false], ["ArrowLeft", false], ["ArrowRight", false], ["Home", false], ["End", false],
    ["PageUp", false], ["PageDown", false], ["Backspace", false], ["Delete", false], ["Shift", false],
    ["Control", false], ["Alt", false], ["Meta", false], ["a", false], ["enter", false],
];
keyboardCases.forEach(([key, expected], index) => {
    test(batch(index + 1, `keyboard activation ${JSON.stringify(key)}`), () => {
        assert.equal(isActivationKey(key), expected);
    });
});

const rateCases: Array<[number, number]> = [
    [-100, 0.75], [-1, 0.75], [0, 0.75], [0.1, 0.75], [0.74, 0.75],
    [0.75, 0.75], [0.76, 0.75], [0.87, 0.75], [0.88, 1], [1, 1],
    [1.12, 1], [1.13, 1.25], [1.25, 1.25], [1.37, 1.25], [1.38, 1.5],
    [1.5, 1.5], [1.51, 1.5], [2, 1.5], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1],
];
rateCases.forEach(([value, expected], index) => {
    test(batch(index + 21, `speech rate ${String(value)}`), () => {
        assert.equal(clampSpeechRate(value), expected);
    });
});

const normalizeCases: Array<[string, string]> = [
    ["", ""], ["   ", ""], ["\n\t", ""], [" a ", "a"], ["a\tb", "a b"],
    ["a\n\nb", "a b"], ["中文\nEnglish", "中文 English"], ["  a   b  ", "a b"], ["a\r\nb", "a b"], ["\u00a0a\u00a0", "a"],
    ["一  二  三", "一 二 三"], ["a\t\tb", "a b"], ["\n a \n", "a"], ["句号。下一句", "句号。下一句"],
    ["问号？回答", "问号？回答"], ["! !", "! !"], ["a\u000bb", "a b"], ["a\f b", "a b"], ["  混合  text  ", "混合 text"], ["x\ny\tz", "x y z"],
];
normalizeCases.forEach(([value, expected], index) => {
    test(batch(index + 41, "speech text normalization"), () => {
        assert.equal(normalizeSpeechText(value), expected);
    });
});

const chunkCases: Array<[string, number]> = [
    ["", 1], ["   ", 2], ["one", 3], ["one two", 3], ["一句。下一句。", 4],
    ["一二三四五", 2], ["alpha;beta;gamma", 5], ["中文：英文：混合", 4], ["a!b!c!", 2], ["a?b?c?", 2],
    ["第一；第二；第三", 3], ["one:two:three", 4], ["a.b.c", 2], ["a\n\nb", 10], ["长文本".repeat(40), 20],
    ["句子。".repeat(30), 12], ["short sentence", 220], ["two words", 1], ["  trimmed  ", 8], ["中文 English", 6],
];
chunkCases.forEach(([value, maxLength], index) => {
    test(batch(index + 61, "speech chunk safety"), () => {
        const chunks = chunkSpeechText(value, maxLength);
        assert.deepEqual(chunks, chunkSpeechText(value, maxLength));
        assert.ok(chunks.every((chunk) => Array.from(chunk).length <= maxLength));
        if (normalizeSpeechText(value) && maxLength >= 1) assert.ok(chunks.length > 0);
    });
});

const languageCases: Array<[string, "zh-CN" | "en-US"]> = [
    ["中文", "zh-CN"], ["English", "en-US"], ["中a", "zh-CN"], ["中ab", "en-US"], ["中英a", "zh-CN"],
    ["abc中文", "en-US"], ["你好世界", "zh-CN"], ["four words", "en-US"], ["1 2 3", "zh-CN"], ["A1", "en-US"],
    ["测试 test", "en-US"], ["test 测", "en-US"], ["ABC", "en-US"], ["一A", "zh-CN"], ["AA中", "en-US"],
    ["。", "zh-CN"], ["!", "zh-CN"], ["中文中文english", "en-US"], ["english中文中文", "en-US"], ["", "zh-CN"],
];
languageCases.forEach(([value, expected], index) => {
    test(batch(index + 81, "speech language selection"), () => {
        assert.equal(speechLanguage(value), expected);
    });
});

const urlCases: Array<[string, string]> = [
    ["", ""], ["   ", ""], ["javascript:alert(1)", ""], ["file:///tmp/a", ""], ["ftp://example.com/a", ""],
    ["https://EXAMPLE.COM", "https://example.com/"], ["http://EXAMPLE.COM:80/", "http://example.com/"], ["https://example.com:443/a/", "https://example.com/a"],
    ["https://example.com/a/#x", "https://example.com/a"], ["https://example.com/a/?q=1", "https://example.com/a?q=1"], ["https://example.com/a///", "https://example.com/a"],
    ["http://example.com:8080/a", "http://example.com:8080/a"], ["HTTPS://Example.Com/A?b=2&a=1", "https://example.com/A?b=2&a=1"], ["https://example.com/#hash", "https://example.com/"],
    ["https://例子.测试/路径", "https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84"], ["not a url", ""], ["//example.com/a", ""], ["mailto:a@b.com", ""],
    ["https://example.com/a%20b", "https://example.com/a%20b"], ["https://example.com/?q=a+b", "https://example.com/?q=a+b"],
];
urlCases.forEach(([value, expected], index) => {
    test(batch(index + 101, "URL normalization"), () => {
        assert.equal(normalizeUrl(value), expected);
    });
});

const carrierCases: Array<[string | undefined, string | undefined, string, boolean, "document" | "source"]> = [
    [undefined, undefined, "unknown", false, "document"], ["", "", "unknown", false, "document"], ["video", "https://a.com", "unknown", true, "document"],
    ["fulltext", "https://a.com", "fulltext", true, "document"], ["fulltext", "", "fulltext", false, "document"], ["fulltext", "javascript:a", "fulltext", false, "document"],
    ["link", "https://a.com", "link", true, "source"], ["link", "http://a.com/a", "link", true, "source"], ["link", "", "link", false, "document"], ["link", "ftp://a.com", "link", false, "document"],
    ["local", "https://a.com", "local", false, "document"], ["local", "", "local", false, "document"], ["unknown", "https://a.com", "unknown", true, "document"], ["fulltext", "HTTP://A.COM:80", "fulltext", true, "document"],
    ["link", " https://a.com/a#b ", "link", true, "source"], ["link", "file:///a", "link", false, "document"], ["local", "javascript:x", "local", false, "document"],
    ["fulltext", "https://a.com/", "fulltext", true, "document"], ["link", "https://a.com/", "link", true, "source"], ["unknown", "http://a.com", "unknown", true, "document"],
];
carrierCases.forEach(([contentType, rawUrl, expectedCarrier, expectedSourceAction, expectedTarget], index) => {
    test(batch(index + 121, "carrier open policy"), () => {
        assert.equal(resolveCarrier(contentType), expectedCarrier);
        assert.equal(hasSourceAction(contentType, rawUrl), expectedSourceAction);
        assert.equal(openTargetForCarrier(contentType, rawUrl), expectedTarget);
    });
});

const statuses: ClipStatus[] = ["inbox", "later", "reading", "done", "archived"];
const transitionCases: Array<[ClipStatus, ClipStatus, boolean]> = [
    ["inbox", "inbox", true], ["inbox", "later", true], ["inbox", "reading", true], ["inbox", "done", true], ["inbox", "archived", true],
    ["later", "inbox", true], ["later", "later", true], ["later", "reading", true], ["later", "done", true], ["later", "archived", true],
    ["reading", "inbox", false], ["reading", "later", true], ["reading", "reading", true], ["reading", "done", true], ["reading", "archived", true],
    ["done", "inbox", false], ["done", "later", false], ["done", "reading", true], ["done", "done", true], ["done", "archived", true],
];
transitionCases.forEach(([from, to, expected], index) => {
    test(batch(index + 141, `status transition ${from}->${to}`), () => {
        assert.equal(canTransition(from, to), expected);
        assert.ok(statuses.includes(from) && statuses.includes(to));
    });
});

const settingsCases: Array<[unknown, (settings: ReturnType<typeof normalizeSettings>) => unknown, unknown]> = [
    [{}, (s) => s.ai.enrichMode, "manual"], [{ ai: { enrichMode: "off" } }, (s) => s.ai.enrichMode, "off"],
    [{ ai: { enrichMode: "auto" } }, (s) => s.ai.enrichMode, "auto"], [{ ai: { enrichMode: "bad" } }, (s) => s.ai.enrichMode, "manual"],
    [{ ai: { enrichDailyCap: -1 } }, (s) => s.ai.enrichDailyCap, 0], [{ ai: { enrichDailyCap: 999 } }, (s) => s.ai.enrichDailyCap, 500],
    [{ ai: { enrichDailyCap: 9 } }, (s) => s.ai.enrichDailyCap, 9], [{ resurface: { dailyCount: 0 } }, (s) => s.resurface.dailyCount, 1],
    [{ resurface: { dailyCount: 99 } }, (s) => s.resurface.dailyCount, 10], [{ resurface: { dailyCount: 4 } }, (s) => s.resurface.dailyCount, 4],
    [{ inboxQuota: 0 }, (s) => s.inboxQuota, 5], [{ inboxQuota: 9999 }, (s) => s.inboxQuota, 1000],
    [{ inboxQuota: 20 }, (s) => s.inboxQuota, 20], [{ staleDays: 0 }, (s) => s.staleDays, 7], [{ staleDays: 4000 }, (s) => s.staleDays, 3650],
    [{ staleDays: 30 }, (s) => s.staleDays, 30], [{ reader: { openInTab: true, defaultMode: "edit" } }, (s) => s.reader.openInTab, true],
    [{ reader: { defaultMode: "wysiwyg" } }, (s) => s.reader.defaultMode, "read"], [{ ai: { channel: "custom" } }, (s) => s.ai.channel, "custom"],
];
settingsCases.forEach(([raw, pick, expected], index) => {
    test(batch(index + 161, "settings normalization"), () => {
        assert.equal(pick(normalizeSettings(raw)), expected);
    });
});

const contentCases: Array<[string | undefined, number | undefined, string]> = [
    ["fulltext", 10, "ok"], ["fulltext", 1, "ok"], ["fulltext", 0, "missing"], ["fulltext", -1, "missing"], ["fulltext", undefined, "unmeasured"],
    ["link", 10, "na"], ["link", 0, "na"], ["link", undefined, "na"], ["local", 10, "na"], ["local", 0, "na"],
    [undefined, 10, "na"], [undefined, 0, "na"], [undefined, undefined, "na"], ["unknown", 3, "na"], ["fulltext", Number.NaN, "missing"],
    ["fulltext", Number.POSITIVE_INFINITY, "ok"], ["local", Number.NaN, "na"], ["link", Number.POSITIVE_INFINITY, "na"], ["fulltext", 2.5, "ok"], ["fulltext", -0.1, "missing"],
];
contentCases.forEach(([contentType, words, expected], index) => {
    test(batch(index + 181, "fulltext body state"), () => {
        assert.equal(fulltextBodyState(contentType, words), expected);
    });
});

const libraryBase: LibraryItem[] = [
    { kind: "clip", id: "a", title: "Alpha", hpath: "H/A", updated: "20261001000000", status: "inbox", site: "example.com", tags: ["one"], aiTags: ["ai"], src: "manual", contentType: "fulltext", time: "20261001000000", words: 100, priority: 3, rating: 2 },
    { kind: "clip", id: "b", title: "Beta", hpath: "H/B", updated: "20261002000000", status: "done", site: "other.com", tags: ["two"], aiTags: ["ml"], src: "import", contentType: "link", time: "20261002000000", words: 0, priority: 5, rating: 5 },
    { kind: "candidate", id: "c", title: "Candidate", hpath: "H/C", updated: "20261003000000", site: "example.com", url: "https://example.com/c" },
];
const libraryCases: Array<[string, () => boolean]> = [
    ["status inbox", () => filterAndSortLibrary(libraryBase, { status: "inbox" }).map((item) => item.id).join(",") === "a"],
    ["status done", () => filterAndSortLibrary(libraryBase, { status: "done" }).map((item) => item.id).join(",") === "b"],
    ["candidate hidden", () => filterAndSortLibrary(libraryBase, {}).every((item) => item.kind === "clip")],
    ["candidate included", () => filterAndSortLibrary(libraryBase, { includeCandidates: true }).some((item) => item.id === "c")],
    ["site exact", () => filterAndSortLibrary(libraryBase, { site: "example.com" }).map((item) => item.id).join(",") === "a"],
    ["site case insensitive", () => filterAndSortLibrary(libraryBase, { site: "EXAMPLE.COM" }).length === 1],
    ["tag exact", () => filterAndSortLibrary(libraryBase, { tag: "one" }).map((item) => item.id).join(",") === "a"],
    ["ai tag separate", () => filterAndSortLibrary(libraryBase, { aiTag: "ml" }).map((item) => item.id).join(",") === "b"],
    ["source filter", () => filterAndSortLibrary(libraryBase, { src: "import" }).map((item) => item.id).join(",") === "b"],
    ["content filter", () => filterAndSortLibrary(libraryBase, { contentType: "link" }).map((item) => item.id).join(",") === "b"],
    ["keyword title", () => matchesLibraryFilter(libraryBase[0], { keyword: "alpha" })],
    ["keyword site", () => matchesLibraryFilter(libraryBase[0], { keyword: "example" })],
    ["keyword miss", () => !matchesLibraryFilter(libraryBase[0], { keyword: "missing" })],
    ["time desc", () => filterAndSortLibrary(libraryBase, { sortBy: "time", direction: "desc" }).map((item) => item.id).join(",") === "b,a"],
    ["time asc", () => filterAndSortLibrary(libraryBase, { sortBy: "time", direction: "asc" }).map((item) => item.id).join(",") === "a,b"],
    ["title asc", () => filterAndSortLibrary(libraryBase, { sortBy: "title", direction: "asc" }).map((item) => item.id).join(",") === "a,b"],
    ["priority desc", () => filterAndSortLibrary(libraryBase, { sortBy: "priority", direction: "desc" }).map((item) => item.id).join(",") === "b,a"],
    ["rating desc", () => filterAndSortLibrary(libraryBase, { sortBy: "rating", direction: "desc" }).map((item) => item.id).join(",") === "b,a"],
    ["content metadata", () => inspectClipMarkdown("# Title\n\n正文内容").contentType === "local"],
    ["filter does not mutate", () => { const before = libraryBase.map((item) => item.id).join(","); filterAndSortLibrary(libraryBase, { sortBy: "title" }); return libraryBase.map((item) => item.id).join(",") === before; }],
];
libraryCases.forEach(([label, check], index) => {
    test(batch(index + 201, `library projection ${label}`), () => {
        assert.equal(check(), true);
    });
});

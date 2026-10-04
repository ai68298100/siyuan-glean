import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error("Usage: node scripts/spike/clipper-author-probe.mjs <official-extension-source>");
const root = path.resolve(sourceRoot);
const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
assert.equal(revision, "00182d4b5cd40bba0ee48c768740786a9a69235a", "Review a different extension revision before using this probe");
const source = readFileSync(path.join(root, "background.js"), "utf8").replaceAll("\r\n", "\n");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `Missing ${name}`);
    const end = source.indexOf("\n}\n", start);
    assert(end > start, `Missing end of ${name}`);
    return source.slice(start, end + 2);
}

const context = vm.createContext({
    SIYUAN_DEFAULT_CLIP_TEMPLATE: "${content}",
    formatClipExcerpt: (value) => value ?? "",
    decodeClipUrl: (value) => value,
    getClipSimpleDateTime: () => ({ date: "2026-10-04", time: "12:00" }),
    getDefaultClipMarkdown: () => { throw new Error("Template fallback must not hide a failure"); },
});
vm.runInContext(`${extractFunction("renderClipTemplate")}\n${extractFunction("buildClipMarkdown")}`, context, { timeout: 1000 });
const result = vm.runInContext(`({
    unknownAuthor: renderClipTemplate('\u0024{author}|\u0024{byline}', {title: 'Title'}),
    selector: renderClipTemplate('\u0024{document.querySelector("#js_name").textContent}', {title: 'Title'}),
    supportedConditional: renderClipTemplate('\u0024{siteName ? " · " + siteName : ""}', {siteName: 'Site'}),
    injectedAuthor: buildClipMarkdown({title: 'Title', href: 'https://example.org/article', siteName: 'Site', author: 'Supplied author', byline: 'Supplied byline'}, 'Body', '\u0024{author}|\u0024{byline}|\u0024{content}')
})`, context, { timeout: 1000 });
assert.equal(result.unknownAuthor, "|");
assert.equal(result.selector, "");
assert.equal(result.supportedConditional, " · Site");
assert.equal(result.injectedAuthor, "||Body");
console.log(JSON.stringify({ revision, extensionVersion: manifest.version, ...result, passed: true }, null, 2));

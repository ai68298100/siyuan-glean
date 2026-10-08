// 一次性审计：找出 i18n 中无代码引用的死键（字面量 + 动态模板前缀双向核对）
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const p = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(p) : /\.(ts|svelte|mjs)$/.test(entry.name) ? [p] : [];
    });
}

const root = process.cwd();
const srcFiles = [...walk(path.join(root, "src")), ...walk(path.join(root, "tests"))];
const sources = srcFiles.map((f) => [f, fs.readFileSync(f, "utf8")]);

const literals = new Set();
for (const [, src] of sources) {
    for (const m of src.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+)["'`]/g)) literals.add(m[1]);
}
const dynamicPrefixes = [];
for (const [, src] of sources) {
    for (const m of src.matchAll(/[`"']([a-zA-Z][a-zA-Z0-9.-]*)\$\{/g)) dynamicPrefixes.push(m[1]);
}

const zh = JSON.parse(fs.readFileSync(path.join(root, "public/i18n/zh_CN.json"), "utf8"));
const dead = Object.keys(zh).filter((k) => {
    if (literals.has(k)) return false;
    return !dynamicPrefixes.some((p) => k.startsWith(p));
});
console.log("total keys:", Object.keys(zh).length, "| dead keys:", dead.length);
console.log(dead.join("\n"));

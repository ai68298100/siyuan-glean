/** i18n 双名 parity + plugin.json 合法性守门 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("i18n：zh_CN.json 与 en_US.json 键集合一致（内核只加载命中的那一份）", () => {
    const zh = JSON.parse(readFileSync(resolve(root, "public/i18n/zh_CN.json"), "utf8"));
    const en = JSON.parse(readFileSync(resolve(root, "public/i18n/en_US.json"), "utf8"));
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    assert.deepEqual(zhKeys, enKeys);
});

test("i18n：值全为非空字符串", () => {
    for (const file of ["public/i18n/zh_CN.json", "public/i18n/en_US.json"]) {
        const bundle = JSON.parse(readFileSync(resolve(root, file), "utf8"));
        for (const [key, value] of Object.entries(bundle)) {
            assert.equal(typeof value, "string", `${file}:${key} 需为字符串`);
            assert.ok((value as string).length > 0, `${file}:${key} 不能为空`);
        }
    }
});

test("i18n：源码中显式引用的文案在两种语言中均存在", () => {
    const bundles = ["zh_CN", "en_US"].map((language) => JSON.parse(readFileSync(resolve(root, `public/i18n/${language}.json`), "utf8")));
    const scan = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const filename = join(directory, entry.name);
            if (entry.isDirectory()) {
                scan(filename);
            } else if (/\.(ts|svelte)$/.test(filename)) {
                const source = readFileSync(filename, "utf8");
                for (const match of source.matchAll(/\bt\([^,]+,\s*["']([^"']+)["']/g)) {
                    for (const bundle of bundles) assert.ok(Object.hasOwn(bundle, match[1]), `${filename}: 缺失文案 ${match[1]}`);
                }
            }
        }
    };
    scan(resolve(root, "src"));
});

test("plugin.json：命名定案与最低内核版本", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
    assert.equal(manifest.name, "siyuan-glean");
    assert.equal(manifest.displayName["zh-CN"], "小驴拾遗");
    assert.equal(manifest.displayName.default, "Lv Glean");
    assert.ok(parseInt(manifest.minAppVersion, 10) >= 3);
    assert.equal(manifest.icon, "icon.png");
    assert.equal(manifest.preview, "preview.png");
});

test("i18n：命令键与入口文案关键词覆盖（集市检索补偿）", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
    const keywords = (manifest.keywords as string[]).join(",");
    for (const word of ["剪藏", "稍后读", "阅读", "收件箱", "读库"]) {
        assert.ok(keywords.includes(word), `keywords 缺「${word}」`);
    }
});

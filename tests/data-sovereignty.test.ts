import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else yield full;
    }
}

test("文章属性底层写端点只能由 clip-store 统一封装", () => {
    const srcFiles = [...walk(resolve(root, "src"))].filter((file) => /\.(ts|svelte)$/.test(file));
    for (const file of srcFiles) {
        const normalized = file.replace(/\\/g, "/");
        if (normalized.endsWith("/src/api/client.ts") || normalized.endsWith("/src/services/clip-store.ts")) continue;
        const source = readFileSync(file, "utf8");
        assert.doesNotMatch(source, /\b(?:setBlockAttrs|batchSetBlockAttrs)\b/, `${file} 绕过 clip-store 使用属性写端点`);
    }
});

test("属性写入实现同时负责索引同步，避免成功写属性却伪造完整状态", () => {
    const source = readFileSync(resolve(root, "src/services/clip-store.ts"), "utf8");
    assert.match(source, /await setBlockAttrs\(docId, serialized\)/);
    assert.match(source, /applyAttrsToIndex\(index/);
    assert.match(source, /await saveIndex\(plugin, index\)/);
});

test("错误路径审计要求智能体返回真实归档成功数", () => {
    const source = readFileSync(resolve(root, "src/index.ts"), "utf8");
    assert.match(source, /batchSetStatusDetailed/);
    assert.match(source, /attempted: stale\.length/);
    assert.match(source, /archived: result\.ok/);
    assert.match(source, /failed: stale\.length - result\.ok/);
});


/** 架构守门：分层单向依赖（AGENTS.md 铁律 2/3） */
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

const domainFiles = [...walk(resolve(root, "src/domain"))].filter((file) => file.endsWith(".ts"));

test("domain/ 是纯函数层：禁 import svelte/siyuan/api/services/ui", () => {
    for (const file of domainFiles) {
        const source = readFileSync(file, "utf8");
        assert.ok(!/from\s+["'](svelte|siyuan)["']/.test(source), `${file} 禁止 import svelte/siyuan`);
        assert.ok(!/from\s+["']\.\.\/(api|services|ui|libs)/.test(source), `${file} 禁止反向依赖上层`);
    }
});

test("api/ 是唯一内核传输层：全仓只有 api/ 允许出现内核端点字符串", () => {
    const srcFiles = [...walk(resolve(root, "src"))].filter((file) => /\.(ts|svelte)$/.test(file));
    const endpointPattern = /\/api\/(attr|query|notebook|filetree|export|search|ai|block)\//;
    for (const file of srcFiles) {
        if (file.replace(/\\/g, "/").includes("/src/api/")) continue;
        const source = readFileSync(file, "utf8");
        assert.ok(!endpointPattern.test(source), `${file} 出现内核端点字符串，必须走 src/api/`);
    }
});

test("UI 不直接出现 fetchPost/fetchSyncPost", () => {
    const uiFiles = [...walk(resolve(root, "src/ui"))].filter((file) => /\.(ts|svelte)$/.test(file));
    for (const file of uiFiles) {
        const source = readFileSync(file, "utf8");
        assert.ok(!/fetch(Sync)?Post/.test(source), `${file} 禁止直接 fetch 内核`);
    }
});

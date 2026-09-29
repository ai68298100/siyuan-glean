/* E2E 工作区准备（不含内核启动）：dist 拷入 + 标记，供桌面客户端 --workspace 指向。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Glean-E2E");

// 隔离护栏（同 spike 纪律）
const resolved = path.resolve(WORKSPACE);
const relRepo = path.relative(resolved, process.cwd());
if (resolved === path.parse(resolved).root || path.relative(os.homedir(), resolved) === "" || !(relRepo === ".." || relRepo.startsWith(`..${path.sep}`) || path.isAbsolute(relRepo))) {
    throw new Error("拒绝使用宽泛或项目目录作为测试工作区");
}
const marker = path.join(resolved, "glean-e2e.json");
if (!fs.existsSync(marker)) throw new Error(`E2E 工作区不存在或无标记（先跑 launch-e2e.mjs 生成）: ${resolved}`);

// dist → 插件目录
const distDir = path.join(process.cwd(), "dist");
if (!fs.existsSync(path.join(distDir, "index.js"))) throw new Error("dist/index.js 不存在，先 pnpm build");
const target = path.join(WORKSPACE, "data", "plugins", "siyuan-glean");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(distDir, target, { recursive: true });
console.log("E2E 工作区已就绪：", WORKSPACE);

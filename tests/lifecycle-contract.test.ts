import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("官方 Petal 插件生命周期契约：LvGleanPlugin 必须覆盖 onDataChanged 防止数据同步时暴力重载", () => {
    const source = read("src/index.ts");
    assert.match(source, /async\s+onDataChanged\s*\(\s*reason\?:\s*"sync"\s*\|\s*"overwrite"\s*\):\s*Promise<void>/, "必须实现 onDataChanged 契约");
    assert.match(source, /this\.settings\s*=\s*await\s+loadSettings\(this\)/, "onDataChanged 需重新同步配置");
    assert.match(source, /this\.notifyDataChanged\(\)/, "onDataChanged 需触发通知让视图就地响应");
});

test("顶栏按钮挂载契约：onLayoutReady 必须具备幂等性与单实例防护", () => {
    const source = read("src/index.ts");
    assert.match(source, /private topBarElement\?: HTMLElement;/, "需记录挂载的顶栏元素引用");
    assert.match(source, /if\s*\(this\.topBarElement\)\s*return;/, "多次触发 onLayoutReady 时拒绝重复添加顶栏按钮");
    assert.match(source, /this\.topBarElement\s*=\s*this\.addTopBar\(/, "保存顶栏元素引用");
    assert.match(source, /this\.topBarElement\s*=\s*undefined;/, "onunload 必须清空顶栏元素引用");
});

test("官方自定义协议与云同步完成事件契约：open-siyuan-url-plugin 与 sync-end 完整接线与配对销毁", () => {
    const source = read("src/index.ts");
    assert.match(source, /this\.eventBus\.on\("open-siyuan-url-plugin",\s*this\.onPluginUrl\)/, "onload 注册 open-siyuan-url-plugin");
    assert.match(source, /this\.eventBus\.on\("sync-end",\s*this\.onSyncEnd\)/, "onload 注册 sync-end");
    assert.match(source, /this\.eventBus\.off\("open-siyuan-url-plugin",\s*this\.onPluginUrl\)/, "onunload 注销 open-siyuan-url-plugin");
    assert.match(source, /this\.eventBus\.off\("sync-end",\s*this\.onSyncEnd\)/, "onunload 注销 sync-end");
    assert.match(source, /const\s+action\s*=\s*parsed\.searchParams\.get\("action"\)/, "解析外部 URL action 指令");
});

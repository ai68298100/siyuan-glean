# 研究：纯浏览器 UI 自动化冒烟的可行性（2026-09-29，T-1601 附带调查）

> 目标：把真实 dist 装入隔离内核，用浏览器驱动完整思源 Web UI 做插件级冒烟（四视图渲染/交互）。
> 结论：**桌面版 stage 构建无法在纯浏览器（非 Electron）环境启动**——环境限制，非插件缺陷。
> 现状：E2E 启动器已落地（`scripts/e2e/launch-e2e.mjs`），供作者桌面客户端/未来 Electron 自动化使用。

## 实验过程

1. 启动器（已入库）：隔离工作区 + 真实 dist 拷贝 + setBazaar 信任 + setPetalEnabled + 演示数据
   （锚点笔记本 GleanE2E + 4 篇不同状态剪藏）→ `node scripts/e2e/launch-e2e.mjs`，服务保持运行。
   内核侧全部成功：loadPetals 含插件、i18n 227 键、演示数据就绪。
2. 浏览器（ZCode IAB，Chromium）打开 `http://127.0.0.1:6833` → 思源首屏卡在
   "Click to Refresh"（模板 7 秒后无条件显示的按钮），`window.siyuan` 始终 undefined。
3. 排除过程：
   - 启动 API 全部可达且 200（version/getConf/bootProgress=100/loadPetals 含本插件）；
   - stage 资源全部 200（runtime/vendors/common/main 均加载）；
   - 页面内 WebSocket 误用 `/ws/app`（404 路径）导致一度误判；内核真实路由为 `/ws`，
     **Node 与页面内均可 OPEN**；
   - 主模块（webpack chunk）含 `require("electron")` 外部引用（桌面构建产物，apicontract 顶层
     electron 模块在纯浏览器无 shim）→ 模块求值即抛 → boot 中止 → `window.siyuan` 永不赋值。

## 结论

桌面安装的 `stage/build/app` 是 Electron 渲染层构建（`/// #if !BROWSER` 段被编入），
`require("electron")` 外部在无 shim 的纯浏览器环境必然失败。**思源 v3.8.5 的浏览器可访问 UI
走的是发布服务/独立前端路径，与桌面 stage 不是同一构建**——插件级 Web UI 自动化冒烟需要：
(a) Electron 环境（真机客户端 + 计算机操作），或 (b) 内核侧提供 browser 构建的 stage（不存在）。

## 并行后台会话（T-3263，2026-10-05）

- pnpm e2e:background start --name plugin-a --port 0 会为本次会话创建唯一临时工作区、随机回环端口、运行 manifest、日志和后台 PID；多个插件仓库可按同一规则并行启动。
- pnpm e2e:background list 查看会话；pnpm e2e:background stop --manifest <manifest> 只按 manifest 校验工作区标记、回环地址和 PID 后停止对应内核，不按进程名清理。
- 本轮两个 3.8.6 会话已分别以端口 42203、41394 就绪，工作区和 GleanE2E 笔记本 ID 不同，随后均按 manifest 停止。
- scripts/spike/glean-spike.mjs、scripts/spike/av-spike.mjs 仍是固定工作区或端口的历史 spike，不应与其他插件直接并行复用，统一改造列入 T-3264。
- 该机制是服务级 E2E 或桌面隔离内核会话，不产生 Android/iOS 真机证据；真机仍需独立设备或独立模拟器，且要避开思源桌面单实例转发。

## 历史 spike 的并行租约（T-3264/D-0112）

- `node scripts/spike/glean-spike.mjs --port 0 --results <path>` 与 `node scripts/spike/av-spike.mjs --port 0 --results <path>` 每次默认创建独立系统临时工作区；也可显式传入带正确标记的 `--workspace`。两个脚本不会再默认使用同一个 `SiYuan-Glean-Spike` 工作区或固定端口。
- 结果文件包含隔离工作区、回环 host/port、内核版本、插件版本和逐项结果；运行成功不等于真实宿主或设备验收。
- 需纳入验收账本时，用 `pnpm e2e:acceptance report --session <session> --report <results>` 导入逐项结果；报告工作区、端口和插件版本不匹配会被拒绝。

## 验收会话账本（T-3264/D-0111）

- `pnpm e2e:acceptance create --kind isolated-kernel --name s1` 创建隔离内核会话；`--kind` 还支持 `desktop-host`、`android-device`、`ios-device`、`android-emulator`、`ios-simulator`、`ai`、`external-file` 和 `dual-plugin`。
- `pnpm e2e:acceptance link --session <session> --manifest <manifest>` 把后台 E2E 的工作区、回环端口、内核版本和 PID 记入会话；该会话证据等级仍是 `service-e2e`。
- `record` 追加证据和失败项；真实 Android/iOS 关闭为 `passed` 前必须有 `--real-device-confirmed true`，桌面宿主和双插件分别需要宿主/双插件确认。存在失败项或没有证据时，账本拒绝 `passed`。
- 账本默认写在系统临时目录，不写文章属性或插件 `saveData`；`list/status` 只读取会话元数据。跨插件仓库可复用命令和字段约定，具体插件的行为证据仍独立保存。

## 现有替代覆盖（已足够）

- 内核 API 面：spike 9/9（含快照闭环、制卡闭环）+ av-spike 6/6——插件全部数据通道已实证；
- UI 面：视觉由 UI-STANDARD 约束 + 作者真机验收（B-0002 全景清单）；
- 插件加载面：spike ⑤（loadPetals 下发 JS/CSS/i18n 正常）。

## 后续可选（作者需要时再投入）

- computer-use 驱动真机桌面客户端（`SiYuan.exe --workspace <E2E 工作区>`）做 UI 冒烟；
  注意与作者常驻实例的端口/窗口共存（内核自动选端口，窗口需弹窗许可）。
- Playwright + Electron 路线（人脉项目有 `playwright.e2e*.mjs` 先例可考）。

## 真机驱动附加结论（2026-09-29，computer-use 尝试）

1. 桌面端单实例转发：带 --workspace 启动第二 SiYuan.exe 时，参数转发给已运行实例，
   新进程无窗口无内核（孤儿，已清理）。多工作区应经应用内"打开工作区"入口切换。
2. computer-use 按 name 绑定会命中作者正在使用的真实实例——冒烟操作有误触真实数据的风险。
   本次发现后立即停止交互（仅被动截图，无任何点击/键盘到作者窗口），主实例探测健康。
3. **最终结论**：UI 冒烟不由 agent 远程驱动，交由作者真机执行（B-0002 清单 +
   scripts/e2e/launch-e2e.mjs 提供的演示环境可作者自行启动后走查）。

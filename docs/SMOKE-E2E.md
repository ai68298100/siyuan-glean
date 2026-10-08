# 写型冒烟与 E2E 运行约定

本仓库把会创建/删除笔记本、写入文档或属性、创建 AV/riff 数据的脚本视为**写型冒烟**。它们不能直接操作作者正在使用的工作区，也不能与其他插件项目共用一个内核。只读走查（例如读取报告、检查静态产物）可以并发；写型冒烟必须在同一内核实例上串行执行。

## 启动隔离靶场

为本插件单独准备一个 workspace，启动第二个思源实例，端口建议从 `6807` 开始顺延，并且只安装本插件的 `dist`。靶场实例的 token 从该实例的“设置 → 关于”获取，不能复用主工作区 token。示例：

```powershell
$env:SIYUAN_BASE_URL = "http://127.0.0.1:6807"
$env:SIYUAN_TOKEN = "从 6807 实例获取的 token"
pnpm e2e:background start --name glean-range --workspace D:\SiYuan\glean-range --port 6807
node scripts/e2e/s1-flow.mjs --base-url $env:SIYUAN_BASE_URL --token $env:SIYUAN_TOKEN
```

也可以把 `--base-url`、`--token` 直接传给支持附着靶场的脚本；命令行参数优先于环境变量。缺 token 会立即失败，脚本不会内置或猜测 token。写型目标只允许回环地址。

`launch-e2e.mjs`、M0/AV/事务/大纲 spike 默认自己创建带标记的隔离 workspace；显式指定的 workspace 必须带匹配标记。启动后所有写型脚本都会先调用 `lsNotebooks`：

1. 清扫本项目前缀的上次崩溃残留（只删除 `siyuan-glean-*` 及兼容历史前缀）；
2. 发现任何非本项目前缀的笔记本就拒绝运行，并提示改用隔离靶场；
3. 确认风险后，只有显式设置 `SIYUAN_E2E_ALLOW_SHARED=1` 才可放行共享内核。

测试临时库必须使用可识别前缀。当前前缀注册表在 `scripts/lib/smoke-kernel.mjs`；新增脚本先登记前缀，再创建笔记本。不要用模糊的“测试”“临时”名称，以免清扫误伤用户数据。

注册表必须覆盖直接写入笔记本的辅助流程（包括备份恢复、制卡/riff、AV、事务、目录和 M0 探针），不能只保护负责启动内核的外层脚本。历史版本留下的 `Glean*` 名称可以暂时保留在兼容清扫列表；新代码统一使用 `siyuan-glean-<purpose>-<pid>`，并在任务台账中记录新增前缀。清扫按完整名称前缀匹配，不使用“包含测试”等模糊匹配。

事务探针包含关闭并重启内核的契约验证，因此始终自建隔离实例，不接受 `SIYUAN_BASE_URL`/`--base-url` 附着参数；若检测到该参数会在任何写入前明确退出。需要附着已启动靶场时使用 AV、M0 或大纲探针，并按上面的 token 规则传入凭据。

## AI 与退出码

任何会把文章内容发送给真实模型的检查默认跳过；设置 `SIYUAN_E2E_AI=1` 才允许外发。离线/可选检查跳过时退出码保持 0，必过脚本的断言失败仍退出 1，启动或靶场防呆失败退出 1/2，不能用“跳过 AI”掩盖内核或数据错误。

## 常用命令

```powershell
# 纯本地服务回归（默认自建隔离内核）
node scripts/e2e/s1-flow.mjs

# 连接已经启动的隔离靶场，运行前会检查并拒绝主工作区
node scripts/e2e/s1-flow.mjs --base-url http://127.0.0.1:6807 --token $env:SIYUAN_TOKEN

# 事务、AV、M0、目录 spike；每次运行使用不同临时工作区/动态端口
pnpm spike:transactions
node scripts/spike/av-spike.mjs --port 0
node scripts/spike/outline-spike.mjs
node scripts/spike/glean-spike.mjs --port 0 --results .\output\spike-results.json
```

`s1-flow` 会在同一条主链中覆盖备份恢复和制卡恢复；它们写入的临时笔记本也受同一前缀注册表保护。若单独调用辅助流程，必须复用已经通过防呆的 `client`，不能另建未登记的笔记本名称。

同一内核上的写型命令按顺序运行；不要在多个终端同时启动它们。若只需读取已有报告或执行静态检查，可以并发。运行结束检查靶场的 `lsNotebooks`，除本项目仍在运行的会话外不应留下临时库；下次启动会自动清扫本项目残留。作者验收 T-3293 时还应记录主工作区拒跑、空靶场全套通过、残留自动清扫三项证据，具体见 [BLOCKERS.md 的 B-0012](./BLOCKERS.md)。

## 安全边界

这些脚本证明隔离内核的 API、服务和数据主权契约，不能代替真实桌面宿主、Android/iOS 真机、官方剪藏扩展或真实模型验收。真实验收仍按 [ACCEPTANCE.md](./ACCEPTANCE.md)、[BLOCKERS.md](./BLOCKERS.md) 和验收账本执行。不要把浏览器窄视口、服务 E2E 或单张截图登记为真机通过。

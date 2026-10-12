# 开发与交付指南

本文面向首次运行仓库的贡献者，说明本地开发、检查、隔离内核验证和构建产物。产品能力及其真实环境验收边界见[能力矩阵](CAPABILITY-MATRIX.md)；写型冒烟规则以[SMOKE-E2E.md](SMOKE-E2E.md)为准；正式发布步骤以[发布手册](RELEASE.md)和仓库 [AGENTS.md](../AGENTS.md) 为准。

## 环境要求

- Node.js `>=24.0.0`。
- pnpm `12.5.1`，版本由 `package.json` 的 `packageManager` 固定。可用 Corepack 启用 pnpm：`corepack enable`。
- Git。真实内核 E2E 还需要单独安装的思源桌面版/内核，以及专供本插件使用的隔离 workspace。

克隆仓库后，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

如果 Corepack 未提供锁定版本，可执行 `corepack prepare pnpm@12.5.1 --activate`，然后重试安装。不要删除或重生成 `pnpm-lock.yaml` 来绕过安装错误。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | 思源插件入口、宿主生命周期和功能挂载。 |
| `src/domain/` | 与 UI、思源 API、服务无关的类型、规则和纯业务计算。 |
| `src/api/` | 思源内核端点与外部服务的 API 适配；新增内核端点先按契约做 spike。 |
| `src/services/` | 读写协调、索引、导入导出、统计、AI 等应用服务；文章属性写入统一经过 `clip-store.ts`。 |
| `src/ui/` | Svelte 工作台、Dock、设置、对话框及复用界面。 |
| `src/libs/` | 宿主桥接、对话框和通用 UI/运行时辅助代码。 |
| `public/i18n/` | 中文和英文资源；新增界面文案要同时维护 `zh_CN.json`、`en_US.json`。 |
| `design/` | UI 原型和设计参考。 |
| `scripts/` | 构建辅助、性能基线、视觉预览、E2E、内核 spike 和任务账本工具。 |
| `tests/` | Node 测试、服务/域逻辑回归、架构/i18n/无障碍/发布门禁。 |
| `docs/` | 数据契约、产品重整、验收、阻塞项、决策、性能基线与运行手册。 |
| `plugin.json` | 思源插件清单。版本需与 `package.json` 保持一致。 |
| `vite.config.ts` | 开发/生产构建、静态资源复制和 release zip 配置。 |

插件宿主只加载构建生成的单个 `index.js`；Vite 配置将动态导入打包到该文件中。新增代码应遵守分层单向依赖和数据主权规则，详细约束见根目录 [AGENTS.md](../AGENTS.md)、[数据契约](DATA-CONTRACT.md) 和[决策记录](DECISIONS.md)。

## 本地开发

`pnpm dev` 会监听构建源码并输出到仓库根目录的 `dev/`，开发构建内含 inline sourcemap。要让思源加载这个目录，可运行 `pnpm make-link` 创建插件目录软链接：脚本会尝试发现本机工作区；自动发现失败时，在 Windows 可设置 `SIYUAN_PLUGIN_DIR` 指向思源的 `data/plugins` 目录后重试。该变量仅供 `make-link` 使用。

也可以只运行 `pnpm dev`，再按思源插件开发方式把 `dev/` 链接到测试工作区。修改中文或英文文案后应检查两个资源文件的键集合一致。开发链接要指向隔离测试工作区，避免在真实数据上进行写操作验证。

## 命令与脚本

以下为 `package.json` 暴露的全部 pnpm scripts：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 监听源码并构建开发版到 `dev/`，启用 inline sourcemap。 |
| `pnpm build` | 清理构建目录，再生成生产 `dist/` 和根目录 `package.zip`。 |
| `pnpm build:app` | 仅生成生产插件 `dist/`，不先清理，也不负责打 release zip。 |
| `pnpm clean` | 清理 `dev/`、`dist/` 和 `package.zip` 等构建产物。 |
| `pnpm check` | 顺序执行 TypeScript 与 Svelte 检查。 |
| `pnpm check:types` | 检查应用和 Node 脚本的 TypeScript 类型。 |
| `pnpm check:svelte` | 运行 `svelte-check`。 |
| `pnpm test` | 运行 `tests/` 中注册的 Node 测试，包括域/服务回归和架构、i18n 等门禁。 |
| `pnpm make-link` | 将开发构建 `dev/` 链接到选定思源工作区的插件目录；可用 `SIYUAN_PLUGIN_DIR` 指定插件父目录。 |
| `pnpm make-install` | 先生产构建，再交互选择思源工作区并将 `dist/` 复制到其插件目录。 |
| `pnpm update-version` | 交互更新 `package.json` 和 `plugin.json` 的版本号；仅在已确定发布节拍后使用。 |
| `pnpm check:release` | 校验版本一致性、dist 关键文件、zip 与集市图片大小限制。 |
| `pnpm perf:baseline` | 运行 1k/5k/10k 合成规模的生产函数性能基准并写入本地结果目录。 |
| `pnpm perf:check` | 检查合成性能预算及分页、批处理等回归边界。 |
| `pnpm visual:check` | 校验视觉基线矩阵和静态案例契约；不启动真实思源界面。 |
| `pnpm spike` | 运行 `scripts/spike/glean-spike.mjs` 的思源内核契约探针。 |
| `pnpm spike:transactions` | 运行包含事务及内核重启场景的独立 spike。该脚本自建隔离内核，不能附着现有内核。 |
| `pnpm e2e:ui` | 启动隔离 UI E2E 思源实例，默认创建独立 workspace。 |
| `pnpm e2e:background` | 管理隔离 E2E 实例：`start`、`stop`、`status`、`list`。 |
| `pnpm e2e:acceptance` | 管理真实验收会话账本：创建、关联证据、记录、报告、关闭和查询。 |
| `pnpm task:ledger` | 检查或维护 `TODO.md`、任务台账的一致性；CI 使用 `pnpm task:ledger -- --check`。 |
| `pnpm icon` | 运行图标生成脚本。 |

常用的修改后检查：

```powershell
pnpm check
pnpm test
pnpm build
pnpm check:release
pnpm perf:check
pnpm visual:check
pnpm task:ledger -- --check
git diff --check
```

CI 还会在 Node 24 下执行冻结锁文件安装、以上类型/测试/构建和仓库门禁。某项失败时先按该命令输出定位，不要只依赖一次成功的生产构建。

## 环境变量

普通开发、类型检查、单元测试和生产构建不需要 `.env` 文件，也不需要模型密钥。仅在对应功能下设置下列可选变量：

| 变量 | 用途与边界 |
| --- | --- |
| `SIYUAN_PLUGIN_DIR` | `pnpm make-link` 自动发现工作区失败时，指定思源 `data/plugins` 目录。 |
| `SIYUAN_BASE_URL` | E2E/spike 附着到已启动的**隔离**内核时指定地址；写型脚本仅接受回环目标。命令行 `--base-url` 优先。 |
| `SIYUAN_TOKEN` | 对应隔离内核的 token；命令行 `--token` 优先。不要提交 token、写入仓库文件或复用主工作区 token。 |
| `SIYUAN_E2E_ALLOW_SHARED=1` | 显式放行检测到非本项目笔记本的共享内核。会承担误写数据风险；通常不应启用，推荐改用空的隔离 workspace。 |
| `SIYUAN_E2E_AI=1` | 显式启用会向真实模型发送文章内容的可选检查；默认跳过。开启前应确认数据可外发及模型配置。 |
| `NODE_ENV` | 构建脚本内部使用；`pnpm dev` 和生产构建命令已分别设置，无需手动配置。 |
| `VITE_SOURCEMAP=inline` | 开发脚本内部启用 inline sourcemap；生产发行不使用。 |

E2E 地址/token 的来源、写入前防护、独立 workspace 和同一内核串行规则见[写型冒烟与 E2E 运行约定](SMOKE-E2E.md)。不要在真实用户工作区运行会创建、修改或删除笔记本/文档/属性的探针。

## E2E 与内核 spike

常规 `pnpm test` 不需要思源内核，脚本通过隔离测试替身或纯函数检查逻辑。内核 E2E/spike 需要思源内核及专属隔离 workspace；一些脚本可以自行启动隔离内核，另一些可附着到专门启动的隔离靶场。写型脚本会清理本项目注册前缀残留并拒绝带有其他笔记本的目标。禁止并发运行同一个内核上的写型脚本。

示例入口：

```powershell
# 启动受管理的隔离内核（具体参数见该命令帮助与 SMOKE-E2E.md）
pnpm e2e:background start --name glean-check --workspace D:\SiYuan\glean-check --port 6807

# 如脚本需要附着隔离靶场，使用该靶场自己的 token
$env:SIYUAN_BASE_URL = "http://127.0.0.1:6807"
$env:SIYUAN_TOKEN = "填入隔离靶场 token"
node scripts/e2e/s1-flow.mjs

# 自建隔离环境的 spike 示例
node scripts/spike/glean-spike.mjs --port 0 --results .\output\spike-results.json
```

运行前先阅读 [SMOKE-E2E.md](SMOKE-E2E.md)，尤其是事务 spike 的自建/重启约束和 AI 外发默认关闭约定。真实桌面宿主、Android/iOS、真实模型、剪藏扩展和外部服务仍需要分别按[验收指南](ACCEPTANCE.md)与[阻塞项](BLOCKERS.md)操作；隔离 E2E 和浏览器预览不能登记为真机验收通过。

## 构建与部署

`pnpm build` 生成思源可安装包 `package.zip`，包内包含 `dist/` 插件文件。zip 条目时间戳采用实际构建文件时间，因此要在准备发行包时重新构建，不要从旧目录复制 zip，也不要手动改写其 mtime。可先执行 `pnpm check:release` 核验版本、文件和包大小。

本地隔离验证时，在思源插件管理中安装该 `package.zip`，或使用 `pnpm make-install` 将 `dist/` 复制到选定的测试工作区。正式交付以 GitHub 仓库 Latest Release 的 `package.zip` 为准，发布版本、tag、Release 和集市提交均按 [发布手册](RELEASE.md) 办理；根目录 [AGENTS.md](../AGENTS.md) 要求打 tag、发 Release 和提交集市前逐次请示作者。CI 目前提供 Quality gates 和 CodeQL 工作流，不会自动替作者发布 Release。

## 已知限制

- 思源宿主通过单文件插件入口加载代码，构建必须保持动态导入内联；不能直接按常规网页路由拆出运行时 chunk。
- 单元测试、合成性能基准、静态视觉矩阵和隔离内核都不代表真实思源 UI、移动端、用户数据规模、模型或第三方服务已经验收。
- 思源内核的 API 能力以[数据契约](DATA-CONTRACT.md)及 `scripts/spike/` 实测为准；不要根据猜测添加端点。
- 插件本身不提供通用外部账号登录系统；思源宿主负责内核权限和 token。可选 AI/集成功能按各自配置、宿主能力及失败降级规则工作。
- 真实宿主、移动设备、真实 AI、剪藏扩展和外部导入等待办以[已知阻塞](BLOCKERS.md)为准。无证据时不要把它们描述成已验收。
- 性能报告使用固定合成输入，结果会受运行机器和负载影响；阅读首屏、真实长文与触控表现需在目标思源环境另测。测量范围说明见[大库性能基线](PERFORMANCE-BASELINE.md)。

## 相关开发文档

- [贡献流程](../CONTRIBUTING.md)
- [开发协议](../AGENTS.md)
- [数据契约](DATA-CONTRACT.md) · [决策记录](DECISIONS.md) · [产品路线](PRODUCT-REPLAN.md)
- [验收指南](ACCEPTANCE.md) · [写型冒烟与 E2E](SMOKE-E2E.md) · [发布手册](RELEASE.md)
- [UI 组件清单](UI-COMPONENTS.md)

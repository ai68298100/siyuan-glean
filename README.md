# 小驴拾遗 (Lv Glean)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> 把思源里已经保存的剪藏，变成可以确认、分拣、阅读和回顾的本地读库。

小驴拾遗管理思源中已有的剪藏与文章。它不抓取网页，也不会因为普通笔记位于某个笔记本就自动收录；每篇文章都由你核对来源并确认后进入读库。

[English](README.en-US.md) · [下载最新版](https://github.com/ai68298100/siyuan-glean/releases/latest) · [能力矩阵](docs/CAPABILITY-MATRIX.md) · [反馈与问题](https://github.com/ai68298100/siyuan-glean/issues/new/choose)

## 本次更新（main，基于 v1.2.0，2026-10-08）

新增：可靠恢复与阅读整理能力

- 收集箱迁入、外部导入、备份恢复和制卡流程增加确切检查点、失败恢复和重试边界。
- 增加阅读位置、真实阅读分钟、全库摘录墙、周/月/年回顾、作者视图、批量 AI、排版整理稿、对外桥和 AV 投影。

新增：跨平台主入口

- 桌面工作台、独立浮窗和移动首页补齐快速收录、搜索、候选等主动作。

优化：桌面与窄屏交互

- 统一中英文文案、无障碍语义和移动端触控命中区；宽画布今日拾遗卡片保持底部对齐。

修复：制卡恢复与浮窗排版

- 制卡插入响应丢失后先恢复确切检查点，再校验来源块归属；错误来源继续返回 `sourceChanged`，不会重复插入。
- 修复独立浮窗和设置浮窗内容区横向塌缩，避免中文逐字换行、按钮挤压和窄布局误触发。

## 安装与快速开始

支持思源 `v3.8.5+`。从 [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest) 下载 `package.zip`，在思源插件管理中安装并启用。

1. 在插件设置中选择一个或多个剪藏笔记本作为读库范围。
2. 打开读库，选择“整理剪藏库”，先查看不写入的预览报告。
3. 核对候选的来源证据，确认收录、补充来源链接、作为本地文档收录或排除误报。
4. 将文章分到收件池、稍后读、阅读中或归档；读完后明确选择“标记已读”。

普通笔记不会仅因所在位置被批量收录；打开文章也不会自动标记为已读。

## 主要能力

- **建立可信读库**：按来源证据发现候选，先预览再确认；支持存量迁移、筛选、排序和批量分拣。
- **按载体阅读**：区分全文剪藏、仅链接和本地文档；Dock、工作台和看板共享文章状态。开始阅读与标记已读是两个明确动作。
- **减少剪藏后吃灰**：今日拾遗按文章事实给出重浮理由；周、月、年回顾可生成报告和 CSV。
- **按需扩展**：阅读页签（实验开关，默认关闭）、摘录、整理稿、AI、导入、快照、收集箱和插件桥接等能力及前置条件，见[能力矩阵](docs/CAPABILITY-MATRIX.md)。

## 数据与隐私

- 文章状态和元数据以思源文档属性为准；插件索引可重建。卸载插件不会主动删除文章属性。
- 自动处理不会覆盖已有的来源链接、状态、优先级、评分和作者；明确编辑时才更新相应字段。
- 插件不提供 RSS 抓取、云账号同步或自动代读，也不内置模型 API key。
- AI 功能可单独关闭，默认仅手动使用且需要配置模型或通道。使用 AI 时，文章文本会发送到你配置的服务；自定义通道请按其隐私政策使用。失败或额度不足不会阻断基础读库流程。

## 兼容性与验收

当前稳定版为 [v1.2.0](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.2.0)。该版本的自动门禁和隔离 S1 服务级 E2E 已通过；这不代表所有真实环境都已验收。

桌面宿主、Android/移动端、浏览器前端、真实模型、官方剪藏、外部文件和订阅服务仍按环境分别验收。使用前提、降级方式和阻塞项以[能力矩阵](docs/CAPABILITY-MATRIX.md)及[已知阻塞](docs/BLOCKERS.md)为准；请勿把单元测试或隔离 E2E 当作真机通过。

## 文档

- [能力矩阵](docs/CAPABILITY-MATRIX.md)：实现状态、验证证据、前置条件和真实环境边界。
- [数据契约](docs/DATA-CONTRACT.md)：文章属性、索引和恢复数据规则。
- [真实宿主验收指南](docs/ACCEPTANCE.md) · [阅读验收](docs/READER-ACCEPTANCE.md)。
- [AI 验收](docs/AI-ACCEPTANCE.md) · [外部集成验收](docs/INTEGRATION-ACCEPTANCE.md) · [已知阻塞](docs/BLOCKERS.md)。

## 相关小驴项目

目前已开发四款小驴系列思源插件：

- [小驴雷切](https://github.com/ai68298100/siyuan-speed-switch)：统一切换与工作上下文
- [小驴打卡](https://github.com/ai68298100/siyuan-checkin)：阅读与习惯打卡
- [小驴人脉](https://github.com/ai68298100/siyuan-contacts)：联系人和人脉管理
- **小驴拾遗**：剪藏文章整理、阅读分拣和每日重浮

## 反馈与社区

请通过[问题与建议模板](https://github.com/ai68298100/siyuan-glean/issues/new/choose)提交反馈，并附上思源版本、插件版本、前端类型和可复现步骤。截图或日志请先移除标题、正文、URL 和密钥等隐私内容。也可加入 QQ 群：**871707735**。

## 开发

需要 Node.js `>=24` 和 pnpm `12.5.1`。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)。常用命令：`pnpm install`、`pnpm dev`、`pnpm check`、`pnpm test`、`pnpm build`。

## License

[MIT](LICENSE)

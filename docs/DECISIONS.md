# 架构决策记录（DECISIONS）

每条决策带编号、日期与动机；重大翻转需新增条目而非修改旧条目。
编号从 D-000 起；D-0001~D-0006 为规划书定案落账（作者 2026-09-29 拍板）。

## D-0001（2026-09-29）属性规范定案：文章状态全部写入文档属性（根块 IAL）

一切文章状态（状态机/评分/摘要/重浮记录）写入 `custom-clip-*` 文档属性——思源内核数据。
插件自身 saveData 只存派生索引（`glean-index.json`）与设置，均可随时重建。
铁律三条：①属性一旦写入，永不因插件卸载而丢失；②迁移幂等（已有 `custom-clip-url` 的文档跳过）；
③用户手填字段（url/status/priority/rating）AI 与迁移器都不得覆盖。
完整字段表见 `docs/DATA-CONTRACT.md` §1；改动需新决策 + 迁移脚本。

## D-0002（2026-09-29）文章识别走双锚点：主锚点=读库笔记本，次锚点=`custom-clip-url` 属性

正文启发式（首行链接匹配）只允许用于迁移器回填时提取 URL，**不得**作为剪藏唯一判定。
收录入口三件套：面板"新剪藏"区 / 右键菜单"加入读库" / 命令面板命令。见 DATA-CONTRACT §2。

## D-0003（2026-09-29）状态机五态：inbox / later / reading / done / archived

对应收件池→稍后读→阅读中→已读→归档的完整生命周期。五态即看板五列（M2），
重浮只从 `inbox/later`（+可选 done 高亮）取材（M4）。属性值为小写枚举字符串，扩展新态需新决策。

## D-0004（2026-09-29）AI 全部走思源官方通道，插件不自带 LLM API key

一律经 `/api/ai/chatGPT`、`chatGPTWithAction`、`editor/chat`、`semanticSearchBlock`，
使用用户已配置的模型。插件零密钥、零订阅、零额外付费。AI 功能逐功能开关、默认关闭；
失败静默降级并记 BLOCKERS，绝不打断收录主流程。

## D-0005（2026-09-29）版本语义化：从 v0.1.0 起步，每里程碑发一版

不跳号、不用大版本号伪装成熟（打卡 18.x 是反面教材）。minAppVersion=3.8.5；
V2 闪卡相关功能要求 3.8.6+，相关任务后置到内核功能落地后另立任务。
打 tag / 发 Release / 提交集市由作者逐次确认；集市 PR 未获授权前不做。

## D-0006（2026-09-29）名称定案：小驴拾遗 / Lv Glean / 仓库 siyuan-glean

作者 2026-09-29 拍板落账。中文「小驴拾遗」，英文「Lv Glean」，仓库 `siyuan-glean`，
对外协议 `window.siyuanGlean`（版本化，M5 之前不承诺稳定）。
品牌叙事：「小驴拾遗，把吃灰的收藏捡回来喂给自己」；UI 文案保持克制直白。

## D-0007（2026-09-29）AI 是一等公民，贯穿全部功能面（作者指示）

作者明确要求"充分拥抱 AI，各功能尽量多给 AI 空间"。落地口径：
①收录即富化（摘要/AI标签/查重）是默认推荐路径（可一键全关）；
②阅读侧栏给 AI 动作常驻位（总结/要点/反方观点/自定义 prompt）；
③关联推荐、每周摘要、重浮理由都用 AI 生成一句话说明；
④智能体工具（addAgentCapability）M3 起随版本扩充；
⑤后续新功能设计时必须回答"AI 在这里能做什么"，至少预留动作钩子。
约束仍遵守 D-0004：走官方通道、可全关、静默降级。

## D-0008（2026-09-29）「不做清单」是延后而非永久（作者指示）

规划书 §1 的竞合边界与 §9 禁止事项按作者 2026-09-29 指示重新定调：
①数据主权、契约先行、不自带 key、不覆盖用户手填字段等工程红线**不变**；
②"不做阅读调度/不做批注 UI/不做通用聊天窗"降级为**延后项**——先做管理端主线，
预留"推入渐进阅读"等集成动作，若作者后续要求，按新决策启动，不在规划里咬死不开发；
③批注消费协议（DATA-CONTRACT §4）保持开放，任何满足形态的批注插件产出都能被聚合。

## D-0009（2026-09-29）仓库结构：插件工程直接位于仓库根

对齐小驴打卡/小驴雷切的布局（plugin.json 在仓库根），不做人脉那样的子目录嵌套。
仓库 `siyuan-glean` ↔ 工作目录 `D:\思源插件\小驴拾遗\`。

## D-0010（2026-09-29）技术栈与工程范式照搬小驴人脉（源码定调）

**定调结论：采用人脉方案（Vite + Svelte 5 + TypeScript + pnpm，CJS 单文件输出），不采用 webpack（打卡/雷切）或无框架样板。**
作者开工前要求先读内核源码定调，以下为 v3.8.5 源码级证据（repos/siyuan）：

1. `app/src/plugin/loader.ts:42-52`——内核以 `window.eval("(function anonymous(require, module, exports){…})")`
   执行插件代码，`require("siyuan")` 由宿主注入（`getAPI()`）→ 插件产物必须是
   **CommonJS 单文件 index.js** 且 `siyuan` 声明为 external；与 vite `lib.formats:["cjs"]` +
   `rollupOptions.external:["siyuan"]` 精确匹配（webpack 亦可但无必要）。
2. `loader.ts:58-68`——模块默认导出必须 `extends Plugin`，否则拒绝加载。
3. `loader.ts:165-174` + `kernel/model/plugin.go:286-294`——`index.css` 由内核整体读取、
   以 `<style id="pluginsStyle<name>">` 注入 → vite `cssFileName:"index"` 输出单份 index.css 即可。
4. `kernel/model/plugin.go:274`——插件目录=`<workspace>/data/plugins/<name>/`，
   装载入口 `/api/petal/loadPetals`；`kernel.js`（goja 内核侧插件）为可选项，本插件不用（同 D-0003 思路）。
5. `kernel/model/plugin.go:296-363`——i18n 按 `Conf.Lang→en→zh-CN` 依次尝试 BCP47 与
   下划线双名（`util.LangToLegacy`，kernel/util/lang.go:66），全未命中回退目录首文件
   → `zh_CN.json + en_US.json` 双名合规且必须**各自全量**（只加载命中的那一份）。
6. `app/src/plugin/index.ts:606-645`——`addAgentCapability({name,description,inputSchema,outputSchema,handler})`
   注册为 `plugin/frontend/<插件名>/<工具名>`，与规划书一致；另发现 `getSecret/getVariable`
   （密钥与变量库，index.ts:568-587）可作未来扩展备用位，不改变"插件不自带 key"红线（D-0004）。

工程范式：api/ 层是唯一内核交互点，domain/ 纯函数层框架无关（architecture 守门测试）；
构建/软链/发版脚本从人脉项目移植；zip 产物 mtime 用真实构建时间（speed-switch 回滚事故教训）。
UI 用 b3 CSS 变量适配主题色，类名前缀 `glean-`。

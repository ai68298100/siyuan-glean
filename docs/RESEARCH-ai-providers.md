# 研究报告：拾遗专用 AI 通道的可行性（2026-09-29，作者命题）

> 作者原话：探索是否可以针对本插件单独设置相关的 AI API（有些 API 免费、效果一般但可供用户选择）。先研究，可行再执行。
> 结论先行：**思源 v3.8.5 原生已支持多提供方 + 分场景绑模型（零开发即可用免费 API）；
> "拾遗独立通道"技术上可行但有桌面/浏览器与密钥存储两个代价，推荐分两步走**（详见 §4 推荐）。

## 1. 思源 v3.8.5 的 AI 架构（内核源码实证）

`Conf.AI`（kernel/conf/ai.go）已是注册表结构：

- **`AI.Providers[]`**：多个提供方，每个含 `id / displayName / enabled / apiKey / baseURL / protocol / headers / models[]`
  ——用户可同时配置任意多个 OpenAI 兼容 API（含免费 API），逐个启用/禁用。
- **场景化模型绑定**：`Editing.ModelID`（AI 编辑器）、`Agent.ModelID`（智能体）、`ImageGeneration.ModelID`、
  `Decision` 等各自独立绑模型；`ReconcileModelIDs()` 会把编辑器/智能体回退到首个可用模型。
- 嵌入（`AI.Embedding`）独立配 baseURL/apiKey，与对话模型无关。

## 2. 本插件现状与官方通道的模型选择

- 拾遗全部 AI 调用走 `/api/ai/chatGPT`（富化）与 `editor/saveAction` 动作（编辑器 AI 菜单）。
- `/api/ai/chatGPT` → `model.ChatGPT` → `chatGPTComplete`（model/ai.go:238）→ **`Conf.AI.GetEditingModel()`**
  ——即 **"AI 编辑器"场景绑定的 Provider+Model**。
- 端点请求体只有 `{msg}`（apicontract.AIMessageRequest），**不支持 per-request 指定模型**；
  无通用 AI 代理端点（contracts.go 中无 apiProxy）。插件经官方通道无法自行选择模型。

## 3. 可行方案对比

### 方案 A：引导用户用思源原生多提供方（零开发，立即可用）✅ 推荐、本轮落地

用户在思源"设置 → AI"里添加多个提供方（免费 API 也行），把 **AI 编辑器** 场景的模型绑到免费/低价模型：
拾遗的富化、预置动作全部走该通道；智能体工具走 Agent 场景模型，互不影响。
落地物：设置页 AI 组加一段引导文案（"想用免费模型？在思源 设置→AI 里配置多个提供方，
并把「AI 编辑器」绑到它——拾遗的摘要/标签会自动使用"）；README 补充说明。
风险：无。限制：改模型影响思源编辑器 AI 的其他用法（对只经拾遗用 AI 的用户无感）。

### 方案 B：拾遗独立通道（用户在插件设置里填 baseURL/key/model，插件直连 OpenAI 兼容 API）

技术可行，三个代价：

1. **前端连通性**：桌面端 Electron 可直连外部 API；但 browser-docked 前端受 CORS 限制，
   多数免费 API 不带 CORS 头 → 需按 `getFrontend()` 降级（桌面可用、浏览器端禁用并提示）。
2. **密钥存储**：saveData 是明文，apiKey 不能存那里。思源有官方密钥库（设置 → 密钥和变量，
   内核加密存储），插件运行时经 `plugin.getSecret(name)` 读取（app/src/plugin/index.ts:568）——
   正路是：用户在思源建一个密钥（如 `glean-ai-key`），拾遗设置里只填 baseURL/model 并引导建密钥。
   流程比"直接填 key"多一步，但密钥加密、且与思源密钥管理统一。
3. **红线修订**：D-0004"插件不自带 LLM API key、全部走思源 /api/ai/*"——方案 B 是"用户提供给插件专用"
   而非"插件自带"，方向上符合作者本次命题，但需要 D-0013 正式修订决策（已落账，见 DECISIONS）。

实现预估：api/ai-direct.ts（OpenAI 兼容 chat/completions 客户端 + AbortController 超时）+
设置组（baseURL/model/密钥名 + "测试连接"）+ 前端降级 + 富化管线注入通道选择，约 1 轮开发量。

### 方案 C（否决）：经思源密钥+变量注入官方通道

官方通道只读 `Conf.AI`，插件无权改用户级 AI 配置（改 Conf 属管理面，插件越权）。否决。

## 4. 推荐

1. **立即（本轮已做）**：方案 A 引导 + AI 消耗控制（富化三态触发 off/manual/auto + 每日上限 +
   今日用量显示 + 语义查重独立开关——查重/相关旧文走嵌入不耗 LLM token，单独控制）。
2. **作者拍板后（下一轮）**：若方案 A 的引导不够（例如用户不想动全局"AI 编辑器"绑定），
   按方案 B 实现"拾遗专用通道"：getSecret 存 key、桌面直连、浏览器降级提示、保留官方通道为默认。
   是否执行请作者确认（涉及 D-0004 修订与用户流程设计）。

## 5. 源码证据索引

- `kernel/conf/ai.go:151-172` Provider/Model 结构；`:452-471` GetEditingModel/GetAgentModel 场景绑定
- `kernel/model/ai.go:42-96, 238-271` ChatGPT → chatGPTComplete → Editing 模型解析与 OpenAIGPT 客户端构造
- `kernel/apicontract/contracts.go:925-944` AI 端点全集（无代理端点）；`ai.go:158-164` 请求体形状
- `app/src/plugin/index.ts:568-587` getSecret/getVariable（插件读思源密钥库的官方通道）

# 200+ 项质量与契约批次记录

> 日期：2026-10-02
>
> 这不是把一个功能拆成 200 个空勾选，而是 220 个可独立运行的回归样本。每个样本在 `tests/batch-200.test.ts` 中有唯一的 `BATCH-200-NNN` 名称、输入和断言；样本覆盖的实现同时已接入实际 UI 或现有纯函数。

## 完成范围

| 编号 | 数量 | 覆盖内容 | 实现/证据 |
|---|---:|---|---|
| BATCH-200-001–020 | 20 | Enter、Space 与 18 个非激活键的键盘语义 | `src/domain/keyboard.ts`；读库、看板、重浮标题和卡片接入 |
| BATCH-200-021–040 | 20 | 朗读速度下限、步进、上限、非有限值 | `src/domain/speech.ts` |
| BATCH-200-041–060 | 20 | 空白、换行、制表、混合文本规范化 | `src/domain/speech.ts` |
| BATCH-200-061–080 | 20 | 朗读切段长度、标点、空态和长文本安全 | `src/domain/speech.ts` |
| BATCH-200-081–100 | 20 | 中英文字符计数与 voice 语言选择 | `src/domain/speech.ts` |
| BATCH-200-101–120 | 20 | URL 协议、主机、端口、fragment、尾斜杠和编码 | `src/domain/url.ts` |
| BATCH-200-121–140 | 20 | fulltext/link/local/unknown 载体打开策略 | `src/domain/carrier.ts` |
| BATCH-200-141–160 | 20 | 五态自身保持与允许/禁止流转 | `src/domain/schema.ts` |
| BATCH-200-161–180 | 20 | AI、重浮、配额、阅读和非法值设置归一化 | `src/services/settings.ts` |
| BATCH-200-181–200 | 20 | 正文测量状态与缺失正文诊断 | `src/domain/content.ts` |
| BATCH-200-201–220 | 20 | 读库状态、候选、站点、标签、AI 标签、排序和只读投影 | `src/domain/library-view.ts` |

## 门禁结果

- `pnpm test`：354/354 通过，其中本批次 220/220 通过。
- `pnpm check`：0 errors / 0 warnings。
- 本批次不新增思源端点、不写 `custom-clip-*` 属性、不改变 `saveData` 结构，也不新增 i18n 文案。
- 真机读屏、移动端触控和浏览器系统 voice 仍属于作者验收范围，不把代码测试冒充真机验收。

## 变更文件

- `src/domain/keyboard.ts`
- `src/domain/speech.ts`
- `src/ui/DockPanel.svelte`
- `src/ui/ImportDialog.svelte`
- `src/ui/OnboardingDialog.svelte`
- `src/ui/ReaderTab.svelte`
- `src/ui/ResurfaceView.svelte`
- `src/ui/SettingsView.svelte`
- `tests/batch-200.test.ts`
- `package.json`


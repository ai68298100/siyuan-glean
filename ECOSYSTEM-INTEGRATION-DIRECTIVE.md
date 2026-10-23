# 【小驴生态中枢统领指令】小驴拾遗 (siyuan-glean) 专项排查与全方位升级执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴拾遗（`siyuan-glean`）开发 Agent
> **当前状态**：底座测试全绿 · 规范评分 80% ➔ 目标 100%
> **核心原则**：零强依赖 · 深松绿+金杏麦珠 Bento 美学 · 严禁私有存储穿透

---

## 一、 核心资产状态确认
1. **根目录 `icon.png`**：**已由中枢完成 256×256 殿堂级“深松绿底配白玉麦穗与金杏麦珠”高清头像替换，请严格保留勿覆盖！**
2. **本地就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，直接 import 使用）。

---

## 二、 当前排查出的本插件专项缺陷与必修任务清单

### 【P0 级：集市获客与设置窗口升级】
1. **`plugin.json` 补齐品牌关键词（严重影响集市获客！）**：
   - 当前 `keywords` 完全没有“小驴”中文词，集市搜“小驴”搜不出拾遗！
   - **必修修改**：前置强制补齐 `["小驴", "小驴拾遗", "xiaolv", "lv", ...]`。
2. **开启独立桌面设置大窗（`settingsWindow: true`）**：
   - 在 `plugin.json` 根级增加 `"settingsWindow": true`，彻底打通思源 3.8.8+ 独立大窗口设置体验。

---

### 【P1 级：样式防污染治理与顶栏图标升级】
3. **【高危样式污染修复】消灭顶层裸类选择器 (`src/index.scss`)**：
   - 目前 `src/index.scss` 顶层存在 `.dialog-content input`、`.dialog-content .b3-select` 等裸选择器，会污染思源原生弹窗与其他插件表单！
   - **必须将所有样式严格包裹在 `.lv-glean` 或 `#glean-*` 命名空间内！**
4. **顶栏单色矢量图标升级 (`src/index.ts`)**：
   - 将 `this.addIcons(...)` 中的 `iconGleanWheat` 替换为在 16px 下依然清晰锐利的标准 32×32 SVG：
   ```xml
   <symbol id="iconGleanWheat" viewBox="0 0 32 32">
     <path d="M5 24c4-1.8 8-1 11 1 3-2 7-2.8 11-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
     <path d="M16 8v16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
     <path d="M16 11c2.8-1.5 5.5 0 5.5 2s-2.7 2-5.5 2M16 16c2.8-1.5 5.5 0 5.5 2s-2.7 2-5.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
     <path d="M16 13.5c-2.8-1.5-5.5 0-5.5 2s2.7 2 5.5 2M16 18.5c-2.8-1.5-5.5 0-5.5 2s2.7 2 5.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
     <circle cx="16" cy="5" r="2.5" fill="currentColor"/>
   </symbol>
   ```

---

### 【P2 级：联动落地与快捷键纠偏】
5. **已读自动打卡 & 划词转闪卡幽灵按钮降级**：
   - 文章状态标记为 `done` 时调用 `logCheckinEventSafely`（`externalRef: "glean:<docId>:<date>"`）；
   - 划词菜单增加“制成闪卡”：未安装小驴闪卡时呈 45% 透明度幽灵按钮并悬停提示，不报错。
6. **跨平台快捷键纠偏与补齐更新日志**：
   - 将硬编码的 Mac 专有符号 `hotkey: "⌥⌘G"` 规范为跨平台标准格式；
   - 补齐根目录缺失的 `CHANGELOG.md`。

---

## 三、 验收指令
修改完成后，在根目录执行：
```bash
pnpm check && pnpm test
```
确保全量单测与类型检查 100% 全绿通过！

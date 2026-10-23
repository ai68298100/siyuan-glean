# 【小驴生态中枢统领指令】小驴拾遗 (siyuan-glean) 全方位升级与跨插件协同执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴拾遗（`siyuan-glean`）开发 Agent
> **架构基线**：Epoch 6 联邦规范 · 零强依赖优雅降级 · 北欧深松绿+金杏麦珠美学 · 历史排雷防线

---

## 一、 核心定位与视觉资产状态
- **生态角色**：**【知识输入与剪藏文库（Content Ingestion Library）】**——管理剪藏文章、五态分拣（inbox/later/reading/done/archived）与每日重浮阅读流。
- **专属主题色**：**北欧深松文库绿（`#0F766E` ➔ `#14B8A6`）＋ 丰收金杏智慧麦珠（`#FB923C`）**。
- **根目录 `icon.png`**：**已由快门中枢完成 256×256 殿堂级“深松绿底配白玉麦穗与金杏麦珠”高反差头像替换，请勿覆盖回退！**
- **本地已就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，可直接 `import`）。

---

## 二、 必做任务 1：跨插件联邦联动（Epoch 6 标准）

### 1. 四别名挂载与安全注销 (`src/services/bridge.ts` & `src/index.ts`)
- 维护 `window.siyuanGlean`，同步挂载 `window.xiaolvGlean`、`window.lvGlean`、`window.LvGlean`（First-Instance-Wins + 卸载时身份核验安全注销）；
- `setClipStatus` 严格受 `settings.integration.bridgeWriteEnabled` 门控。

### 2. 文章读完自动联动小驴打卡 (`src/services/bridge.ts` 或状态流转处)
- 当文章状态被标记为 `done`（已读）时，若用户配置了阅读打卡项，调用 `src/libs/ecosystem-bridge-kit.ts` 的 `logCheckinEventSafely`：
  ```ts
  if (this.settings.checkinItemId) {
      await logCheckinEventSafely({
          itemId: this.settings.checkinItemId,
          value: 1,
          externalRef: `glean:${clip.id}:${new Date().toISOString().slice(0, 10)}`,
          note: `完成文章阅读：《${clip.title}》`,
      });
  }
  ```
  *(未安装小驴打卡时自动静默返回 false，0 报错)*

### 3. 高亮转闪卡 / 考试出题——幽灵按钮降级模式 & 向雷切注册小组件
- 阅读器划词/工具条提供“制成闪卡（FSRS）”与“AI 出题（考试）”：
  - 探测 `window.xiaolvCards` / `window.LvExam`：未安装时按钮呈 45% 透明度幽灵态，悬停气泡提示“💡 安装小驴闪卡/考试后可一键制卡/出题”；已安装时调用对应桥接口；
- 在 `onload` 调用 `registerRaikiriModuleSafely` 注册 `glean-later-list`（稍后读待读流）小组件。

---

## 三、 必做任务 2：顶栏与侧栏单色图标升级 (`src/index.ts`)

将 `this.addIcons(...)` 中的 `iconGleanWheat` 更新为与新版 Logo 1:1 映射、在 16px 下依然清晰锐利的 32×32 单色矢量图标（展卷书页基座 + 麦穗茎秆与两对饱满麦粒 + 顶部智慧麦珠）：
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

## 四、 必做任务 3：UI 轻量统一与 CSS 全局污染治理 (`src/index.scss`)

1. **【高危样式污染修复】消灭顶层裸类选择器 (`src/index.scss`)**：
   - 经中枢审计，`src/index.scss` 中存在 `.dialog-content .b3-select, .dialog-content input` 等未包裹插件专有前缀的选择器，会直接污染思源原生弹窗与其他插件表单！
   - **必须将所有样式严格包裹在 `.lv-glean` 或 `#glean-*` 根容器选择器内！**
2. **注入专属品牌色与参考图 Bento 软性美学**：
   ```scss
   --lv-brand: #0D9488; /* 北欧文库青绿 */
   --lv-brand-soft: color-mix(in srgb, var(--lv-brand) 12%, transparent);
   --lv-accent-wheat: #FB923C; /* 金杏麦穗色 */
   ```
   - 五态筛选栏与阅读时长标签（`📖 5 min`）统一采用 `9999px` 饱满药丸胶囊；
   - 按钮挂载 `:active:not(:disabled) { transform: translateY(1.5px) scale(0.985); }` 物理微触感；
   - Dialog 弹窗标题栏统一采用 `.lv-dialog-title-wrap`（22×22 青绿底白麦穗标 + 标题 + 版本胶囊）。

---

## 五、 必做任务 4：深层工程规范与历史排雷加固

1. **`plugin.json` 关键对齐（必改）**：
   - **补齐品牌关键词**：当前 `keywords` 完全没有“小驴”！必须前置加入 `["小驴", "小驴拾遗", "xiaolv", "lv", ...]`，确保用户在思源集市搜“小驴”能搜到拾遗！
   - 新增 `"settingsWindow": true`（开启独立桌面设置大窗）；
   - `minAppVersion` 统一为 `"3.8.4"`。
2. **跨平台快捷键纠偏 (`src/index.ts`)**：
   - 将硬编码的 Mac 专有符号 `hotkey: "⌥⌘G"` 规范为跨平台标准格式，避免在 Windows/Linux 下解析异常。
3. **日志与发布合规补齐**：
   - 控制台日志前缀统一由 `[glean]` 规范为 `[LvGlean]`；Toast 提示前缀统一为 `[小驴拾遗]`；
   - 补齐根目录缺失的 `CHANGELOG.md` 与 `.github/workflows/release.yml`。

---

## 六、 验收标准
执行完毕后，在根目录运行：
```bash
pnpm check && pnpm test
```
确保全量单测与类型检查 100% 全绿通过！

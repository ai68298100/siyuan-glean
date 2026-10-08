# 视觉回归基线

本目录登记小驴拾遗的视觉回归矩阵。矩阵事实源是 `scripts/visual/visual-matrix.mjs`，登记文件是 `baseline.json`，当前包含 3 个视口 × 8 个状态 = 24 个案例。

## 尺寸和状态

| 视口 | 尺寸 | 说明 |
| --- | ---: | --- |
| desktop | 1280×800 | 桌面工作台或插件页签 |
| narrow | 768×1024 | 窄屏、可收起桌面导航 |
| mobile | 390×844 | 移动端顶部栏、内容和底部导航 |

每个视口都要覆盖：默认、空、加载、无结果、失败、部分成功、成功、撤销。状态截图必须能看出发生了什么、数据是否安全和下一步怎么做；录屏只为滑动、焦点、加载和撤销等动态路径补充证据。

## 检查

```text
pnpm visual:check
pnpm visual:check -- --strict
```

普通检查验证 24 个槽位、尺寸、状态、文件命名和登记路径；严格检查还要求每个案例已经取得真实宿主截图。截图放到 `docs/visual-regression/baseline/`，文件名必须与 `baseline.json` 一致，尺寸必须等于登记视口。录屏暂存于 `output/visual-regression/`，不把临时录屏混入代码提交。

## 采集边界

`design/prototype-v2.html` 只提供视觉令牌、信息层级和状态语义的设计参考，不能冒充实际 Svelte 组件截图。真实基线应在思源桌面宿主或作者真机中采集，使用 `node scripts/e2e/launch-e2e.mjs` 准备隔离内核和演示数据，再按 `docs/ACCEPTANCE.md` 的安全步骤操作。

纯浏览器打开思源桌面 stage 不能启动真实前端，原因和停止条件见 `docs/RESEARCH-browser-e2e.md`、B-0009 和 B-0010。因此当前 24 个案例登记为 `pending-host`；完成真实采集后，将对应项改为 `captured` 并运行严格检查。静态矩阵通过不等于宿主视觉验收通过。


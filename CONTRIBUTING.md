# 参与贡献

感谢你为小驴拾遗提交问题、建议或代码。请先阅读 [README](README.md)、[能力矩阵](docs/CAPABILITY-MATRIX.md) 和 [AGENTS.md](AGENTS.md)，了解当前已实现能力、真实宿主验收边界和数据契约。

## 提交问题和建议

请优先使用 GitHub 的 Issue 模板，并提供可复现的最小信息：思源版本、插件版本、桌面/移动/浏览器环境、文章载体、复现步骤和脱敏截图或日志。不要公开 API key、访问令牌、完整正文、私有 URL 或未经脱敏的导出文件。安全问题请按 [SECURITY.md](SECURITY.md) 报告。

## 修改代码

- 文章状态和 `custom-clip-*` 属性以 `src/domain/schema.ts` 和 `services/clip-store.ts` 为唯一事实路径；不要直接写属性端点。
- 新的存储或内核端点先更新 `docs/DATA-CONTRACT.md`，并在 `docs/DECISIONS.md` 留下决策记录。
- UI 类名使用 `glean-` 前缀，颜色使用思源主题变量或已有设计 token；保持中文和英文 i18n 键集合一致。
- 不要把浏览器预览、桌面响应式或 `browser-mobile` 当作 Android 真机验收；真实宿主限制请记录到 `docs/BLOCKERS.md`。
- 不修改用户手填的 URL、状态、优先级、评分和作者，除非用户明确执行对应操作。

提交前运行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm visual:check
pnpm check:release
```

## Pull request

PR 描述请说明用户可见结果、影响范围、数据契约/i18n 变化和验证命令。涉及移动端、真实思源宿主、外部服务或模型的改动，要明确写出尚待作者验收的部分。不要在 PR 中自行升版本、打 tag、发 Release、上传 `package.zip` 或提交集市发布。

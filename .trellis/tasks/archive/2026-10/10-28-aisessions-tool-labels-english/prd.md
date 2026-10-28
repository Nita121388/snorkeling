# aisessions 工具摘要文案英文化

## Goal

会话详情里工具调用摘要（折叠组标题 / 展开前自然语言）当前是中文，与项目默认英文 UI 不一致。把工具调用区域的用户可见文案统一改成英文。项目无 i18n 基础设施（无 react-i18next / useTranslation），因此是**硬编码文案替换**，不引入 i18n 框架。

## Requirements

- `tool-describe.ts` 的 `KIND` 映射、`describeRun`、`describeToolGroupCompact`、`describeToolGroupKind` 输出全部英文。
- `subagent-card.tsx` 的用户可见中文（打开 / 匹配到多个候选… / 子会话内容 / 已保留已加载的内容。/ 重试 / 正在加载更多…）改英文。
- 代码注释保持原样（项目现状中英混排，不属于 UI 文案）。
- 同步更新 `tool-describe.test.ts` 断言。

## Acceptance Criteria

- [ ] 工具折叠组摘要不再出现中文（`Run command ×3` / `Tool ×5`）。
- [ ] `describeRun(["subagent"])` 返回英文标签。
- [ ] 子代理卡片的按钮/提示/加载态文案为英文。
- [ ] `vitest run frontend/app/view/aisessions/tool-describe.test.ts` 通过。
- [ ] 工具调用区域 grep 不再命中中文 UI 字符串。

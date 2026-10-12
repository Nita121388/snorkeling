# 执行计划：image-block
1. [ ] 复现事故：构造「插入带尺寸图片 → 写盘 → 重读」用例，确认图片消失（先红）
2. [ ] 抽 `image-size.ts`（解析三种语法 + 序列化只用 Obsidian 约定 + 失败降级）
3. [ ] `image.tsx` 改用它；删除/隔离旧的 `parseImageSizeSuffix` 写路径
4. [ ] 拖拽缩放手柄 + 写回（往返可解释）
5. [ ] 四类 UI 测试；沙箱实测插入→缩放→失焦→重开
6. [ ] spec + Obsidian 记录
依赖：parity-harness 的门禁先就位（否则编辑态样式差异没法被拦住）

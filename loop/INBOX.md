# INBOX — 我自己的随手记录

> 规则：一行一条，5 秒写完，**不要分类、不要写判据**。分类与判据留到分诊。
> 格式：`- [ ] <日期> <一句话>`，可选结尾 `@来源`（issue / pr / community / social）。
> 分诊：`node loop/queue.mjs inbox` 看编号 → `triage --n <编号>` 三选一。
> 归档：处置后自动勾掉并搬到 `loop/INBOX-ARCHIVE/<月>.md`。

## 待分诊

- [ ] 2026-11-05 看板 Drawer 缺 redproof/set-priority 入口；@dnd-kit/motion/sonner/react-resizable-panels 零引用（要么用要么从 deps-policy 移除）
- [ ] 2026-11-05 签字 hash 只能由引擎函数产出（裸 sha256sum 口径不同，混用会造成假 drift）
- [ ] 2026-11-05 引擎 queue.mjs 不认 --root（只有 bin/loop.mjs 认）；LOOP_ROOT 指向不存在目录时 board 静默返回 0 包，应报 symptom
- [ ] 2026-11-05 看板 mergeBoards 自己重算 summary，且 g8Ok/drift 在多仓合并时丢失（R4.3 要求显示 g8）
- [ ] 2026-11-05 原型示例条目：预览块滚到顶时轻微抖动
- [ ] 2026-11-05 Trellis 钩子注册写的是 E:/primary/projects/loop（.trellis/config.yaml 的 hooks 段），在 macOS 上 run 不到 → created/started/archived 事件永不产生；改成平台无关路径或 <engine> 变量 @pi-night-audit
- [ ] 2026-11-17 F-1117-overview-card-props 缺台账事件：commit 83b6e5c8d 已落、G1/G2/G5 已清、绿证 11/11（item 记录有），但 pick/commit/verify 引擎事件没发（macOS 本机 queue.mjs 不可用）；需引擎侧补记 + G6/G7 待办 @loop-closeout
- [ ] 2026-11-17 N-1117-tab-collapse-to-more 回填包待引擎入库：代码 f44ec0942 先落、红证/绿证已备（loop/red/N-1117-tab-collapse-to-more.txt），item 文件已在，需 queue add 分诊 + G1/G2/G5 门签 @loop-closeout
- [ ] 2026-11-17 package-lock.json 版本字段与 package.json 脱节（lock 写 0.0.127、json 已 0.0.128，npm install 会同步）；建议 bump 版本时同步 lock 或加发布前检查 @loop-closeout

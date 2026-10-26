# PRD: AI 会话标题 —— Tab 分层显示 + 后台异步 AI 标题生成

## 背景

1. 会话详情块（`view=aisessions` + `aisessions:sessionid`）在 `session-detail-block.ts:41` 建块时把
   `frame:title` 写死成 `"Session Details"`，`newchat` 写死 `"New Session"`。
2. `block.tsx` 的 `InlineTabLabel.defaultTitle` 第一优先级就是 `if (!isBlank(frameTitle)) return frameTitle;`，
   于是所有会话详情的 tab 名字完全一样、毫无信息量。
3. 会话真正的身份信息在 `SessionSummary.title` / `SessionSummary.projectPath`，但只在 InfoCard 里被读过，
   tab 层从来没接这条通路。
4. 标题现有来源是一条优先级链（`pkg/aisessions`）：
   `user`（手动改名 / AI 提案 Apply）> `first_user_message` > `source_title` > `project` > `id`。
   日常 90% 的标题是「第一条用户消息」截断，**没有 AI 参与**。
5. AI 生成标题的能力已存在（`titlegenerate.go` / `GenerateTitle` RPC），但**纯手动**：必须在 InfoCard 点按钮，
   生成后点 Apply 才落库，且落库后 `titleSource=user`，与手改名无法区分。

## 目标

1. Tab 标题分层显示：`user/ai 标题 > 项目文件夹名（远端拼 connection）> Session Details/newchat 兜底`。
2. 新增**后台静默异步**的 AI 标题自动生成：不影响列表/详情性能，串行限流，绝不重复生成。
3. 新增独立开关（默认**关**），控制"自动生成 AI 标题"。
4. 引入 `ai` 这个 titleSource，优先级插在 `user` 与 `first_user_message` 之间；`user` 永远最高、AI 不覆盖。
5. 保留并明确手动改名（已有双击改名）与手动 Regenerate，二者写入 `user`，永久最高优先。

## 非目标

- 不改变现有 `first_user_message` / `source_title` / `project` / `id` 的生成规则。
- 不新增"按消息数增长自动重生成"（会话变长不重新生成，用户手点才重生成）。
- 不做标题翻译 / 多语言切换。
- 不改 tab 因长标题溢出折叠的既有算法（只控制标题取 basename，不加长前缀）。
- 不改 `agent:sessionid`（TUI agent block）既有命名逻辑。

## 用户故事

1. 作为用户，打开两个不同会话的详情 tab，能一眼从 tab 名区分它们（显示各自的项目文件夹名 → 生成后用各自的会话标题）。
2. 作为用户，手动双击改名后，后台 AI 永远不会把我的标题改掉。
3. 作为用户，我不开开关时不会有任何 AI 标题请求发出。
4. 作为用户，后台生成时列表和详情**完全不卡**、没有 loading、没有弹窗，生成完标题**平滑替换**。

## 约束

- **性能红线**：扫描/列表热路径只做「入队」，绝不调用 AI；worker 独立 goroutine，串行 + 间隔限流；
  每次尝试都落 `attempted` 标记，重启/重扫不重复；单批上限 + 游标。
- **幂等**：一个会话最多被自动生成一次；失败也只记一次，不自动重试。
- **安全**：`user` 标题不可被自动通道覆盖；AI 生成失败/为空时不写标题，保留原兜底值。
- `titleSource === "source_title"`（provider 自带真实标题，如 opencode/pi session name）**不参与**自动生成，
  避免覆盖更权威的来源。

## 验收标准

- [ ] 新建两个不同项目的会话详情块（未生成 AI 标题），tab 分别显示各自项目文件夹 basename；
      远端 connection 追加 ` · connection`；hover tooltip 显示完整 projectPath。
- [ ] `newchat` 块的 tab 显示 `New Session`（或 `New Session · <folder>`），不是空白。
- [ ] 开关关闭（默认）时：后台**零** AI 标题请求（可用日志/断点验证 `GenerateSessionTitle` 未被调用）。
- [ ] 开关打开时：后台 worker 串行生成，单次仅 1 个在途，两次之间不小于配置间隔；生成完 tab/列表标题更新。
- [ ] 手动双击改名后，`titleSource=user`；后续自动通道**永远跳过**该会话（构造重扫验证）。
- [ ] 同一会话重复扫描/重启 App，不再触发第二次自动生成（`attempted_at` 已落库）。
- [ ] 自动生成的标题 `titleSource=ai`；优先级表现为 `ai` 覆盖 `first_user_message`，但被 `user` 覆盖。
- [ ] 生成失败（模型报错/空返回）时：不写标题、记录 attempt、不重试、UI 无报错弹窗。
- [ ] 单元测试覆盖：title 优先级排序、eligibility 判定、attempt 幂等、ApplyMeta 读回 `title_source`。
- [ ] 列表/详情首屏无新增阻塞（对照改动前无明显变慢）。

## Notes

- 涉及 4 个面：Go 后端（metastore/manager/sqlite titleSource 语义）、后台队列、前端设置页、tab 渲染。
- 分两步实施：第一步纯前端 meta（文件夹名，零 RPC），第二步 AI 标题管道。

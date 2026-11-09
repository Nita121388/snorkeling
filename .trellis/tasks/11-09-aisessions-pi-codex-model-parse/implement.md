# 执行计划：pi/codex 会话模型解析

## 步骤

1. `pkg/aisessions/provider_pi.go`
   - `piEntryMessages()`：读 `model` 并写进产出的 `Message.Model`。
   - `parsePiMessages()`：跟踪 `model_change.modelId`，为 `Model == ""` 的 assistant 消息兜底。
2. `pkg/aisessions/provider_codex.go`
   - 新增 `codexMessageParser`（带 `model` 状态 + `parse` 方法，先 observe `turn_context`）。
   - `parseCodexMessages()` 改用有状态解析器；包级 `parseCodexMessageLine` 保留无状态。
3. 测试（`pkg/aisessions/provider_pi_test.go`、`provider_test.go`）
   - `TestPiAssistantMessageModel`：v3 fixture 带 `model` → 断言 `Message.Model`。
   - `TestPiModelChangeFallback`：`model_change` + 无 model 的 assistant → 断言兜底值。
   - `TestCodexTurnContextModel`：两个 `turn_context`（模型不同）+ 各自 assistant → 断言逐条取到对应模型。
4. 校验

```bash
gofmt -l pkg/aisessions/provider_pi.go pkg/aisessions/provider_codex.go
go test ./pkg/aisessions/ -run 'TestPiAssistantMessageModel|TestPiModelChangeFallback|TestCodexTurnContextModel' -v
go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...
```

5. 真实数据校验（临时测试文件，跑完删除，数字记入任务 notes）：

```bash
# 期望两行都是 N / N（相等），pi=deepseek-v4.1-flash，codex=gpt-5.4
go test ./pkg/aisessions/ -run TestTempRealSessionModel -v
```

## 门槛

- G2 器具：上面 4 条命令有确定输出。
- G7 人验收：用户在真机上看悬浮卡 / Tab more / 弹窗副标题不再是「未指定」。

## 回滚点

单 commit；`git revert <sha>` 即可，无数据/配置迁移。

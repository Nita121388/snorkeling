# Journal - nita (Part 1)

> AI development session journal
> Started: 2026-10-03

---

## 2026-10-21 Wave AI：`ai:endpoint` 填 base URL 导致 chat 404

用户报「设置模型后报 404 page not found，但获取模型正常」。根因不是模型选择，是 endpoint 契约：
`ai:endpoint` 一直是完整请求 URL，而 cc-switch 导入和手填都会给成 base URL。FetchModels 早就会
剥 `/chat/completions`，所以模型列表看着正常；三条 chat 链原样 POST 裸 base，网关回 404。

修复走 Lyra `joinUrl` 的思路但更保守：新增 `pkg/aiusechat/aiutil/endpoint.go`，只把「确定是 base」
的形态（裸主机、版本段结尾）补上终止路径，自定义路径（Wave `/api/waveai`、Azure `?api-version=`、
Gemini `models/<m>:method`）一律原样返回。接入 openai-chat / openai-responses / anthropic /
gemini + FetchModels，错误信息加上实际 URL。24 个单测 + openaichat 2 个，全绿，真实端点复验 404→401。

## 2026-10-30 opencode 作为 agent 的支持缺口补齐（进行中）

梳理后发现 opencode 支持是「壳子接好、核心没落地」。三件事落地 + 一个架构性发现：

1. **后端 provider 重写（10-26）**：实测 opencode 1.18.32 真实 schema 是
   `session(model JSON, parent_id, directory)` + `message(data.role)` + `part(type=text/tool)`，
   `session_message` 0 行且无 role/content。旧代码全查错列 → provider 整体扫不到。
   已重写 `provider_opencode.go`：路径探测改 XDG data home（`~/.local/share/opencode`）优先、
   session 读真实列 + 解析 model JSON 填 VendorID + parent_id→Kind/ParentKey、
   消息走 message+part 聚合、工具从 part.type=tool 提取、snippet 走 bounded JOIN、
   新增 LoadMessageDelta（基于 LastSeq 行游标）。legacy role/content 保留为防御回退。
   测试套件按新 schema 全重写 + 新增 model/parent/delta 用例。`go test ./pkg/aisessions` 全绿。

2. **前端 ccswitch loader bug（10-30-ccswitch-loader-fix）**：`loadCcSwitchVendors` 只分
   codex/claude，opencode/pi 全落 claude RPC → opencode 厂商下拉实际是 claude 厂商。
   已补 opencode→CcSwitchListOpenCodeVendorsCommand、pi→...PiVendorsCommand。tsc 该文件 0 错。

3. **关键实测发现：`OPENCODE_HOME` 对 opencode 完全无效**（用非法 json 探测：
   `OPENCODE_CONFIG_DIR` 会报解析错=生效，`OPENCODE_HOME` 无反应=无效）。
   项目里 agent-launch / resume 命令 / cc-switch 物化全用 `OPENCODE_HOME`，等于厂商隔离一直没生效。
   已把 agent-launch 和 restoreCommandForSession 的注入改成 `OPENCODE_CONFIG_DIR`（实测有效），测试同步。

4. **架构性缺口（待决策）**：opencode 会话存在单一全局 DB，`model.providerID`（opencode-go）
   是 opencode 自带 provider，≠ cc-switch vendor id。所以「按会话恢复原厂商」反推不出来，
   恢复隔离对 opencode 不成立。需要产品决策：要么接受 opencode 恢复不隔离厂商，要么在启动时
   把 block→vendor 映射落库做 provenance。

5. **agent-status 钩子**：hookinstall 已用 `OPENCODE_CONFIG_DIR`（正确），但插件自动发现
   需 TUI 启动验证事件 payload，non-interactive 探不到，留作 10-30-hook-verify 真机项。

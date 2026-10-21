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

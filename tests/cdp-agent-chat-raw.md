# CDP Agent Chat Test — 2026-08-25T13:10:06.407Z
target: Wave Terminal - T1 (http://127.0.0.1:51742/index.html)

> 假设：AISessions 视图已打开，CDP 可达。每个 AISessions 块(.block-content)包含自己的 composer 与消息列表，测试在同一块内作用域。会创建带 CDP_TEST_/CDP_DUP_ 标记的消息便于清理。
## Recon
```json
{
  "ok": true,
  "taPlaceholder": "给 Agent 输入任务…",
  "taRect": {
    "x": 857,
    "y": 825
  },
  "sbLabel": "Send message",
  "count": 0
}
```
## T-ORD · 消息顺序
```json
{
  "skipped": true,
  "count": 0
}
```
## T-SND-DUP · 重复发送防护（真实输入 + 同步两次页内点击）
```json
{
  "marker": "CDP_DUP_1787663406514",
  "afterType": {
    "taValEnd": "",
    "sbDisabled": true,
    "sbLabel": "Send message"
  },
  "finalBlk": {
    "found": false
  },
  "stopSeen": false
}
```
## T-SND · 发送后用户消息出现时机 + Send/Stop 切换
```json
{
  "marker": "CDP_TEST_1787663452263",
  "afterType": {
    "taValEnd": "ST_1787663452263",
    "sbDisabled": false,
    "sbLabel": "Send message"
  },
  "appearedAt": null,
  "stopSeen": true,
  "finalBlk": {
    "found": false
  }
}
```
## T-ST · Agent 状态标签（模型/思考/agent）
```json
{
  "note": "marker session not found"
}
```
## T-STP · 流式中停止
```json
{
  "stopped": true,
  "sendLabelAfter": "Send message"
}
```

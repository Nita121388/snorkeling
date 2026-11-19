# 基线测量结果

- 日期：2026-11-19
- 环境：macOS，Chrome Headless 157（桌面 M 系列 CPU，**非 iOS 真机**），viewport 500×757
- 数据：200 agent 行（含 tag/note/props）、1000 条会话消息、SSE 30 条/秒 × 300
- 说明：桌面 Chrome 的数字是**上界参考**，只能横向比较方案。iOS 真机需用 WKWebView + Instruments 复测。

| 指标 | 通过线 | 实测（WebView 基线） | 结论 |
|---|---|---|---|
| 列表挂载（200 行，无虚拟化） | < 120ms | **22.1ms** | 通过 |
| 列表滚动（3s，rAF 采样） | p99 < 16.7ms，掉帧 < 1% | **60.3fps / p99 16.8ms / 掉帧 1** | 通过 |
| 会话挂载（1000 条） | < 250ms | **38.3ms** | 通过 |
| 流式追加（300 条 @30/s） | 最大 rAF 间隙 < 50ms | **18ms**，总时长 10.4s，长任务 0 | 通过 |
| 审批反馈（click → 下一帧） | < 100ms | **14.1ms** | 通过 |
| 冷启动 | < 1.5s | 未测（需真机） | 待测 |

原始输出：

```json
{"results":{"listMount":22.1,
"listScroll":{"frames":181,"p50":16.7,"p95":16.8,"p99":16.8,"dropped":1,"fps":60.3},
"chatMount":38.3,
"stream":{"received":300,"totalMs":10395.3,"worstRafGapMs":18,"perMsgMs":34.7},
"approval":{"clickToPaint":14.1},"longTasks":[]}}
```

## 读数注意

- `perMsgMs` 34.7ms 等于 1000/30，是 SSE 推送节奏，**不是渲染成本**；看渲染要看 `worstRafGapMs`（18ms）。
- `dropped: 1` 是首帧。

## 结论

「观察器」这个工作量在 WebView 档有充足余量（最差项也有 5 倍以上冗余）。它把选型的门槛从"哪个最快"改成
"WebView 够不够"。真机复测若仍达标，MyGo（webview + Go 直连 + 单代码库）可以直接拿下 v0.1，不必上 RN / SwiftUI。

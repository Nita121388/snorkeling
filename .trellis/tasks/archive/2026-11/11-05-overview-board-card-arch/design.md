# 技术设计（A：卡片信息架构）

细节以父任务 `../11-05-overview-board-v2/design.md` §2.1–§2.4 为准。本文件只记本子任务的落点。

## 落点文件

| 文件 | 变更 |
|---|---|
| `frontend/app/session-overview/agent-status-chip.tsx` | 新增：从 `session-overview.tsx` 原样搬出 `AgentStatusChip` / `statusDurationText` / `shouldShowAgentStatusChip` |
| `frontend/app/session-overview/session-overview.tsx` | 改 import；`blockTitle()` 补 cwd basename；panel 组装 `OverviewBoardCard[]` |
| `frontend/app/session-overview/overview-board-model.ts` | 新增 `OverviewBoardCard` / `OverviewBoardAvatar` 类型 + 4 个纯函数 |
| `frontend/app/session-overview/overview-board.tsx` | `OverviewBoardItem` → `OverviewBoardCard`，卡片结构重写 |
| `frontend/app/session-overview/session-overview.scss` | 卡片新结构样式（avatar / meta 行 / note 行） |
| `frontend/app/session-overview/overview-board.test.ts` | 新纯函数用例 |

## 数据装配（panel 侧）

```ts
const personas = useAgentPersonas();
const sessionEmojis = useSessionEmojis();
const cards = useMemo(() => boardBlocks.map((b) => {
    const summary = summaries[b.sessionId]?.summary ?? null;
    const detailSummary = details[b.sessionId]?.detail?.summary ?? null;
    const title = resolveBoardCardTitle({
        isAgentLike: b.isAgentLike,
        sessionTitle: summary?.title ?? detailSummary?.title,
        note: summary?.note,
        projectName: projectNameFromPath(summary?.projectPath ?? meta["cmd:cwd"]),
        tabName: b.tabName,
        providerLabel: providerDisplayLabel(b.agentProvider),
        blockTitle: b.title,
    });
    ...
}), [boardBlocks, personas, sessionEmojis, summaries, details, now]);
```

`presentedStatuses` 仍按 blockId 传入（分组口径不变）。

## 风险

- `OverviewBoardCard` 内 `useAgentReadContext` 每个卡片一个订阅：卡片数上限 ~数十，低频写，可接受；
  若真机出现 re-render 抖动，退回在 panel 预计算 `unread` 布尔值。
- `getAgentIcon` 返回的 `icon` 是 ReactNode：类型上用 `React.ReactNode`，不要在 model 里 import 组件。

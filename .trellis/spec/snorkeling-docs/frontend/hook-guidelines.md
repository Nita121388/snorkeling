# Hook Guidelines

> How hooks are used in this project.

---

## Overview

<!--
Document your project's hook conventions here.

Questions to answer:
- What custom hooks do you have?
- How do you handle data fetching?
- What are the naming conventions?
- How do you share stateful logic?
-->

(To be filled by the team)

---

## Custom Hook Patterns

<!-- How to create and structure custom hooks -->

(To be filled by the team)

---

## Data Fetching

悬浮卡（InfoCard）里的异步数据一律遵守「延迟 + 缓存 + 收敛」三件套。参考实现：
`frontend/app/block/use-repo-info.ts`（`useRepoInfo`，Git 分支信息）。

1. **显示延迟不等同于隐藏延迟。** `useInfoCardHover` 只有 `hideDelayMs`（200–300ms），
   `mouseenter` 会立即开卡。因此任何会发 RPC 的卡片内容必须自己在 hook 里加停留阈值
   （现用 `REPO_INFO_DELAY_MS = 150`），否则快速划过 Tab 栏会打出一串请求。
2. **不预取。** 悬停卡是低频、单实例的 surface，Block 挂载时预取会让「打开 N 个 block」
   变成 N 次 RPC。
3. **模块级缓存 + TTL，正负同寿。** 失败也要写负缓存，防止失败风暴；TTL 到期不主动刷新，
   只在下一次真正需要时重取。
4. **single-flight。** 同 key 在途只保留一个 Promise。
5. **状态只落在叶子组件。** RPC state 放在卡片内部的子组件（如 `RepoLine`），不要提到
   卡片本体或 `BlockInfoCard` 分派器，避免三个消费方（header / inline tab / sidebar）连带 re-render。
6. **缓存 key 带上 connection**（`connection\0path`），本地与远端同名路径是两个仓库。

## Naming Conventions

<!-- How data fetching is handled (React Query, SWR, etc.) -->

(To be filled by the team)

---

## Naming Conventions

<!-- Hook naming rules (use*, etc.) -->

(To be filled by the team)

---

## Common Mistakes

- 把「隐藏延迟」当成「显示延迟」，在 hover 开始时立刻发起 RPC。
- 在卡片本体（`PreviewInfoCard` 等）里直接 `useState + useEffect` 拉数据，
  让卡片壳与分派器一起 re-render。
- 失败不写负缓存 → 每次悬停都重试同一个坏路径。

<!-- Hook-related mistakes your team has made -->

(To be filled by the team)

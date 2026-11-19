# Tab 悬浮弹窗被截断（info-card 无视口钳位）

## Goal

悬浮 workspace Tab 的 info card 只做相对偏移、无视口钳位，靠右/靠下时整卡被窗口裁掉；修复为纯函数 computeCardPos（翻侧 + 钳位），判据在 info-card-pos.test.ts。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## 2026-11-19 复发报告（nita，macOS 0.0.131 实测）

- 现象：macOS 上当前版本，**agent block 头部悬停弹出的 agent card 仍被窗口边缘截断**。
- 根因（代码已核实）：11-06 修复只接了 4 个面（tab.tsx / block.tsx / block-sidebar.tsx / tab-more-menu），
  **第 5 个面漏了**——`frontend/app/block/blockframe-header.tsx:1044-1052` 的 agent hover 卡容器仍是
  `position: absolute; top: 100%; left: 0`，无视口钳位、无翻转。block 靠右/靠下时卡片顶出视口被裁。
- 修复方向：复用已测好的 `computeCardPos`（frontend/app/element/info-card/info-card-pos.ts，10 例单测），
  **只换定位、不动交互**（保留延迟隐藏 / 焦点钉住 / InfoCardPinProvider / claimInfoCard / 点击外部关闭全套行为）。
- 验收：
  - 新增单测：右缘 header、下缘 header 两夹具下，卡片矩形 `right ≤ viewport.width`、`bottom ≤ viewport.height`
  - `npx vitest run frontend/app/element/info-card/ frontend/app/block/` 全绿（现有 173 例不回归）
  - 白名单 tsc 0 新增 error；eslint 0 error
- 真机验收：代码合入后由 nita 重启 app（可带 `--remote-debugging-port=9222` 走 CDP 量矩形）肉眼/机器确认。

## 2026-11-19 修复完成（worker agent）· 待真机验收

改动（白名单内）：
- `frontend/app/block/blockframe-header.tsx`：agent hover 卡容器改挂 **body portal + fixed 像素坐标**；
  坐标 = `computeCardPos({ rect: headerElRef 矩形, card: 实测尺寸, viewport, placement: "bottom" })`（翻侧 + 钳位）。
  首帧按 0 尺寸估算，挂载后 `useLayoutEffect` 实测尺寸 paint 前重算（同 info-card-hover.tsx 手法）；
  窗口 resize 时若卡开着重算。交互一行未动：延迟隐藏 / 焦点钉住 / InfoCardPinProvider / claimInfoCard
  单例独占 / class `info-card-portal` 全部保留。唯一定位相关调整：`isInsideCardOrHeader` 的 header 判定
  从 `cardEl.closest(...)`（portal 后失效）改为复用 `headerElRef`，点击外部关闭语义等价。
  祖先链有 backdrop-filter / will-change，in-place `position:fixed` 的包含块会被改写，故必须 portal，不能留在 header 子树。
- `frontend/app/block/blockframe-header-card-pos.dom.test.tsx`（新建，@vitest-environment jsdom）：
  真实挂载 BlockFrame_Header + 重写 Element.prototype.getBoundingClientRect 喂几何夹具，覆盖：
  右缘钳位 / 下缘翻转 / resize 重算 / portal 锚点与 class / 点击外侧关闭 / 点击内部不关 / 焦点钉住。

验收结果：
- `npx vitest run frontend/app/element/info-card/ frontend/app/block/` → **25 files / 220 tests 全绿**（含既有 173 例不回归 + 新增 6 例）
- `npx eslint frontend/app/block/blockframe-header.tsx frontend/app/block/blockframe-header-card-pos.dom.test.tsx` → **0 error**（2 个 `t` unused warning 为既有代码）
- `node scripts/check-tsc-baseline.mjs` → 白名单文件 **0 新增**（8 条新增全在 agent-status/aipanel/emain/onboarding 等其他 agent 的在途改动）

真机验收建议：重启 app 后带 `--remote-debugging-port=9222`，把 agent block 拖到窗口右下角，
hover 头部确认卡片整卡在视口内（可 `node scripts/inspect-electron-ui.mjs` 量矩形）。

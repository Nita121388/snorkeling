# Implement: 弹窗焦点两层收口

## 步骤（有序；每步后跑对应判据）

### S1 registry + Modal 接线（AC1）
- [ ] 新建 `frontend/app/modals/modal-open-registry.ts`（API 见 design §1）
- [ ] 新建 `frontend/app/modals/modal-open-registry.test.ts`：claim/release 幂等、多源共存、sink 回放、resetForTest
- [ ] `modal.tsx`：组件体内 `useModalOpenSource(true)`（key 用 `useId`）
- [ ] `modalsrenderer.tsx`：`globalStore.set(atoms.modalOpen, rtn.length > 0)` → `setModalOpenSource("modals-stack", rtn.length > 0)`
- [ ] `tab-target-modal.tsx`：删除自写 atom 的 effect，改 `useModalOpenSource(true)`
- [ ] `app.tsx`：挂载时 `bindModalOpenSink((open) => globalStore.set(atoms.modalOpen, open))`
- 判据：`npx vitest run frontend/app/modals/modal-open-registry.test.ts frontend/app/modals/modal.dom.test.tsx`
- [ ] `modal.dom.test.tsx` 加用例：挂载 Modal → `modalOpenAny() === true` 且 `atoms.modalOpen` 为 true；卸载 → false

### S2 外壳不吃指针（AC2）
- [ ] `modal.scss`：`.modal-wrapper { pointer-events: none; }`，`.modal-backdrop { pointer-events: auto; }`，`.modal { pointer-events: auto; }`
- 判据：S5 真机探针第 2 断言

### S3 弹窗回焦（AC3）
- [ ] `commontext-compose-modal.tsx`：内容根节点加 `onFocusCapture`（记录最后可编辑）+ `onBlurCapture`（relatedTarget==null → rAF 回焦）
- [ ] `commontext-compose-modal.dom.test.tsx` 加用例：
  - blur 且 relatedTarget=null → rAF 后 activeElement 回 textarea
  - 焦点在弹窗内控件间移动 → 不改焦点
- 判据：`npx vitest run frontend/app/commontext/commontext-compose-modal.dom.test.tsx`

### S4 详情编辑合成期守卫（AC4）
- [ ] `commontext-compose-modal.tsx`：`detailComposingRef` + `pendingDetailResetRef`；联动 effect 合成中只记账不写
- [ ] dom test：合成中列表刷新（detailId 不变、文本外部变化）→ detailText 不被覆写；合成结束后校正
- 判据：S3 同一命令

### S5 emain 窗口回焦补 focus（AC5）
- [ ] `emain/emain-window.ts`：抽 `refocusActiveTabWebContents()`；`setActiveTab` 换用；`on("focus")` 调用（relaunching 跳过）
- [ ] 判定抽纯函数 `shouldRefocusActiveView(...)`（放 emain-window.ts 顶部导出）+ `emain-window.test.ts` 用例
- 判据：`npx vitest run emain/emain-window.test.ts`

### S6 全量绿 + 真机探针
- [ ] `npx vitest run frontend/app/modals frontend/app/commontext emain`（相关面全绿）
- [ ] 新建 `tmp/ct-diag6.mjs`（真机，探针断言三行）：
  1. 弹窗开着 → `window.globalAtoms.modalOpen` === true
  2. `elementFromPoint(新建 Tab 中心)` 命中 tab 栏按钮（不再是 DIV.modal-wrapper）
  3. 点死区 (390,18) 后 `document.activeElement` 仍是详情 textarea（回焦生效）
- [ ] 跑一次 `commontext-source-notion` 验证台确认无回归（环境允许时；不允许则记 skipped 原因）

## 提交
- [ ] `git status` 只含本任务文件；`git add` 明确列文件
- [ ] commit：`fix(commontext): 弹窗失焦根治——modalOpen 登记 + 外壳不吞点击 + 失焦回焦 + emain 补 focus（11-23-commontext-modal-focus）`
- [ ] 台账：verify-ledger 记一行真机结论

## 回滚点
- 每步一个 commit 不必（单 commit）；出问题时按 design「兼容与回滚」表逐项关开关。

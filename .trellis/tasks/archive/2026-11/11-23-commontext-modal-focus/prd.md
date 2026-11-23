# PRD: CommonText 弹窗失焦根治（modalOpen / 外壳 / 回焦 / emain 补 focus）

## 背景（本轮真机排查结论）

用户反复反馈：CommonText 列表详情编辑时"容易失去焦点、拿不到焦点"，要切 app 的 Tab 再切回来才好。
前几轮修的是 composer 编辑器与列表（重渲染 / hover / IME / mousedown），都没有命中真正的原因。

在 HEAD（529f1cadd）源码真机实例上用 CDP 真实指针 + 真实键盘走查，得到两个层面的缺陷：

1. **DOM 层（真机已复现）**
   - CommonText 弹窗直接渲染 `<Modal>`，不经过 `modalsModel`，因此 `atoms.modalOpen` 恒为 `false`。
   - `atoms.modalOpen` 的唯一写入点是 `ModalsRenderer`（`modalsrenderer.tsx:53`）。
   - 后果 A：`keymodel.shouldDispatchToBlock` 在 `activeElement === body` 时返回 `true`，按键被派发给背后聚焦块；
     终端块会把字符写进 shell（"看起来焦点丢了、字打不进"）。
   - 后果 B：`block.tsx` 的 `focusFromPointerEnter` 守卫 `if (modalOpen …) return` 对这类弹窗失效。
   - 后果 C：`.modal-wrapper` 是全屏固定层且默认吃点击。真机实测：弹窗开着时点「新建 Tab」(390,18)
     命中元素是 `DIV.modal-wrapper`（tab 栏点不动）；点该区域后 `document.activeElement` 变成 `BODY`
     （弹窗内 textarea 被 blur，没有任何代码回收焦点）。
   - 已确证：详情 textarea 自身的受控更新路径是稳定的（连续键入跨过 800ms 自动保存、IME 合成 nihao→你好，
     activeElement 全程不变、命中测试全程命中 textarea）。所以"改 textarea 内部"不解决问题。

2. **窗口层（强推断，代码自证）**
   - 每个 Tab 是独立 Electron `WebContentsView`。emain 里对"tab 视图莫名丢 webContents 焦点"已有手工补拍注释与
     `focus()` 重试（`emain-window.ts:631-643`），只在切 Tab 时补。
   - 该层失焦时 DOM `document.activeElement` 仍是 textarea、但键入无响应、点击输入框不出光标；
     切 Tab 会 `webContents.focus()` → 立即恢复。这正是用户"切 Tab 再切回来才行"的机制，点击无法修。

## 目标（AC，全部机器可判定）

- **AC1 弹窗登记为 modal**：任意 `<Modal>` 挂载期间 `atoms.modalOpen` 为 `true`，卸载后回到 `false`；
  `modalsModel` 栈与直接渲染的 `<Modal>` 两种来源共存时不互相覆盖。
  判据：`modal-open-registry.test.ts` + `modal.dom.test.tsx` 新增用例全绿；
  真机：弹窗开着时 `window.globalAtoms.modalOpen` 读值为 `true`。
- **AC2 弹窗外壳不再吞点击、不再无故丢焦点**：`.modal-wrapper` 不吃指针，`.modal` 与 `.modal-backdrop` 显式接管。
  判据：真机探针——弹窗开着时 `document.elementFromPoint(新建 Tab 中心)` 不再是 `DIV.modal-wrapper`；
  点该点后 `document.activeElement` 仍是详情 textarea（考虑 AC3 的回焦）。
- **AC3 弹窗内失焦自动回焦**：焦点掉到 `body`（`relatedTarget == null`）且弹窗仍开着时，回收上一个可编辑控件；
  焦点在弹窗内控件之间移动（`relatedTarget != null`）时不干预。
  判据：`commontext-compose-modal.dom.test.tsx` 新增用例（派发 blur → 焦点回 textarea；点按钮 → 不回收）。
- **AC4 详情编辑不被合成/复位打断**：详情 textarea 合成期间，联动 effect 不重置 `detailTitle/detailText`，
  合成结束后再按最新数据校正。
  判据：`commontext-compose-modal.dom.test.tsx` 断言语义（合成中不 reset，结束后校正一次）。
- **AC5 emain 窗口回焦补 focus**：窗口重新获得焦点时，若当前 Tab 的 webContents 不是 focused，则补 focus
  （复用切 Tab 那套 0/10/30ms 节拍）。
  判据：`emain-window.test.ts` 新增纯函数用例（是否该补 focus 的判定），真机上以焦点日志人工复核。

## 非目标

- 不改 CommonText 的业务数据写入链路（settings / 同步 / auto-save 语义不动）。
- 不改 `Detail` 组件在列表筛选变化时的回落语义（只加合成期守卫）。
- 不为其余 40 处 `<Modal>` 逐个加焦点恢复（AC1/AC2 是外壳级，自动对它们生效）。
- 不在本轮引入"弹窗最小化焦点陷阱（focus trap）"，只做回焦。

## 风险与回滚

- AC1 改动会让"任意弹窗开着时" `modalOpen === true`。风险：某个 `<Modal>` 常驻挂载（隐藏但不卸载）会把全局键路由永久关掉。
  已核对 41 处 `<Modal>` 用法均按 open 条件挂载（`modalsModel` 栈内、`{flag && <Modal/>}`、`{x != null ? … : null}`）。
  回滚：`modal.tsx` 里去掉 `useModalOpenSource` 调用即可恢复旧行为（registry 保持无副作用）。
- AC2 让 tab 栏在弹窗开着时可点（顶部 36px 不在 backdrop 内）。这是用户既有绕行路径的显式化，不是新语义。
  回滚：`.modal-wrapper { pointer-events: auto }`。
- AC5 在窗口回焦时强制 focus 当前 Tab 视图。风险：抢走 DevTools/输入法候选窗焦点；
  已用 `webContents.isFocused()` 判空与 `relaunching` 守卫，节拍与既有 setActiveTab 一致。

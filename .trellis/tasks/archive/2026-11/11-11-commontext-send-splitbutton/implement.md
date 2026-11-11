# Implement — SplitButton + CommonText Send 弹层修复

## 步骤（顺序执行）

### 1. 新控件
- [ ] 1.1 新建 `frontend/app/element/splitbutton.tsx`（API/行为见 design.md §2）
- [ ] 1.2 新建 `frontend/app/element/splitbutton.scss`（语义 token 造型）

### 2. 接入 CommonText Send
- [ ] 2.1 `commontext-send-button.tsx`：删 `Portal` / `popoverShellClass` / 手工 anchorRect / 全屏遮罩
- [ ] 2.2 `CommontextSendButton` 改用 `<SplitButton>`；popover 内容作为 children({close})
- [ ] 2.3 `SendTargetPopover` → `SendTargetPanel`（无 portal、无遮罩；保留全部 data-* 属性与分区）
- [ ] 2.4 `PickerMenu` 改为面板内 absolute anchored 菜单 + 面板级 pointerdown 关闭

### 3. 测试
- [ ] 3.1 新建 `frontend/app/element/splitbutton.dom.test.tsx`（jsdom）：
      - caret 点击 → 弹层渲染
      - 主段点击 → 弹层**不**打开、主段回调被调用
      - floating 层 style.zIndex 为 1000
      - 外部 pointerdown → 关闭
      - Escape → 关闭
- [ ] 3.2 既有 `commontext-send-target.test.ts` / `commontext-*.test.*` 保持绿

### 4. 验证台升级
- [ ] 4.1 `verify.mjs` 加 `realClick()` + `elementFromPoint` 命中断言（caret / popover / picker）
- [ ] 4.2 二级菜单项真实点选 + 面板外真实点击关闭 + Escape 关闭
- [ ] 4.3 截图：01-send-button / 02-popover-with-picker / 03-after-send

### 5. 收尾
- [ ] 5.1 `npm run build:prod`（或 tsconfig/vite build 等价）通过
- [ ] 5.2 真机 verify 全绿 → 写 `docs/project/verify-ledger.md`
- [ ] 5.3 教训回写：`docs/project/ui-verify-playbook.md`（合成 click 会假绿、portal 层叠上下文陷阱）
- [ ] 5.4 commit（feat(commontext): …），task 归档

## 验证命令

```powershell
# 单测（快速）
npx vitest run frontend/app/element/splitbutton.dom.test.tsx
npx vitest run frontend/app/commontext/

# 真机验证（真实指针 + 截图）
node scripts/verify/commontext-send-agent-block/verify.mjs

# 构建
npm run build:prod
```

## 回滚点
- 每步独立可回滚；最坏整包 revert（单一 commit）。

## 触碰路径（白名单）
- `frontend/app/element/splitbutton.tsx`
- `frontend/app/element/splitbutton.scss`
- `frontend/app/element/splitbutton.dom.test.tsx`
- `frontend/app/commontext/commontext-send-button.tsx`
- `scripts/verify/commontext-send-agent-block/verify.mjs`
- `docs/project/verify-ledger.md`
- `docs/project/ui-verify-playbook.md`
- `.trellis/tasks/11-11-commontext-send-splitbutton/**`

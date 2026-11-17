# 执行计划：N-1117-conn-typeahead-row-rail

## 改动文件（= loop touch 白名单）

| 文件 | 内容 |
|---|---|
| `frontend/app/modals/typeaheadmodal.tsx` | 行结构改「左 icon / label / 右栏 rail」；新增 `loading` 骨架渲染；高度计算纳入 loading |
| `frontend/app/modals/typeaheadmodal.scss` | label 真省略；rail 右对齐；copy 槽位常驻 + hover 浮现；骨架 shimmer |
| `frontend/app/modals/conntypeahead.tsx` | 行数据加 `copyText`；loading 状态（两 RPC settle 后落）；接入 `conn-usage` 排序；空列表 Enter 护栏 |
| `frontend/app/modals/conn-usage.ts` | 新增：localStorage 使用计数读写 + 纯排序函数 |
| `frontend/app/modals/conn-usage.test.ts` | 新增：计数累加 / 排序纯函数断言 |
| `frontend/app/modals/typeaheadmodal.test.tsx` | 新增：rail 结构 + loading 骨架 + copy 点击不冒泡 |
| `frontend/app/modals/conntypeahead.test.tsx` | 新增：copyText 只在有连接名的行 / Enter 空列表不抛 |
| `frontend/types/custom.d.ts` | `SuggestionConnectionItem.copyText?: string` |
| `frontend/i18n/locales/{en,zh}/modals.json` | `connTypeahead.copyName` / `copyFailed` / `loading` |
| `scripts/verify/conn-typeahead-rail/verify.mjs` | 新增真机 area（右栏极差 / hover 复制 / 骨架 / 排序） |
| `scripts/verify/README.md` | area 表登记一行 |
| `docs/project/verify-ledger.md` | 结论一行 |

## 顺序

1. **红证先行**：先写 `conn-usage.test.ts` + `typeaheadmodal.test.tsx` + `conntypeahead.test.tsx` 的新断言，在**未改动**的旧源上跑 → 必红 → 存 `loop/red/N-1117-conn-typeahead-row-rail.txt` → `queue gate --gate g2`。
2. `queue run --id N-1117-conn-typeahead-row-rail --dry-run` → `--emit-pick`。
3. 实现 `conn-usage.ts`（纯函数 + localStorage 薄壳）→ 单测转绿（排序部分）。
4. 改 `typeaheadmodal.tsx` / `.scss`（rail + loading + 骨架样式）。
5. 改 `conntypeahead.tsx`（copyText、loading、排序接入、Enter 护栏、i18n 文案透传）。
6. i18n：新增 key 双语 → `npm run i18n:check`。
7. `npx vitest run frontend/app/modals` 全绿。
8. 新 verify area（从 `scripts/verify/_template` 复制，只用 `lib/cdp|launch|probes|report`）→ 真机跑（async，>60s）。
9. `queue prove` → 采数字 → park green。
10. 台账 + spec 回写 + commit。

## 回滚点

- `conn-usage.ts` 独立新文件，排序是叠加在既有 `sortConnSuggestionItems` 之上的一层 → 回滚只需还原 `conntypeahead.tsx` 一行调用。
- 右栏/骨架改动集中在两个文件，`git checkout` 即回到现状（无数据迁移、无后端改动）。

## 判据（与 prd 一致）

```bash
npx vitest run frontend/app/modals --reporter=basic && echo MODALS_TESTS_PASS
npm run i18n:check && echo I18N_PASS
node scripts/verify/conn-typeahead-rail/verify.mjs && echo VERIFY_PASS
```

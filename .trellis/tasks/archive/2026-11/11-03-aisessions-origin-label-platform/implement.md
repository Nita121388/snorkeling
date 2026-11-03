# 执行清单

## 1. 后端：平台化标签

- [x] 1.1 `pkg/service/aisessionsservice/origins.go`
  - 新增 `localOriginLabelFor(goos string) string`：`windows → "This PC"`，`darwin → "This Mac"`，其余 `"This Machine"`。
  - 新增 `localOriginLabel() string` = `localOriginLabelFor(runtime.GOOS)`。
  - 把 `Origins()` 里的 `Label: "This Mac"` 换成 `Label: localOriginLabel()`。
  - 加注释说明：与 `wshremote.WindowsDrivesDisplayName`（"This PC"）保持同一叫法。

## 2. 前端：去掉 fallback 硬编码

- [x] 2.1 `frontend/app/view/aisessions/origin-switcher.tsx:110-111`
  - `active?.label ?? "This Mac"` → `active?.label ?? "this machine"`（`aria-label` 与 `title` 各一处）。

## 3. 测试

- [x] 3.1 `pkg/service/aisessionsservice/origin_service_test.go`
  - 新增表驱动 `TestLocalOriginLabelFor`：`windows`/`darwin`/`linux` 三个输入。
  - 在 `TestOrigins_LocalFirstAndIncludesEnvDump` 里补一条 `local.Label == localOriginLabel()` 断言。

## 4. 验证

- [x] 4.1 `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice"`
- [x] 4.2 `go build ./...`（或至少 `go vet ./pkg/service/aisessionsservice`）
- [x] 4.3 `rg -n "This Mac" pkg/ frontend/` → 只应命中 `origins.go` 的 darwin 分支
- [x] 4.4 前端类型检查（仓库既有脚本；如 `npm run` 里有 tsc/check，按实际名称执行）
- [x] 4.5 真机确认：重启应用后打开 AISessions，Origin 下拉显示 "This PC"

## 回滚点

- 全部改动集中在 3 个文件，验证失败可 `git checkout -- <file>` 单文件回退。

## 验证记录（2026-11-03）

| 检查 | 命令 | 结果 |
|---|---|---|
| 包单测 | `go test ./pkg/service/aisessionsservice -run 'TestLocalOriginLabelFor|TestOrigins_' -v` | PASS（4 个用例全绿，含新增 `TestLocalOriginLabelFor`） |
| 构建 | `go build ./pkg/...` | BUILD OK |
| 静态检查 | `go vet ./pkg/service/aisessionsservice` | 无输出（干净） |
| 前端类型 | `tsc --noEmit -p tsconfig.json` | 无错误输出 |
| 前端单测 | `vitest run frontend/app/view/aisessions/origin-state.test.ts` | 9 passed |
| 残留文案 | `rg -n "This Mac" pkg/ frontend/` | 只剩平台推导函数的 darwin 分支（`origins.go:31`）+ 测试断言 |

结果：AC1–AC4 由命令核验；AC5 见上表。AC6（真机确认下拉显示 "This PC"）需重启应用后人工确认。

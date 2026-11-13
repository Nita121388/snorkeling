# A1 persona 核心 — 执行计划

> 判据见 `prd.md`，技术口径见 `design.md`。顺序执行，每步有验证命令。

## 步骤

### 1. `pkg/persona/persona.go` — 数据模型 + 根目录解析
- [x] `Persona` / `PersonaLocal` / `Provenance` / `Origin` 结构体（JSON tag 定稿）
- [x] `DefaultRootDir` / `ResolveRoot`（显式 > `PERSONA_ROOT` env > `~/.snorkeling/personas`）
- [x] `slugify(name)`：小写、折叠非法字符、中文/空名回落 `persona-<sha1[:8]>`
- [x] 验证：`go build ./pkg/persona/`

### 2. `pkg/persona/scaffold.go` — 模板与落盘
- [x] 全套模板常量（CHARTER / MEMORY 五件套 / agents 三契约 / 根级 AGENTS.md ≤20行 / .gitignore / persona.json / persona.local.json）
- [x] `Create(opts)`：幂等（已存在 → 读回返回 `Created=false`，零写入）；dry-run 零落盘（不 MkdirAll）
- [x] `.persona/` 下文件数 ≥ 12；GENERATED 头齐全
- [x] 验证：`go test ./pkg/persona/ -run TestCreate`

### 3. `pkg/persona/roster.go` — 名册
- [x] `List(root)` 扫描 + 排序（名字）
- [x] `WriteRoster(root)`：临时文件 + 原子 rename；>50 条加折叠提示行
- [x] create/rename 后自动重生成
- [x] 验证：`go test ./pkg/persona/ -run TestRoster`

### 4. `pkg/persona/rename.go`
- [x] `Rename(root, old, new, dryRun)`：目标存在报错不覆盖；`os.Rename` + 更新 `persona.json.id` + 重写名册；`rewriteBlockMetaReferences` 空钩子（A3 接）
- [x] 验证：`go test ./pkg/persona/ -run TestRename`

### 5. `pkg/persona/persona_test.go` — 单测
- [x] TestSlugify（含中文名、空名、重音符号）
- [x] TestCreate（dry-run 零落盘；--yes 落盘 ≥9 文件；重复 create 幂等：CHARTER md5 不变）
- [x] TestRoster（create 后名册含 id；rename 后旧 id 0 次）
- [x] TestRename（旧目录不存在；目标冲突报错）
- [x] 验证：`go test ./pkg/persona/...` → ok

### 6. `cmd/wsh/cmd/wshcmd-persona.go` — CLI
- [x] `wsh persona create/list/get/rename`，flag：`--name/--emoji/--role/--provider/--model/--json/--yes/--root`
- [x] dry-run 默认；`--json` 纯结构化输出；幂等命中 exit 0
- [x] `rootCmd.AddCommand`
- [x] 验证：`go build ./cmd/wsh/`

### 7. 全量判据（prove 用，含 PRD 六条）
```bash
go test ./pkg/persona/...                                          # ok
go build ./cmd/wsh/                                                 # 通过
d=$(mktemp -d) && wsh persona create --name smoke --root "$d" --dry-run  # 文件清单、零落盘（find "$d" -type f | wc -l == 0）
wsh persona create --name smoke --root "$d" --yes                      # find "$d/smoke/.persona" -type f | wc -l >= 9
再次同名 --yes && sha256("$d/smoke/.persona/CHARTER.md") 不变       # 幂等
wsh persona rename smoke second --root "$d" --yes                     # ! -e smoke && grep -c smoke roster == 0
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"               # <= 47
```

## 回滚点

每步独立可回滚（步骤间无共享临时态）；整体回滚 = 删 `pkg/persona/` + `cmd/wsh/cmd/wshcmd-persona.go`（用户数据不删）。

## 出白名单即停

touch 白名单（loop 工作项）：`pkg/persona/**`、`cmd/wsh/cmd/wshcmd-persona.go`、`.trellis/tasks/11-12-persona-core/**`、`.trellis/spec/**`、`loop/**`、`docs/project/persona-system.md`。

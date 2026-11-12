# A1 persona 核心：目录布局 + scaffold + wsh persona CLI

## Goal

立起 persona 的数据地基：磁盘布局、scaffold 生成、CLI。此后所有子包只消费它。

## Requirements

- 布局按设计 §3.1：`<rootdir>/<id>/.persona/{persona.json, persona.local.json, CHARTER.md, MEMORY/…, agents/}` + 根级 `AGENTS.md` 指针 + `work/`；名册派生在 `<rootdir>/.index/PERSONAS.md`
- scaffold 幂等；创建即生成全套文件（persona.json 带 `schemaVersion`；CHARTER 模板；MEMORY 五件套；agents 三 provider 契约）
- 生成物带 `GENERATED` 头；根级 AGENTS.md ≤ 20 行（指针 + 先读 MEMORY + 同事规则）
- `wsh persona create/list/get/rename`：dry-run 默认、`--yes` 才写、幂等（slug 冲突返回已存在不覆盖）、`data` scope、`--json`
- `rename` = move + 更新 id + 重扫名册 + 重写 block meta `persona:id` 引用
- 目录名 = id；显示名（persona.json.name）可独立改

## Acceptance Criteria

- [ ] `go test ./pkg/persona/...` → ok
- [ ] `wsh persona create --name smoke --dry-run` → 输出文件清单且零落盘
- [ ] `wsh persona create --name smoke --yes` 后 `.persona/` 下文件数 `>= 9`
- [ ] 再次同名 `--yes` → 退出码 0 且 CHARTER md5 不变（幂等不覆盖）
- [ ] `wsh persona rename a b --yes` 后旧目录不存在、名册 0 处引用 a
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 依赖

R0。

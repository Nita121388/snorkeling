# 实施计划

## 文件清单（touch 白名单）

- `pkg/hero/scaffold.go` — rootPointerTemplate 增加身份段 + 必读硬规则
- `pkg/hero/scaffold_test.go` — 新增断言（先红后绿）
- `frontend/app/workspace/hero-launch.ts` — 仅修 L84 过期注释
- `.trellis/tasks/11-16-hero-identity-inject/**` — 任务文档
- `loop/**` — 台账

## 顺序

1. [ ] G2 器具：先写 scaffold_test.go 新断言，对当前源跑 → 记录失败输出到 loop/red/F-1116-hero-identity-inject-g2.txt（红证）
2. [ ] 建 loop 包 + 登记 g1/g6 门（nita 会话授权）
3. [ ] 改 rootPointerTemplate：身份段（emoji name + role）+「必读 CHARTER.md / facts.md TL;DR」硬规则
4. [ ] 修 hero-launch.ts L84 注释
5. [ ] `go test ./pkg/hero/...` 全绿 + `go build ./cmd/wsh/`
6. [ ] 临时目录 scaffold 验证产物内容
7. [ ] 真机证据：headless pi 在临时 hero 基地确认注入面含使命文本
8. [ ] g5 合规 + g7 验收（nita）

## 回滚

单模板回退 = git revert 单 commit；据点生成物本来就是 gitignore + 登场重建，无数据迁移。

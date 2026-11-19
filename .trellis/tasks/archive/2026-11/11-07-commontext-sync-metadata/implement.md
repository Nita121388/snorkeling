# Implement — 元数据模型

## Checklist

- [ ] 1 `pkg/wconfig/settingsconfig.go`：两个新类型 + CommonTextItemType 四字段 + jsonschema 标注
- [ ] 2 重生成 `schema/settings.json`，diff 检查只含新字段
- [ ] 3 `pkg/commontextstore/commontext_store.go`：7 列迁移（PRAGMA 探测）
- [ ] 4 读出兜底函数 nilToDefault + Scan 接线
- [ ] 5 ListOptions 三过滤（creator/device/includeDeleted）+ 参数化 WHERE
- [ ] 6 UpsertItem 新列写入
- [ ] 7 单测：迁移 fixture（旧 schema 建表 + 旧行）→ 读出兜底；新行往返无损；三过滤各一例；墓碑排除/可见
- [ ] 8 `frontend/app/commontext/commontext-model.ts` 类型 + normalize 兜底（前端展示层先就位，供 UI 子任务消费）

## 验证命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/commontextstore/ ./pkg/wconfig/"
```

判据（G2 门链）：
1. `go test ./pkg/commontextstore/ -run TestMigrateLegacyRows` → PASS（旧行读出带 human/local/0 兜底）
2. `go test ./pkg/commontextstore/ -run TestFilters` → PASS（creator/device 过滤计数精确）
3. `go test ./pkg/commontextstore/ -run TestTombstone` → PASS（默认排除，IncludeDeleted 可见）

## 回滚点

单 commit；迁移是纯 ALTER ADD COLUMN，回滚只需回退代码（列多出无害）。

# Design — 元数据模型

## 结构体（pkg/wconfig/settingsconfig.go）

```go
type CommonTextCreatedByType struct {
    Kind string `json:"kind,omitempty" jsonschema:"enum=human,enum=agent"`
    Name string `json:"name,omitempty"`
}
type CommonTextOriginType struct {
    DeviceId   string `json:"deviceid,omitempty"`
    DeviceName string `json:"devicename,omitempty"`
    Platform   string `json:"platform,omitempty" jsonschema:"enum=win32,enum=darwin,enum=linux"`
}
```

追加到 `CommonTextItemType`：`CreatedBy *CommonTextCreatedByType` / `Origin *CommonTextOriginType` / `Rev float64` / `DeletedAt float64`，全 omitempty。指针类型保证旧 JSON（无这些键）解析不产生非 nil 空对象。

## SQLite 迁移（commontextstore）

| 列 | 类型 | 说明 |
|---|---|---|
| createdby_kind | TEXT | human/agent |
| createdby_name | TEXT | |
| origin_deviceid | TEXT | |
| origin_devicename | TEXT | |
| origin_platform | TEXT | |
| rev | INTEGER DEFAULT 0 | 条目级版本 |
| deletedat | REAL NULL | NULL=存活 |

迁移沿用库内 `PRAGMA table_info` 探测 + `ALTER TABLE ADD COLUMN` 先例。**不写 NOT NULL DEFAULT**——旧行保持 NULL，读出侧兜底，避免触发整表重写。

## 读出兜底（nilToDefault）

`rows.Scan` 后若 createdby_kind 为空串 → `CreatedBy={Kind:"human",Name:""}`；origin_deviceid 空 → `Origin={DeviceId:"local",DeviceName:"This machine",Platform:runtime.GOOS 映射}`；rev NULL → 0。写路径不回填。

## ListOptions

```go
CreatorFilter string  // ""|all|human|agent（"" 与 all 等价）
DeviceFilter  string  // ""|any|<deviceId>
IncludeDeleted bool
```

参数化 WHERE 追加；DeviceFilter 用 `origin_deviceid = ?`（不匹配兜底行 "local"，符合预期：旧条目归 "local" 设备）。

## 前端类型（commontext-model.ts）

同名可选字段 + `normalizeItem()` 兜底同规则。`rev` 供未来 transport 用，本任务不自动递增。

## 权衡

- 元数据放 settings JSON（随条目走）而不是单独表：条目是同步单元，payload 自包含；单独表会让 folder 单文件 payload 组装变 join
- `Platform` 枚举而非自由串：约束展示口径（徽标 tooltip / 属性网格），写入侧由 origin 构造器把关

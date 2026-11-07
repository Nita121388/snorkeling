# R1 元数据模型：CommonTextItemType 加 createdBy/origin/rev/deletedat + store 迁移

> 父任务：11-07-commontext-cloud-sync（需求总集与跨面验收见其 prd）
> 原型依据：`design/prototypes/commontext-cloud-sync-notion/` README「R1 云同步 + 元数据」表

## Goal

Go 侧 `CommonTextItemType` 增加来源元数据字段；`commontextstore` SQLite 列迁移 + 查询过滤；旧数据零迁移兜底。

## Requirements

### R1.1 结构体字段（pkg/wconfig/settingsconfig.go）

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

`CommonTextItemType` 追加：`CreatedBy *CommonTextCreatedByType`、`Origin *CommonTextOriginType`、`Rev float64`、`DeletedAt float64`。全部 omitempty。

### R1.2 SQLite 迁移（pkg/commontextstore/commontext_store.go）

- 新列：`createdby_kind TEXT`、`createdby_name TEXT`、`origin_deviceid TEXT`、`origin_devicename TEXT`、`origin_platform TEXT`、`rev INTEGER DEFAULT 0`、`deletedat REAL`
- 迁移方式沿用现有 `PRAGMA table_info` 探测 + `ALTER TABLE ADD COLUMN`（库内已有先例）
- `deletedat` 语义：NULL = 存活；非 NULL = 墓碑，`List` 默认排除，带 `IncludeDeleted` 才返回

### R1.3 查询过滤

`ListOptions` 增加 `CreatorFilter`（all/human/agent）与 `DeviceFilter`（any/deviceId）。SQL WHERE 拼接沿用现有参数化风格。

### R1.4 旧数据兜底（前端 normalize 也要做，但此处兜 Go 读出侧）

读出时若列全空：`CreatedBy = {Kind:"human", Name:""}`、`Origin = {DeviceId:"local", DeviceName:"This machine"}`、`Rev = 0`。**写路径不回填**（不触发迁移写盘）。

### R1.5 写入侧

`UpsertItem` 接受新字段；`rev` 由调用方传（transport 层负责递增，本任务不自动递增）。

### R1.6 schema 重生成

`schema/settings.json` 的 `CommonTextItemType` 定义重新生成，确认与新结构体一致。

## Acceptance（可机器判定）

- [ ] `go test ./pkg/commontextstore/` 全绿，新增用例覆盖：迁移后旧行读出带兜底值；插入带元数据行再读出字段无损；CreatorFilter/DeviceFilter 各一例；墓碑默认排除 + IncludeDeleted 可见
- [ ] `go test ./pkg/wconfig/` 全绿（jsonschema 生成不破）
- [ ] `schema/settings.json` diff 只含 CommonTextItemType 新字段
- [ ] 旧库文件（迁移前 fixture）打开后 `List` 不报错且返回兜底值
- [ ] 命令 → 期望输出三行判据写入实现笔记后再动手（loop 门链 G2）

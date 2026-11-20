# 技术设计 — status 类型彻底退役 + 改类型浮层菜单

## 1. 边界与不变量

| 不变量 | 说明 |
|---|---|
| **值形状零变化** | status 与 select 的值形状本就一致（单值标量 + 彩色 pill）；迁移只改 `type` 字段，`value/source/name/order/updated_at` 原样保留，用户数据无感 |
| **settings 无变化时字节级不变** | 无 status 定义 → 不调 `SetBaseConfigValue`（对齐 `upsertSchemaDef` 的不变量） |
| **迁移幂等** | sqlite 靠 `ai_schema_meta` 哨兵键；settings 靠「读出无 status 即短路」；二次运行零写入、零备份 |
| **写边界单点归一** | `NormalizePropertyType` 是唯一 status→select 落点；校验/白名单/错误文案从此只认 select |
| **旧 agent 兼容** | CLI/MCP/RPC 带来的 `type:"status"` 不会报错，静默归一为 select 落库（比 E_USAGE 拒绝更符合"彻底剥离"的目标：老调用方无感升级） |

## 2. 后端归一（R1/R2）

### 2.1 `pkg/aisessions/propertygenerate.go`

```go
// NormalizePropertyType maps the retired Notion-style "status" type onto
// "select" (identical value shape). It is the single legacy write-boundary
// normalization: callers validate AFTER this, so "status" never reaches
// storage. Trimmed + case-insensitive on the legacy literal only.
func NormalizePropertyType(raw string) string {
    if strings.EqualFold(strings.TrimSpace(raw), "status") {
        return "select"
    }
    return strings.TrimSpace(raw)
}
```

- `propertyTypeWhitelist`：删 `"status"`。
- `ValidatePropertyValue`：`case "text", "url", "select"`（删 status）。
- `parsePropertySuggestions`：`propType = NormalizePropertyType(item.Type)`，之后才 `ValidPropertyType` 判断。

### 2.2 `pkg/aisessions/manager.go`

- `ApplyAIProperties`（~L1068）：`propType := NormalizePropertyType(suggestion.Type)`。
- `SetProps`：归一循环里 `cell.Type = NormalizePropertyType(cell.Type)`（前端 `service.SetProps`
  直写路径的唯一闸门；同时覆盖 retype：前端改类型也走这里，`"select"` 原样通过）。

### 2.3 `pkg/agentdata/patch.go`

- 新增（与 `normalizeSessionEmojiPatchOperations` 并列，`ApplyPatch` 内紧挨调用）：

```go
// normalizeLegacyPropTypes rewrites the retired "status" property type to
// "select" on every write boundary. Mutates operations in place so preview,
// apply and the schema sync all see the normalized type.
func normalizeLegacyPropTypes(operations []PatchOperation) {
    for _, op := range operations {
        for key, prop := range op.Props {
            prop.Type = aisessions.NormalizePropertyType(prop.Type)
            op.Props[key] = prop
        }
    }
}
```

  （`patch.Operations` 是切片共享底层数组；card.go 随后的 `syncPropertySchema` 读同一切片，天然拿到归一后的值。）
- `validateOperation` L493 校验前已被归一，无需改；防御上仍保留 `ValidPropertyType` 检查。
- `validAddOptionPropertyType`：`case "select", "multi_select"`；错误文案 →
  `"expected select or multi_select"`。注释同步删 status。
- `PropPatch.AddOptions` 注释里的 "select/multi_select/status" 措辞一并清理。

## 2.4 `pkg/wconfig/settingsconfig.go`

- `AgentPropertyDefType.Type` jsonschema tag 删 `enum=status`。
- 新增启动迁移（仿 `MigratePresetsBackgrounds` 的容错风格——失败只 log，不阻断启动）：

```go
// MigrateAgentPropertySchemaStatus rewrites the retired "status" property
// type to "select" in settings.json agent:propertyschema. No status defs →
// byte-identical settings (returns without writing).
func MigrateAgentPropertySchemaStatus() {
    cfg := ReadFullConfig()
    defs := cfg.Settings.AgentPropertySchema
    changed := false
    for i := range defs {
        if strings.EqualFold(strings.TrimSpace(defs[i].Type), "status") {
            defs[i].Type = "select"
            changed = true
        }
    }
    if !changed {
        return
    }
    if err := SetBaseConfigValue(MetaMapType{ConfigKey_AgentPropertySchema: defs}); err != nil {
        log.Printf("error migrating agent:propertyschema status types: %v\n", err)
        return
    }
    BroadcastConfigUpdate()
    log.Printf("migrated agent:propertyschema status types to select: %d def(s)\n", /*count*/)
}
```

- 挂载点：`cmd/server/main-server.go` 在 `wconfig.MigratePresetsBackgrounds()` 之后调用。

### 2.5 sqlite 一次性迁移（R3）

`pkg/aisessions/sqlite_index.go`，挂在 `ensureSchema` 迁移链（`migrateSessionTags` 之后）：

```go
// migratePropTypeStatus rewrites the retired "status" prop_type to "select".
// One-shot via ai_schema_meta sentinel; VACUUM INTO backup first, mirroring
// the tag migration (backup failure → skip migration, retry next open).
func (idx *SQLiteIndex) migratePropTypeStatus(ctx context.Context) error {
    if _, done, _ := idx.schemaMeta(ctx, "session_props_status_type_migrated"); done {
        return nil
    }
    var n int
    if err := idx.db.GetContext(ctx, &n,
        `SELECT count(*) FROM ai_session_props WHERE lower(trim(prop_type)) = 'status'`); err != nil {
        return err
    }
    if n > 0 {
        if err := idx.backupSQLiteBeforeTagMigration(); err != nil { // 复用既有备份助手（改名或新建 backupSQLiteBefore）
            debugf("... skipping prop status migration, backup failed err=%v", err)
            return nil
        }
        // UPDATE ... WHERE lower(trim(prop_type))='status'
    }
    return idx.setSchemaMeta(ctx, "session_props_status_type_migrated", "1")
}
```

要点：
- 只改 `prop_type` 一列；`ai_session_meta.updated_at` 不动（属性类型变更不属于"会话内容更新"，
  避免把所有历史会话标 dirty 触发全量重扫）。
- 备份失败 → 本次跳过（哨兵不写），下次打开重试——与 tag 迁移同一策略。
- emoji/hero 等 `text` 类型不受影响（`WHERE` 限死 status）。

## 3. 前端收敛（R4）

### 3.1 `property-model.ts`

- `PropertyType` 联合删 `"status"`。
- `normalizePropertyType` 保留、签名放宽：

```ts
/** Legacy 读侧兜底：老库/未迁移镜像可能仍带 "status"；类型联合里已不存在，归一后才进 PropertyDef。 */
export function normalizePropertyType(raw: string): PropertyType {
    return raw === "status" ? "select" : (raw as PropertyType);
}
```

  调用处改为先 `normalizePropertyType` 再当 `PropertyType` 用（`toPropertyDefs` 两处现状已是先归一，无需大改；
  顺带把 `DropdownTypes` 里 status 相关的归一注释清理）。
- `ALL_PROPERTY_TYPES` 删 status；`typeLabel` map 删 status 键。
- `DropdownTypes` 删 `"status"`（归一后永远走 select）。

### 3.2 i18n

`zh/en/aisessions.json` 删 `propertyType.status`（两处同步删，`i18n:check` parity 才不红）。

### 3.3 生成物

Go 结构体改完后跑 `go run cmd/generateschema/main-generateschema.go`，重写
`schema/settings.json`（enum 删 status）与 `frontend/types/gotypes.d.ts`（`type?: string` 不变，无需确认差异）。

## 4. 改类型浮层菜单（R5，bug 修复）

### 4.1 根因

原生 `<select>`（`property-list.tsx` retype 分支）在 Windows/Electron 下展开时焦点走原生弹窗 →
web 侧 blur → `onBlur={() => setRetypeKey(null)}` 立即卸载控件 → "一点击就关闭"。`autoFocus` 无法弥补。

### 4.2 新交互

- 删 `isRetyping` 原生 select 分支与 `.property-select` CSS。
- 「修改类型」菜单项点击 → `setRetypeKey(def.key)` + `setRetypeAnchor(菜单按钮或值按钮 DOM)`；
  行内值按钮照常显示当前值（不再变形），浮层独立 portal 渲染：

```tsx
{retypeKey === def.key && onRetypeProperty != null ? (
    <PropertyValuePopover open anchor={retypeAnchor} onClose={() => setRetypeKey(null)}>
        <div className="property-type-menu" role="listbox" aria-label={i18n.t("aisessions:propertyList.propertyType")} data-testid="property-type-menu">
            {CreatableTypes.map((t) => (
                <button type="button" role="option" aria-selected={t === def.type} key={t} data-type={t}
                    className={cn("property-type-menu__item", t === def.type && "is-active")}
                    onClick={() => { setRetypeKey(null); onRetypeProperty(def.key, t); }}>
                    <i className={cn("fa-sharp fa-solid", AddableTypeIcons[t] ?? "fa-font")} aria-hidden="true" />
                    <span>{typeLabel(t)}</span>
                    {t === def.type ? <i className="fa-sharp fa-solid fa-check" aria-hidden="true" /> : null}
                </button>
            ))}
        </div>
    </PropertyValuePopover>
) : null}
```

- 关闭路径：点选项（提交后关）/ 浮层外点（`PropertyValuePopover` 自带 outside-interaction 关闭）/ Esc。
  **不依赖任何 focus/blur 保活** —— 浮层由 `PropertyValuePopover` 的 `useInfoCardPin` pin 住 hover 卡，
  与属性值下拉编辑器同一套已验证的存活机制（property-editor 验证台 13/13 绿的那套）。
- 浮层入口行内仍给 hover 高亮（`is-editing` class 沿用 `retypeKey` 判断）。

### 4.3 为什么不修旧 select（onBlur 忽略原生弹窗）

补丁式修法（`onBlur` 检查 `relatedTarget`）在 Windows 原生弹窗场景 relatedTarget 恒为 null，判不准；
且与"新建属性"面板的类型菜单（自定义下拉）形成两套交互。统一成一套浮层菜单是更小总量的选择。

## 4bis. 值列表浮层误关闭修复（R7，2026-11-20 追加）

### 根因（三层叠加）

1. `tag-editor.tsx` 容器 `onBlur` → `onClose()`：焦点逃逸即关。浮层自身空白区
   （`.ptag-list` padding 6px/4px、行间隙）没有 `preventDefault`，pointerdown 默认把焦点归 body → 误关。
2. `value-popover.tsx` `useDismiss(outsidePress)`：浮层外任何 pointerdown 都关（不豁免锚点），误点概率高。
3. 候选列表「已选值在前」在值变化后整体重排，连点第二下时目标行已移位 → 踩空 → 被前两条关掉。

### 修法（对齐 4.2 的「关闭只认三条信号」）

- 删容器 `onBlur` 关门（`containerRef`/`handleBlur` 一并删除）。
- `.ptag-list` 容器 `onMouseDown={(e) => e.preventDefault()}`：点空白不丢输入焦点（可继续打字），选项行原有
  preventDefault 不变。
- 保留：Esc（键盘）、`outsidePress`（浮层外部 pointerdown）、单选点选提交即关。
- **刻意不改**「已选值在前」排序：那是 11-19 定下的候选可见性语义（新输入不被清单末尾吞掉），
  连点踩空的场景在 blur 关门移除后只剩「点到浮层外」一种，先观察真机反馈再议。
- 共享面影响：md 预览属性卡 / CommonText compose modal 的 tags 编辑器同享新语义（关闭路径变少，
  行为更接近 Notion/Wolai：点卡片内空白不丢菜单）。

## 5. 数据流与兼容

```
外部写(CLI/MCP/RPC card) ──▶ agentdata.ApplyPatch ──▶ normalizeLegacyPropTypes ─┐
前端 service.SetProps ─────▶ Manager.SetProps ───────▶ cell.Type 归一 ──────────┼─▶ sqlite: prop_type 恒无 "status"
AI 提案 ──────────────────▶ ApplyAIProperties ─────▶ NormalizePropertyType ───┘
存量数据 ──(一次性)──▶ sqlite UPDATE + settings MigrateAgentPropertySchemaStatus
读侧 ──▶ Go 直接返回（已无 status）／前端 normalizePropertyType 兜底（旧镜像/备份恢复）
```

回滚：settings 迁移可手工改回 settings.json；sqlite 迁移前有 `VACUUM INTO` 备份文件可还原；
代码回滚后 status 白名单恢复，数据里的 select 与旧 status 行为等价（值形状一致），无硬兼容断裂。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| settings 迁移在多端同步下与旧版本互相覆盖 | 只在含 status 时写一次；旧版本读 select 值也正常（select 一直合法） |
| sqlite 迁移碰上 2GB 大库耗时 | 纯 UPDATE 走 `idx_ai_session_props` 无关、全表扫一次；只命中 status 行；备份 VACUUM INTO 与 tag 迁移同量级 |
| `NormalizePropertyType` 拼写被误用为万能清洗 | 注释钉死：只映射 status；其它类型原样，不做大小写折叠 |
| 前端删 `PropertyType` 字面量后遗漏引用 | tsc 白名单脚本 + 全局 grep `"status"` 收口；`typeLabel` map 是 Record<PropertyType,...>，删键即编译期暴露 |

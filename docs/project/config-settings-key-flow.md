# 新增 settings 配置键的完整链路

更新时间：2026-10-12

适用范围：任何需要把前端状态持久化到 `settings.json` 的改动。

## 为什么不能只改前端

后端的 `SetConfigCommand` → `wconfig.SetBaseConfigValue()` 会先做键校验：

```go
ctype := getConfigKeyType(configKey)   // 反射遍历 SettingsType 的 json tag
if ctype == nil {
    return fmt.Errorf("invalid config key: %s", configKey)
}
```

`getConfigKeyType` 只认 `pkg/wconfig.SettingsType` 结构体上带 `json:"<key>"` 的字段。
因此**只在 TypeScript 里使用一个新键名，写入一定失败**（前端若用 `fireAndForget` 包住，症状是"静默不生效"）。

## 完整步骤

1. 在 `pkg/wconfig/settingsconfig.go` 定义值类型（可复用/嵌套已有类型）：

   ```go
   type PathUsageEntryType struct {
       Path       string `json:"path"`
       Connection string `json:"connection,omitempty"` // "" = local
       Kind       string `json:"kind"`                 // "dir" | "file"
       Count      int    `json:"count"`
       LastAt     int64  `json:"lastAt"`               // unix ms
   }
   ```

2. 在同一个文件的 `SettingsType` 上加字段（json tag 就是配置键名）：

   ```go
   PreviewPathUsage []PathUsageEntryType `json:"preview:path-usage,omitempty"`
   ```

3. 在 `pkg/wconfig/metaconsts.go` 登记键常量（本仓库约定）：

   ```go
   ConfigKey_PreviewPathUsage = "preview:path-usage"
   ```

4. 重新生成 TS 绑定与 JSON schema：

   ```bash
   node scripts/run-task.mjs generate          # cmd/generatets + cmd/generatego + build:schema
   git diff --stat                             # 只应出现 gotypes.d.ts / schema/settings.json / metaconsts.go 等预期文件
   ```

   生成物：`frontend/types/gotypes.d.ts`（得到全局 `PathUsageEntryType` 与 `"preview:path-usage"?: PathUsageEntryType[]`）、`schema/settings.json`。

5. 前端读取：`getSettingsKeyAtom("<key>")`（`@/store/global`），包装成派生 atom：

   ```ts
   export const pathUsageAtom = atom<PathUsageEntryType[]>((get) => {
       const value = get(getSettingsKeyAtom("preview:path-usage"));
       return Array.isArray(value) ? value : [];
   });
   ```

6. 前端写入：`RpcApi.SetConfigCommand(TabRpcClient, { "<key>": next })`（`@/app/store/wshclientapi`），或视图内已有的 `env.rpc.SetConfigCommand`。

## 推荐模式：配置即唯一事实源

新增键时优先让**配置成为单一事实源**，前端的 atom 从配置派生，而不是维护一份本地副本：

- 读：派生 atom 直接读 settings → 配置回声自动驱动 UI，天然多窗口同步。
- 写：只写配置，不写本地副本。
- 高频写：加节流缓冲（见下）。

反例（会产生双写者数据丢失）：把配置值在构造函数里快照进一个 `PrimitiveAtom`，之后写路径还从这份过期快照重建整个数组。
本项目 `preview:pinned-directories` 就是这种历史写法：`PreviewModel.pinnedDirs` 曾是一次性快照，与 `widgets.tsx` 的面板 Pin 形成两个写者，互相覆盖。
修复方式：把 `pinnedDirs` 改成从 `env.getSettingsKeyAtom("preview:pinned-directories")` 派生的 atom，删除本地 `globalStore.set`。
参考提交：本仓库 Files 路径中枢任务。

## 高频写入的节流

导航类状态可能每秒变化多次，而配置文件是整文件重写：

- 模块级 `pendingEntries` 缓冲 + 600ms debounce，合并为一次 `SetConfigCommand`。
- "读当前值"取 `pendingEntries ?? globalStore.get(atom)`，避免节流窗口内的多次记录互相覆盖。
- 配置回声与 `pendingEntries` 深度相等时清空缓冲。
- 加 `pagehide` 监听做 best-effort flush，避免"退出前最后 <debounce 窗口内的变更"丢失。
- 用条目上限（如 200 条）控制文件体积。

## 常见坑

| 坑 | 现象 | 处理 |
|---|---|---|
| 只在 TS 用新键名 | 写入静默失败（`invalid config key`） | 必须走上面第 1–4 步 |
| 忘记重新 `generate` | `getSettingsKeyAtom` 类型报错；schema 与 Go 不一致 | 提交前跑 `generate` 并确认无漂移 |
| 本地 connection 拼写不一致 | 同一路径被记成多条、去重失效 | 用身份键前统一 `""`/`"local"`/`"local:*"` → `""` |
| 配置未加载就写入 | 用空数组覆盖已持久化数据 | 写入前判断 `atoms.fullConfigAtom != null` |

## 参考实现

- `pkg/wconfig/settingsconfig.go` — `PathUsageEntryType` / `PinnedDirectoryType`
- `frontend/app/view/preview/path-usage.ts` — 纯逻辑（可单测，无 jotai/env 依赖）
- `frontend/app/view/preview/path-usage-store.ts` — 派生 atom + 节流持久化
- `frontend/app/view/preview/preview-model.tsx` — 记录埋点

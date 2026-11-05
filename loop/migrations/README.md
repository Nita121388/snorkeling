# 迁移

文件名：`<序号>-<一句话>.mjs`，例如 `3-lessons-index.mjs`。序号必须大于当前 `loop/VERSION`。

```js
// 每个迁移导出这个签名；失败即中止，VERSION 不前进
export default async function ({ dir, argv }) {
  // 改文件、补字段、搬目录都行。幂等：重复跑不应产生副作用。
}
```

`node loop/queue.mjs upgrade` 会：备份（`loop/.backup/<ts>/`）→ 顺序应用 → 每个成功后写 `VERSION` → 记一条 `note` 事件。

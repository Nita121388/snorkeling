# A2 创建入口与两步向导（右键 / launcher / card）

## Goal

三个入口共用一个向导，把「会话 → 人设」压到两次点击。

## Requirements

- 入口：Agent TUI block 头部右键、AISessions 行右键、Session Detail 卡片 ⋯ 菜单，均新增「🎭 设为新人设…」
- 向导 1/2 身份：emoji picker、名字（目录名实时 slug 化）、据点二层（全局根目录 [更改…] / 单独指定 [浏览…]）、记忆初稿勾选（Note/Tags、批注）
- 向导 2/2 预览：真实 scaffold 文件树（与 A1 生成清单同源，禁止两处手写）
- 「更改…」直达设置页「🎭 人设」节（A5.5 落地前先打开设置根节）
- 键盘：`P` 打开向导；Esc 关闭

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/aisessions` → passed
- [ ] `scripts/verify` 对应 area 真机全绿（三入口探针）
- [ ] 向导文件树节点集 = A1 scaffold 实际文件集（同一常量/生成器）
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 依赖

A1。参考原型：`design/prototypes/persona/` 场景 A。

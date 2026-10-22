# Implement — Agent TUI 拆分 = 新会话

> 纯前端改动：新增 1 个纯函数模块 + 改 1 个文件的 2 个函数 + 新增单测 + 文档。
> 后端 Go 零改动。

## Step 0 — 前置检查（不改代码）

```bash
git status --short
git log --oneline -1
```

- [ ] 起点干净（只有 `.trellis/` 与 `docs/answers/` 未跟踪）
- [ ] 记录基线提交号

**Rollback point R0**：无代码改动，随时可放弃。

---

## Step 1 — 新增 `frontend/app/workspace/agent-split.ts`

纯函数模块，无副作用，不 import store / React。

**导出**

```ts
export const AGENT_AUTORESUME_META_KEY = "agent:autoresume";
export const AGENT_PROVIDER_META_KEY = "agent:provider";
export const AGENT_SESSION_ID_META_KEY = "agent:sessionid";

export function isAgentBlockMeta(meta?: MetaType | Record<string, unknown>): boolean
export function resolveAgentProvider(meta?: MetaType | Record<string, unknown>): string
export function stripAgentResumeArgs(provider: string, args: string[]): string[]
export function buildSplitBlockDef(blockDef: BlockDef): BlockDef
```

**实现要点**

1. `isAgentBlockMeta`：`agent:autoresume === true` || `agent:provider` 非空 || `agent:sessionid` 非空
2. `resolveAgentProvider`：`agent:provider`（小写 trim）优先 → 否则 `cmd` basename
   （`\`→`/`、取最后一段、去 `.exe/.cmd/.bat/.ps1`、小写）
3. `stripAgentResumeArgs(provider, args)`：
   - codex：找 `resume` 子命令 → 去掉它和它后面那个**非选项**的 session id；
     再去掉 `--last` / `--all` / `--include-non-interactive`
   - claude：去掉 `--resume` / `-r` / `--session-id`（连同其值）、`--continue` / `-c` / `--fork-session`；
     同时处理 `--flag=value` 内联形态
   - opencode：去掉 `--session`（连同其值）
   - pi：去掉 `--session-id` / `--session` / `--resume` / `-r` / `--fork`（连同其值）
   - 未知：通用 —— `--resume` / `-r` / `--session` / `--session-id`（连同值或 `=` 内联）
     + `resume <id>` 子命令
   - 返回**新数组**，不改原数组
4. `buildSplitBlockDef(blockDef)`：
   - `meta` 为空 / 非 agent 块 → 返回 `{ meta: { ...blockDef.meta } }`（等价拷贝）
   - agent 块 →
     ```
     const meta = { ...blockDef.meta };
     delete meta["agent:sessionid"];
     const args = Array.isArray(meta["cmd:args"]) ? meta["cmd:args"] : null;
     if (args) {
         const stripped = stripAgentResumeArgs(provider, args);
         if (stripped.length > 0) meta["cmd:args"] = stripped; else delete meta["cmd:args"];
     }
     return { meta };
     ```
   - **不原地修改**传入的 blockDef / meta

**验证**

```bash
grep -n "export function" frontend/app/workspace/agent-split.ts
```

- [ ] 4 个导出函数都在
- [ ] 无 store / React import

---

## Step 2 — 接入拆分原语 `frontend/app/store/global.ts`

**改动 A** — `createBlockSplitHorizontally`（`:366`）

```diff
 async function createBlockSplitHorizontally(
     blockDef: BlockDef,
     targetBlockId: string,
     position: "before" | "after"
 ): Promise<string> {
     const layoutModel = getLayoutModelForStaticTab();
     const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
-    const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
+    const newBlockId = await ObjectService.CreateBlock(buildSplitBlockDef(blockDef), rtOpts);
```

**改动 B** — `createBlockSplitVertically`（`:389`）：同一处改法

**import**

```ts
import { buildSplitBlockDef } from "@/app/workspace/agent-split";
```

**注意**：`createBlock`（普通新建）**不改** —— 它是「主动打开会话」的路径，必须保留 resume 语义。

**验证**

```bash
grep -n "buildSplitBlockDef" frontend/app/store/global.ts
```

- [ ] 只有 `createBlockSplitHorizontally` / `createBlockSplitVertically` 两处使用
- [ ] `createBlock` / `replaceBlock` 未被改

**Rollback point R1**：`git checkout frontend/app/store/global.ts`

---

## Step 3 — 单测 `frontend/app/workspace/agent-split.test.ts`

用例清单（对应 design §8）：

1. provider 判定：meta 优先 / cmd basename 兜底 / 未知
2. codex 剥离：`["resume","abc"]` → `[]`；`["--model","gpt-5","resume","--cd","/tmp","abc"]` → `["--model","gpt-5","--cd","/tmp"]`
3. claude 剥离：`["--resume","abc"]` → `[]`；`["-r","abc"]` → `[]`；`["--continue"]` → `[]`；`["--resume=abc"]` → `[]`
4. opencode 剥离：`["--session","abc"]` → `[]`
5. pi 剥离：`["--session-id","abc"]` → `[]`；`["--fork","abc"]` → `[]`
6. 未知 provider 通用剥离
7. 非 agent 块 → meta 等价不变
8. agent 块 → `agent:sessionid` 删除、`agent:autoresume`/`agent:provider` 保留、
   `cmd`/`cmd:cwd`/`cmd:env`/`connection` 保留
9. 纯函数性：不修改传入的 blockDef / meta / args 数组

**运行**

```bash
npx vitest run frontend/app/workspace/agent-split.test.ts
```

- [ ] 全部通过

---

## Step 4 — 回归验证

```bash
npx vitest run frontend/app/store frontend/app/workspace frontend/app/view/term
```

- [ ] 无回归

（若耗时过长，可只跑 `frontend/app/workspace` + `frontend/app/view/term`）

**Rollback point R2**：`git checkout frontend/app/store/global.ts frontend/app/workspace/agent-split.ts`

---

## Step 5 — 文档

`docs/docs/agent-workflow.mdx` —— 在 agent 块行为说明处补一条：

> 水平/垂直拆分一个 Agent 块时，新块会以相同的 provider / 模型 / 工作目录启动**一个全新的会话**
> （不会 resume 原会话）；原块保持原会话不变。

**验证**

```bash
grep -n -i "split" docs/docs/agent-workflow.mdx
```

---

## Step 6 — 提交

```bash
git add frontend/app/workspace/agent-split.ts frontend/app/workspace/agent-split.test.ts \
        frontend/app/store/global.ts docs/docs/agent-workflow.mdx
git commit -m "fix(agent): splitting an agent block starts a new session instead of resuming"
```

- [ ] 提交前跑 `git diff --cached --stat` 确认只含预期文件
- [ ] 不提交 `.trellis/`（按项目惯例另行归档）

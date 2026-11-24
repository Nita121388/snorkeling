# F-1124 agent-path-links 红证源码存档

这三个 `*.spec.ts.txt` 是**红证阶段写的测试源码**（原文件名去掉 `.txt` 后缀即可恢复）。
它们引用的实现模块尚未创建，直接放回目录会让 `npx vitest run` 必红：

| 测试源码 | 需要的实现 |
|---|---|
| `term-link-handler.spec.ts.txt` | `frontend/app/view/term/term-link-handler.ts` |
| `agent-path-ref.spec.ts.txt` | `frontend/app/element/agent-path-ref.ts` |
| `agent-path-open.spec.ts.txt` | `frontend/app/element/agent-path-open.ts` |

红证输出（失败原文）见同级 `../F-1124-agent-path-links.txt`。

**实现该包时**：先 `cp *.spec.ts.txt → 对应 .test.ts`，跑红，再实现，再跑绿。
存档原因：2026-11-24 收工提交前保持主干测试绿（实现未开工，红测试不应进主干）。

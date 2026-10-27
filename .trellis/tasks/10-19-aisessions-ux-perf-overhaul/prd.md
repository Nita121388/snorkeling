# AI 会话体验与性能综合整改（父任务）

## 背景

AI 会话（Agent block / 历史会话详情）当前在「学习回看一个 AI 处理过程」这个主场景下有七类明显阻塞。用户看会话相当于看 AI 的处理过程，需要在过程中**学习 + 标记**，因此对连续性、完整性和可读性有硬要求。

## 目标（按 lane 拆分，见子任务）

| Lane | 子任务 | 优先级 |
|---|---|---|
| L1 | AISessions full-load without stalls | P0 |
| L2 | AISessions annotations（选区级 `10-19-aisessions-annotate` + 节点级 `10-25-aisessions-annotation-timeline`） | P1 |
| L3 | AISessions fold subagents into parent timeline | P1 |
| L4 | AISessions refresh icon and header overlap | P2 |
| L5 | Preview txt and html multi-mode open | P2 |
| L6 | CommonText paste image | P2 |
| L7 | AISessions list detail block separation | P1 |
| L8 | `10-27-aisessions-scroll-perf` 详情滚动性能整改（虚拟化重测 / memo / 滚动事件） | P1 |
| L9 | `10-27-aisessions-virtual-row-stability` 虚拟行视觉稳定性（挂载动画 / 行高估算 / 滚动锚定） | P1 |

## 全局约束（所有 lane 必须遵守）

1. **不修改 pi 写入的会话 JSONL。** 标注数据持久化在 Snorkeling 侧（SQLiteIndex），不触碰 agent 的文件。删除类能力全部搁置。
2. **不改动 pi-subagents 上游 npm 包**（`~/.pi/agent/npm/node_modules/pi-subagents`）。L3 的父子映射必须能在**不改扩展**的前提下工作，扩展侧写入作为后续可选增强。
3. **模型不切换。** 所有子代理继承当前模型；不传 `model` 参数。
4. **子代理不得 git commit。** 合并由父会话统一完成。
5. 并行 lane 之间按**文件域**隔离，禁止两个 lane 改同一文件；L2 依赖 L1 的消息分块/稳定 id 管线，必须等 L1 合并后再启动。
6. 前端口径遵循 `.trellis/spec/snorkeling-docs/frontend/`（hooks / state / component / type-safety）。

## 依赖图

```
L1 (full-load) ──> L2 (annotations)
L1 ──> L7 (block separation，复用 detail 加载契约)
L1 ──> L8 (scroll perf) ──> L9 (row stability，同文件域，必须串行)
L3、L4、L5、L6 相互独立，可与 L1 并行
```

## 集成验收（父任务层）

- [ ] 打开最大的历史会话（约 20MB）能一次拉到全部内容，且打开后首屏内容 <1s 出现，后续内容后台补齐
- [ ] 全量内容可滚动浏览，无 UI 冻结；搜索结果能跳转到任意位置
- [ ] 能对消息正文、thinking、工具调用、工具结果加文字级批注，重新打开后按原位置显示
- [ ] 子代理在父会话时间线内显示为可折叠卡片，可展开看内容、可跳到独立会话
- [ ] 会话详情头部刷新控件不再与关闭按钮重叠，且无 Auto 文字徽标
- [ ] `.txt` 可在 Snorkeling 内预览；`.html` 有三种明确打开方式并按后缀记忆
- [ ] CommonText 可粘贴图片并落成文件
- [ ] 会话列表与详情分离：点击开 detail block、再点并入当前 tab、Ctrl+点击新开 block
- [ ] 大会话（>200 条）详情滚动流畅，滚动过程无行级淡入、视口内容漂移 <8px；流式输出期间可正常滚动
- [ ] ≤60 条消息的小会话仍保留原有落盘淡入过渡与全量渲染行为

## 决策记录

- 删除全部搁置（用户已确认：删除先不做）。
- 标注覆盖全类型：选中文字 + 整条消息 + 命令/工具调用 + 工具结果 + thinking（用户已确认）。
- Auto 刷新简化为纯刷新图标（用户已确认）。
- 全量加载必须配合虚拟列表，否则"拿到数据那一刻"照样卡。
- html 打开方式交互：双击 = 上次方式；右键菜单 / 工具栏提供三个显式入口（源码 / 内置预览 / 系统默认应用）。

# 发布重试待办（0.0.97）

## 当前状态

- 代码：已提交并推送 main（`0db7a415`），工作树干净。
- 版本：`0.14.6-beta.0.snorkeling.0.0.97`（bump commit `07493869`）。
- Tag：`snorkeling-v0.14.6-beta.0-0.0.97` 已推送。**没有创建任何 Release**（不是空 release，是根本没创建）。
- Workflow run `38273254945`：三个 build job 都成功构建，但都在 `Upload build artifacts` 失败；
  `Publish GitHub Release` 被 skip。已 `gh run rerun` 重跑一次，同样失败。

## 阻塞原因（已诊断）

`actions/upload-artifact` 报：`Artifact storage quota has been hit. Unable to upload any new artifacts.
Usage is recalculated every 6-12 hours.`

- 仓库是 **私有**，Actions 产物配额是**账号级**。
- 清理前 `snorkeling` 单仓库产物 **484 个 ≈ 38 GB**：
  - `windows-exe` 79 份 × ~165MB ≈ 13GB（来自 `testdriver-build.yml`，无 retention-days）
  - `release-macos-latest` 7 × 1667MB、`release-ubuntu-latest` 7 × 1222MB、
    `release-windows-latest` 7 × 796MB ≈ 26GB
- 已于 2026-10-13 00:54 CST 全部删除（`.repos/Nita121388/snorkeling/actions/artifacts` 现为 0），
  账号下其他仓库均无产物 → 产物存储现在基本为空。
- **但**配额是缓存值，每 6-12 小时才重算；删除后立刻重跑仍然失败（已验证一次）。
- 复发预防：`0db7a415` 给两个上传步骤加了 `retention-days`（windows-exe 3 天、release-* 1 天）。

## 重试条件与步骤

**最早重试时间**：清理时间 + 6 小时 ≈ 2026-10-13 06:54 CST。
（若仍失败，说明重算窗口还没到，隔 2-3 小时再试；6-12 小时区间内一般会放开。）

```bash
cd /Users/nita/Primary/projects/snorkeling
# 1. 确认产物仍是空的（若又有堆积，先清）
gh api "repos/Nita121388/snorkeling/actions/artifacts?per_page=100" --jq '.total_count'
# 2. 重跑同一个 run（tag 不变，不需要新版本号）
gh run rerun 38273254945 -R Nita121388/snorkeling
# 3. 盯（约 25 分钟）
gh run watch 38273254945 -R Nita121388/snorkeling --interval 60 --exit-status
# 4. 成功判据
gh release view snorkeling-v0.14.6-beta.0-0.0.97 -R Nita121388/snorkeling | head -30
```

**成功判据**：`gh release view` 列出三平台产物（\*.dmg / \*.exe / \*.msi / \*.deb / \*.pacman /
\*.AppImage / \*.snap / \*.yml / \*.blockmap），且 run 结论为 success。

**成功后**：
1. 删除本文件或标记为已完成。
2. `shout_for_user({category: "completion", urgency: "info"})` 通知用户。
3. 更新 Obsidian 06-开发记录.md。

## 不要做

- ❌ 不要因为失败去 bump 成 0.0.98 —— tag 已经推了且**没有**创建 release，重跑同一个 run 即可。
  只有在"release 已创建但是空的"情况下才按 skill 建议 bump 到下一个号。
- ❌ 不要在配额未重算前反复重跑 —— 每次三平台构建约 60 分钟私有仓库分钟数，且必然失败。
- ❌ 不要删 tag 重发同号。

## 已知的两个后续项（与发布无关）

详见 `/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/07-TODO.md`：
`preview:pathisdir` 写入方语义过载；新面板尚未真机（CDP）验证。

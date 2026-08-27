---
name: snorkeling-release
description: 发布 Snorkeling (WaveTerm fork) 新版本。用于用户提到"发布新版本/release/发版/上 tag/打 tag/publish new version/发布到 release"。流程: bump package.json prerelease 号 → 查远端号未被占 → commit → push → 打 annotated tag → push tag 触发 GitHub Actions 自动三平台构建 + softprops 创建正式 GitHub Release。本 skill 不发 S3/Snap/WinGet (那是上游 waveterm 的发版流域, 不适用本 fork)。
---

# Snorkeling Release

## 目标

把当前 `feat/light-theme` (或当事分支) 上的提交作为新版本发布到 GitHub Releases。Snorkeling 的发版是**全自动化**: 推 `snorkeling-v<ver>` annotated tag 就触发 `.github/workflows/snorkeling-release.yml`,在三平台 (ubuntu/macos/windows) 跑构建, 用 `softprops/action-gh-release@v2` 自动创建 Release 并附所有平台安装包, `generate_release_notes: true` 自动从 commit 生成 release notes。**不需要手敲 `gh release create`,不需要上传产物。**

## 判断依据 / 前置检查

- 当前分支: `git rev-parse --abbrev-ref HEAD` —— 通常在 `main` 或 `feat/light-theme`。**不要**因为发版去 merge 进 `refactor/snorkeling` 主分支 (该主分支要归档)。注意: 当前活跃分支会变,执行前先确认 `main` 是否就是这次发版分支;若是则直接 push `main` 即可。
- 已有标签: `git ls-remote --tags origin | grep -oE "snorkeling-v0\.14\.5-beta\.4-0\.0\.[0-9]+$" | grep -oE "0\.0\.[0-9]+$" | sort -t. -k2 -n | tail -5` —— **必须** 在 bump 之前查。其他会话/CI 可能并行发版,抢号会得到废弃 commit+tag (已知风险)。
- 当前版本号格式: `0.14.5-beta.4.snorkeling.X.Y`, prerelease 段是 `.X.Y` 两位 (例如 `0.0.58`)。Taskfile `vars.VERSION` 也通过 `node version.cjs` 同步读出。
- 新 tag 名格式: `snorkeling-v0.14.5-beta.4-0.0.<N>` (注意把 prerelease `.X.Y` 改写成 `-X-Y`,对齐既有 convention)。
- 发版脚本: `version.cjs` (Taskfile `task version` 包装)。**安全约束**: bump 前必查 `git ls-remote --tags origin`, bump 后必 `git diff package.json` 确号正确。
- 跨平台构建产物命名前缀: `Snorkeling-` (macOS / Windows), `snorkeling-` (linux). GitHub Release 自动附, 无需手动。

## ⚠️ 必检: working tree 必须先 commit 功能改动 (本 fork 已踩坑)

**发版前 `git status --short` 必须没有 ` M` / `M ` 行 (modified)**。如果还有 staged/unstaged 的功能改动,**立刻停下来**: 先把功能改动 `git add -A && git commit` 成一个独立 commit,再走下面的 bump/commit/push/tag 流程。

**理由**: 本 skill step 1 说"`??` 之外的可以忽略"是错的。功能改动没 commit 时打的 tag,tag 指向的 commit 只有 bump commit,build 出的产物和 release notes 都不含本次改动。GitHub 上 release 看起来"成功了"但实际上发的是空 release。0.0.66 release 就是这么出的 — 必须跟着 bump 到下一个号 (如 0.0.67) 才能补上。

**两种现场处理路径**:

1. **功能改动还在 working tree,还没 commit**: `git add -A && git commit -m "<具体功能 commit message>"`,然后走下面 step 3 起。
2. **已经 commit 了 bump commit (package.json version only),功能改动还在 working tree**: 不要删那个 bump commit (push 上去会作为公开历史),而是按"双 commit 序列"走:
   - `git add -A && git commit -m "<功能 commit>"` (功能 commit 排在后面,本地)
   - `node version.cjs 1` 再 bump +1 (比如 0.0.66 → 0.0.67)
   - `git add package.json && git commit -m "chore: bump package version to ..."` (再一个 bump commit)
   - `git push origin <branch>` 把两个 commit 一起推上去
   - `git tag -a` + `git push origin` 打最新号 (跳过那个空 release 号)

## 执行步骤

1. **当前事务 commit 干净、push 干净**: `git status --short` **必须空** —— 不允许任何 ` M`/`M `/`A `/`??` 行。如果有功能改动 staged/unstaged,**先返回上面"⚠️ 必检"小节把它 commit 成独立 commit**,再回到这里继续。bump commit 不能跟未 commit 的功能改动混在一起。
2. **查远端最新号**: `git ls-remote --tags origin | grep -oE "snorkeling-v0\.14\.5-beta\.4-0\.0\.[0-9]+$" | grep -oE "0\.0\.[0-9]+$" | sort -t. -k2 -n | tail -5`。记下最新 `Y`。
3. **bump 版本号**: 重复执行 `node version.cjs 1` 直到出现 `0.14.5-beta.4.snorkeling.0.0.<N>` 满足 `<N> > 远端最新号`。每次 bump `+1` prerelease 末位。
4. **本地查重** 确认 bump 出的号远端没占 (Collaborator 可能在 bump 后、push 前抢发): `git ls-remote --tags origin | grep -E "0\.0\.<N>"` 应该空。
5. **commit**: 把 `package.json` 加上修复 commit 里 (或单独的 `chore: bump package version to 0.14.5-beta.4.snorkeling.0.0.<N>`)。**注意时序**: 这个 bump commit 必须排在功能改动 commit **之后**——先有功能 commit、再有 bump commit,这样 tag 指向 bump commit 时两个 commit 都在历史里。
6. **push**: `git push origin <current-branch>`。
7. **打 annotated tag**: `git tag -a snorkeling-v0.14.5-beta.4-0.0.<N> -m "Snorkeling 0.14.5-beta.4.snorkeling.0.0.<N>\n\n<概述 commit / release notes>"`。
8. **push tag** (这一步立即触发 workflow): `git push origin snorkeling-v0.14.5-beta.4-0.0.<N>`。
9. **看 workflow 起没起**: `gh run list -R Nita121388/snorkeling --workflow=snorkeling-release.yml --limit 3` —— 出现 `in_progress` 行即成功触发。
10. **后台监跑**: `gh run watch <run_id> -R Nita121388/snorkeling --interval 60 --exit-status` (后台模式),约 15-25 分钟跑完。

## 验证

- workflow `softprops/action-gh-release@v2` 步完成后, `gh release view snorkeling-v0.14.5-beta.4-0.0.<N> -R Nita121388/snorkeling | head` 应列出三平台产物: `*.dmg`, `*.zip`, `*.exe`, `*.msi`, `*.deb`, `*.pacman`, `*.AppImage`, `*.snap`, 各 `*.yml`/`*.blockmap`。
- 自动生成的 release notes 含本版 bump 提交、相关修复 commit。
- 旧 `.57` 跑了 18min12s (build + publish); 本版预计 ±2min。

## 不要做

- ❌ 不要调用 `task artifacts:upload` / `artifacts:publish:*` / `artifacts:snap:publish:*` / `artifacts:winget:publish:*` —— 这些是 waveterm 上游发版流域 (`dl.waveterm.dev/releases-w2`, `CommandLine.Wave`), 与本 fork 无关。
- ❌ 不要 merge 进 `refactor/snorkeling` 主分支 (归档中)。
- ❌ 不要在 bump 前 commit package.json (避免 commit 后又改号产出多余 commit 序列)。
- ❌ 不要用 `task version -- 1` 形式 —— `version.cjs 1` 直接调用更稳, 不经 Taskfile 变量替换。
- ❌ **不要在 working tree 有未 commit 的功能改动时打 tag** —— tag 只指向当前 HEAD commit,未 commit 的改动不会进 release。这是本 skill 最容易踩、最隐蔽的坑 (0.0.66 已踩): build 成功、release 创建成功,但产物是上一版的内容。打 tag 前必须 `git status --short` 全空。
- ❌ **发现空 release 后不要试图删 tag/release 重新发同号** —— 已 push 的 tag 和 release 已被公开/缓存,删了再发同号会留下"tag 曾存在又消失"的痕迹,且 GitHub 可能保留旧 release assets 缓存。直接 bump 到下一个号 (0.0.66 → 0.0.67) 重发完整版,旧号留作历史空 release。

## 相关

- reference: 本机 memory `snorkeling-release-flow`, 描述同流程的非显然点 (主分支政策 / 抢号风险 / 不要走 S3 流域)。
- workflow: `.github/workflows/snorkeling-release.yml` (trigger, build matrix, publish step)。
- 版本脚本: `version.cjs` (Taskfile 入口 `task version`)。

# Snorkeling CI/CD 与发布

更新时间：2026-04-17

## CI（质量门禁）

工作流：`.github/workflows/snorkeling-ci.yml`

- 触发：
  - `pull_request` 到 `main` / `refactor/snorkeling`
  - `push` 到 `main` / `refactor/snorkeling`
  - 手动触发
- 执行内容：
  - `eslint`（frontend）
  - 关键前端测试（Agent 启动逻辑）
  - `go test ./...`

## Release（三平台构建发布）

工作流：`.github/workflows/snorkeling-release.yml`

- 触发：
  - 推送 tag：`snorkeling-v*`
  - 手动触发
- 构建平台：
  - `ubuntu-latest`
  - `macos-latest`
  - `windows-latest`
- 发布方式：
  - 各平台构建产物汇总
  - 自动创建 GitHub Release 并上传产物

## 与官方安装隔离（避免冲突）

- App 标识：
  - `name`: `snorkeling`
  - `productName`: `Snorkeling`
  - `appId`: `io.github.nita121388.snorkeling`
- 本地数据目录前缀：`snorkeling`（不再使用 `waveterm`）
- Linux 可执行与安装路径：
  - `/usr/bin/snorkeling`
  - `/opt/Snorkeling/snorkeling`

## 推荐发布流程

1. 在 `refactor/snorkeling` 完成功能开发并合并到 `main`
2. 创建版本 tag：`snorkeling-v<官方版本>-local.0.0.1`
   - 示例：`snorkeling-v0.14.5-beta.4-local.0.0.1`
3. 等待 `Snorkeling Release` 完成三平台构建与发布
4. 在 Release 页面核对产物完整性（macOS / Linux / Windows）

# 在 Linux 上交叉构建 Windows 版（实测可用）

用途：Windows 机器配置弱（内存小、盘紧）时，把构建放到 Linux 服务器，产物回传 Windows 验证。
本文全部步骤已在 2026-11-27 实测跑通（Ubuntu 26.04 / 61 GiB 内存，产物 = PE32+ `wavesrv.x64.exe` + `Snorkeling.exe` zip）。

## 一、能成立的原因（三条前提，先验证再动手）

| 前提 | 证据 |
|---|---|
| 无原生 Node 模块，JS 全被 Vite 打包 | `electron-builder.config.cjs` 的 files 里有 `!node_modules`；73 个 dependencies 无 pty/sqlite/sharp 类原生模块 |
| Go 侧本来就支持交叉 | `build:wsh:parallel` 在任意宿主构建全部 GOOS/GOARCH；wavesrv 用 `zig cc -target x86_64-windows-gnu` |
| Windows 包免签名免 wine | `win.target` 含 `zip`，加 `-c.win.signAndEditExecutable=false` 跳过 rcedit；`msi` 需要 WiX，**不要用** |

## 二、服务器网络前提（2026-11-27 实测，必须照做）

| 目标 | 服务器可达性 | 对策 |
|---|---|---|
| github.com release 资产（objects.githubusercontent.com） | 不可达（000/超时） | 本机下载 → scp |
| go.dev / ziglang.org | 不可达 | 本机下载 → scp |
| registry.npmmirror.com | 200 | 直接用 `--registry` |
| goproxy.cn | 200 | 直接用（`resolve-env.mjs` 默认值） |

关键限制：`scripts/bootstrap.mjs` 用 Node 原生 `fetch`，**不认 `https_proxy`**（Node 22 无 env-proxy 支持）。所以「借本机代理」救不了工具链，工具链只能预置。

## 三、一次性预置（本机下载 → scp → 服务器解压）

版本来源：`scripts/bootstrap.mjs` 的 `TaskVersion` / `ZigVersion` 常量 + `go.mod` 首行 `go x.y.z`。
校验来源：`task_checksums.txt`、`go-dl.json`、`zig-index.json`、electron 的 `SHASUMS256.txt`。

| 下载物 | 解压/落点（相对仓库根） | 说明 |
|---|---|---|
| `task_linux_amd64.tar.gz` | `.tools/task/`（解开即 `task` + LICENSE） | 源：`github.com/go-task/task/releases/download/v<TaskVersion>/` |
| `go<ver>.linux-amd64.tar.gz` | `.tools/`（内含 `go/` 目录） | 源：`go.dev/dl/` |
| `zig-linux-x86_64-<ver>.tar.xz` | `.tools/zig/`（原目录名 `zig-linux-...`，需 `mv` 成 `zig`） | 源：`ziglang.org/download/<ver>/` |
| `libvips-8.14.5-linux-x64.tar.br` | `.cache/libvips-local/v8.14.5/` | 源：`github.com/lovell/sharp-libvips/releases/download/v8.14.5/` |
| `electron-v<ver>-win32-x64.zip` | `.cache/electron/` | 源：`npmmirror.com/mirrors/electron/<ver>/`；再存一份 `SHASUMS256.txt-<ver>` |

预置完成后 `npm run setup` 必须输出三项 `already installed`——出现 downloading 就说明版本号不匹配。

```bash
# 解压（Go/Zig 的 tar 必须在 Linux 上解，Windows 解会丢符号链接与执行位）
mkdir -p .tools/task .cache/electron .cache/libvips-local/v8.14.5
tar -xf task_linux_amd64.tar.gz -C .tools/task
tar -xf go<ver>.linux-amd64.tar.gz -C .tools
tar -xf zig-linux-x86_64-<ver>.tar.xz -C .tools && mv .tools/zig-linux-x86_64-<ver> .tools/zig
```

## 四、装依赖（离线开关三个都要带）

```bash
cd <repo>
ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
npm_config_sharp_libvips_local_prebuilds=$PWD/.cache/libvips-local \
npm ci --registry=https://registry.npmmirror.com
```

- `ELECTRON_SKIP_BINARY_DOWNLOAD=1`：跳过 electron 的 linux 版二进制（打包用不到）。
- `npm_config_sharp_libvips_local_prebuilds`：sharp 0.32 装到这一步会去 GitHub 拉 libvips，指到预置目录后日志出现 `Using local libvips from`，成功标志是 `node_modules/@docusaurus/lqip-loader/node_modules/sharp/vendor/8.14.5/linux-x64/lib/` 存在。
- 实测：2306 包、25 秒、`node_modules` 1.3 GB。

## 五、构建五步（实测总耗时 3 分 41 秒）

```bash
cd <repo>
# 1) wsh 全平台（内部先跑 go mod tidy + generate）
node scripts/run-task.mjs build:wsh                       # 81 s

# 2) wavesrv 交叉编译出 Windows exe（Taskfile 的 build:server:windows 有 platforms:[windows] 门禁，Linux 上只能手打这条）
V=$(node version.cjs) && \
CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
GOCACHE=$PWD/.cache/go-build GOMODCACHE=$PWD/.cache/gomod GOPATH=$PWD/.cache/gopath \
GOENV=off GOTOOLCHAIN=local GOPROXY=https://goproxy.cn,direct \
ZIG_GLOBAL_CACHE_DIR=$PWD/.cache/zig-global ZIG_LOCAL_CACHE_DIR=$PWD/.cache/zig-local \
CC="$PWD/.tools/zig/zig cc -target x86_64-windows-gnu" \
$PWD/.tools/go/bin/go build -tags "osusergo,sqlite_omit_load_extension" \
  -ldflags "-s -w -X main.BuildTime=$(date +%Y%m%d%H%M) -X main.WaveVersion=$V" \
  -o dist/bin/wavesrv.x64.exe cmd/server/main-server.go        # 31 s

# 3) tsunami scaffold（electron-builder 的 extraResources 依赖它）
node scripts/run-task.mjs build:tsunamiscaffold            # 17 s

# 4) 前端生产构建
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm run build:prod          # 49 s

# 5) 打 Windows 便携 zip（环境变量必须显式给，裸环境会写进 ~/.cache）
ELECTRON_CACHE=$PWD/.cache/electron \
ELECTRON_BUILDER_CACHE=$PWD/.cache/electron-builder \
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
NODE_OPTIONS=--max-old-space-size=8192 \
npm exec electron-builder -- -c electron-builder.config.cjs -p never --win zip --x64 \
  -c.win.signAndEditExecutable=false                       # 43 s
```

## 六、产物验证（必做，别只看退出码）

```bash
file dist/bin/wavesrv.x64.exe     # 期望 PE32+ executable for MS Windows, x86-64
unzip -l make/*.zip | head        # 期望含 Snorkeling.exe、ffmpeg.dll、d3dcompiler_47.dll
```

## 七、已知坑

1. **产物名会骗人**：`artifactName: "${productName}-${platform}-${arch}-${version}.${ext}"` 的 `${platform}` 取的是**宿主平台名**，Linux 上打 Windows 包会得到 `Snorkeling-linux-x64-....zip`。内容是对的。别改配置，重命名产物即可（`mv` 到 `...-win-x64-...zip`）。
2. **`build:server:windows` 直跑会被 Taskfile 拒绝**（`platforms: [windows]`），必须用第五步里的手写 zig cc 命令。
3. **不要在 Windows 上解 Linux 的 Go/Zig tar**：符号链接与执行位会丢，`go version` 直接报错。
4. **electron-builder 下载不走 `ELECTRON_MIRROR` 之外的地方**：预置 `.cache/electron/` 后它命中缓存不联网；漏了预置就会去 npmmirror 拉 142 MB。
5. **`npm ci` 失败先看是不是 sharp**：报 `sharp: Downloading https://github.com/lovell/...` 就是 libvips 没预置。
6. **`expanded` 目录别提交**：`make/`、`dist/` 都在 `.gitignore` 里，`git status` 应保持干净。

## 八、回传 Windows 与运行

```bash
# 从服务器把 zip 推到被控端（meshctrl 的参数是 --file，不是 --source）
bash <meshctrl封装> Upload --id '<nodeid>' --file '<服务器上的 zip 路径>' --target 'C:\目标目录\'
# 校验：目标端 for %A in (<zip路径>) do @echo SIZE=%~zA   —— 必须与服务器字节数一致
# 解压：powershell -NoProfile -Command "Expand-Archive -Path '<zip>' -DestinationPath '<目录>'"
```

运行：双击 `Snorkeling.exe`。无签名首次启动弹 SmartScreen，点「更多信息 → 仍要运行」。
应用数据落在 `%APPDATA%\Snorkeling`，不写安装目录。

## 九、占地与撤销

- 服务器全部内容都在仓库目录内：`.tools`（约 1 GB）、`.cache`（实测 307 MB 起）、`node_modules`（1.3 GB）、`make/`（约 240 MB + `win-unpacked` 约 1 GB）。
  依据 `scripts/resolve-env.mjs`：GOCACHE / GOMODCACHE / GOPATH / npm / electron / zig / TMPDIR 全被重定向进仓库 `.cache/`，`GOENV=off`、`GOTOOLCHAIN=local`，不污染家目录。
- 撤销：`rm -rf <repo>` 一个文件夹即恢复原样。要保留构建能力就别删 `.tools` 与 `.cache`，重新抽包约 10 分钟。

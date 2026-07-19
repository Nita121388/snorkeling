# Building Snorkeling

These instructions are for setting up dependencies and building Snorkeling from source on macOS, Linux, and Windows.

Snorkeling is a Wave Terminal-based fork. Some internal package names, environment variables, and binaries still use the upstream Wave names, such as `WAVETERM_*`, `wavesrv`, and `wsh`.

## Prerequisites

### OS-specific dependencies

See [Minimum requirements](README.md#minimum-requirements) to learn whether your OS is supported.

#### macOS

macOS does not have any platform-specific dependencies.

#### Linux

You must have `zip` and `tar` installed. The repository bootstrap installs Zig for statically linking CGO.

Debian/Ubuntu:

```sh
sudo apt install zip tar snapd
```

Fedora/RHEL:

```sh
sudo dnf install zip tar
```

Arch:

```sh
sudo pacman -S zip tar
```

##### For packaging

For packaging, the following additional packages are required:

- `fpm` &mdash; If you're on x64 you can skip this. If you're on ARM64, install fpm via [Gem](https://rubygems.org/gems/fpm)
- `rpm` &mdash; If you're not on Fedora, install RPM via your package manager.
- `snapd` &mdash; If your distro doesn't already include it, [install `snapd`](https://snapcraft.io/docs/installing-snapd)
- `lxd` &mdash; [Installation instructions](https://canonical.com/lxd/install)
- `snapcraft` &mdash; Run `sudo snap install snapcraft --classic`
- `libarchive-tools` &mdash; Install via your package manager
- `binutils` &mdash; Install via your package manager
- `libopenjp2-tools` &mdash; Install via your package manager
- `squashfs-tools` &mdash; Install via your package manager

#### Windows

Windows 10 and later include the `tar` command used by the repository bootstrap.

### NodeJS

Make sure you have Node.js 22.12 or later installed. Node is the only language toolchain required globally.

See NodeJS's website for platform-specific instructions: https://nodejs.org/en/download

The repository bootstrap installs pinned Task, Go, and Zig versions under `.tools/` without changing the system PATH.

## Clone the Repo

```sh
git clone git@github.com:Nita121388/snorkeling.git
```

or

```sh
git clone https://github.com/Nita121388/snorkeling.git
```

## Install the development toolchain

The first time you clone the repo, install or verify the repository-local toolchain:

```sh
npm run setup
```

The development task installs Node and Go dependencies when they are first needed.

## Build and Run

All the methods below will install Node and Go dependencies when they run the first time. All these should be run from within the Git repository.

### Development server

Run the following command to build the app and run it via Vite's development server (this enables Hot Module Reloading):

```sh
npm run dev
```

### Multiple dev instances and CDP

Use a unique profile and Vite port for each running checkout:

```sh
npm run dev -- --profile review --vite-port 51742
```

Use the predefined CDP entry when inspecting the Electron UI:

```sh
npm run dev:cdp
```

It uses profile `cdp` and starts searching from Vite port `51742` and CDP port `9222`. Occupied ports advance automatically; the launcher prints the actual URLs and ready-to-run CDP check command. Add `--strict-port` to fail on a collision, or add `-- --dry` after the instance options when only checking Task expansion.

### Standalone

Run the following command to build the app and run it standalone, without the development server. This will not reload on change:

```sh
task start
```

### Packaged

Run the following command to generate a production build and package it. This lets you install the app locally. All artifacts will be placed in `make/`.

```sh
task package
```

If you're on Linux ARM64, run the following:

```sh
USE_SYSTEM_FPM=1 task package
```

## Debugging

### Frontend logs

You can use the regular Chrome DevTools to debug the frontend application. You can open the DevTools using the keyboard shortcut `Cmd+Option+I` on macOS or `Ctrl+Option+I` on Linux and Windows. Logs will be sent to the Console tab in DevTools.

### Backend logs

Backend logs for the development version of Snorkeling can be found at the app data directory:

- macOS: `~/Library/Application Support/snorkeling-dev/waveapp.log`
- Linux: `~/.local/share/snorkeling-dev/waveapp.log`
- Windows: `%LOCALAPPDATA%\snorkeling-dev\Data\waveapp.log`

Both the NodeJS backend from Electron and the main Go backend will log here.

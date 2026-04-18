<p align="center">
  <a href="https://github.com/Nita121388/snorkeling">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="./assets/snorkeling-icon.svg">
		<source media="(prefers-color-scheme: light)" srcset="./assets/snorkeling-icon.svg">
		<img alt="Snorkeling Logo" src="./assets/snorkeling-icon.svg" width="220">
	</picture>
  </a>
  <br/>
</p>

# Snorkeling (Wave-based)

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

## Snorkeling Development Notes

- Code source: this repository starts from the official `wavetermdev/waveterm` codebase and is maintained as an independent customization project.
- Reference project: Agent profile/configuration behavior references the OpenCove Agent management approach.
- Branch scope: `refactor/snorkeling` carries the Snorkeling customization work and related documentation.
- Implemented in this branch:
  - Snorkeling app identity isolation (`name`, `productName`, `appId`, local data/config paths).
  - Right-side `Agent` entry between `Terminal` and `Files`, with 3-scenario smart target selection.
  - Agent profile configuration support (`agent:defaultprofile`, `agent:profiles`) with fallback defaults.
  - CI/CD workflow for Snorkeling release (`.github/workflows/snorkeling-release.yml`) to build/publish macOS, Linux, and Windows artifacts.
- Auto-update isolation from official Wave:
  - Runtime updater reads packaged `app-update.yml`.
  - Packaging publish target is pinned in [`electron-builder.config.cjs`](./electron-builder.config.cjs) to GitHub `Nita121388/snorkeling`.
  - App identity is `io.github.nita121388.snorkeling` in [`package.json`](./package.json), so Snorkeling update channel is separated from official Wave.
- App icon source:
  - Snorkeling icon uses Twemoji snorkel emoji asset (`🤿`, `1f93f`) from `https://github.com/twitter/twemoji/tree/master/assets`.
  - Source file in this repo: [`assets/snorkeling-icon.svg`](./assets/snorkeling-icon.svg).

Wave is an open-source, AI-integrated terminal for macOS, Linux, and Windows. It works with any AI model. Bring your own API keys for OpenAI, Claude, or Gemini, or run local models via Ollama and LM Studio. No accounts required.

Wave also supports durable SSH sessions that survive network interruptions and restarts, with automatic reconnection. Edit remote files with a built-in graphical editor and preview files inline without leaving the terminal.

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## Key Features

- Wave AI - Context-aware terminal assistant that reads your terminal output, analyzes widgets, and performs file operations
- Durable SSH Sessions - Remote terminal sessions survive connection interruptions, network changes, and Wave restarts with automatic reconnection
- Flexible drag & drop interface to organize terminal blocks, editors, web browsers, and AI assistants
- Built-in editor for editing remote files with syntax highlighting and modern editor features
- Rich file preview system for remote files (markdown, images, video, PDFs, CSVs, directories)
- Quick full-screen toggle for any block - expand terminals, editors, and previews for better visibility, then instantly return to multi-block view
- AI chat widget with support for multiple models (OpenAI, Claude, Azure, Perplexity, Ollama)
- Command Blocks for isolating and monitoring individual commands
- One-click remote connections with full terminal and file system access
- Secure secret storage using native system backends - store API keys and credentials locally, access them across SSH sessions
- Rich customization including tab themes, terminal styles, and background images
- Powerful `wsh` command system for managing your workspace from the CLI and sharing data between terminal sessions
- Connected file management with `wsh file` - seamlessly copy and sync files between local and remote SSH hosts

## Wave AI

Wave AI is your context-aware terminal assistant with access to your workspace:

- **Terminal Context**: Reads terminal output and scrollback for debugging and analysis
- **File Operations**: Read, write, and edit files with automatic backups and user approval
- **CLI Integration**: Use `wsh ai` to pipe output or attach files directly from the command line
- **BYOK Support**: Bring your own API keys for OpenAI, Claude, Gemini, Azure, and other providers
- **Local Models**: Run local models with Ollama, LM Studio, and other OpenAI-compatible providers
- **Free Beta**: Included AI credits while we refine the experience
- **Coming Soon**: Command execution (with approval)

Learn more in our [Wave AI documentation](https://docs.waveterm.dev/waveai) and [Wave AI Modes documentation](https://docs.waveterm.dev/waveai-modes).

## Installation

Wave Terminal works on macOS, Linux, and Windows.

Platform-specific installation instructions can be found [here](https://docs.waveterm.dev/gettingstarted).

You can also install Wave Terminal directly from: [www.waveterm.dev/download](https://www.waveterm.dev/download).

### Minimum requirements

Wave Terminal runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 1809 or later (x64)
- Linux based on glibc-2.28 or later (Debian 10, RHEL 8, Ubuntu 20.04, etc.) (arm64, x64)

The WSH helper runs on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 or later (x64)
- Linux Kernel 2.6.32 or later (x64), Linux Kernel 3.1 or later (arm64)

## Roadmap

Wave is constantly improving! Our roadmap will be continuously updated with our goals for each release. You can find it [here](./ROADMAP.md).

Want to provide input to our future releases? Connect with us on [Discord](https://discord.gg/XfvZ334gwU) or open a [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose)!

## Snorkeling Project Docs

- Project Charter (CN): [docs/project/snorkeling-project-charter.md](./docs/project/snorkeling-project-charter.md)
- Execution Plan (CN): [docs/project/snorkeling-execution-plan.md](./docs/project/snorkeling-execution-plan.md)
- Agent Config (CN): [docs/project/agent-config.md](./docs/project/agent-config.md)
- CI/CD & Release (CN): [docs/project/ci-cd-release.md](./docs/project/ci-cd-release.md)
- Upstream Sync Playbook (CN): [docs/project/upstream-sync-playbook.md](./docs/project/upstream-sync-playbook.md)

## Links

- Homepage &mdash; https://www.waveterm.dev
- Download Page &mdash; https://www.waveterm.dev/download
- Documentation &mdash; https://docs.waveterm.dev
- X &mdash; https://x.com/wavetermdev
- Discord Community &mdash; https://discord.gg/XfvZ334gwU

## Building from Source

See [Building Wave Terminal](BUILD.md).

## Contributing

Wave uses GitHub Issues for issue tracking.

Find more information in our [Contributions Guide](CONTRIBUTING.md), which includes:

- [Ways to contribute](CONTRIBUTING.md#contributing-to-wave-terminal)
- [Contribution guidelines](CONTRIBUTING.md#before-you-start)

### Sponsoring Wave ❤️

If Wave Terminal is useful to you or your company, consider sponsoring development.

Sponsorship helps support the time spent building and maintaining the project.

- https://github.com/sponsors/wavetermdev

## License

Wave Terminal is licensed under the Apache-2.0 License. For more information on our dependencies, see [here](./ACKNOWLEDGEMENTS.md).

# Snorkeling Documentation

This directory contains the Docusaurus documentation site for Snorkeling.

Snorkeling is a customization fork built on top of Wave Terminal, so some docs still describe inherited Wave behavior. Snorkeling-specific pages should clearly distinguish runtime facts that still use upstream names, such as `wsh`, `WAVETERM_*`, and `waveai:*`.

## Content guide

- `docs/` — English source pages (`en`), ordered by `sidebar_position` in each file's frontmatter.
- `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/` — Simplified Chinese mirrors. **Every English page must have a paired Chinese page.**
- `docs/docs/snorkeling-features.mdx` — fork feature overview (paired in zh-Hans).
- Fork-specific detail pages (en + zh paired):
  - `agent-workflow.mdx` — Agent launch, context inheritance, profiles, session resume.
  - `ai-sessions.mdx` — browsing / outlining / marking / resuming local Codex & Claude sessions, plus Session Overview.
  - `version-control.mdx` — Git / SVN blocks, diff, history, commits, remote sync.
- `docs/project/snorkeling-user-facing-features.md` — the authoritative fact source for user-visible fork features; keep it in sync when features change.
- `docs/project/docs-gap-map.md` — feature → page mapping and a "do not invent" checklist.
- `docs/project/docs-update-progress.md` — progress tracker for doc updates.

When editing, update both the English page and its zh-Hans mirror. Do not invent shortcuts, config keys, or behaviors not present in the fact source; mark uncertain items explicitly.

## Development

```bash
npm install
npm run start
```

## Build

```bash
npm run build -- --locale en
npm run build -- --locale zh-Hans
```

`onBrokenLinks: throw` fails the build on broken links, so both locales must build cleanly before publishing.

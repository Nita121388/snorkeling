# Simplify Wave AI defaults and provider naming

## Requirements

- Work directly on `main` after integrating the existing Wave AI editor.
- Use one editable default custom mode named `My AI` for a new/empty configuration.
- Do not present Quick, Balanced, and Deep as the new-user default UI.
- Keep existing `waveai@quick`, `waveai@balanced`, and `waveai@deep` entries compatible.
- Categorize user modes as `My Models` and legacy built-ins as `Built-in Wave AI`.
- Keep new UI copy in English; no new i18n dependency.
- Preserve the existing `waveai.json` format and `waveai:defaultmode` setting.

## Acceptance Criteria

- Empty Wave AI configuration creates `custom@default` with display name `My AI` and selects it as default.
- Existing configurations are not overwritten or seeded with additional Quick/Balanced/Deep entries.
- Legacy built-in entries remain selectable and usable if already present.
- User-created entries appear under `My Models`; built-ins appear under `Built-in Wave AI`.
- Existing CRUD, rename, default selection, test connection, and fetch models behavior remains available.
- Added/changed UI text is English.
- Targeted lint, tests, and TypeScript diagnostics pass for changed files.

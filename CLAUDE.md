@.kilocode/rules/rules.md

---

## Electron UI inspection

For actual Electron UI layout, style, hover/click, and modal overflow issues, inspect the running app through CDP instead of asking the user to open DevTools and report DOM details.

- Use `node scripts/inspect-electron-ui.mjs ...` from the repo root. The app must be running with a CDP port, usually `--remote-debugging-port=9222`.
- Use `http://127.0.0.1:9222/json/list` to verify targets when the script cannot find the app.
- The right vertical widget strip is called `WidgetsBar`, or the right Widgets bar.
- Do not use `opencli operate state` for this workflow; it controls OpenCLI's own automation browser and may return `about:blank`.

Useful commands:

```powershell
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs elements --limit 40
node scripts/inspect-electron-ui.mjs style "Common Text"
node scripts/inspect-electron-ui.mjs click 1796 296
node scripts/inspect-electron-ui.mjs screenshot
```

For style bugs, gather both visual and layout evidence: `getBoundingClientRect()`, `clientHeight`, `scrollHeight`, computed `display`, `flex`, `minHeight`, `height`, `maxHeight`, `overflow`, `overflowY`, element text, `aria-label`, `title`, classes, and coordinates.

## Skill Guides

This project uses a set of "skill" guides — focused how-to documents for common implementation tasks. When your task matches one of the descriptions below, **read the linked SKILL.md file before proceeding** and follow its instructions precisely.

| Skill        | File                                     | Description                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add-config   | `.kilocode/skills/add-config/SKILL.md`   | Guide for adding new configuration settings to Wave Terminal. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings.                                               |
| add-rpc      | `.kilocode/skills/add-rpc/SKILL.md`      | Guide for adding new RPC calls to Wave Terminal. Use when implementing new RPC commands, adding server-client communication methods, or extending the RPC interface with new functionality.                                                 |
| add-wshcmd   | `.kilocode/skills/add-wshcmd/SKILL.md`   | Guide for adding new wsh commands to Wave Terminal. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface.                                                                      |
| context-menu | `.kilocode/skills/context-menu/SKILL.md` | Guide for creating and displaying context menus in Wave Terminal. Use when implementing right-click menus, adding context menu items, creating submenus, or handling menu interactions with checkboxes and separators.                      |
| create-view  | `.kilocode/skills/create-view/SKILL.md`  | Guide for implementing a new view type in Wave Terminal. Use when creating a new view component, implementing the ViewModel interface, registering a new view type in BlockRegistry, or adding a new content type to display within blocks. |
| electron-api | `.kilocode/skills/electron-api/SKILL.md` | Guide for adding new Electron APIs to Wave Terminal. Use when implementing new frontend-to-electron communications via preload/IPC.                                                                                                         |
| waveenv      | `.kilocode/skills/waveenv/SKILL.md`      | Guide for creating WaveEnv narrowings in Wave Terminal. Use when writing a named subset type of WaveEnv for a component tree, documenting environmental dependencies, or enabling mock environments for preview/test server usage.          |
| wps-events   | `.kilocode/skills/wps-events/SKILL.md`   | Guide for working with Wave Terminal's WPS (Wave PubSub) event system. Use when implementing new event types, publishing events, subscribing to events, or adding asynchronous communication between components.                            |

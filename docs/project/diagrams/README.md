# Snorkeling project diagrams

This directory contains draw.io source files for Snorkeling project documentation. Open any `.drawio` file with diagrams.net/draw.io.

## Files

1. [01-overall-architecture.drawio](./01-overall-architecture.drawio) - Electron, React renderer, Go server, storage, and external execution targets.
2. [02-process-architecture.drawio](./02-process-architecture.drawio) - Main app processes and the boundaries between Electron, renderer, Go, and helper commands.
3. [03-frontend-backend-communication.drawio](./03-frontend-backend-communication.drawio) - How a UI action becomes a backend service or RPC command and returns as data/events.
4. [04-workspace-object-model.drawio](./04-workspace-object-model.drawio) - Core persisted UI object hierarchy and how block rendering is selected.
5. [05-agent-launch-flow.drawio](./05-agent-launch-flow.drawio) - Snorkeling Agent entry chooses a terminal/files/home context before launching Codex/Claude/Gemini/etc.
6. [06-ai-sessions-data-flow.drawio](./06-ai-sessions-data-flow.drawio) - Local Codex and Claude Code histories are scanned, indexed, filtered, annotated, and rendered.
7. [07-files-workflow.drawio](./07-files-workflow.drawio) - File browsing, preview, edit, copy context, and directional open targets.
8. [08-vcs-workflow.drawio](./08-vcs-workflow.drawio) - Repository detection, status, history, commits, and visual diffs.
9. [09-module-layering.drawio](./09-module-layering.drawio) - High-level source layers in the repository.
10. [10-directory-responsibilities.drawio](./10-directory-responsibilities.drawio) - What each top-level directory owns.
11. [11-rpc-interface.drawio](./11-rpc-interface.drawio) - Custom wshrpc command/type generation and runtime dispatch.
12. [12-wps-events.drawio](./12-wps-events.drawio) - Wave PubSub keeps windows and blocks synchronized after backend mutations.
13. [13-jotai-state-management.drawio](./13-jotai-state-management.drawio) - Model-level atoms, globalStore writes, and component rendering.
14. [14-block-view-registry.drawio](./14-block-view-registry.drawio) - Metadata view keys map to frontend ViewModel classes and block components.
15. [15-terminal-command-execution.drawio](./15-terminal-command-execution.drawio) - From terminal block input through shell controller, PTY/job streams, and UI rendering.
16. [16-ssh-remote-connection.drawio](./16-ssh-remote-connection.drawio) - Remote and WSL execution attach a connection route into the same RPC fabric.
17. [17-file-preview-pipeline.drawio](./17-file-preview-pipeline.drawio) - Preview decides rendering mode after file info and content are loaded.
18. [18-diff-viewer-pipeline.drawio](./18-diff-viewer-pipeline.drawio) - File history, VCS diff, and AI file diff converge into the visual diff renderer.
19. [19-data-storage.drawio](./19-data-storage.drawio) - Persistent data stores used by the desktop app and backend services.
20. [20-build-packaging.drawio](./20-build-packaging.drawio) - Frontend, Electron, Go helpers, assets, and packaging steps.
21. [21-code-generation.drawio](./21-code-generation.drawio) - Generated TypeScript and Go glue should be produced from source definitions, not edited manually.
22. [22-security-boundaries.drawio](./22-security-boundaries.drawio) - Sensitive boundaries around filesystem, credentials, remote execution, and AI tool actions.
23. [23-ai-tool-approval.drawio](./23-ai-tool-approval.drawio) - AI chat tools route through backend approval before mutating files or running sensitive actions.
24. [24-error-handling.drawio](./24-error-handling.drawio) - Errors move from backend/domain layers into RPC responses, events, and visible UI states.
25. [25-testing-coverage.drawio](./25-testing-coverage.drawio) - Main automated checks by layer and the high-risk gaps they cover.
26. [26-dependency-map.drawio](./26-dependency-map.drawio) - Major external libraries grouped by runtime layer.
27. [27-user-core-journey.drawio](./27-user-core-journey.drawio) - Snorkeling product goal: stay in terminal while opening, editing, diffing, committing, and launching Agent.
28. [28-release-lifecycle.drawio](./28-release-lifecycle.drawio) - Local changes become a tagged, packaged, and installable Snorkeling release.
29. [29-docs-i18n-workflow.drawio](./29-docs-i18n-workflow.drawio) - Project documentation and Docusaurus localization assets.
30. [30-snorkeling-customization-map.drawio](./30-snorkeling-customization-map.drawio) - Custom features layered on top of upstream Wave Terminal.

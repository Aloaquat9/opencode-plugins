# OpenCode Plugins

Collection of OpenCode plugins maintained in this repository.

## Packages

- **opencode-archive-before-compaction** (`packages/opencode-archive-before-compaction`):
  Archives full session transcripts immediately before compaction, writing timestamped Markdown/JSON files under `.opencode/archive/sessions/<sessionId>/`, and injects a compaction note pointing to the archive so agents can search later (for example with `grepai`).

## Using a plugin

Each package contains its own README with installation and usage details. Start with the package README and add the plugin to your `opencode.json` configuration.

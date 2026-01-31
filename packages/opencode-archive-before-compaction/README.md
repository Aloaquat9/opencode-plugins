# opencode-archive-before-compaction

OpenCode plugin that archives the full session transcript immediately before compaction, then injects a reference to the archive folder into the compaction context so agents can search it later (e.g., via `grepai`).

## What it does
- Writes archives under: `.opencode/archive/sessions/<sessionId>/`
- Creates timestamped `.md` (human readable) and `.json` (exact)
- De-dupes identical archives via SHA256
- Adds a compaction note pointing at the archive folder and recommending searching it with `grepai`

## Install (OpenCode config)
In your `opencode.json`:

```json
{
  "plugin": ["opencode-archive-before-compaction"]
}


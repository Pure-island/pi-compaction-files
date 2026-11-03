---
verified_against: 7ce6b0cb3e42697ab7ac4fd103282845eabe8360
verified_scope: File-list configuration and native summarizer passthrough in extensions/index.ts
---

# Configuration

Edit `~/.pi/pi-compaction-files.json`, then run `/reload`.
Omitted fields use the extension's defaults. Run `/filelist` to inspect the loaded
configuration. Default values are defined in
[`loadConfig()`](../extensions/index.ts) and
[`DEFAULT_OPTIONS`](../extensions/filelist.ts).

## Summary generation

The extension calls Pi's native `compact()` with the conversation model and thinking
level. Focus instructions, output limits and summary prose are left unchanged.
Pi retains responsibility for cut points and recent-message selection.
A split-turn compaction can generate separate history and turn-prefix summaries.

## File lists

| Field | Meaning |
| --- | --- |
| `keepModified` / `keepRead` | Number of modified/read paths retained in context, ordered by modification time. |
| `dropMissing` | Filter out paths that no longer exist on the local filesystem. |
| `excludePatterns` | Path substrings to exclude from the rendered list. |
| `sensitivePatterns` | Path substrings to hide from the rendered list and, with `archiveSensitive: false`, the saved inventory. Supplying an array replaces the built-in list. |
| `archiveSensitive` | Whether sensitive-matching paths may remain in the saved `details` inventory. Existing entries retain their stored data. |
| `style` | `native` renders shortened Pi file blocks. `index` renders a `<session_files>` index. |
| `tool` | Register the `session_files` tool for looking up the saved inventory. Pair with `style: "index"`. |
| `indexRecent` | Number of paths displayed by the index. When the index would be longer, the extension uses native blocks. |

For on-demand inventory lookup:

```json
{
  "style": "index",
  "tool": true
}
```

The inventory is stored in the session entry's `details`. The context handler rewrites
older summaries in memory when preparing model requests.

## Switches and diagnostics

| Field or environment variable | Meaning |
| --- | --- |
| `enabled` | Enable or disable the extension's compaction and context rewriting. |
| `PI_FILELIST_DISABLE=1` | Disable the extension when it loads. |
| `PI_COMPACTION_FILES_CONFIG` | Read configuration from this path instead of the home-directory file. |
| `piDistDir` / `PI_CODING_AGENT_DIST` | Point the self-check at Pi's `dist/` directory when automatic discovery fails. |

## Failure handling

Failed authentication or a failed request logs a warning and returns control to Pi's
native compaction. Pi resolves the conversation model's credentials before invoking
the extension.

The native fallback saves its own summary. The extension's context handler still trims
its file lists on later model requests. The extension does not add its own generation
retry or completion-path fallback.

Use one extension that supplies a `session_before_compact` result for an event.
Pi calls these handlers independently and uses the last override.

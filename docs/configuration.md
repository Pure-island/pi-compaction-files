---
verified_against: bb1512a8a3f1e3add26bc3d067d12bd87d1f27a1
verified_scope: Conversation-model compaction and request-level output budgets in extensions/index.ts
---

# Configuration

Edit `~/.pi/pi-compaction-files.json`, then run `/reload`.
Omitted fields use the extension's defaults. Run `/filelist` to inspect the loaded
configuration. Default values are defined in
[`loadConfig()`](../extensions/index.ts) and
[`DEFAULT_OPTIONS`](../extensions/filelist.ts).

## Model and thinking

Compaction uses the current conversation model.

| Field | Meaning |
| --- | --- |
| `compactThinking` | Summarization thinking level. Accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`, subject to provider support. |

The same settings apply to manual, threshold and overflow compactions.
Pi retains responsibility for cut points and recent-message selection.
`/compact` focus instructions are passed through to the native summarizer.
A split-turn compaction can generate separate history and turn-prefix summaries.

Each compaction logs the effective model and thinking level.

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

## Output budgets

| Field | Meaning |
| --- | --- |
| `outputBudgetRatio` | Target share of the conversation model's `maxTokens` for reasoning plus summary. `0` disables the target. |
| `outputHardCapRatio` | Request-level output ceiling as a share of the conversation model's `maxTokens`. `0` retains the model's ceiling. |
| `retryOnOverflow` | If reported output exceeds the target, retry once with tighter instructions and lower thinking. Keep the lower-usage result. |
| `summaryMaxTokens` | Target length of the rewritten summary, estimated as characters / 4. `0` disables it. File lists are tightened first. |
| `summaryHardTrim` | Truncate summary text when it still exceeds `summaryMaxTokens` after list tightening. This can discard task context. |

Both ratios accept values from `0` to `1`. Output caps apply to a request-local model
copy. Pi's conversation model and compaction trigger settings remain unchanged.

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
its file lists on later model requests. Consecutive compaction failures can suspend the
hook until the extension reloads.

Use one extension that supplies a `session_before_compact` result for an event.
Pi calls these handlers independently and uses the last override.

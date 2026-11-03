# pi-compaction-files

Fork of [yeyudeH/pi-compaction-files](https://github.com/yeyudeH/pi-compaction-files),
adding an optional dedicated compaction model in the same native summarization flow.
The file-list measurements below are from upstream, not new fork benchmarks.

**Pi's compaction appends two unbounded file lists to every summary and re-inherits them
forever. This extension caps them, and the cost per turn stops growing.**

Measured on one long-running real session (30k+ entries, 112 compactions):

| | file lists in context | cost per model call |
|---|---|---|
| Pi default | 110,924 B / 1,930 paths (57% of the summary) | **≈27,700 tokens** |
| with this extension | 1,594 B / 38 paths (4.8%) | **≈399 tokens, constant** |

Pi's own docs describe the growth as intended behaviour
([`docs/compaction.md` → "Cumulative File Tracking"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)):

> Default compaction and branch summarization track files cumulatively. […] Compaction
> also carries file lists from the previous Pi-generated compaction. […] File tracking
> therefore accumulates across default compactions and nested default branch summaries.
> **Pi does not automatically carry file lists from extension-generated summaries whose
> `fromHook` field is `true`; extensions manage their own `details` format.**

That last sentence is the documented contract this extension uses. It is not a monkey patch.

> **中文文档见 [README.zh.md](./README.zh.md)。**

---

## Install

Requires Pi **1.4.0 or newer**. Install this fork from GitHub:

```bash
pi install git:github.com/Pure-island/pi-compaction-files@v0.4.0
```

For updates from the default branch, omit `@v0.4.0`. This fork is not published to npm.
Remove any installed upstream copy or `pi-compaction-model` before enabling this fork;
only one extension should own `session_before_compact`.

Restart Pi or run `/reload` after installation.

Then check it is loaded:

```
/filelist
```

You should see something like:

```
enabled=true style=native keepModified=60 keepRead=40 dropMissing=true
archiveSensitive=false tool=false indexRecent=12 failStreak=0/2
exclude=[/tmp/, /dev/shm/, /node_modules/, /.cache/, /proc/, /sys/]
cache=0 streamMode=[]
pi-self-check=ok dist=/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist
  ok: compaction.js: fromHook inheritance guard present
  ok: session-manager.js: fromHook persisted on compaction entries
  ok: compaction/utils.js + compaction.js: still emits read-files/modified-files blocks
  ok: compaction.js: details field still carried
当前清单: read 12 / modified 31
```

**The extension takes effect on the next Pi start**, because extensions load at process
startup. A compaction summary that is already in your session is rewritten in memory on
every turn (nothing is written to the session file), so an existing bloated session
shrinks immediately.

---

## What it does

### 1. Shortens the lists at the source

`session_before_compact` calls Pi's own `compact()` with the selected model,
`compactThinking`, and output budget, then replaces the file blocks with shorter ones. Because the
result comes from a hook, Pi records `fromHook: true` and stops inheriting the previous
lists. The snowball breaks at the source instead of being re-trimmed every turn.

### 2. Strips *every* complete block, not just the trailing one

Pi appends the real block at the end. But the summarizer can also **reproduce an earlier
block inside the narrative**. Observed in a real session:

```
offset 29181   1594 B   38 paths   ← previous compaction's block, copied into the prose
offset 33349     75 B    1 path    ← the real block Pi appended
```

A "take the last match" implementation leaves the first one in context on every turn, and
it grows again. This extension removes all complete blocks and merges their paths into one
capped list. Prose that merely *mentions* the tags is untouched: the regex requires the tag
alone on its own line plus a matching close tag. Measured across 112 real compactions:
141 narrative mentions, **0 swallowed**.

### 3. Filters the paths

- drop paths that no longer exist on disk (`dropMissing`)
- drop temp noise: `/tmp/`, `/dev/shm/`, `/node_modules/`, `/.cache/`, `/proc/`, `/sys/`
- dedupe the same path written relative and absolute (Pi stores both)
- count and hide paths matching `sensitivePatterns`
- keep the `keepModified` / `keepRead` most recently touched, newest first

### 4. Keeps sensitive paths out of the session file too

Pi writes the full lists into the compaction entry's `details`, which it never renders
into context. Hiding a path from the *prompt* does not remove it from the *session file on
disk*. In one real session, 1,643 of 140,048 archived paths (1.17%, 21 distinct) matched
the sensitive patterns — credential-ish file names, agent config files, screenshots in a
private folder.

Since 0.2.0 the archive is filtered as well (`archiveSensitive: false`, the default). Set
it to `true` if you want the full inventory kept on disk so the `session_files` tool can
search it.

Existing entries are never rewritten — the filter applies to new compactions.

---

## Configuration

Optional file: `~/.pi/pi-compaction-files.json`

```json
{
  "enabled": true,
  "style": "native",
  "tool": false,
  "keepModified": 60,
  "keepRead": 40,
  "dropMissing": true,
  "indexRecent": 12,
  "archiveSensitive": false,
  "compactModel": null,
  "compactThinking": "medium",
  "outputBudgetRatio": 0.8,
  "outputHardCapRatio": 0.9,
  "retryOnOverflow": true,
  "summaryMaxTokens": 0,
  "summaryHardTrim": false,
  "excludePatterns": ["/tmp/", "/dev/shm/", "/node_modules/", "/.cache/", "/proc/", "/sys/"],
  "sensitivePatterns": ["/credential", "/secret", "/token", ".key", "/password", "apikey", "/.pi/agent/settings.json", "/.pi/agent/models.json"],
  "piDistDir": null
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. `PI_FILELIST_DISABLE=1` also disables at runtime. |
| `style` | `native` | `native` re-emits Pi's own `<read-files>` / `<modified-files>` blocks, shorter. `index` replaces them with a `<session_files>` index. |
| `tool` | `false` | Register the `session_files` lookup tool. Only useful with `style: "index"`. |
| `keepModified` | `60` | How many modified paths stay in context (newest first). |
| `keepRead` | `40` | How many read paths stay in context. |
| `indexRecent` | `12` | `index` style only: how many paths the index shows. Without this cap an index is **longer** than native (measured +506 chars at kept=38); with it, 854 chars shorter. If the index still would not be shorter, the extension falls back to `native` for that summary. |
| `dropMissing` | `true` | Drop paths that no longer exist. |
| `archiveSensitive` | `false` | `false` also strips sensitive-shaped paths from the on-disk `details` archive. |
| `excludePatterns` | see above | Substrings whose paths are dropped entirely. |
| `compactModel` | `null` | Optional exact `provider/model` known to Pi; omitted, `null`, or an empty string uses the active conversation model. Model IDs may contain `/`. |
| `compactThinking` | `medium` | Thinking level for the summarisation request itself instead of the session's. |
| `outputBudgetRatio` | `0.8` | Share of the selected model's output ceiling (`model.maxTokens`) that the whole summarisation reply — reasoning **plus** summary — should fit inside. `0` disables. |
| `outputHardCapRatio` | `0.9` | Set a request-local model output ceiling to this share of the selected model's limit. Applies to both registry and native completion paths; does not change session settings. `0` leaves the model's ceiling untouched. |
| `retryOnOverflow` | `true` | If the reply used more than that budget, redo it once with tighter instructions and one step lower thinking; keep whichever was cheaper. |
| `summaryMaxTokens` | `0` | Optional second ceiling on the summary text alone (chars/4). `0` = off; `outputBudgetRatio` is the primary control. |
| `summaryHardTrim` | `false` | When the summary is still over the ceiling after the lists are tightened, cut the prose too (default: tighten lists and warn). |
| `sensitivePatterns` | see above | Substrings whose paths are counted but never listed. **Add your own private directories here.** |
| `piDistDir` | auto | Only needed if the self-check cannot find Pi's `dist/`. `PI_CODING_AGENT_DIST` works too. |

---

### Dedicated compaction model

Implementation baseline: [`cdbfb9d91419594e32d40d686c4b286e0410543e`](https://github.com/Pure-island/pi-compaction-files/commit/cdbfb9d91419594e32d40d686c4b286e0410543e).
Scope: model selection and request-level output budgets in `extensions/index.ts`.

In `~/.pi/pi-compaction-files.json`, set for example:

```json
{
  "compactModel": "openai-codex/gpt-6-luna",
  "compactThinking": "medium"
}
```

Use a model available in your Pi registry. This changes summarization only, not the
conversation model, compaction trigger, or retained-message selection. Manual,
threshold, and overflow compactions use the same configuration. `/compact` focus
instructions still apply. Normal non-split compaction generates one summary; Pi's
native split-turn flow can generate separate history and turn-prefix summaries.

`/filelist` shows the configured model; each compaction logs the effective model and
thinking level, and `details.fileListIndex.compactModel` records the model used.
Invalid references, unknown models, authentication errors, or request failures log a
warning and return control to Pi's native current-model compaction. That fallback does
not trim the persisted summary through this hook; the `context` handler still trims
file blocks when the summary is sent on a later turn. The active model must also have
working credentials because Pi resolves them before invoking this hook.

## Results

### Against Pi's default (measured on 101 real native compaction entries)

Growth fitted on the real data: **+1,108 B per compaction**, unbounded.

| | file-list bytes | tokens per call |
|---|---|---|
| Pi default, at the point this extension was installed | 110,924 B | 27,731 |
| Pi default, projected 40 compactions later | 155,234 B | 38,809 |
| this extension | 1,594 B | 399 |

The list is capped by `keepModified + keepRead`, so it does not depend on how many
compactions you have had.

### 0.1.0 vs 0.2.0 (same real data, side by side)

| compaction | input | 0.1.0 output | 0.2.0 output | blocks left: 0.1.0 → 0.2.0 |
|---|---|---|---|---|
| 5 of the last 6 | — | identical | identical | 1→1, 2→2, 1→1, 1→1, 1→1 |
| the one with a re-seeded block | 33,424 | 33,424 | **33,281** | **3 → 1** |

Five of six inputs were already clean, so there is no regression. The sixth is the case
0.2.0 exists for.

Projection with the observed parameters (native +1,108 B/step; re-seeded block 1,594 B,
observed in 1 of 11 hook-produced compactions):

| +N compactions | Pi default | 0.1.0 at observed rate | 0.1.0 worst case | **0.2.0** |
|---|---|---|---|---|
| 5 | 116 KB | 2,319 B | 9,564 B | **1,594 B** |
| 20 | 133 KB | 4,492 B | 33,474 B | **1,594 B** |
| 40 | 155 KB | 7,390 B | 65,354 B | **1,594 B** |

### Cost of the extension itself

Measured:

- cold path (no cache, includes `statSync` per path): **0.43 ms**
- warm path (cache hit, signature only): **0.0002 ms**

The warm path is what runs on a normal turn. Negligible.

Full method and caveats: [docs/benchmark.md](./docs/benchmark.md).

---

## Coexistence with other context extensions

This fork owns native compaction and also rewrites file blocks through the `context`
hook. Extensions operating at other stages can coexist, but check their hook ownership.

`pi-zip` documents the same conclusion from its side:

> An extension that only writes Pi's compaction summaries (a `session_before_compact`
> handler) does not pause pi-zip.

Do not enable this fork alongside `pi-compaction-model`, the upstream copy, or another
extension that supplies a `session_before_compact` result for the same event. Pi invokes
each handler independently and uses the last override; they do not form a summary pipeline.

---

## Safety

- **It never cancels compaction.** Every handler returns `{}` on any error, so Pi's
  default path runs untouched.
- **It never writes to your session file.** The `context` handler edits the summary in
  memory per turn; the `session_before_compact` handler returns a value that Pi persists
  like any hook result.
- **No telemetry.** Model requests use Pi's configured providers; no analytics or other network requests are added.
- **Uninstall = full rollback.** Old summaries stay in the session file byte for byte.
- **Failure budget.** After 2 consecutive failures it stops for the rest of the process
  and lets Pi do compaction.

---

## Known limits (read these)

- **It depends on Pi internals.** Three behaviours matter: the `fromHook` inheritance
  guard, `details` not being rendered into context, and in-place edits from the `context`
  hook. The first is documented; the other two are not contractual. A Pi upgrade can
  change them. The extension then does not crash — it silently stops helping — so it
  self-checks on load and logs a warning. Watch stderr after upgrading, or run `/filelist`.
- **Pi's compaction trigger is unaffected.** Pi decides when to compact from its own
  entry projection (`agent-session.js:422`), not from the rewritten prompt. Shrinking the
  summary makes the real prompt smaller but does not move Pi's trigger point. Hooking the
  compaction itself mitigates this, because the new summary is small to begin with.
- **Information is deliberately dropped.** Dead paths disappear from the list, and the
  list is capped. The narrative summary still mentions what mattered. If you need the full
  inventory, set `tool: true` and `archiveSensitive: true`, and use `session_files`.
- **`style: "index"` + `tool: true` has not been run in production** by the author; the
  `indexRecent` cap was measured offline.
- **The archive filter is not retroactive.** Old compaction entries keep their old lists.

---

## Development

```bash
npm test              # pure logic, no session data needed
npm run test:plugin   # existing hook harness against a mocked Pi
npm run test:integration # real Pi RPC + local HTTP providers; no paid model calls
npm run privacy       # refuse to publish personal paths / session ids
npm run check         # privacy + existing offline harnesses
```

`test/plugin-load.mjs` loads the extension against a mocked `compact()` and a throwaway
`HOME`, so it never reads the developer's own config and never calls a model. Point it at
another copy of the package with `PLUGIN_PKG=/path/to/pkg`.

`test:integration` needs Pi installed as a dependency or `PI_CODING_AGENT_CLI` pointing
to its `dist/cli.js`. For a global npm installation in PowerShell:

```powershell
$env:PI_CODING_AGENT_CLI = Join-Path (npm root -g) '@earendil-works/pi-coding-agent/dist/cli.js'
npm run test:integration
```

It checks model/provider routing, authentication, thinking level, output caps,
Windows-compatible file trimming, persisted summaries, and native failure fallback.
It creates and removes isolated fixtures without loading user settings or sessions.

To measure against your own session:

```bash
PI_TEST_SESSION=~/.pi/agent/sessions/<your-session-dir>/<your-session>.jsonl npm run test:plugin
```

That path is read-only.

---

## License

MIT — see [LICENSE](./LICENSE).

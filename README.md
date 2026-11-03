# pi-compaction-files

Keep file lists short in Pi's conversation compaction summaries.

[中文](README.zh.md)

## Install

```bash
pi install git:github.com/Pure-island/pi-compaction-files
```

Run `/reload`, then `/filelist` to see the configuration and self-check status.
To pin a release, append `@<tag>` to the install source. Supported Pi versions are in
[package.json](package.json), under `peerDependencies`.

Enable one compaction extension at a time. Remove `pi-compaction-model` and the upstream
`pi-compaction-files` copy before switching to this fork.

## Configure

Create `~/.pi/pi-compaction-files.json`:

```json
{
  "compactThinking": "medium"
}
```

Compaction uses the current conversation model. Reload Pi after editing the file. File counts, filters, output budgets and other options
are in the [configuration reference](docs/configuration.md).

## How it works

Pi's native `compact()` generates the summary with the conversation model. The extension
then filters and caps its `<read-files>` and `<modified-files>` blocks before saving it.
File lists in older summaries are also shortened when sent as conversation context.

Authentication or request failures are logged and handed back to Pi's native compaction.

## Development

[Validation guide](docs/verify-it-works.md#automated-checks) ·
[Upstream file-list measurements](docs/benchmark.md) ·
[Changelog](CHANGELOG.md)

Fork of [yeyudeH/pi-compaction-files](https://github.com/yeyudeH/pi-compaction-files).
[MIT](LICENSE).

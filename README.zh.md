# pi-compaction-files

给 Pi 的上下文压缩单独指定模型，把摘要里的文件清单控制在固定条数内。

[English](README.md)

## 安装

```bash
pi install git:github.com/Pure-island/pi-compaction-files
```

执行 `/reload`，再用 `/filelist` 查看配置和自检结果。
固定版本时，在安装来源后加 `@<tag>`。支持的 Pi 版本见
[package.json](package.json) 的 `peerDependencies`。

同一时间启用一个接管压缩的扩展。换用本 fork 前，移除 `pi-compaction-model`
和上游版 `pi-compaction-files`。

## 配置

创建 `~/.pi/pi-compaction-files.json`：

```json
{
  "compactModel": "openai-codex/gpt-6.1-sol",
  "compactThinking": "medium"
}
```

模型从 Pi 已注册的列表里选。省略 `compactModel` 时使用当前对话模型。
修改后执行 `/reload`。文件条数、路径过滤、输出预算等选项见
[配置参考](docs/configuration.md)。

## 工作方式

调用 Pi 原生的 `compact()`，由选定模型生成摘要，再过滤、缩短
`<read-files>` 和 `<modified-files>` 清单并保存。
已有摘要的文件清单也会在发给模型时缩短。

模型选择、鉴权或请求失败时会记录日志，并交还 Pi 使用当前对话模型压缩。
当前对话模型也需要有效凭据。

## 开发

[验证方法](docs/verify-it-works.md#automated-checks) ·
[上游文件清单测量](docs/benchmark.md) ·
[更新记录](CHANGELOG.md)

基于 [yeyudeH/pi-compaction-files](https://github.com/yeyudeH/pi-compaction-files)。
[MIT](LICENSE)。

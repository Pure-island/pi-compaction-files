# pi-compaction-files

基于 [yeyudeH/pi-compaction-files](https://github.com/yeyudeH/pi-compaction-files) 的 fork，
在同一次原生压缩流程中增加指定压缩模型的能力。下方文件清单测量来自上游，并非本 fork 的新基准。

**Pi 每次压缩都会在摘要末尾追加两个没有上限的文件清单，并且永久继承。这个扩展把它们封顶，
于是每轮的固定成本不再随压缩次数增长。**

一个长期真实会话实测（3 万+ 条目、112 次压缩）：

| | 上下文里的文件清单 | 每次模型调用的成本 |
|---|---|---|
| Pi 默认 | 110,924 B / 1,930 条（占摘要 57%） | **≈27,700 token** |
| 装本扩展 | 1,594 B / 38 条（4.8%） | **≈399 token，恒定** |

Pi 官方文档把这种增长写成了预期行为（`docs/compaction.md` → “Cumulative File Tracking”）：

> Default compaction and branch summarization track files cumulatively. […] Compaction
> also carries file lists from the previous Pi-generated compaction. […] File tracking
> therefore accumulates across default compactions and nested default branch summaries.
> **Pi does not automatically carry file lists from extension-generated summaries whose
> `fromHook` field is `true`; extensions manage their own `details` format.**

最后一句就是本扩展所依据的**公开契约**，不是 monkey patch。

---

## 安装

需要 **Pi 1.4.0 或更新版本**。从 GitHub 安装本 fork：

```bash
pi install git:github.com/Pure-island/pi-compaction-files@v0.4.0
```

去掉 `@v0.4.0` 可跟随默认分支更新。本 fork 未发布到 npm。
启用前移除已安装的上游版本或 `pi-compaction-model`，避免多个扩展同时接管压缩。

安装后重启 Pi，或执行 `/reload`。

确认已加载：

```
/filelist
```

看到类似输出即可，重点是最后一行的自检结果：

```
enabled=true style=native keepModified=60 keepRead=40 dropMissing=true
archiveSensitive=false tool=false indexRecent=12 failStreak=0/2
pi-self-check=ok dist=…/@earendil-works/pi-coding-agent/dist
  ok: compaction.js: fromHook inheritance guard present
  …
```

**扩展在下次启动 Pi 时才生效**（扩展是进程启动时加载的）。但已经存在会话里的旧摘要会在
每一轮被就地改写（不写会话文件），所以已经很臃肿的会话**立刻**变小。

---

## 它做了什么

### 1. 从源头缩短清单

`session_before_compact` 使用选定模型、`compactThinking` 和输出预算调用 Pi 自己的 `compact()`，
然后把文件清单块换短。因为结果来自 hook，Pi 会记 `fromHook: true` 并**停止继承上一次的清单**
—— 雪球在源头断掉，而不是每轮重新修剪。

### 2. 剥掉**所有**完整块，不只是末尾那个

Pi 把真块追加在末尾，但摘要模型会把**上一次的块抄进正文**。真实会话里实测到：

```
offset 29181   1594 B   38 条   ← 上一次压缩的块，被抄进正文
offset 33349     75 B    1 条   ← Pi 追加的真块
```

只取最后一处的实现会让前一份原样留在上下文里，每轮都付，并且继续滚大。本扩展剥掉所有完整块、
把路径并进一个有上限的清单。正文里只是**提到**标签的文字不会被误伤（正则要求标签独占一行且
有配对闭合标签）。112 次真实压缩里共 141 处提及，**误吞 0 处**。

### 3. 过滤路径

- 丢掉已不存在的路径（`dropMissing`）
- 丢掉临时噪音：`/tmp/`、`/dev/shm/`、`/node_modules/`、`/.cache/`、`/proc/`、`/sys/`
- 同一路径的相对/绝对两种写法去重（Pi 两种都存）
- 命中 `sensitivePatterns` 的路径只计数、不列出
- 按最近修改时间保留 `keepModified` / `keepRead` 条

### 4. 连会话文件里的存档也脱敏

Pi 会把完整清单写进 compaction 条目的 `details`（不渲染进上下文）。**只从 prompt 里隐藏
路径，并不会把它从磁盘上的会话文件里去掉。** 一个真实会话里，140,048 条存档路径中有
1,643 条（1.17%，21 种）命中敏感模式 —— 凭据形态的文件名、agent 配置、私密目录里的截图。

0.2.0 起存档也过滤（`archiveSensitive: false`，默认）。若你希望保留完整清单好让
`session_files` 工具能检索，设成 `true`。

**已存在的条目不会被追溯改写**，过滤只作用于新的压缩。

---

## 配置

可选文件：`~/.pi/pi-compaction-files.json`

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

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关。`PI_FILELIST_DISABLE=1` 可在运行时整体关闭。 |
| `style` | `native` | `native` 保留 Pi 原生块只缩短；`index` 换成 `<session_files>` 索引 |
| `tool` | `false` | 是否注册 `session_files` 检索工具（只有 `index` 样式有意义） |
| `keepModified` | `60` | 上下文里保留多少条修改路径（新的优先） |
| `keepRead` | `40` | 上下文里保留多少条读取路径 |
| `indexRecent` | `12` | 仅 `index` 样式：索引里列几条。不设这个上限时 `index` 比 `native` **更长**（kept=38 时实测 +506 字）；设了则短 854 字。若加了头尾说明后索引仍不更短，这一次自动退回 `native` |
| `dropMissing` | `true` | 丢掉已不存在的路径 |
| `archiveSensitive` | `false` | `false` = 敏感形态路径连磁盘存档也剔掉 |
| `excludePatterns` | 见上 | 命中即整条丢弃 |
| `compactModel` | `null` | Pi 已知的精确 `provider/model`。未设置、`null` 或空字符串使用当前对话模型；模型 ID 本身可含 `/` |
| `compactThinking` | `medium` | 压缩请求自己用的思考强度，不再沿用会话级别 |
| `outputBudgetRatio` | `0.8` | 压缩请求的**总输出**（思考 + 摘要）应落在选定模型输出上限（`model.maxTokens`）的这个比例内。`0` 表示不限制 |
| `outputHardCapRatio` | `0.9` | 将请求级模型输出上限设为选定模型上限的这个比例，同时作用于 registry 和原生 completion 路径，不改会话配置。`0` 表示不缩减模型原上限 |
| `retryOnOverflow` | `true` | 实际用量超过预算时，用更严的指令 + 降一档思考重做一次，取更省的那次 |
| `summaryMaxTokens` | `0` | 可选的第二道限制，只管摘要正文（字符数/4）。`0` 表示关闭；主控是 `outputBudgetRatio` |
| `summaryHardTrim` | `false` | 清单收到最紧之后摘要还是超上限时，是否连正文一起裁掉（默认只收紧清单并告警） |
| `sensitivePatterns` | 见上 | 命中即计数但不列出。**请把你自己的私密目录加进来** |
| `piDistDir` | 自动 | 自检找不到 Pi `dist/` 时才需要；也支持环境变量 `PI_CODING_AGENT_DIST` |

---

### 指定压缩模型

核对基线：[`cdbfb9d91419594e32d40d686c4b286e0410543e`](https://github.com/Pure-island/pi-compaction-files/commit/cdbfb9d91419594e32d40d686c4b286e0410543e)。
核对范围：`extensions/index.ts` 中的模型选择和请求级输出预算。

在 `~/.pi/pi-compaction-files.json` 中配置，例如：

```json
{
  "compactModel": "openai-codex/gpt-6-luna",
  "compactThinking": "medium"
}
```

使用 Pi 注册列表中可用的模型。只改变摘要请求，不切换对话模型，也不改变压缩触发点或保留消息的
选择。手动、阈值和溢出恢复压缩使用同一配置，`/compact` 的附加指令仍生效。普通非分段压缩生成
一次摘要；Pi 原生 split-turn 流程可能分别生成历史摘要和当前轮前缀摘要。

`/filelist` 显示配置模型；每次压缩日志显示实际模型和思考强度，
`details.fileListIndex.compactModel` 记录实际使用的模型。模型格式无效、模型不存在、鉴权错误或
请求失败时，会告警并交还 Pi，以当前对话模型执行原生压缩。此回退不会通过本钩子裁剪持久化摘要，
但后续请求中的 `context` 钩子仍会缩短文件清单。当前对话模型也需要有效凭据，因为 Pi 会先解析
它的鉴权，再调用压缩钩子。

## 效果

### 对比 Pi 默认（101 条真实原生压缩实测）

实测拟合增长斜率：**每次压缩 +1,108 B**，无上限。

| | 清单字节数 | 每次调用 token |
|---|---|---|
| Pi 默认（装上本扩展那个时点） | 110,924 B | 27,731 |
| Pi 默认（再推 40 次压缩） | 155,234 B | 38,809 |
| 本扩展 | 1,594 B | 399 |

清单上限是 `keepModified + keepRead`，**与压缩次数无关**。

### 0.1.0 vs 0.2.0（同一份真实数据并排跑）

| 压缩 | 输入 | 0.1.0 输出 | 0.2.0 输出 | 残留块 0.1.0 → 0.2.0 |
|---|---|---|---|---|
| 最近 6 次里的 5 次 | — | 完全相同 | 完全相同 | 1→1, 2→2, 1→1, 1→1, 1→1 |
| 有被抄块的那一次 | 33,424 | 33,424 | **33,281** | **3 → 1** |

5/6 输入本来已经干净，所以没有回归；第 6 次正是 0.2.0 存在的理由。

按观测参数推演（原生 +1,108 B/次；被抄块 1,594 B，11 次接管里出现 1 次）：

| +N 次压缩 | Pi 默认 | 0.1.0 按观测率 | 0.1.0 最坏（每次都抄） | **0.2.0** |
|---|---|---|---|---|
| 5 | 116 KB | 2,319 B | 9,564 B | **1,594 B** |
| 20 | 133 KB | 4,492 B | 33,474 B | **1,594 B** |
| 40 | 155 KB | 7,390 B | 65,354 B | **1,594 B** |

### 扩展自身的开销

实测：冷路径（无缓存，含每条路径 `statSync`）**0.43 ms**；热路径（命中缓存，只做签名）
**0.0002 ms**。正常每轮走的是热路径，可忽略。

完整方法与口径说明见 [docs/benchmark.md](./docs/benchmark.md)（英文）。

---

## 与其他上下文类扩展共存

本 fork 接管原生压缩，也通过 `context` 钩子缩短文件清单。其他阶段的扩展可以共存，
但应确认各自的钩子职责。

`pi-zip` 从它那边也给出了同样结论：

> An extension that only writes Pi's compaction summaries (a `session_before_compact`
> handler) does not pause pi-zip.

不要同时启用本 fork、`pi-compaction-model`、上游版本或其他为同一事件返回
`session_before_compact` 结果的扩展。Pi 会独立调用各处理器并采用最后一个覆盖结果，
不会把前一个摘要传给后一个继续处理。

---

## 安全性

- **绝不 cancel 压缩。** 任何出错都返回 `{}`，Pi 走原生路径，行为不受影响。
- **绝不写你的会话文件。** `context` 钩子每轮在内存里改；`session_before_compact` 只是返回
  一个 hook 结果，由 Pi 按正常方式持久化。
- **没有遥测。** 模型请求通过 Pi 已配置的 provider 发出，不增加分析上报或其他网络请求。
- **卸载即完全回滚。** 旧摘要在会话文件里原样保留。
- **失败预算。** 连续 2 次失败后本进程停用，交回 Pi。

---

## 已知边界（请读）

- **依赖 Pi 内部行为。** 三条：`fromHook` 继承守卫、`details` 不渲染进上下文、`context` 钩子
  就地改消息。第一条有文档保证，后两条不是契约。Pi 升级可能改掉。真发生时扩展不会崩，
  只会**静默失效** —— 所以加载时会自检并 log 告警。升级 Pi 后请看一眼 stderr，或跑 `/filelist`。
- **不影响 Pi 的压缩触发点。** Pi 用自己的条目投影（`agent-session.js:422`）决定何时压缩，
  不看改写后的 prompt。缩短摘要让真实 prompt 变小，但不会移动 Pi 的触发线。
  接管压缩本身会缓解这点（新摘要本来就小）。
- **有意丢信息。** 已删除的路径从清单消失，清单有条数上限。摘要正文仍会提到关键文件。
  要完整清单就设 `tool: true` + `archiveSensitive: true`，用 `session_files` 检索。
- **`style: "index"` + `tool: true` 作者没在生产环境跑过**；`indexRecent` 上限只是离线量出来的。
- **存档过滤不追溯。** 旧条目保持原样。

---

## 开发

```bash
npm test              # 纯逻辑，不需要会话数据
npm run test:plugin   # 已有 mock Pi 钩子链
npm run test:integration # 真实 Pi RPC + 本地 HTTP provider，不调用付费模型
npm run privacy       # 防止把个人路径 / 会话 ID 发出去
npm run check         # 隐私检查 + 已有离线 harness
```

`test/plugin-load.mjs` 用 mock 的 `compact()` 和一次性 `HOME` 加载扩展，
所以既不读开发者自己的配置，也不调模型。用 `PLUGIN_PKG=/path/to/pkg` 可以指向另一份副本测。

`test:integration` 需要已安装 Pi 依赖，或将 `PI_CODING_AGENT_CLI` 指向 Pi 的 `dist/cli.js`。
全局 npm 安装时，可在 PowerShell 中运行：

```powershell
$env:PI_CODING_AGENT_CLI = Join-Path (npm root -g) '@earendil-works/pi-coding-agent/dist/cli.js'
npm run test:integration
```

它覆盖模型与 provider 路由、鉴权、思考强度、输出限额、Windows 路径裁剪、摘要持久化和失败回退。
测试创建并清理隔离环境，不读取用户配置或会话。

想在自己机器上量一遍，见 [docs/verify-it-works.md](./docs/verify-it-works.md)。

---

## 许可

MIT，见 [LICENSE](./LICENSE)。

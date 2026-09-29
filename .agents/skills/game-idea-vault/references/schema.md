# 拾念资料协议 v1

资料仓库独立于 PWA 应用仓库。仓库须已有初始提交（创建时添加 README 即可）。所有客户端共用以下格式。

```text
idea-vault.json
ideas/
  <topic-id>/
    topic.json
    modules/
      <module-id>.md
```

`idea-vault.json`：

```json
{"schemaVersion":1,"app":"idea-vault"}
```

主题和模块 ID 为稳定 UUID 或 `[a-zA-Z0-9_-]{1,80}`，不包含中文、斜杠或点。改标题不改 ID。日期为可解析的 ISO 8601 字符串。

`topic.json`：

```json
{
  "id": "forest",
  "title": "回声森林",
  "description": "通过声音改变森林的探索解谜游戏。",
  "tags": ["探索", "解谜"],
  "createdAt": "2026-09-29T00:00:00.000Z",
  "updatedAt": "2026-09-29T00:00:00.000Z"
}
```

模块 Markdown 的头部使用**单行 JSON**（JSON 也是有效的 YAML flow mapping），格式固定为：

```markdown
---
{"id":"sound-loop","title":"声音驱动探索","type":"gameplay","status":"confirmed","reason":"先验证一个清晰的核心循环","source":"与用户讨论后确认","createdAt":"2026-09-29T00:00:00.000Z","updatedAt":"2026-09-29T00:00:00.000Z"}
---

观察环境 → 尝试发声 → 发现变化 → 打开新路径。

- 第一段体验只引入一种声音和一种植物。
- 不加入战斗。
```

字段限制：标题非空、最多 200 字符；主题描述 / reason / source 最多 4000 字符；正文最多 200000 字符；标签最多 20 个，每个最多 40 字符。首版最多 2000 个资料文件；单文件最多 300000 UTF-8 字节。中文内容接近限制时优先按字节限制拆模块。

type：`gameplay`、`experience`、`art`、`tech`、`question`、`other`。
status：`confirmed`（用户明确采用）、`exploring`（未决）、`rejected`（废案，仅保留必要理由）。

创建模块时保留 createdAt，更新时只变 updatedAt；修改模块时同步更新所属 topic.json 的 updatedAt。主题标签与其他未知的元数据字段应保留。

## 写入与删除

- 一次逻辑变更应将主题与模块放在同一次 Git 提交中，避免可见的半成品状态。
- 删除模块：删除对应 .md，更新主题日期。删除主题：删除 topic.json 及其全部模块。
- Git 历史中仍会保留旧内容；应用删除不等于清除历史。
- 不写入 ideas/ 下的其他格式；仓库的 README、技能文件等放在该目录之外。
- `idea-vault.json` 标记保留，即使已删除最后一个主题。

## API 客户端

先读取分支 HEAD 以及该提交对应 tree；以该 HEAD 固定后续读取。创建 tree 时必须携带 `base_tree`，增改文件用 UTF-8 `content`，删除用 `sha: null`，不能同时传这两个字段。创建 commit 的 parents 只能包含刚读取并据其内容修订的 HEAD。最后 PATCH 分支 ref，设置 `force: false`。远端前进导致失败时重新读取并处理冲突，禁止强制更新。

PWA 将整份主题（元信息和模块）视为冲突边界，使用基线、本机、GitHub 三方比较。两端同改一个主题时人工选择整个主题版本；不同主题可自动合并。删除主题与另一端修改其模块也必须作为冲突处理。

接续上下文默认包括 confirmed 和 exploring，排除 rejected。备份格式为 `{"app":"idea-vault-backup","schemaVersion":1,"exportedAt":"ISO 日期","files":{"相对路径":"UTF-8 文件内容"}}`。

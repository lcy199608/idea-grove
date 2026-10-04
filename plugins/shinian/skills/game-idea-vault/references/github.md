# GitHub 插件工作流

使用 connection.md 解析出的仓库和分支，除非用户本次明确覆盖。先发现当前 GitHub 插件实际工具与参数，不依赖旧 GPT Actions。以下是当前连接器能力映射；若目标平台的工具不同，按相同协议调用它提供的等价能力。

## 读取一致快照

1. 使用 GitHub `fetch` 的 GET 能力读取 `https://api.github.com/repos/<owner>/<repo>/git/ref/heads/<branch>`，得到 HEAD。分支路径按 URL 编码，后续全部固定在该提交，避免混入不同版本。
2. GET `/repos/<owner>/<repo>/git/commits/<HEAD>` 获取 tree SHA；GET `/repos/<owner>/<repo>/git/trees/<tree-SHA>?recursive=1` 获取文件目录。返回 truncated 时逐层读取子树补全；不要把代码搜索无结果当作空库。
3. `fetch_file(repository_full_name, path, ref=HEAD)` 读取 `idea-vault.json` 和 `ideas/<topic-id>/topic.json`。列主题只需主题元数据；统计模块数量可用树路径。接续时再读取相关 modules/*.md 和 topic.json.references 索引；精确分析按索引读取相关文件，见 reference-materials.md。
4. `fetch` 可返回包裹的 JSON 文本；按实际输出提取内容。Git blobs/contents API 返回 Base64 时可靠解码；不猜测原文、字节或 SHA。`fetch_file` 若提供完整 UTF-8 正文优先使用它。返回被截断时继续读取，取得完整文件再编辑。
5. 缺少资料标记且没有 ideas/ 资料，报告远端尚未建立拾念资料。若已有 ideas/ 但无标记，报告格式问题，不覆盖。404 时读取仓库元信息或根目录区分权限、错误分支与文件缺失；不可访问时不改用公开搜索猜测私有内容。

## 写入一个原子提交

仅在用户已明确要求保存或删除且范围明确时执行；普通讨论/整理预览不创建 tree、commit 或分支。

1. 重新读取最新 HEAD 和相关文件，保留讨论基线。如果同一内容已在远端变化，比较基线、拟写版本和远端：不相关变化保留，真实冲突由用户决定。采用最新 HEAD 作为唯一父提交。
2. 有聊天参考图时，先按 chat-images.md 准备并上传真实图片 blobs；必须图片失败则停止，不能只提交其正文引用。按 schema.md 准备全部文件变化。保留 ID、createdAt、未知字段和图片；更新模块及所属主题 updatedAt。纯文字新库创建 v1 标记，已有 v2/v3 不降级。不修改 README、应用源码、工作流或其他路径。
3. `create_tree(repository_full_name, base_tree_sha=<最新 commit.tree.sha>, tree_elements=[...])`。新增/更新文字用 `{path, mode:"100644", type:"blob", content:"完整 UTF-8 正文"}`；删除已有文件用 `{path, mode:"100644", type:"blob", sha:null}` 且不传 content。新图片及参考二进制文件 tree 条目使用 create_blob 返回的 SHA；未改图片通过 base_tree 保留，不能把二进制图片当文字写入。
4. `create_commit(repository_full_name, message, tree_sha=<新 tree>, parent_sha=<最新 HEAD>)`；不增加其他父提交。
5. `update_ref(repository_full_name, branch_name=<配置分支>, sha=<新 commit>, force=false)`。此调用成功才表示资料库分支已保存。返回真实提交链接 `https://github.com/<owner>/<repo>/commit/<SHA>`，不要仅报告 tree/commit 创建成功。
6. 分支更新因并发被拒绝：重新读取远端，仍无冲突时最多再合并重试一次；有冲突或再次失败则保留拟写内容并说明，不 force。超时导致结果未知时只读查询当前分支及提交关系/对应文件，确认实际状态后再决定后续，不盲目重复提交。

缺少 tree / commit / 非强制 ref 更新能力时，不退化为逐文件写入一次多文件变更，以免拾念拉到不完整主题。说明缺少的能力，保留拟写内容；可在用户同意后换本地 Git 原子提交。安装技能不会增加 GitHub OAuth 权限，平台授权弹窗仍需正常处理。

## 最终回复

- 只读：主题名称、简述和需要用户选择的问题；资料未上传时说明，不编造主题。
- 整理：清楚列出待保存变化，末尾明确“尚未写入”。
- 保存：变化摘要、提交链接、“拾念点拉取即可看到”；不承诺自动同步用户所有聊天或关闭后继续工作。

## 参考资料补充

通用参考文件实际保存为原始字节，topic.json.references 记录SHA-256、用途和来源。UTF-8资料可通过 fetch_file 获取全文；二进制用blob原字节通道，不把工具返回的截断显示冒充完整文件。大输出分段读取或使用可用文件运行时；metadata和内容哈希需对应。文件、索引、主题更新与v3标记属于同次提交。更新ref成功后才能报告已跨设备归档。

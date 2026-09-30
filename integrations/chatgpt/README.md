# ChatGPT 接入拾念

## 推荐：GitHub 插件 + 拾念 Skill

已有 GitHub 插件时，可以使用 `.agents/skills/game-idea-vault/` 中的规则，无需 GPT Actions，也无需服务器。默认资料库通过技能内 `references/repository.json` 固定为 `lcy199608/game-ideas`、分支 `main`；不含令牌。

- 当前 Mac 已安装本地 Skill，可以在 Codex / 本地技能可用的界面选择「拾念」。
- 网页和手机需要一次云端插件创建；本地安装不会自动出现在手机。
- 在 ChatGPT 的 @ 菜单查找 **Plugin Creator**，附上本次生成的「拾念-ChatGPT插件说明.txt」或完整技能包，请它创建仅自己使用的「拾念」插件，包含已连接的 GitHub 应用和整理技能。说明文件已含默认仓库、工作流、资料格式和原子提交规则。
- 只有创建完成、能选到 `@拾念` 并具备对应 GitHub 工具后，才能按配置直接读取和保存。若账号没有 Plugin Creator，则保留素材包，不能声称已经云端安装；桌面可继续使用本地 Skill。
- 不把技能放入旧 GPT 的「知识」来冒充工具连接，不在聊天/文件中填写 GitHub 令牌。

创建完成后的日常用语：

> @拾念 打开我的创意库。
>
> @拾念 继续讨论回声森林，先不保存。
>
> 整理本次讨论，给我看拟保存内容。
>
> 保存第 1、3 项；第 2 项作为待探索；其余不保留。

“整理”默认只预览；“保存”才写入，完成后返回提交链接。回到拾念点「拉取」。GitHub 插件写入能力及手机端体验需人工验收，本次未运行测试或修改资料库。

官方参考：[构建技能](https://learn.chatgpt.com/docs/build-skills)、[创建插件](https://learn.chatgpt.com/docs/build-plugins)。

## 可选：私人 GPT Actions

这条路线使用 ChatGPT 的自定义 GPT Actions 直接调用 GitHub API，不需要自建 MCP 或中转服务器。

**当前交付了指令、OpenAPI 模板及生成器，尚未进行真实账号联调。** 必须在你的账号内按人工验收清单确认 Actions 可用、认证成功、读取解码与写入链路成功。普通聊天不会自动获得此 GPT 的能力。

如果官网 GPT 编辑器的「配置」页底部没有 Actions，不要继续寻找同一入口，也不要把 JSON 上传到「知识」代替连接。账号套餐名称本身不能确认接口可用；这份私人 GPT 的 GitHub 直连尚未启用，可使用上面的 GitHub 插件 + Skill 路线。

## 1. 生成你自己的 Actions 配置

两种方式任选其一：

- 应用中配置好资料仓库后，打开「与 AI 一起创作」，点击「下载本仓库 Actions 配置」和「下载 GPT 指令」。下载不含令牌。
- 在项目目录执行以下**文件生成命令**，替换所有者和仓库名称：

```sh
python3 scripts/configure_gpt.py --owner YOUR-NAME --repo game-ideas --branch main
```

生成 `integrations/chatgpt/openapi.local.json`，该文件默认已被 .gitignore 排除。模板位于 `web/integrations/chatgpt-openapi.template.json`；其中 YOUR-OWNER、YOUR-REPO、VAULT_BRANCH 仅为占位符，不能直接连接真实仓库。

## 2. 在 ChatGPT 创建仅自己可用的 GPT

1. 创建私人自定义 GPT，例如「拾念 · 游戏创意助手」。实际入口取决于账号提供的 GPT 编辑功能。
2. 将 `web/integrations/chatgpt-instructions.md` 的完整文字填入 Instructions。
3. 开启 **Code Interpreter / 数据分析**。GitHub 返回的 blob 内容为 Base64，指令要求通过代码准确解码 UTF-8，而不是让语言模型猜测编码。
4. 添加 Action，将生成的 openapi.local.json 导入 Schema。
5. 在 Action 的 Authentication 里配置 **API Key / Bearer**，填写一个只授权资料仓库、具有 Contents 读写权限的 fine-grained GitHub PAT。若当前编辑器没有对应认证入口，停止并按实际能力调整，不能把令牌塞进 Schema、Instructions 或聊天。
6. 保存为 **仅自己可用**。这个版本使用 GPT 级别凭据；不要将带有个人写权限的 GPT 分享给他人。将来多人使用需改为每人独立 OAuth 授权，或每人各自建立私人 GPT。

GPT 和 PWA 可以使用分别创建的令牌，便于独立撤销。不要把令牌提交到应用仓库或资料仓库。

## 3. 人工验证读写

先用独立的空白资料仓库（已有 README）人工验证：

> 读取资料仓库并列出已有主题，暂时不修改。

> 创建一个名为「人工验收示例」的主题，将「使用单一核心循环验证玩法」作为待探索模块保存到 GitHub。

应依次发生读取 HEAD / commit / tree，准备 tree，创建 commit，最后非强制更新 branch ref。最终回复应给出提交链接。回到 PWA 拉取后应看到主题与模块，中文内容完整。

只有创建 tree 或 commit 成功，而最后更新 ref 失败，**不能报告已经同步**。并发更新时需要重新读取并处理冲突。

## 能力边界

- 仅此私人 GPT 内的聊天可使用所配置的 Actions；不会监听所有 ChatGPT 对话。
- 手机端是否能执行配置好的 Actions、具体授权弹窗和 Code Interpreter 可用性，以你的账号实际界面和人工验收结果为准。
- 平台可能要求写入确认；指令不绕过平台权限。
- 工具调用有请求大小、超时等限制；每次写入保持为少量相关模块，不用一个巨大文件存完整聊天。
- schema 固定仓库和分支，但路径约束主要由 schema 与指令表达；GitHub PAT 实际授权粒度仍是仓库级。使用独立资料仓库，避免把源码放在同一授权范围。
- 配置兼容 v1 文字资料与 v2 图片附件。修改文字必须保留 attachments；删除模块/主题需同时删除其附件。已有图片依靠 base_tree 保留；新图片由拾念上传，当前 Actions 不提供聊天图片自动上传接口。
- 图片路径和说明不等于图片像素。GPT 若没有实际读取/显示图片的能力，请从拾念下载图片并上传到对话，不能仅凭文件名声称看过图片。
- 如果 Actions 当前不可用，可先在 Codex 完成直接同步，或用 PWA 的「接续上下文」与备份导入导出。不能把这视为 ChatGPT 自动同步已经完成。

## 官方参考

- [GPT Actions](https://developers.openai.com/api/docs/actions/introduction)
- [Actions 认证](https://developers.openai.com/api/docs/actions/authentication)
- [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees)
- [GitHub Git References API](https://docs.github.com/en/rest/git/refs)

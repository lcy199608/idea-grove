# 拾念 · 游戏创意档案

把散落在 ChatGPT 和 Codex 对话里的游戏创意，沉淀为可以继续的项目资料。

一套桌面 / 手机共用 PWA，GitHub 保存资料，不需要自建服务器、数据库或模型 API Key。

**交付状态：代码与接入配置已编写；遵照项目要求，未运行测试、浏览器验收或真实 GitHub/GPT 联调。尚未部署到 GitHub。**

## 在本机打开

需要 Python 3.9 或更新版本。在项目根目录执行：

```sh
python3 scripts/serve.py
```

浏览器打开 <http://localhost:4173>。此命令仅在自己的电脑启动静态预览，不是要购买或维护一台服务器。不要直接双击 index.html 使用 file://，ES Modules、IndexedDB、Service Worker 和 Web Locks 需要合适的浏览器环境。

先点「看看示例」了解界面，或「创建第一个主题」从空白开始。示例只有点击后才进入本地资料，允许编辑、删除，不会自动上传。

## 功能

- 主题创建、编辑、标签与删除。
- 模块创建、编辑、删除、搜索、状态筛选和 Markdown 阅读。
- 已确认 / 待探索 / 已放弃；接续上下文默认排除已放弃内容。
- 项目概览、上下文复制与 Markdown 下载。
- 本地资料与编辑草稿保存在 IndexedDB；支持离线编辑。
- GitHub 手动拉取 / 上传，三方比较、按主题处理冲突，整批修改作为一次提交上传。
- 删除与另一端修改相遇时显示冲突，避免旧设备悄悄恢复删除内容。
- 资料备份导入 / 导出、冲突副本下载、导入前恢复副本。
- 单个来源只允许一个编辑窗口，避免本地多标签页覆盖草稿。
- 内置私人 GPT 指令与按当前仓库生成的 Actions 配置下载。
- 可安装的 PWA、响应式布局、应用图标与静态离线缓存。

## 首次接入 GitHub

1. 创建一个**私有资料仓库**，例如 `game-ideas`，勾选添加 README，使 `main` 分支已经存在。
2. 在 GitHub 创建 fine-grained personal access token，仅选择该仓库，给予 **Contents: Read and write**。
3. 在应用「同步设置」填写所有者、仓库名、分支与令牌。
4. 点击「拉取」读取资料。如果在连接前已写了本地内容，可以在首次连接时勾选带上这些资料。
5. 编辑后点击「上传」。其他设备点击「拉取」接续。

点击「保存并记住登录」后，令牌保存在当前设备、当前浏览器的 IndexedDB 独立凭据区，刷新页面、关闭后重开及重启浏览器都会自动恢复。应用不设登录有效期；GitHub 令牌自身到期、撤销、权限变更，以及浏览器清理站点数据仍会影响登录。每个设备首次填写一次，凭据不会随 GitHub 或备份同步。

在「同步设置 → 清除此设备全部登录」可主动移除所有已保存仓库的凭据，同时保留仓库设置、主题、草稿与备份。「切回本地空间」只切换工作区，不清除登录；再次填写已保存的仓库所有者与名称会恢复令牌。凭据不进入资料文件、导出备份、Git 提交或日志；这只清除本机记忆，不会撤销 GitHub 上的令牌或其他设备的登录。

旧版选择了会话记住且当前标签页还持有凭据时，升级后会迁移到长期存储；旧版仅在内存中保存的令牌，需要重新填写并保存一次。应用会尝试申请浏览器持久存储，但无痕模式、系统回收或人为清理数据无法由应用保证。不要把令牌发在聊天中。

仓库 / 分支各有独立本地工作区。切换仓库不会把另一份仓库的旧草稿混入；切回同一仓库会恢复该设备已有草稿。未连接空间的资料也独立保留。

## 发布到 GitHub Pages

使用两个仓库：

- **应用仓库**：本项目源码，用 GitHub Pages 发布 web/。GitHub Free 需要公开应用仓库。
- **资料仓库**：始终独立且私有，只有授权后通过 API 读取，不能复制进 web/。

本项目已提供 `.github/workflows/pages.yml`，只上传 `web/` 静态资源，不执行测试或构建。

1. 将本项目源码上传到你用于发布的 GitHub 仓库，默认分支使用 `main`。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. 在 Actions 中手动运行 **Publish PWA to GitHub Pages**，或提交 web/ 的修改触发发布。
4. 工作流完成后，打开 Pages 提供的网址。
5. 在手机打开同一网址，并通过浏览器菜单添加到主屏幕。支持 PWA 安装的桌面浏览器也可安装。

若默认分支不是 main，需要同步修改工作流的触发分支。应用使用相对地址，同时适配 `username.github.io/` 与 `username.github.io/project/`。应用每次发布修改缓存资源时，应提升 web/sw.js 的 CACHE 版本；关闭所有旧窗口再打开应用以启用新版本。

仓库首次创建、发布、GitHub 授权与 GPT 配置需要你的账号操作。项目当前没有绑定任何账号、仓库地址或令牌。

## 连接 AI

- [Codex Skill 安装与使用](docs/codex.md)
- [私人 GPT Actions 配置](integrations/chatgpt/README.md)
- [统一资料协议](.agents/skills/game-idea-vault/references/schema.md)
- [人工验收清单](docs/manual-acceptance.md)
- [架构与边界](docs/architecture.md)

日常流程：读取最新资料 → 讨论 → 明确采用 → AI 保存并同步 → 应用拉取。

应用自身不调用模型；智能提炼由你正在使用的 ChatGPT 或 Codex 完成。没有安装接入能力的普通聊天，可以通过「接续上下文」复制 / 下载继续。

## 目录

```text
web/                          可直接发布的静态 PWA
  src/model.js                数据协议、上下文、三方合并
  src/storage.js              IndexedDB
  src/github.js               GitHub API 与原子提交
  src/app.js                  交互界面
  integrations/               GPT 指令与 Actions 模板
.agents/skills/game-idea-vault/ Codex Skill、资料协议、Python 助手
integrations/chatgpt/          GPT 配置说明
scripts/                      本地预览、图标生成、GPT 配置生成
.github/workflows/pages.yml    Pages 发布
docs/                         架构与人工验收
```

无需安装 Node 包、无需构建、无外部字体或前端第三方脚本。

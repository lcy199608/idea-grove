# Codex 接入

本项目的 `.agents/skills/game-idea-vault/` 已包含可复用 Skill。要让其他项目中的 Codex 也能使用，可将整个文件夹复制到个人技能目录：

```sh
mkdir -p ~/.codex/skills
cp -R .agents/skills/game-idea-vault ~/.codex/skills/
```

如果目标目录已经存在，先查看现有内容再决定更新，不要直接覆盖自己的定制。也可只把技能放到资料仓库的 `.agents/skills/` 目录中作为项目技能；该目录不属于需要沉淀的 ideas/ 数据。

安装后开启新聊天，让 Codex 加载技能。

## 准备资料仓库

1. 在 GitHub 创建私有仓库，添加 README。
2. 在电脑上完成 Git 认证（例如 GitHub CLI 登录或已有 SSH 配置）。
3. 克隆该仓库，保留原有 upstream。给 Codex **资料仓库的本地绝对路径**。

例：

> 使用 $game-idea-vault，资料仓库位于 /你的绝对路径/game-ideas。先读取最新资料，继续讨论回声森林。

讨论后：

> 采用我们刚才确定的声音反馈方案，更新核心玩法模块，并同步到 GitHub。

用户已明确要求保存和同步时，技能直接在该范围内执行。只是头脑风暴时不擅自写入。

## 助手脚本

脚本位于技能目录的 scripts/vault.py，需要 Python 3.9+ 和 Git，无额外依赖。

```sh
python3 /技能目录/scripts/vault.py --repo /资料仓库 list
python3 /技能目录/scripts/vault.py --repo /资料仓库 context --topic 主题ID
```

写入命令由 Skill 按上下文调用。修改已有模块时传稳定的模块 ID；正文通过 UTF-8 文件传递。脚本不会调用 AI 或保存聊天记录。

`pull` 只在工作区干净时执行快进拉取。`push` 仅暂存资料文件，已有暂存内容或未推送的无关提交会导致停止；推送只针对明确配置的 upstream 分支，绝不 force。被拒绝时，本地修改 / 提交保留，人工或 AI 在明确授权下解决差异后再继续。

主题元数据也可以按协议直接编辑。所有客户端必须保留未知元数据字段，不能通过重建整个仓库来更新一个模块。

## 在应用中看到 AI 更新

只有 push 成功后，GitHub 才有新版本。应用点击「拉取」后读取新版本；如果本机同时编辑了同一主题，则进入冲突选择。

这里没有自动安装到你的全局技能目录，也没有克隆或推送任何资料仓库；需要先指定真实仓库并完成认证。

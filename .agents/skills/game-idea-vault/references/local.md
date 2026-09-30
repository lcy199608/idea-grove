# 本地 Git 工作流（可选）

用户指定的本地目录必须是资料仓库；检查 origin/upstream 与 repository.json 或本次明确指定的仓库对应。不使用应用源码工作区保存创意。

使用技能目录的 scripts/vault.py；支持 Python 3.9+ 和 Git，无额外依赖。未指定本地路径时优先使用 GitHub 插件，不因目录未知反复询问仓库链接。确需克隆时，在用户授权范围内选择独立目录，不覆盖已有工作区。

开始接续时先查看 Git 状态。有未提交修改或分歧则保留并说明；工作区干净、已授权同步时调用 pull 快进拉取。不能 reset、stash 或强制覆盖。仅讨论时不 push。

```sh
python3 /技能目录/scripts/vault.py --repo /资料仓库 list
python3 /技能目录/scripts/vault.py --repo /资料仓库 context --topic TOPIC_ID
python3 /技能目录/scripts/vault.py --repo /资料仓库 create-topic --title '游戏名' --description '一句话描述'
python3 /技能目录/scripts/vault.py --repo /资料仓库 upsert-module --topic TOPIC_ID --title '模块名' --type gameplay --status confirmed --body-file /absolute/body.md --reason '采用原因'
python3 /技能目录/scripts/vault.py --repo /资料仓库 upsert-module --topic TOPIC_ID --module MODULE_ID --title '模块名' --type gameplay --status confirmed --body-file /absolute/body.md
python3 /技能目录/scripts/vault.py --repo /资料仓库 delete-module --topic TOPIC_ID --module MODULE_ID
python3 /技能目录/scripts/vault.py --repo /资料仓库 delete-topic --topic TOPIC_ID
python3 /技能目录/scripts/vault.py --repo /资料仓库 pull
python3 /技能目录/scripts/vault.py --repo /资料仓库 push --message '沉淀已确认的内容'
```

正文通过 UTF-8 文件传递，避免 shell 转义。省略 reason/source 保留原值，传空字符串清空。context 默认排除 rejected，--confirmed-only 仅输出已确认内容。聊天参考图可按 chat-images.md 准备，在资料库写入真实图片并将附件元数据与正文同次更新；vault.py 本身不提供图片插入命令。脚本保留附件元数据，删除模块/主题会同时删除关联图片。

一次逻辑变更准备完成后统一 push。脚本只暂存资料路径，已有暂存内容或无关未推送提交时停止；只推明确 upstream，不 force。若 upstream 不同于配置分支，先说明，不偷偷更改远端或分支。push 成功才返回远端提交链接；失败保留本地工作。

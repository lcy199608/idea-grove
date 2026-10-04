#!/usr/bin/env python3
"""Build the cloud-compatible Shinian plugin ZIP; does not run tests or access GitHub."""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / '.agents/skills/game-idea-vault'
target = ROOT / 'plugins/shinian'
skill = target / 'skills/game-idea-vault'
skill.mkdir(parents=True, exist_ok=True)
(skill / 'references').mkdir(exist_ok=True)
(skill / 'agents').mkdir(exist_ok=True)
text = (source / 'SKILL.md').read_text()
text = text.replace('纯本地环境可使用 references/repository.json 的个人配置，但公共插件不携带个人默认地址。', '本插件不携带个人默认地址，不依赖本地文件或常驻电脑。')
text = '\n'.join(line for line in text.split('\n') if not line.startswith('- 用户明确指定本地资料仓库'))
(skill / 'SKILL.md').write_text(text)
for name in ('connection.md', 'github.md', 'schema.md', 'chat-images.md', 'reference-materials.md'):
    shutil.copyfile(source / 'references' / name, skill / 'references' / name)
(skill / 'scripts').mkdir(exist_ok=True)
for name in ('prepare_reference.py', 'read_blob_chunk.py', 'prepare_material.py'):
    shutil.copyfile(source / 'scripts' / name, skill / 'scripts' / name)
shutil.copyfile(source / 'agents/openai.yaml', skill / 'agents/openai.yaml')
(target / 'assets').mkdir(exist_ok=True)
shutil.copyfile(ROOT / 'web/icons/icon-192.png', target / 'assets/icon.png')
interface = {
    'displayName': '拾念',
    'shortDescription': '接续游戏创意，整理共识，同步 GitHub',
    'longDescription': '通过已连接的 GitHub 共用拾念资料。首次配置仓库，后续从云端找回。支持参考文件归档、解析结果索引与版本记录；按需读取资料接续讨论。具备原文件通道时同次保存附件与正文，明确未归档和待验证项，保留并发修改。',
    'developerName': 'Idea Grove',
    'category': 'Productivity',
    'capabilities': ['Read', 'Write'],
    'defaultPrompt': ['打开我的拾念创意库，只读取。', '整理本次游戏讨论，先不要保存。', '配置并记住我的拾念资料仓库。'],
    'logo': './assets/icon.png',
    'brandColor': '#42634B'
}
identity = {'name': 'shinian', 'version': '0.4.0', 'description': '跨设备游戏创意整理与 GitHub 资料同步'}
extension = {'apps': './.app.json', 'interface': interface}
manifest = {'$schema': 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', **identity, 'extensions': {'com.openai': extension}}
(target / 'plugin.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(target / '.codex-plugin').mkdir(exist_ok=True)
(target / '.codex-plugin/plugin.json').write_text(json.dumps({**identity, 'skills': './skills/', **extension}, ensure_ascii=False, indent=2) + '\n')
# Existing official GitHub app mapping, from the installed GitHub plugin.
(target / '.app.json').write_text(json.dumps({'apps': {'github': {'id': 'connector_76869538009648d5b282a4bb21c3d157', 'required': True}}}, indent=2) + '\n')
output = ROOT / 'web/integrations/shinian-plugin.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(target.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(target))
print(output)

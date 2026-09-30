#!/usr/bin/env python3
"""Read/write a local idea-vault repository. No third-party Python packages."""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

TYPES = {"gameplay", "experience", "art", "tech", "question", "other"}
STATUSES = {"confirmed", "exploring", "rejected"}
ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
IMAGE_PATTERN = re.compile(r"ideas/[a-zA-Z0-9_-]{1,80}/images/[a-zA-Z0-9_-]{1,80}/[a-zA-Z0-9_-]{1,80}\.(jpg|png|webp)")
MAX_IMAGE_BYTES = 1536 * 1024


def is_image(path):
    return bool(IMAGE_PATTERN.fullmatch(path))


def image_mime(path):
    return {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[path.rsplit(".", 1)[-1]]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def identifier(value):
    if not ID_PATTERN.fullmatch(value):
        raise ValueError("主题或模块 ID 格式不正确。")
    return value


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=False)
    if result.returncode:
        # Git output may contain a remote URL; never print auth-bearing URLs.
        message = re.sub(r"https?://[^\s/@]+(?::[^\s/@]+)?@", "https://[redacted]@", result.stderr.strip())
        raise ValueError(message or "Git 操作未完成。")
    return result.stdout


def atomic_write(path, content):
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("拒绝通过符号链接写入资料。")
    path.parent.mkdir(parents=True, exist_ok=True)
    if len(content.encode("utf-8")) > 300000:
        raise ValueError("文件超过 300000 UTF-8 字节，请拆分模块。")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".vault-", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(content)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def module_content(value):
    metadata = dict(value)
    body = metadata.pop("body").strip()
    return "---\n" + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n---\n\n" + body + "\n"


def read_module(path):
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n([^\n]+)\n---\n(?:\n)?([\s\S]*)$", text)
    if not match:
        raise ValueError(f"模块格式错误：{path.name}")
    value = json.loads(match.group(1))
    value["body"] = match.group(2).strip()
    return value


def validate_meta(value):
    identifier(value["id"])
    if not isinstance(value.get("title"), str) or not value["title"].strip() or len(value["title"]) > 200:
        raise ValueError("标题必须为 1–200 个字符。")
    for field in ("createdAt", "updatedAt"):
        datetime.fromisoformat(value[field].replace("Z", "+00:00"))


def text_limit(value, limit, name):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{name}格式错误或超过 {limit} 字符。")


def validate_topic(value):
    validate_meta(value)
    text_limit(value.get("description"), 4000, "主题描述")
    tags = value.get("tags")
    if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(tag, str) or len(tag) > 40 for tag in tags):
        raise ValueError("标签最多 20 个，每个最多 40 字符。")


def validate_module(value):
    validate_meta(value)
    if value.get("type") not in TYPES or value.get("status") not in STATUSES:
        raise ValueError("模块类型或状态不受支持。")
    text_limit(value.get("body"), 200000, "正文")
    for field in ("reason", "source"):
        text_limit(value.get(field, ""), 4000, field)
    attachments = value.get("attachments", [])
    if not isinstance(attachments, list) or len(attachments) > 10:
        raise ValueError("每个模块最多支持 10 张参考图。")
    for item in attachments:
        identifier(item["id"])
        text_limit(item["name"], 200, "图片名称")
        text_limit(item["caption"], 4000, "图片说明")
        if not is_image(item["path"]) or item["mimeType"] != image_mime(item["path"]):
            raise ValueError("图片路径或格式错误。")
        if any(type(item.get(key)) is not int or not 1 <= item[key] <= 2560 for key in ("width", "height")):
            raise ValueError("图片尺寸无效或超过 2560 像素。")
        if type(item.get("size")) is not int or not 1 <= item["size"] <= MAX_IMAGE_BYTES:
            raise ValueError("单张图片不能超过 1.5 MB。")
    if len(module_content(value).encode("utf-8")) > 300000:
        raise ValueError("模块超过 300000 UTF-8 字节，请拆分。")


def load(root):
    marker = root / "idea-vault.json"
    version = 1
    if marker.is_symlink():
        raise ValueError("资料标记不能是符号链接。")
    if marker.exists():
        value = json.loads(marker.read_text(encoding="utf-8"))
        if value.get("schemaVersion") not in (1, 2) or value.get("app") != "idea-vault":
            raise ValueError("资料库版本不受支持。")
        version = value["schemaVersion"]
    ideas = root / "ideas"
    if ideas.is_symlink():
        raise ValueError("ideas 不能是符号链接。")
    results = []
    count = 1 if marker.exists() else 0
    image_paths = set()
    total_images = 0
    for path in ideas.rglob("*") if ideas.exists() else []:
        if path.is_symlink():
            raise ValueError("资料不能是符号链接。")
        if not path.is_file():
            continue
        if not managed(path.relative_to(root).as_posix()):
            raise ValueError(f"ideas 中有不支持的文件：{path.name}")
        count += 1
        relative = path.relative_to(root).as_posix()
        size = path.stat().st_size
        if is_image(relative):
            if not 1 <= size <= MAX_IMAGE_BYTES:
                raise ValueError("图片为空或超过 1.5 MB。")
            with path.open("rb") as handle:
                header = handle.read(16)
            mime = image_mime(relative)
            valid = header.startswith(b"\xff\xd8\xff") if mime == "image/jpeg" else header.startswith(b"\x89PNG\r\n\x1a\n") if mime == "image/png" else header.startswith(b"RIFF") and header[8:12] == b"WEBP"
            if not valid:
                raise ValueError("图片格式与扩展名不一致。")
            image_paths.add(relative)
            total_images += size
        elif size > 300000:
            raise ValueError("文字资料文件超过 300000 字节。")
    if total_images > 40 * 1024 * 1024:
        raise ValueError("资料库图片总量超过 40 MB。")
    if image_paths and version != 2:
        raise ValueError("含图片的资料库需要 schemaVersion 2。")
    if count > 2000:
        raise ValueError("首版最多支持 2000 个资料文件。")
    referenced = set()
    if ideas.exists():
        for path in sorted(ideas.glob("*/topic.json")):
            topic = json.loads(path.read_text(encoding="utf-8"))
            validate_topic(topic)
            if topic["id"] != path.parent.name:
                raise ValueError("主题 ID 与路径不一致。")
            topic["modules"] = []
            for mod_path in sorted((path.parent / "modules").glob("*.md")):
                module = read_module(mod_path)
                validate_module(module)
                if module["id"] != mod_path.stem:
                    raise ValueError("模块 ID 与路径不一致。")
                for item in module.get("attachments", []):
                    expected = f"ideas/{topic['id']}/images/{module['id']}/{item['id']}.{item['path'].rsplit('.', 1)[-1]}"
                    if item["path"] != expected or item["path"] in referenced or item["path"] not in image_paths:
                        raise ValueError("图片缺失、重复或不属于当前模块。")
                    if (root / item["path"]).stat().st_size != item["size"]:
                        raise ValueError("图片文件大小与元数据不一致。")
                    referenced.add(item["path"])
                topic["modules"].append(module)
            results.append(topic)
        for path in ideas.glob("*/modules/*.md"):
            if not (path.parent.parent / "topic.json").exists():
                raise ValueError("发现缺少所属主题的模块。")
    if image_paths != referenced:
        raise ValueError("发现未关联到模块的图片。")
    if results and not marker.exists():
        raise ValueError("资料缺少 idea-vault.json 标记。")
    return results


def managed(path):
    return path == "idea-vault.json" or is_image(path) or bool(re.fullmatch(r"ideas/[a-zA-Z0-9_-]{1,80}/(?:topic\.json|modules/[a-zA-Z0-9_-]{1,80}\.md)", path))


def topic_by_id(topics, tid):
    identifier(tid)
    for topic in topics:
        if topic["id"] == tid:
            return topic
    raise ValueError("找不到指定主题。先使用 list 查看主题 ID。")


def write_topic(root, topic):
    metadata = {key: value for key, value in topic.items() if key != "modules"}
    validate_topic(metadata)
    write_json(root / "ideas" / identifier(topic["id"]) / "topic.json", metadata)


def main():
    parser = argparse.ArgumentParser(description="拾念资料库助手")
    parser.add_argument("--repo", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    sub.add_parser("pull")
    push = sub.add_parser("push")
    push.add_argument("--message", required=True)
    context = sub.add_parser("context")
    context.add_argument("--topic", required=True)
    context.add_argument("--confirmed-only", action="store_true")
    create = sub.add_parser("create-topic")
    create.add_argument("--title", required=True)
    create.add_argument("--description", default="")
    create.add_argument("--tags", default="", help="逗号分隔")
    update = sub.add_parser("upsert-module")
    update.add_argument("--topic", required=True)
    update.add_argument("--module")
    update.add_argument("--title", required=True)
    update.add_argument("--type", choices=sorted(TYPES), required=True)
    update.add_argument("--status", choices=sorted(STATUSES), required=True)
    update.add_argument("--body-file", type=Path, required=True)
    update.add_argument("--reason")
    update.add_argument("--source")
    remove = sub.add_parser("delete-module")
    remove.add_argument("--topic", required=True)
    remove.add_argument("--module", required=True)
    remove_topic = sub.add_parser("delete-topic")
    remove_topic.add_argument("--topic", required=True)
    args = parser.parse_args()
    root = args.repo.resolve(strict=True)
    if Path(git(root, "rev-parse", "--show-toplevel").strip()).resolve() != root:
        raise ValueError("--repo 必须是资料仓库根目录。")
    records = load(root)
    if args.command == "list":
        print(json.dumps([{key: value for key, value in topic.items() if key != "modules"} | {"modules": [{"id": module["id"], "title": module["title"], "status": module["status"]} for module in topic["modules"]]} for topic in records], ensure_ascii=False, indent=2))
        return
    if args.command == "context":
        topic = topic_by_id(records, args.topic)
        print(f"# {topic['title']}\n\n{topic['description']}\n\n已确认为当前共识，待探索尚未采用。")
        for module in topic["modules"]:
            if module["status"] == "rejected" or (args.confirmed_only and module["status"] != "confirmed"):
                continue
            print(f"\n## {module['title']} [{module['status']}]\n\n{module['body']}")
            if module.get("reason"):
                print(f"\n决策理由：{module['reason']}")
            if module.get("source"):
                print(f"\n来源：{module['source']}")
            for item in module.get("attachments", []):
                print(f"\n参考图：{item['name']}\n仓库路径：{item['path']}\n说明：{item['caption']}\n本地文件：{root / item['path']}")
        return
    if args.command == "pull":
        if git(root, "status", "--porcelain").strip():
            raise ValueError("工作区有未提交修改，保留现状。请先处理修改后再拉取。")
        print(git(root, "pull", "--ff-only").strip())
        load(root)
        return
    if args.command == "push":
        if git(root, "diff", "--cached", "--name-only").strip():
            raise ValueError("仓库已有暂存内容，停止以避免混入其他工作。")
        git(root, "rev-parse", "--verify", "HEAD")
        # Require a configured upstream; never guess a destination repository.
        git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        branch_ref = git(root, "symbolic-ref", "--quiet", "HEAD").strip()
        remote = git(root, "for-each-ref", "--format=%(upstream:remotename)", branch_ref).strip()
        remote_ref = git(root, "for-each-ref", "--format=%(upstream:remoteref)", branch_ref).strip()
        if not remote or remote == "." or remote.startswith("-") or not remote_ref.startswith("refs/heads/"):
            raise ValueError("需要配置明确的远端分支，不能使用本地 upstream。")
        unpublished = git(root, "log", "--format=", "--name-only", "-z", "@{upstream}..HEAD")
        if any(path.strip() and not managed(path.strip()) for path in unpublished.split("\0")):
            raise ValueError("已有未推送提交包含资料范围以外的文件。请人工处理，避免推送无关工作。")
        paths = set(git(root, "diff", "--name-only", "-z", "HEAD").split("\0"))
        paths.update(git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0"))
        selected = sorted(path for path in paths if path and managed(path))
        if selected:
            git(root, "add", "--", *selected)
            git(root, "commit", "-m", args.message)
        print(git(root, "push", remote, f"HEAD:{remote_ref}").strip() or "GitHub 推送完成。")
        print("HEAD:", git(root, "rev-parse", "HEAD").strip())
        return
    if args.command == "create-topic":
        timestamp = now()
        topic = {"id": str(uuid.uuid4()), "title": args.title.strip(), "description": args.description, "tags": list(dict.fromkeys(tag.strip() for tag in re.split("[,，]", args.tags) if tag.strip())), "createdAt": timestamp, "updatedAt": timestamp}
        validate_topic(topic)
        if not (root / "idea-vault.json").exists():
            write_json(root / "idea-vault.json", {"schemaVersion": 1, "app": "idea-vault"})
        write_topic(root, topic)
        print(json.dumps(topic, ensure_ascii=False, indent=2))
        return
    topic = topic_by_id(records, args.topic)
    if args.command == "upsert-module":
        if args.module:
            identifier(args.module)
            existing = next((module for module in topic["modules"] if module["id"] == args.module), None)
            if not existing:
                raise ValueError("指定模块不存在。新增模块请省略 --module。")
            module = dict(existing)
        else:
            module = {"id": str(uuid.uuid4()), "createdAt": now(), "reason": "", "source": ""}
        module.update({"title": args.title.strip(), "type": args.type, "status": args.status, "body": args.body_file.read_text(encoding="utf-8"), "updatedAt": now()})
        for field in ("reason", "source"):
            if getattr(args, field) is not None:
                module[field] = getattr(args, field)
        validate_module(module)
        atomic_write(root / "ideas" / topic["id"] / "modules" / f"{module['id']}.md", module_content(module))
        topic["updatedAt"] = now()
        write_topic(root, topic)
        print(json.dumps({"topic": topic["id"], "module": module["id"], "saved": "local"}, ensure_ascii=False))
    elif args.command == "delete-module":
        identifier(args.module)
        path = root / "ideas" / topic["id"] / "modules" / f"{args.module}.md"
        if not path.is_file():
            raise ValueError("指定模块不存在。")
        module = next(item for item in topic["modules"] if item["id"] == args.module)
        for item in module.get("attachments", []):
            (root / item["path"]).unlink()
        path.unlink()
        topic["updatedAt"] = now()
        write_topic(root, topic)
        print("模块已从本地删除，尚未推送。")
    elif args.command == "delete-topic":
        for module in topic["modules"]:
            for item in module.get("attachments", []):
                (root / item["path"]).unlink()
            (root / "ideas" / topic["id"] / "modules" / f"{module['id']}.md").unlink()
        (root / "ideas" / topic["id"] / "topic.json").unlink()
        print("主题及其模块已从本地删除，尚未推送。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"未完成：{error}", file=sys.stderr)
        sys.exit(1)

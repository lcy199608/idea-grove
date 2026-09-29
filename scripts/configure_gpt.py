#!/usr/bin/env python3
"""Generate a repository-scoped GPT Actions schema; no credentials or network."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote

parser = argparse.ArgumentParser(description="生成私人 GPT Actions 配置；不会连接 GitHub")
parser.add_argument("--owner", required=True)
parser.add_argument("--repo", required=True)
parser.add_argument("--branch", default="main")
parser.add_argument("--output", type=Path, default=Path("integrations/chatgpt/openapi.local.json"))
args = parser.parse_args()
if not re.fullmatch(r"[a-zA-Z0-9-]+", args.owner) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", args.repo) or args.repo in {".", ".."}:
    parser.error("仓库名称格式错误")
if not args.branch or re.search(r"[\s~^:?*\[\\]", args.branch) or ".." in args.branch or "@{" in args.branch or "//" in args.branch or args.branch.endswith(".") or any(not part or part.startswith(".") or part.endswith(".lock") for part in args.branch.split("/")):
    parser.error("分支名称格式错误")
root = Path(__file__).resolve().parents[1]
schema = json.loads((root / "web/integrations/chatgpt-openapi.template.json").read_text(encoding="utf-8"))
schema["servers"] = [{"url": f"https://api.github.com/repos/{args.owner}/{args.repo}"}]
schema["paths"] = {key.replace("VAULT_BRANCH", quote(args.branch, safe="/")): value for key, value in schema["paths"].items()}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"已生成：{args.output.resolve()}（不含令牌）")

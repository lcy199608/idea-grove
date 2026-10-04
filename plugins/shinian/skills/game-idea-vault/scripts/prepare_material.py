#!/usr/bin/env python3
"""Prepare actual reference bytes for a v3 atomic upload; no network or parsing."""
import argparse
import base64
import hashlib
import json
import mimetypes
import re
import uuid
from pathlib import Path

LIMIT = 8 * 1024 * 1024


def safe_id(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise argparse.ArgumentTypeError('ID must contain 1-80 letters, digits, underscores or hyphens')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--topic', required=True, type=safe_id)
    parser.add_argument('--reference', required=True, type=safe_id)
    parser.add_argument('--file-id', type=safe_id)
    parser.add_argument('--role', choices=['original', 'extracted', 'evidence'], default='original')
    parser.add_argument('--locator', default='')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.file.resolve(strict=True)
    if not source.is_file() or source.stat().st_size > LIMIT:
        parser.error('Reference must be a file no larger than 8 MiB; register larger originals as unarchived sources')
    if len(args.locator) > 1000:
        parser.error('locator exceeds 1000 characters')
    data = source.read_bytes()
    if len(data) > LIMIT:
        parser.error('Reference grew beyond 8 MiB while reading')
    extension = source.suffix[1:].lower()
    if not re.fullmatch(r'[a-z0-9]{1,12}', extension):
        extension = 'bin'
    encoding = 'binary'
    if extension in {'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'js', 'py', 'j', 'lua', 'yaml', 'yml', 'ini', 'log', 'slk'}:
        try:
            data.decode('utf-8')
            encoding = 'utf-8'
        except UnicodeDecodeError:
            pass
    file_id = args.file_id or str(uuid.uuid4())
    name = re.sub(r'[/\\\x00-\x1f]', '_', source.name)[:200]
    item = {'id': file_id, 'path': f'ideas/{args.topic}/references/{args.reference}/{file_id}.{extension}',
            'name': name, 'role': args.role, 'encoding': encoding,
            'mimeType': mimetypes.guess_type(source.name)[0] or 'application/octet-stream',
            'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'locator': args.locator}
    # Never overwrite an input or existing upload package by accident.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as handle:
        json.dump({'file': item, 'contentBase64': base64.b64encode(data).decode('ascii')}, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'output': str(args.output.resolve()), 'file': item}, ensure_ascii=False))


if __name__ == '__main__':
    main()

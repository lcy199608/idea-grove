#!/usr/bin/env python3
"""Read a bounded chunk of prepared Base64 for programmatic tool transfer."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blob', required=True)
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--limit', type=int, default=8192)
    args = parser.parse_args()
    try:
        path = Path(args.blob)
        if path.stat().st_size > 3 * 1024 * 1024:
            raise ValueError('准备文件超出大小限制。')
        blob = json.loads(path.read_text(encoding='utf-8'))
        content = blob['content']
        if blob.get('encoding') != 'base64' or not isinstance(content, str):
            raise ValueError('不是有效的图片准备文件。')
        if not 0 <= args.offset <= len(content) or not 1 <= args.limit <= 16384:
            raise ValueError('分块位置或大小无效。')
        end = min(args.offset + args.limit, len(content))
        print(json.dumps({'offset': args.offset, 'next': end,
                          'total': len(content), 'content': content[args.offset:end]}))
    except Exception as error:
        parser.exit(1, f'读取图片准备文件失败：{error}\n')


if __name__ == '__main__':
    main()

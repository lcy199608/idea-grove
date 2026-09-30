#!/usr/bin/env python3
"""Prepare an accessible chat image for a Shinian GitHub blob, without network writes.

Requires Pillow in the active file-processing runtime. The output directory must
be new. stdout contains only paths and metadata; Base64 stays in blob.json.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import uuid
import warnings

MAX_BYTES = 1536 * 1024
MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 50_000_000
MAX_EDGE = 2560


def prepare(source, output_dir, topic, module, caption, name=None):
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise ValueError('当前文件处理环境缺少 Pillow，尚未处理或保存图片。') from error
    for value in (topic, module):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', value):
            raise ValueError('主题与模块必须使用已确定的有效 ID。')
    if not caption.strip() or len(caption) > 4000:
        raise ValueError('请提供不超过 4000 字符的图片参考用途。')
    source = Path(source)
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE_BYTES:
        raise ValueError('附件必须是当前可读取的图片文件，且不超过 20 MiB。')
    original = source.read_bytes()
    notes = []
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(original)) as image:
            if image.format not in {'JPEG', 'PNG', 'WEBP', 'GIF'}:
                raise ValueError('支持 JPG、PNG、WebP、GIF；其他格式请先转换。')
            if image.width * image.height > MAX_PIXELS:
                raise ValueError('图片超过 5000 万像素，请先缩小。')
            if getattr(image, 'n_frames', 1) > 1:
                notes.append('仅保存动画首帧作为静态参考，不保留动画。')
            image.seek(0)
            image = ImageOps.exif_transpose(image)
            has_alpha = image.mode in {'RGBA', 'LA'} or 'transparency' in image.info
            image = image.convert('RGBA' if has_alpha else 'RGB')
            # Re-encoding retains reference pixels, not camera/GPS metadata.
            image.info.clear()
            image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            for attempt in range(6):
                buffer = io.BytesIO()
                image.save(buffer, format='WEBP', quality=90 if attempt == 0 else 80, method=6)
                binary = buffer.getvalue()
                if len(binary) <= MAX_BYTES:
                    break
                if attempt < 5:
                    image = image.resize((max(1, round(image.width * .75)), max(1, round(image.height * .75))), Image.Resampling.LANCZOS)
            else:
                raise ValueError('处理后仍超过 1.5 MiB，未生成可上传文件。')
            width, height = image.size
    image_id = str(uuid.uuid4())
    repo_path = f'ideas/{topic}/images/{module}/{image_id}.webp'
    attachment = {
        'id': image_id, 'path': repo_path,
        'name': (name or source.name)[:200], 'caption': caption.strip(),
        'mimeType': 'image/webp', 'width': width, 'height': height,
        'size': len(binary), 'inline': True
    }
    # Escape alt text; never let a caption supply a Markdown path.
    alt = caption.strip().replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]').replace('\r', ' ').replace('\n', ' ')
    markdown = f'![{alt}](../images/{module}/{image_id}.webp)'
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    image_path = output_dir / f'{image_id}.webp'
    image_path.write_bytes(binary)
    blob_path = output_dir / 'blob.json'
    blob_path.write_text(json.dumps({'content': base64.b64encode(binary).decode('ascii'), 'encoding': 'base64'}), encoding='utf-8')
    manifest = {
        'attachment': attachment, 'markdown': markdown,
        'sourceSha256': hashlib.sha256(original).hexdigest(),
        'gitBlobSha': hashlib.sha1(f'blob {len(binary)}\0'.encode('ascii') + binary).hexdigest(),
        'imageFile': str(image_path), 'blobFile': str(blob_path), 'notes': notes,
        'savedToGitHub': False
    }
    manifest_path = output_dir / 'reference.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {**manifest, 'manifestFile': str(manifest_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--topic', required=True)
    parser.add_argument('--module', required=True)
    parser.add_argument('--caption', required=True)
    parser.add_argument('--name')
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.output_dir, args.topic, args.module, args.caption, args.name)
    except Exception as error:
        parser.exit(1, f'图片准备失败：{error}\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

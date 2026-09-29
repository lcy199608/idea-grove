#!/usr/bin/env python3
"""Generate the small, geometric app icons using only Python's standard library."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "web" / "icons"


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def generate(size, filename):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            u, v = x / size * 64, y / size * 64
            color = (32, 63, 53)
            if ((19 <= u < 30 or 34 <= u < 45) and 19 <= v < 30) or (19 <= u < 30 and 34 <= v < 45):
                color = (219, 233, 188)
            if 34 <= u < 45 and 34 <= v < 45:
                color = (232, 173, 119)
            if (38 <= u < 41 and 32 <= v < 48) or (32 <= u < 48 and 38 <= v < 41):
                color = (32, 63, 53)
            pixels.extend(color)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(pixels), 9)) + chunk(b"IEND", b"")
    (ROOT / filename).write_bytes(data)


for dimension, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    generate(dimension, name)

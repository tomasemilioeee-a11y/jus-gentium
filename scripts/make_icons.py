#!/usr/bin/env python3
"""Draw the app icon (a gilt globe on navy) as PNGs using only the standard library."""
import math, struct, zlib
from pathlib import Path

NAVY, GOLD = (15, 30, 46), (201, 115, 58)  # Pacific night, Chilean copper
OUT = Path(__file__).resolve().parent.parent / "app" / "icons"


def coverage(x, y, r, w):
    """Fraction of a 4x4 subsample grid in pixel (x,y) that hits the globe line art."""
    hits = 0
    for sy in range(4):
        for sx in range(4):
            px, py = x + (sx + .5) / 4, y + (sy + .5) / 4
            dx, dy = px, py
            d = math.hypot(dx, dy)
            on = abs(d - r) < w                                   # outer ring
            if d < r:
                on |= abs(dy) < w * .8                            # equator
                for lat in (-.5, .5):                              # two parallels
                    yy = lat * r
                    on |= abs(dy - yy) < w * .6 and abs(dx) < math.sqrt(max(r*r - yy*yy, 0))
                on |= abs(dx) < w * .8                            # central meridian
                for k in (.45, .82):                               # meridian ellipses
                    a = k * r
                    v = (dx / a) ** 2 + (dy / r) ** 2
                    on |= abs(math.sqrt(v) - 1) * a < w * .6
            hits += on
    return hits / 16


def icon(size, scale):
    r, w = size * scale * .5, size * .022
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            c = coverage(i - size / 2, j - size / 2, r, w)
            row += bytes(round(NAVY[k] + (GOLD[k] - NAVY[k]) * c) for k in range(3))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


OUT.mkdir(parents=True, exist_ok=True)
for name, size, scale in [("icon-192.png", 192, .62), ("icon-512.png", 512, .62),
                          ("apple-touch-icon.png", 180, .62), ("icon-maskable-512.png", 512, .5)]:
    (OUT / name).write_bytes(icon(size, scale))
    print("wrote", name)

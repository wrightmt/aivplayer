#!/usr/bin/env python3
"""Draws the aIVplayer app icon: the three-speaker arrangement over a Dunwich shingle beach.

Everything is described as signed distance fields in a 0..1 unit square and sampled with numpy,
so the mark stays crisp at any size and the drawing can be re-read and adjusted. Writes a PNG
with no third-party dependencies.

    python3 tools/make-icon.py build/icon.png 1024
"""

from __future__ import annotations

import struct
import sys
import zlib

import numpy as np

# The app's own palette, so the icon and the window agree.
SKY_TOP = (0x11, 0x12, 0x0F)
SKY_HORIZON = (0x23, 0x27, 0x1D)
SHORE = (0x15, 0x17, 0x11)
LINE = (0x9F, 0xB2, 0x8A)  # --accent
FRONT_SPEAKER = (0xC3, 0xD1, 0xB0)
REAR_SPEAKER = (0xD8, 0xB3, 0x6A)  # --warn: the difference speaker is the point of the app
SHINGLE = (0x7C, 0x80, 0x6E)

HORIZON_Y = 0.545
APEX = (0.500, 0.150)
BASE_L = (0.302, 0.415)
BASE_R = (0.698, 0.415)
SPEAKER_HALF = 0.0285
WIRE = 0.0060
MARGIN_L, MARGIN_R = 0.100, 0.900


def grid(size: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-centre coordinates in the unit square."""
    axis = (np.arange(size) + 0.5) / size
    return np.meshgrid(axis, axis)  # x, y


def cover(dist: np.ndarray, size: int, softness: float = 1.4) -> np.ndarray:
    """Antialiased coverage from a signed distance, feathered over ~1.4 pixels."""
    edge = softness / size
    return np.clip(0.5 - dist / edge, 0.0, 1.0)


def sd_segment(x, y, a, b, half_width: float) -> np.ndarray:
    """Distance to a capsule: the segment a→b grown by half_width."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    px, py = x - ax, y - ay
    t = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0.0, 1.0)
    return np.hypot(px - t * dx, py - t * dy) - half_width


def sd_box(x, y, centre, half) -> np.ndarray:
    qx = np.abs(x - centre[0]) - half
    qy = np.abs(y - centre[1]) - half
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)


def sd_circle(x, y, centre, radius: float) -> np.ndarray:
    return np.hypot(x - centre[0], y - centre[1]) - radius


def paint(img: np.ndarray, mask: np.ndarray, colour, alpha: float = 1.0) -> None:
    """Alpha-composites a flat colour through a coverage mask."""
    a = (mask * alpha)[..., None]
    img *= 1.0 - a
    img += a * (np.array(colour, dtype=np.float64) / 255.0)


def render(size: int) -> np.ndarray:
    x, y = grid(size)
    img = np.zeros((size, size, 3), dtype=np.float64)

    # Ground: a dusk sky warming towards the horizon, then a flatter shore below it.
    t = np.clip(y / HORIZON_Y, 0.0, 1.0)[..., None]
    sky = np.array(SKY_TOP) / 255.0 * (1 - t) + np.array(SKY_HORIZON) / 255.0 * t
    img[:] = np.where((y < HORIZON_Y)[..., None], sky, np.array(SHORE) / 255.0)

    # Sea: parallel swells, each a little shorter and fainter as it recedes up the beach.
    for i, (yy, amp, alpha) in enumerate([(0.628, 0.012, 0.90), (0.702, 0.014, 0.72), (0.778, 0.016, 0.55)]):
        inset = 0.012 * i
        wave = yy + amp * np.sin((x - MARGIN_L) / (MARGIN_R - MARGIN_L) * np.pi * 4 + i * 1.1)
        band = np.abs(y - wave) - 0.0045
        inside = (x > MARGIN_L + inset) & (x < MARGIN_R - inset)
        paint(img, cover(band, size) * inside, LINE, alpha)

    # Horizon: the one hard line in the picture.
    horizon = sd_segment(x, y, (MARGIN_L, HORIZON_Y), (MARGIN_R, HORIZON_Y), 0.0058)
    paint(img, cover(horizon, size), LINE)

    # Shingle: two staggered rows of stones, thinning towards the foreground.
    rng = np.random.default_rng(1960)  # Dunwich Beach, Autumn, 1960
    for row, (yy, count, alpha) in enumerate([(0.852, 9, 0.85), (0.918, 8, 0.62)]):
        for i in range(count):
            cx = MARGIN_L + 0.035 + (MARGIN_R - MARGIN_L - 0.07) * (i + 0.5) / count
            cx += float(rng.uniform(-0.016, 0.016))
            cy = yy + float(rng.uniform(-0.010, 0.010))
            radius = float(rng.uniform(0.0085, 0.0145)) * (1.0 + 0.15 * row)
            # Slightly squashed: stones lie flat on the shingle rather than reading as dots.
            paint(img, cover(sd_circle(x, (y - cy) * 1.35 + cy, (cx, cy), radius), size), SHINGLE, alpha)

    # The arrangement: two front speakers, and the rear one carrying L−R at the apex.
    for a, b in [(APEX, BASE_L), (APEX, BASE_R), (BASE_L, BASE_R)]:
        paint(img, cover(sd_segment(x, y, a, b, WIRE / 2), size), LINE, 0.75)
    for centre, colour in [(BASE_L, FRONT_SPEAKER), (BASE_R, FRONT_SPEAKER), (APEX, REAR_SPEAKER)]:
        paint(img, cover(sd_box(x, y, centre, SPEAKER_HALF), size), colour)

    return img


def write_png(path: str, img: np.ndarray) -> None:
    size = img.shape[0]
    rgb = (np.clip(img, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    alpha = np.full((size, size, 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=2).reshape(size, size * 4)
    # Every scanline is preceded by one filter-type byte (0 = None).
    raw = np.concatenate([np.zeros((size, 1), dtype=np.uint8), rgba], axis=1).tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "build/icon.png"
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    write_png(out, render(size))
    print(f"wrote {out} at {size}x{size}")


if __name__ == "__main__":
    main()

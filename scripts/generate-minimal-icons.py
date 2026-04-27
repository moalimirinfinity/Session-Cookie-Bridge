#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
PRIMARY = (17, 36, 65, 255)  # #112441
ACCENT = (28, 134, 215, 255)  # #1C86D7
TRANSPARENT = (0, 0, 0, 0)
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "icons"
SUPERSAMPLE = 6


def scale(value: float, size: int) -> int:
    return round(value * size)


def generate_icon(size: int) -> Image.Image:
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), TRANSPARENT)
    draw = ImageDraw.Draw(image)

    stroke = max(2 * SUPERSAMPLE, round(canvas * 0.11))
    link_height = scale(0.36, canvas)
    radius = round(link_height / 2)

    left_link = (
        scale(0.09, canvas),
        scale(0.18, canvas),
        scale(0.61, canvas),
        scale(0.54, canvas),
    )
    right_link = (
        scale(0.39, canvas),
        scale(0.46, canvas),
        scale(0.91, canvas),
        scale(0.82, canvas),
    )

    draw.rounded_rectangle(left_link, radius=radius, outline=PRIMARY, width=stroke)
    draw.rounded_rectangle(right_link, radius=radius, outline=PRIMARY, width=stroke)

    bridge_height = max(SUPERSAMPLE * 2, round(canvas * 0.07))
    bridge = (
        scale(0.39, canvas),
        scale(0.50, canvas) - bridge_height // 2,
        scale(0.61, canvas),
        scale(0.50, canvas) + bridge_height // 2,
    )
    draw.rounded_rectangle(bridge, radius=bridge_height // 2, fill=ACCENT)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        output = OUT_DIR / f"icon-{size}.png"
        generate_icon(size).save(output)
        print(f"wrote {output}")


if __name__ == "__main__":
    main()

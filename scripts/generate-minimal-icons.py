#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
STROKE = (11, 34, 57, 255)  # #0B2239
TRANSPARENT = (0, 0, 0, 0)
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "icons"


def stroke_width(size: int) -> int:
    return max(1, round(size * 0.09))


def draw_round_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    width: int,
    color: tuple[int, int, int, int],
) -> None:
    draw.line((start, end), fill=color, width=width)
    radius = width / 2
    for x, y in (start, end):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def generate_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    stroke = stroke_width(size)

    cx = size / 2
    cookie_cy = size * 0.37
    cookie_radius = size * 0.24
    cookie_box = (
        cx - cookie_radius,
        cookie_cy - cookie_radius,
        cx + cookie_radius,
        cookie_cy + cookie_radius,
    )
    draw.ellipse(cookie_box, outline=STROKE, width=stroke)

    chip_radius = max(1, round(size * 0.032))
    chip_points = (
        (cx - cookie_radius * 0.34, cookie_cy - cookie_radius * 0.20),
        (cx + cookie_radius * 0.20, cookie_cy - cookie_radius * 0.34),
        (cx + cookie_radius * 0.32, cookie_cy + cookie_radius * 0.16),
    )
    for chip_x, chip_y in chip_points:
        draw.ellipse(
            (
                chip_x - chip_radius,
                chip_y - chip_radius,
                chip_x + chip_radius,
                chip_y + chip_radius,
            ),
            fill=STROKE,
        )

    base_y = round(size * 0.78)
    margin = round(size * 0.2)
    draw_round_line(draw, (margin, base_y), (size - margin, base_y), stroke, STROKE)

    support_top = round(size * 0.61)
    support_width = max(1, stroke - 1)
    for support_x in (round(size * 0.38), round(size * 0.5), round(size * 0.62)):
        draw_round_line(
            draw,
            (support_x, support_top),
            (support_x, base_y),
            support_width,
            STROKE,
        )

    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        output = OUT_DIR / f"icon-{size}.png"
        generate_icon(size).save(output)
        print(f"wrote {output}")


if __name__ == "__main__":
    main()

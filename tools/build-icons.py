"""Renders extension/icons/icon-{16,32,48,128}.png: three staggered drawer tabs
in group colors on a warm dark tile (see Design.md). Run: python3 tools/build-icons.py"""
import pathlib

from PIL import Image, ImageDraw

SIZE = 512
PAPER = (29, 25, 21, 255)
DRAWERS = [  # (color, x offset, y) top to bottom
    ((236, 138, 67, 255), 0, 112),   # signal orange
    ((138, 180, 248, 255), 46, 216),  # blue
    ((129, 201, 149, 255), 92, 320),  # green
]
OUT = pathlib.Path(__file__).resolve().parent.parent / "extension" / "icons"


def drawer(draw: ImageDraw.ImageDraw, color: tuple, x: int, y: int) -> None:
    left = 84 + x
    right = 428
    tab_w = 120
    # folder tab
    draw.rounded_rectangle((left, y, left + tab_w, y + 46), radius=18, fill=color)
    # drawer body
    draw.rounded_rectangle((left, y + 26, right, y + 92), radius=18, fill=color)


def render() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=112, fill=PAPER)
    for color, x, y in DRAWERS:
        drawer(draw, color, x, y)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    big = render()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()

"""Generates every favicon from public/branding/logo-mark.png (NEVER from logo-full.png).

The artwork is black on transparent. A white-only favicon would vanish in a light
browser tab bar, and a black one in a dark tab bar, so each icon is the WHITE mark
on a near-black (#0d0d0f) tile: the allowed "white mark on dark surface" variant,
visible on light and dark tab bars alike.

    pip install pillow
    python scripts/generate-favicons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "branding" / "logo-mark.png"
OUT = ROOT / "public" / "favicons"
BG = (0x0D, 0x0D, 0x0F, 255)


def white_mark(src: Image.Image) -> Image.Image:
    """Equivalent of CSS `filter: brightness(0) invert(1)`: every pixel white, alpha preserved."""
    alpha = src.getchannel("A")
    white = Image.new("RGBA", src.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def tile(mark: Image.Image, size: int) -> Image.Image:
    scale = 4  # supersample for clean edges
    big = size * scale
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.18), fill=BG)
    # Clear space: the mark occupies 68% of the tile (>= 25% of its height around it on small sizes).
    target = int(big * 0.68)
    w, h = mark.size
    ratio = min(target / w, target / h)
    resized = mark.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.LANCZOS)
    canvas.alpha_composite(resized, ((big - resized.width) // 2, (big - resized.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SOURCE).convert("RGBA")
    bbox = src.getchannel("A").getbbox()
    mark = white_mark(src.crop(bbox) if bbox else src)

    for size, name in [(16, "favicon-16x16.png"), (32, "favicon-32x32.png"), (48, "favicon-48x48.png"),
                       (180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
        tile(mark, size).save(OUT / name)
    tile(mark, 64).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("favicons written to", OUT)


if __name__ == "__main__":
    main()

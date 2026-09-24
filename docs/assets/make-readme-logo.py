"""White variant of the logo for the README in GitHub's dark mode.

The artwork (web/public/branding/logo-full.png) is black on transparent: invisible on a
dark background. This produces the allowed "white mark on dark surfaces" variant,
exactly like the CSS filter `brightness(0) invert(1)` used in the app.

    python docs/assets/make-readme-logo.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "web" / "public" / "branding" / "logo-full.png"
OUT = ROOT / "docs" / "assets" / "logo-full-white.png"

src = Image.open(SOURCE).convert("RGBA")
white = Image.new("RGBA", src.size, (255, 255, 255, 0))
white.putalpha(src.getchannel("A"))
white.save(OUT)
print("written", OUT)

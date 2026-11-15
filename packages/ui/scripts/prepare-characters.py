import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def linear(value):
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


directory = Path(__file__).resolve().parent.parent / "assets" / "characters"
source = Path(sys.argv[1])
materials = []
for path in sorted(directory.glob("*.webp")):
    if path.name.startswith("eye-"):
        continue
    original = Image.open(path).convert("RGBA")
    alpha = original.getchannel("A")
    image = Image.open(source / f"{path.stem}.png").convert("L")
    image = image.resize(original.size, Image.Resampling.LANCZOS)
    # Extend fiber color into matte pixels before applying the retained alpha.
    edge = np.asarray(alpha.filter(ImageFilter.MinFilter(17))) < 255
    pixels = np.asarray(image).copy()
    matte = edge & (pixels < 80)
    pixels[matte] = np.asarray(image.filter(ImageFilter.MaxFilter(17)))[matte]
    image = Image.fromarray(pixels)
    gray = np.asarray(image, dtype=float) / 255
    interior = np.asarray(alpha) > 250
    median = float(np.median(gray[interior]))
    if median <= 0:
        raise ValueError(f"{path.name}: body material has no illumination")
    value = np.clip(linear(gray) * float(linear(0.55)) / float(linear(median)), 0, 1)
    gray = np.where(value <= 0.0031308, value * 12.92, 1.055 * value ** (1 / 2.4) - 0.055)
    luma = Image.fromarray(np.rint(gray * 255).astype("uint8"))
    material = Image.merge("RGBA", (luma, luma, luma, alpha))
    assert material.size == original.size
    assert np.array_equal(np.asarray(material.getchannel("A")), np.asarray(alpha))
    assert abs(float(np.median(np.asarray(luma)[interior])) / 255 - 0.55) < 1 / 255
    materials.append((path, material))

for path, material in materials:
    material.save(path, lossless=True, method=6)
    print(f"Prepared {path.name}", flush=True)

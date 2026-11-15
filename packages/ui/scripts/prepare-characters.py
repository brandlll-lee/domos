import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def linear(value):
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def prepare(render, reference):
    if reference.width != reference.height:
        raise ValueError("Expected a square body reference")
    alpha = reference.convert("RGBA").getchannel("A")
    alpha = alpha.resize((1024, 1024), Image.Resampling.LANCZOS)
    image = render.convert("L")
    bounds = alpha.point(lambda value: 255 if value > 128 else 0).getbbox()
    source = image.point(lambda value: 255 if value > 96 else 0).getbbox()
    if not bounds or not source:
        raise ValueError("Expected a visible body and reference")
    sx = (bounds[2] - bounds[0]) / (source[2] - source[0])
    sy = (bounds[3] - bounds[1]) / (source[3] - source[1])
    material = Image.new("L", (1120, 1120), 24)
    resized = image.resize(
        (round(image.width * sx), round(image.height * sy)),
        Image.Resampling.LANCZOS,
    )
    material.paste(
        resized,
        (round(bounds[0] - source[0] * sx) + 48,
         round(bounds[1] - source[1] * sy) + 48),
    )
    retained = Image.new("L", material.size)
    retained.paste(alpha, (48, 48))
    fringe = np.asarray(retained.filter(ImageFilter.MaxFilter(41)), dtype=float) / 255
    interior = np.asarray(
        retained.point(lambda value: 255 if value > 128 else 0)
        .filter(ImageFilter.MinFilter(41))
    ) > 250
    if np.count_nonzero(interior) == 0:
        raise ValueError("Body reference has no opaque core")
    gray = np.asarray(material, dtype=float)
    light = np.asarray(
        material.filter(ImageFilter.MaxFilter(25)).filter(ImageFilter.GaussianBlur(5)),
        dtype=float,
    )
    # Recover fine hair coverage against the render's charcoal matte.
    opacity = np.clip((gray - 24) / np.maximum(light - 24, 1), 0, 1) * fringe
    opacity[interior] = 1
    opacity[opacity < 0.015] = 0
    foreground = np.where(
        opacity > 0,
        (gray - 24 * (1 - opacity)) / np.maximum(opacity, 0.001),
        140,
    )
    median = float(np.median(foreground[interior])) / 255
    if not np.isfinite(median) or median <= 0:
        raise ValueError("Body material has no illumination")
    value = np.clip(
        linear(np.clip(foreground / 255, 0, 1)) * linear(0.55) / linear(median),
        0, 1,
    )
    gray = np.where(value <= 0.0031308, value * 12.92, 1.055 * value ** (1 / 2.4) - 0.055)
    luma = Image.fromarray(np.rint(gray * 255).astype("uint8"))
    alpha = Image.fromarray(np.rint(opacity * 255).astype("uint8"))
    assert np.all(opacity[interior] == 1)
    assert np.all(opacity[np.asarray(retained.filter(ImageFilter.MaxFilter(43))) == 0] == 0)
    assert abs(float(np.median(np.asarray(luma)[interior])) / 255 - 0.55) < 1 / 255
    return Image.merge("RGBA", (luma, luma, luma, alpha))


if __name__ == "__main__":
    renders, references, output = map(Path, sys.argv[1:])
    materials = []
    for path in sorted(references.glob("*.webp")):
        if not path.name.startswith("eye-"):
            material = prepare(Image.open(renders / f"{path.stem}.png"), Image.open(path))
            materials.append((output / path.name, material))
            print(f"Prepared {path.name}", flush=True)
    output.mkdir(parents=True, exist_ok=True)
    for path, material in materials:
        material.save(path, lossless=True, method=6)

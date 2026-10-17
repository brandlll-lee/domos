import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 2048
SCALE = SIZE / 100


def pile_field(rng, resolution):
    values = rng.normal(0, 1, (resolution, resolution)).astype(np.float32)
    values = np.asarray(Image.fromarray(values).resize((SIZE, SIZE), Image.Resampling.BICUBIC)).copy()
    return values / max(values.std(), 0.001)


def fibers(fur, rng, inside, normals, height, distance, color, clumps, groom, light, count, length_scale, lightness, shadows=False):
    roots = rng.uniform(0, SIZE, (count * 2, 2))
    indices = np.minimum(roots.astype(int), SIZE - 1)
    roots = roots[inside[indices[:, 1], indices[:, 0]]][:count]
    indices = roots.astype(int)
    rx, ry = indices[:, 0], indices[:, 1]
    n = normals[ry, rx]
    bundles = np.clip(clumps[ry, rx], -2, 2)
    angle = np.arctan2(n[:, 1] * 0.95 + 0.45, n[:, 0] * 0.95 + 0.14 * np.sin(rx / SCALE * 0.4))
    angle += 0.27 * groom[ry, rx] + rng.normal(0, 0.18, len(roots))
    lengths = np.clip(rng.lognormal(-0.33, 0.34, len(roots)), 0.28, 1.7) * SCALE * length_scale * (1 + 0.12 * bundles)
    bend = 0.15 * groom[ry, rx] + rng.normal(0, 0.14, len(roots))
    direction = np.stack([np.cos(angle), np.sin(angle)], axis=1)
    side = np.stack([-np.sin(angle), np.cos(angle)], axis=1)
    p1 = roots + direction * lengths[:, None] * 0.34 + side * (bend * lengths * 0.24)[:, None]
    p2 = roots + direction * lengths[:, None] * 0.70 + side * (bend * lengths * 0.70)[:, None]
    p3 = roots + direction * lengths[:, None] + side * (bend * lengths)[:, None]
    tint = color[ry, rx] * (rng.normal(1, 0.025 if length_scale < 1 else 0.04, len(roots)) * lightness)[:, None]
    root_colors = np.clip(tint * (0.92 if length_scale < 1 else 0.84), 0, 255).astype(np.uint8)
    mid_colors = np.clip(tint * 1.01, 0, 255).astype(np.uint8)
    glint = (0.5 + 0.5 * np.abs(direction @ light[:2]))[:, None]
    tip_colors = np.clip(tint * 1.06 + glint * np.array([9, 10, 5]), 0, 255).astype(np.uint8)
    width = max(1, round(0.055 * SCALE * min(length_scale, 1.1)))
    if shadows:
        shadow = Image.new('RGBA', fur.size)
        draw = ImageDraw.Draw(shadow)
        for i in range(len(roots)):
            opacity = int(55 * min(distance[ry[i], rx[i]], 1))
            draw.line([tuple(roots[i] + [1.2, 1.7]), tuple(p2[i] + [1.2, 1.7]), tuple(p3[i] + [1.2, 1.7])], fill=(52, 66, 17, opacity), width=width + 1)
        fur.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(0.55)))
    draw = ImageDraw.Draw(fur)
    for i in np.argsort(height[ry, rx]):
        draw.line([tuple(roots[i]), tuple(p1[i])], fill=tuple(root_colors[i]) + (255,), width=width)
        draw.line([tuple(p1[i]), tuple(p2[i])], fill=tuple(mid_colors[i]) + (255,), width=width)
        draw.line([tuple(p2[i]), tuple(p3[i])], fill=tuple(tip_colors[i]) + (235,), width=max(1, width - 1))


def render(points, base):
    rng = np.random.default_rng(7349)
    boundary = np.array(points)
    mask = Image.new('L', (SIZE, SIZE))
    ImageDraw.Draw(mask).polygon([tuple(point * SCALE) for point in boundary], fill=255)
    inside = np.asarray(mask) > 0
    grid = 384
    gy, gx = np.mgrid[0:grid, 0:grid].astype(np.float32) * (100 / grid)
    distance = np.full((grid, grid), np.inf, dtype=np.float32)
    for point in boundary:
        distance = np.minimum(distance, (gx - point[0]) ** 2 + (gy - point[1]) ** 2)
    distance = np.asarray(Image.fromarray(np.sqrt(distance)).resize((SIZE, SIZE), Image.Resampling.BILINEAR)).copy()
    distance[~inside] = 0
    yy, xx = np.mgrid[0:SIZE, 0:SIZE] / SCALE
    height = 20 * np.sqrt(np.clip(distance / 27, 0, 1))
    height += 2.2 * np.exp(-((xx - 50) / 28) ** 2 - ((yy - 61) / 27) ** 2) * inside
    fy, fx = np.fft.fftfreq(SIZE)[:, None], np.fft.rfftfreq(SIZE)[None, :]
    smooth = np.exp(-2 * np.pi ** 2 * (1.65 * SCALE) ** 2 * (fx ** 2 + fy ** 2))
    height = np.fft.irfft2(np.fft.rfft2(height) * smooth, s=height.shape).astype(np.float32)
    dy, dx = np.gradient(height, 1 / SCALE)
    normals = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 0.0001)
    light = np.array([-0.46, -0.54, 0.84])
    light /= np.linalg.norm(light)
    fill_light = np.array([0.6, 0.12, 0.79])
    fill_light /= np.linalg.norm(fill_light)
    diffuse = np.maximum(normals @ light, 0)
    illumination = 0.50 + 0.43 * diffuse + 0.12 * np.maximum(normals @ fill_light, 0)
    sheen = np.maximum(diffuse - 0.78, 0) ** 2 * 1.8
    clumps, groom = pile_field(rng, 42), pile_field(rng, 30)
    noise = 1 + 0.018 * clumps + rng.normal(0, 0.007, (SIZE, SIZE))
    rim = (1 - normals[..., 2]) ** 2 * np.maximum(normals[..., 0] * 0.6 - normals[..., 1] * 0.8, 0)
    color = np.clip(base * (illumination * noise)[..., None] + sheen[..., None] * [22, 19, 13] + rim[..., None] * [15, 18, 6], 0, 255)
    fur = Image.fromarray(np.dstack([color.astype(np.uint8), np.asarray(mask)]), 'RGBA')
    args = (rng, inside, normals, height, distance, color, clumps, groom, light)
    fibers(fur, *args, 180000, 0.56, 0.98)
    fur = fur.filter(ImageFilter.GaussianBlur(0.8))
    fibers(fur, *args, 105000, 1.14, 1.01, shadows=True)
    fibers(fur, *args, 26000, 1.48, 1.025)
    return fur.resize((1024, 1024), Image.Resampling.LANCZOS)


config = json.load(sys.stdin)
base = np.array([int(config['color'][i:i + 2], 16) for i in (1, 3, 5)])
for outline in config['outlines']:
    output = Path(sys.argv[1]) / f"{outline['name']}.webp"
    render(outline['points'], base).save(output, quality=95, method=6)
    print(f"{output.name}: {output.stat().st_size}", flush=True)

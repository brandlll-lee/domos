# Character body materials

Bodies use directional plush fibers, soft root shadows and translucent flyaways.
Each lossless WebP stores neutral gray at a median sRGB level of 0.55.
The shared Character component
maps this material to the saved Bot color in linear light. Eyes and motion remain
separate layers.

Keep the unpadded square body references in a separate directory. Place one approved
grayscale PNG render per body in another directory. Use the matching WebP basename.
Renders use a uniform RGB (24, 24, 24) background. Run with Python, Pillow and NumPy:

```sh
python packages/ui/scripts/prepare-characters.py <render-directory> <reference-directory> packages/ui/assets/characters
```

The preparation script aligns each render to its reference. It retains the body's
core and extracts fine hair coverage near its contour. Each 1120px body includes
48px of padding on all sides. Character compensates for that padding, so the body
and eyes retain their positions. Review all bodies at 40, 64 and 160 pixels in both
themes. Keep eye assets separate from body preparation.

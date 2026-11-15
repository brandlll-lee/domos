# Character body materials

Bodies use fine short plush fibers and soft studio lighting. Each lossless WebP
stores neutral gray at a median sRGB level of 0.55. The shared Character component
maps this material to the saved Bot color in linear light. Eyes and motion remain
separate layers.

To prepare approved body renders, align each body with its existing asset and
place one PNG per body in a directory. Use the matching WebP basename. Run with
Python, Pillow and NumPy:

```sh
python packages/ui/scripts/prepare-characters.py <render-directory>
```

The preparation script retains each existing body's dimensions and alpha. Review
all bodies at 40, 64 and 160 pixels in both themes before replacing assets. Keep
eye assets separate from body preparation.

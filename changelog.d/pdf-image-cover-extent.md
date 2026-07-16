---
category: Fixed
---

PDF page observation now measures a drawn raster image over its full extent, not a single
pixel of it. The interpreter hands an image its pixel-space transform, so measuring the unit
square undercounted every multi-pixel image by its width times its height — a full-page scan
read as a sliver. This corrects the image-coverage signal the OCR page-selection gate relies
on, and hardens redaction: the rule that a vector box drawn over a raster image does not
remove the underlying pixels now applies across the whole image, not just one corner of it.

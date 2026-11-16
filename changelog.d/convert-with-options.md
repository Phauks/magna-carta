---
category: Added
audience: public
---

**Convert with Options.** `POST /api/v1/conversions` takes an optional `options` object (`maxDimension`, `quality`, `grayscale`; the contract now lives in `packages/conversion/src/contract.ts`). What a conversion accepts comes from the engine that writes the copy (`packages/conversion/src/options.ts`): the raster engine reads all three for image targets (quality for JPEG only) and size and grayscale for an image going to PDF, and honours them from new `x-max-dimension`, `x-quality` and `x-grayscale` headers (`containers/raster/src/convert.rs`, `ConvertOptions`). No other engine reads any, so an option it cannot honour is refused with 422 `unsupported-conversion-option` rather than dropped. Options ride the final hop of a path only. The web adds `convert-options-dialog.svelte`, reached as the last entry of the matter file manager's Convert flyout and as a button on the File Workbench Convert tab, and offered only where some target takes a setting.

## Public

Pictures can now be converted with settings: shrink to a longest side, grayscale, and JPEG quality. Use **Convert with Options** in a file's Convert menu or on the File Workbench Convert tab. The original is never changed.

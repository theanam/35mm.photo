# LUT assets

Every built-in look is synthesised at runtime from a `ColorTransform` in
`src/editor/presets/looks.ts`, so nothing here is required to run 35mm. This
directory is the drop-in point for real 3D LUTs.

To use one:

1. Put the `.cube` file here, e.g. `public/luts/chrome.cube`.
2. Point the look at it in `src/editor/presets/looks.ts`:

   ```ts
   { id: 'chrome', name: 'Chrome', lut: 'luts/chrome.cube', /* … */ }
   ```

The file is fetched, parsed (`src/editor/presets/cube.ts`), normalised out of any
non-unit `DOMAIN_MIN`/`DOMAIN_MAX`, and uploaded as a `TEXTURE_3D` sampled with
hardware trilinear filtering. Only 3D `.cube` files are supported —
`LUT_1D_SIZE` files are rejected.

If the fetch or the parse fails, the look falls back to its synthesised
transform and logs a warning, so a missing LUT degrades rather than breaks.

**Licensing.** 35mm ships no third-party LUT data on purpose. Check the licence
of anything you add here before distributing a build that includes it.

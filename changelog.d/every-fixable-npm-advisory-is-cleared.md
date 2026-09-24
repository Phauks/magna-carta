---
category: Security
audience: internal
---

**Every npm advisory with a fixed release is cleared. The only npm findings left are the two the
`osv-scanner.toml` header already names as out of reach.** Ten advisories had opened since the last
sweep, all below the gate's fail threshold, so nothing had failed. All moved within their existing
major:

- `hono` 4.13.0 to 4.13.5 in the catalog, the only one with production reach: unbounded dot-notation
  nesting in `parseBody()` (a memory DoS through any form body), the query parser reading past a `#`
  fragment, and `toSSG()` writing outside its output directory.
- `devalue` pinned to 5.9.2 (a parser DoS on malformed input), through svelte, SvelteKit and
  sveltekit-superforms.
- `joi` 17 pinned to 17.13.8 (two prototype-pollution paths), reached only as superforms' optional
  validator adapter.
- `js-yaml` 4 to 4.3.2 and 3 to 3.15.2 (merge-key exhaustion), behind the OpenAPI client generator.
- `sharp` to 0.35.4 (an out-of-bounds read in its bundled libheif), behind miniflare.
- `extract-zip`'s two symlink-traversal advisories have **no fixed release**, so their carrier is
  removed instead. `@cloudflare/puppeteer` hard-pins `@puppeteer/browsers` 2.2.4 for its Node launcher,
  which downloads a local Chrome. A Worker never runs that launcher: the entry point drives the
  Browser Rendering binding, and a dry-run bundle of the API worker contains none of
  `@puppeteer/browsers`, `extract-zip` or `yauzl`. Removing it with a pnpm override drops about 600
  lockfile lines and adds no baseline entry.

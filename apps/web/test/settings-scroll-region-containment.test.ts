import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * THE SETTINGS SCROLL REGION CONTAINS WHAT IS POSITIONED INSIDE IT.
 *
 * Settings, AI (then titled AI and the Assistant) showed two scrollbars: its own, and the app shell's `<main>`. Nothing
 * on the page declared a second overflow, so `pnpm run lint:settings-scroll` (which follows overflow
 * classes through the component graph) had nothing to find. Rendered at 1440 x 900, `<main>` was
 * 1125px tall in an 844px box, and the one element past its foot was LoadingRegion's screen-reader
 * announcer: an `sr-only` paragraph, so `position: absolute`, laid out against the nearest positioned
 * ancestor. The scroll region was not positioned, so that ancestor was `<main>` (which is `relative`),
 * and the announcer's static position near the bottom of a long page stretched `<main>`'s scroll
 * height. The other settings pages were fine only because their LoadingRegions sit high enough.
 *
 * The fix is one class on the shared region, so every settings page is covered by it; this test holds
 * that class in place. Checked rendered at 1280, 1440 and 1920 wide: `<main>` no longer overflows.
 */
const REGION = "src/lib/settings/components/settings-scroll-region.svelte";

describe("SettingsScrollRegion", () => {
  it("is the containing block for absolutely positioned descendants", () => {
    const source = readFileSync(new URL(`../${REGION}`, import.meta.url), "utf8");
    const scroller = /<div class="([^"]*overflow-y-auto[^"]*)"/.exec(source);
    expect(scroller, "the region's scrolling element").not.toBeNull();
    expect(scroller?.[1]?.split(/\s+/)).toContain("relative");
  });
});

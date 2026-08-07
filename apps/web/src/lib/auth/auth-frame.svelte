<script lang="ts">
  /*
   * The frame every signed-out surface renders inside: the chrome band across the top, the sunken
   * page beneath it, and one centred card. It lives outside the (app) route group, so nothing here
   * assumes a session — the brand band is the only chrome a visitor gets before they have one.
   *
   * The gold wash is a decorative element rather than a background on the page: a radial that has
   * to sit off the top-inline-end corner needs a positioned box, and giving it its own aria-hidden
   * element keeps the page's own background a flat token surface.
   */
  import type { Snippet } from "svelte";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as TopBar from "@magna-carta/design-system/top-bar";

  let { children }: { children: Snippet } = $props();

  /*
   * The chrome nav destinations. Each is a SEPARATE future site (marketing, community forum, the
   * help centre, the public status page), none of which exists yet, so every href is a placeholder
   * until those sites are stood up — the links are here so the band's shape is right, not because
   * they navigate. apps/web/src/lib/navigation/ecosystem-sites.ts is where the real URLs land.
   */
  const CHROME_NAVIGATION = ["Product", "Forum", "Help", "Status"];
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken">
  <TopBar.Root class="ps-16">
    <BrandMark />
    <TopBar.Actions>
      <nav aria-label="Magna Carta" class="flex items-center gap-4">
        {#each CHROME_NAVIGATION as destination (destination)}
          <TopBar.Link href="#">{destination}</TopBar.Link>
        {/each}
      </nav>
    </TopBar.Actions>
  </TopBar.Root>

  <main class="relative flex flex-auto items-center justify-center p-24">
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        class="absolute top-0 right-0 aspect-square w-full translate-x-1/2 -translate-y-1/2 rounded-full bg-radial from-chrome-accent/6 to-transparent"
      ></div>
    </div>
    {@render children()}
  </main>
</div>

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
  import VersionChip from "$lib/versions/version-chip.svelte";
  import { ECOSYSTEM_SITES } from "../navigation/ecosystem-sites.ts";

  let { children }: { children: Snippet } = $props();

  /*
   * The chrome nav destinations, resolved from the ecosystem-site registry rather than listed here.
   * Each is a SEPARATE site (marketing, community forum, the help centre, the public status page),
   * and the registry's `href` is the light-up switch: an entry with a URL renders as a real external
   * link, one still null renders inert. That keeps this band from being a second place a site's
   * address is written down, which is how the status page ended up live behind a "#" — its URL had
   * been in the registry for some time while these four links stayed placeholders.
   *
   * The label stays local because the band's vocabulary is its own: the registry calls them "About
   * Magna Carta" and "Documentation" for the profile menu, where there is room for the longer name.
   */
  const CHROME_NAVIGATION = [
    { label: "Product", id: "about" },
    { label: "Forum", id: "forums" },
    { label: "Help", id: "documentation" },
    { label: "Status", id: "status" },
  ].map((entry) => ({
    ...entry,
    href: ECOSYSTEM_SITES.find((site) => site.id === entry.id)?.href ?? null,
  }));
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken">
  <TopBar.Root class="ps-16">
    <BrandMark />
    <TopBar.Actions>
      <nav aria-label="Magna Carta" class="flex items-center gap-4">
        {#each CHROME_NAVIGATION as destination (destination.id)}
          {#if destination.href}
            <TopBar.Link href={destination.href} rel="noreferrer">
              {destination.label}
            </TopBar.Link>
          {:else}
            <TopBar.Link aria-disabled="true">{destination.label}</TopBar.Link>
          {/if}
        {/each}
      </nav>
      <!-- "Which version am I on" is asked most often by someone who cannot get in, so the chip
           belongs on this side of the door too. It sits in the same chrome corner as the app
           shell's, from the same component: the public scope shows this build's own identifier
           (already in the bundle the visitor downloaded) and reads nothing from the API, which
           needs a session. -->
      <VersionChip scope="public" />
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

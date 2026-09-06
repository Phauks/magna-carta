<script lang="ts">
  /*
   * BackLink — the return affordance at the top of a screen that was entered FROM another screen.
   * It shows the destination in miniature: the back arrow, then the destination's own glyph, then
   * its name. A reader learns not merely that there is a way out but WHERE it lands, in the same
   * mark and the same words the sidebar uses for that screen — which is the context the arrow alone
   * could never carry (owner's direction, 2026-09-03).
   *
   * It composes the design-system EyebrowLink — a masthead eyebrow that navigates — so it wears the
   * eyebrow register (subtle letterspaced small-caps at the xs step) for free, and, being a label
   * rather than a control, carries no control height: the arrow's ink sits flush with the
   * block-start edge of its box, landing the same distance from a page frame's top as from its
   * inline start. The register, the caps tracking, and the hit target all live in the component.
   *
   * Screens do not place this themselves — screen-header.svelte does, from the destination its
   * `back` names, so every screen's way back is the same shape in the same position. The glyph is
   * decorative (the name beside it says the same thing), so it is hidden from assistive technology;
   * the anchor carries the explicit accessible name "Back to <destination>", of which the visible
   * text stays a substring (WCAG Label in Name).
   *
   * `arrow-only` drops the glyph and the name for a header whose top line already reads in the
   * eyebrow register and cannot spare a second one. It is the exception, not a peer of the default:
   * a bare arrow says only "back", which is the ambiguity the labelled form exists to remove.
   *
   * Presentational only: the semantic landmark (a `nav`) belongs to whatever places the link.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import type { Component } from "svelte";

  let {
    href,
    label,
    icon: DestinationIcon,
    display = "labelled",
  }: {
    href: string;
    /** The destination's name — spoken either way, shown in the `labelled` form. */
    label: string;
    /** The destination's own glyph, shown beside its name: the screen in miniature. */
    icon?: Component;
    /** `arrow-only` where the header line the arrow joins already reads in the eyebrow register. */
    display?: "labelled" | "arrow-only";
  } = $props();
</script>

<EyebrowLink {href} aria-label={`Back to ${label}`}>
  <ArrowLeft class="size-12" aria-hidden="true" />
  {#if display === "labelled"}
    {#if DestinationIcon !== undefined}
      <DestinationIcon class="size-12" aria-hidden="true" />
    {/if}
    {label}
  {/if}
</EyebrowLink>

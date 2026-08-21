<script lang="ts">
  /*
   * BackLink — the return affordance above a page masthead: a leading back arrow, then the NAME of
   * the destination (not the word "Back"), so a reader learns WHERE the link goes rather than merely
   * which direction. It composes the design-system EyebrowLink — a masthead eyebrow that navigates —
   * so it wears the eyebrow register (subtle letterspaced small-caps at the xs step) for free, and,
   * being a label rather than a control, carries no control height: the arrow's ink sits flush with
   * the block-start edge of its box, landing the same distance from a page frame's top as from its
   * inline start. (The register, the caps tracking, and the hit target all live in the component, so
   * this file no longer reaches for a raw letter-spacing style or a negative-margin pull.)
   *
   * The visible text is the destination alone (e.g. "Tools"); read out of context next to a masthead
   * of the same shape that bare word is ambiguous, so the anchor carries an explicit accessible name
   * of the form "Back to <destination>", of which the visible text stays a substring (WCAG Label in
   * Name). The arrow is decorative and hidden from assistive technology.
   *
   * Presentational only: the semantic landmark (a `nav`) belongs to whatever places the link.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";

  let { href, label }: { href: string; label: string } = $props();
</script>

<EyebrowLink {href} aria-label={`Back to ${label}`}>
  <ArrowLeft class="size-12" aria-hidden="true" />
  {label}
</EyebrowLink>

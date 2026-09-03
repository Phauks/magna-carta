<script lang="ts">
  /*
   * BackLink — the return affordance at the top of a screen that was entered FROM another screen:
   * a leading back arrow pointing at the screen it came from. Every screen that lives under a main
   * screen carries one, and `pnpm run lint:back-navigation` refuses a new one that does not (the
   * rule and its two forms are in docs/conventions/ui-design.md).
   *
   * It composes the design-system EyebrowLink — a masthead eyebrow that navigates — so it wears the
   * eyebrow register (subtle letterspaced small-caps at the xs step) for free, and, being a label
   * rather than a control, carries no control height: the arrow's ink sits flush with the
   * block-start edge of its box, landing the same distance from a page frame's top as from its
   * inline start. (The register, the caps tracking, and the hit target all live in the component, so
   * this file no longer reaches for a raw letter-spacing style or a negative-margin pull.)
   *
   * TWO FORMS, AND THE HEADER PICKS BETWEEN THEM.
   *
   * `labelled` (the default) shows the destination's NAME rather than the word "Back", so a reader
   * learns WHERE the link goes rather than merely which direction. It sits above a masthead, tight
   * to it, and reads as the title's eyebrow.
   *
   * `arrow-only` is for a header that ALREADY carries a line in the eyebrow register — a matter's
   * ledger line, a record's kind. There the arrow leads that line instead of stacking a second caps
   * label above it: a second label competes with the line for the same register and reads as a
   * breadcrumb trail with one crumb (owner ruling on the matter header, 2026-09-01). The label is
   * still required, because it is still spoken.
   *
   * Either way the anchor carries an explicit accessible name of the form "Back to <destination>",
   * of which the visible text — when there is any — stays a substring (WCAG Label in Name). The
   * arrow is decorative and hidden from assistive technology.
   *
   * Presentational only: the semantic landmark (a `nav`) belongs to whatever places the link, and a
   * lone link inside a header line does not need one.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";

  let {
    href,
    label,
    display = "labelled",
  }: {
    href: string;
    /** The destination's name — spoken either way, shown in the `labelled` form. */
    label: string;
    /** `arrow-only` where the header line the arrow joins already reads in the eyebrow register. */
    display?: "labelled" | "arrow-only";
  } = $props();
</script>

<EyebrowLink {href} aria-label={`Back to ${label}`}>
  <ArrowLeft class="size-12" aria-hidden="true" />
  {#if display === "labelled"}{label}{/if}
</EyebrowLink>

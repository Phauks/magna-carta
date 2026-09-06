<script lang="ts">
  /*
   * ScreenHeader — the one way a screen states what it is. Every screen's title comes from here.
   *
   * WHY IT EXISTS. Twenty screens assembled the design-system Masthead by hand, in eight different
   * combinations of its parts, and four more hand-rolled an `h1` over a letterspaced `p` outside the
   * design system entirely. Nothing was wrong with any one of them; the problem was that they were
   * all slightly different, so "what does a screen header look like here" had twenty-four answers
   * and a correction had to be made twenty-four times. The Masthead recipe stays the primitive —
   * the register, the display serif, the density step — and this is the one assembly of it.
   *
   * THE ANATOMY, in the order a reader meets it:
   *
   *   ← ⌂ MATTERS        the way back, showing the destination in miniature (its glyph, its name)
   *   PERSON             the eyebrow: what this screen's subject IS, when that needs saying
   *   Rosalind Chase     the title, in the display serif
   *   she/her · …        the meta line, the citation beneath the title
   *
   * with the actions at the inline end of the title row. The way back leads the stack rather than
   * sharing the eyebrow's line, so the two never compete for the same register: one names where you
   * would go, the other names what you are looking at (owner's selection, 2026-09-03).
   *
   * THE TITLE IS THE DESTINATION'S OWN NAME, and on a main screen it is the whole header. A screen
   * that names itself something the sidebar calls something else costs the two a shared vocabulary
   * and buys a reader nothing, so the title comes from navigation/destinations.ts. The EYEBROW is
   * for what the screen's SUBJECT is — PERSON over a person's name — never for what the screen is:
   * on a destination screen the title is already that answer, so an eyebrow there can only repeat
   * it. No main screen carries one, and the META line takes facts (a date, a seat count, a maturity
   * badge), never a sentence restating the title. Ruled in docs/conventions/design-corrections.md,
   * "Screen headers".
   *
   * THE WAY BACK IS NAMED, NOT DRAWN. A screen passes `back="directory"` — a destination id — and
   * the href, the label and the glyph come from the sidebar's own registry (screen-header.ts). A
   * screen cannot invent a destination, call it something the sidebar calls something else, or go
   * stale when a path moves. `pnpm run lint:back-navigation` refuses a screen that sits under
   * another screen and passes no `back` at all.
   *
   * THE TRAILING COLUMN is for a band that shares its height with something else — the matter's
   * search over its section strip. Passing it is what makes the title truncate rather than wrap and
   * the band stretch to one height, because those follow from the two-column arrangement rather
   * than being separate decisions a caller could get inconsistently right.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import type { MastheadDensity } from "@magna-carta/design-system/masthead";
  import BackLink from "$lib/navigation/back-link.svelte";
  import { resolveBackDestination, type BackTarget } from "$lib/screen/screen-header.ts";
  import type { Snippet } from "svelte";

  let {
    title,
    back,
    eyebrow,
    density = "default",
    meta,
    actions,
    trailing,
    class: className,
  }: {
    /** The screen's name, in the display serif. Becomes the page's h1. */
    title: string;
    /** Where this screen was entered from: a sidebar destination's id, or a spelled-out screen. */
    back?: BackTarget;
    /**
     * What the screen's SUBJECT is — a record's kind, a section's name. Never what the screen is:
     * a main screen's title already says that, so a main screen passes no eyebrow.
     */
    eyebrow?: string;
    density?: MastheadDensity;
    /** The citation line beneath the title. */
    meta?: Snippet;
    /** The inline-end group on the title's row. */
    actions?: Snippet;
    /** A second column sharing the band's height (the matter's search over its section strip). */
    trailing?: Snippet;
    class?: string;
  } = $props();

  const destination = $derived(back === undefined ? null : resolveBackDestination(back));

  /*
   * A trailing column means the heading no longer owns the row, so the title takes an ellipsis
   * rather than wrapping (a wrapped title drags the citation down and the band grows), and the
   * band stretches so the trailing column can seat its own contents against its edges. Both follow
   * from the arrangement, so neither is a separate switch a caller could set the wrong way.
   */
  const sharesTheRow = $derived(trailing !== undefined);
</script>

<div class={className}>
  <!-- One link back to one screen is not a breadcrumb trail, so the landmark is named for what it
       is; announcing it as a breadcrumb would send a reader looking for a path that is not there.
       The nav is a flex container so the inline-flex link is a flex item rather than a line-box
       inhabitant — a block nav leads the link down by half the difference between its own
       line-height and the link's, indenting the arrow from the frame's block-start edge while its
       inline-start edge stays flush. The gap sits tight to the masthead so the link reads as the
       title's eyebrow rather than a separate band above the screen. -->
  {#if destination !== null}
    <nav aria-label={`Back to ${destination.label}`} class="mb-4 flex">
      <BackLink href={destination.href} label={destination.label} icon={destination.icon} />
    </nav>
  {/if}

  <Masthead.Root {density} class={sharesTheRow ? "items-stretch" : undefined}>
    <Masthead.Heading class={sharesTheRow ? "min-w-0 max-w-2xl flex-1" : "min-w-0"}>
      {#if eyebrow !== undefined}
        <Masthead.Eyebrow>{eyebrow}</Masthead.Eyebrow>
      {/if}
      {#if sharesTheRow}
        <Masthead.Title class="truncate" title={title}>{title}</Masthead.Title>
      {:else}
        <Masthead.Title>{title}</Masthead.Title>
      {/if}
      {#if meta !== undefined}
        <Masthead.Meta class={sharesTheRow ? "flex-nowrap" : undefined}>{@render meta()}</Masthead.Meta>
      {/if}
    </Masthead.Heading>

    {#if actions !== undefined}
      <Masthead.Actions>{@render actions()}</Masthead.Actions>
    {/if}
    {#if trailing !== undefined}
      {@render trailing()}
    {/if}
  </Masthead.Root>
</div>

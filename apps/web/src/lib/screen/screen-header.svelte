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
   * EVERY HEADER CARRIES THE PAGE'S OWN MENU, and the favourite gesture lives in it (owner's
   * direction, 2026-11-09, "move star to page ... menu"; the gesture itself reaching every page is
   * the 2026-09-16 direction). The `…` holds what is about this page rather than work done on it:
   * Add to Favorites, Copy Link, Open in New Tab, then the screen's own secondary page-level items
   * passed as `pageMenu` (page-actions-menu.svelte). It sits on the title's row, beside the name,
   * because that is where it means "this page" — and because a screen with a trailing column seats
   * its actions between the two columns, which would have left it floating mid-band on a matter.
   * The screen passes nothing for the favourite: the address and the name are the address in the
   * bar and this header's own title. `favoritable={false}` is for a screen that is not a place a
   * member returns to and passes around — a step in a flow, a dev-only console — and it drops the
   * whole menu, because every item in it is a question about a place.
   *
   * THE TRAILING COLUMN is for a band that shares its height with something else — the matter's
   * search over its section strip. Passing it is what makes the title truncate rather than wrap and
   * the band stretch to one height, because those follow from the two-column arrangement rather
   * than being separate decisions a caller could get inconsistently right.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import PageActionsMenu from "$lib/screen/page-actions-menu.svelte";
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
    favoritable = true,
    pageMenu,
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
    /**
     * Whether this screen may be favourited. True everywhere by default — a screen with a title is
     * a place. False for a screen that is a STEP rather than a place, or one nobody should be
     * shortcutting to (the developer console).
     */
    favoritable?: boolean;
    /**
     * The screen's own items for the page menu beside the title (`DropdownMenu.Item`s), drawn
     * beneath the three every page carries. Live, secondary, page-level items only: the screen's
     * main work stays in `actions`, and an unwired item stays on the row marked Soon.
     */
    pageMenu?: Snippet;
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
      <!-- THE TITLE'S ROW, and the page menu sits on it rather than in the actions group. A screen with
           a trailing column (a matter's search over its section strip) seats its actions BETWEEN
           the two columns, which would have left the menu floating in the middle of the band on
           exactly the screens somebody most wants to favourite. Beside the name it reads as being
           about this page, which is what it is, and it lands in the same place on every screen
           whatever else the header carries. -->
      <div class="flex min-w-0 items-center gap-8">
        {#if sharesTheRow}
          <Masthead.Title class="truncate" title={title}>{title}</Masthead.Title>
        {:else}
          <Masthead.Title class="min-w-0">{title}</Masthead.Title>
        {/if}
        {#if favoritable}
          <div class="flex flex-none items-center">
            <PageActionsMenu {title} items={pageMenu} />
          </div>
        {/if}
      </div>
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

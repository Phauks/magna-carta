<script lang="ts">
  /*
   * The matter's header band — the ceremonial edge and the section navigation, in ONE band.
   *
   * The arrangement (owner's selections, 2026-08-31 through 2026-09-01): the identity block on the
   * reading edge, the matter's search and the section strip stacked in the column at the inline
   * end, the strip flush against the band's bottom rule. 152px of chrome became 111px when the
   * strip moved off its own row, and 76px when the identity block stopped spending three rows on
   * itself; the search takes the space the strip's row left behind rather than a row of its own.
   *
   * THE BAND CARRIES ONE ACTION, AND IT IS THE CREATE CONTROL. The search is a way IN to the
   * matter; the create control beside it (owner's placement, 2026-09-03) is the one way something
   * new is made on it — "New Fee" on Fees, "New File" on Files, its label answered by the section
   * registry and its behaviour claimed by the section's page (create-action.svelte.ts). It is one
   * width on every section, so the search it sits beside never moves. It replaces the create
   * button each section used to carry in its own action row, which sat a different distance down
   * the screen on every tab. The band's earlier overflow (...) control, whose only item was the
   * status's lifecycle action shipped disabled and marked Soon, was removed on 2026-09-01: a menu
   * that has to be opened to find out it holds nothing pressable is chrome that costs a control's
   * width and returns nothing. When the lifecycle action is wired it comes back as a named button,
   * on the row and legible at rest, not behind a glyph.
   *
   * THE LEDGER LINE HAS NO ROW OF ITS OWN. The matter number and its status seal lead the citation
   * beneath the title, where they still read first, instead of costing a full line above it. That
   * is a whole row rather than a few points of type, which is why it beat shrinking the title
   * further — at the next step down the display face is close enough to the citation that the
   * masthead register's scale contrast nearly goes.
   *
   * THE TITLE TRUNCATES; IT DOES NOT WRAP. At a 1024 canvas there is not room for a full-scale
   * serif title AND a useful strip on one row, and only three things can give. Letting the title
   * wrap was measured first: the citation follows it down and the band ends up TALLER than the two
   * rows this arrangement replaced, which defeats the whole point. Letting the identity block hold
   * its natural width instead starves the strip — it fell to a single tab plus More at 1060. So
   * the two sides share the row evenly and the title takes an ellipsis, with the full name on the
   * element's `title` for the hover and in the document title either way. The band is then one
   * height at every canvas width, which is the property this arrangement was chosen for.
   *
   * The Masthead recipe is the one door to the display serif, so the identity block still composes
   * Masthead.Heading and takes its step from the recipe's own `density` rather than a type utility
   * on the Title. The Actions slot is left unused: the inline-end column belongs to the search and
   * the strip, which need to share a column rather than a slot.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases: the
   * seal and the number-or-Consultation line.
   *
   * THE SEAL IS THE CONTROL. Pressing the status seal opens the status window, which is where a
   * matter is opened, closed or reopened (matter-status-dialog.svelte). An action that belongs to a
   * fact belongs on it.
   *
   * THE WAY BACK LEADS THE CITATION, AS AN ARROW ALONE. The return to the docket is the first thing
   * on the line, ahead of the ledger line, wearing the same eyebrow register the ledger line wears.
   * It holds its width with them, so the citation is still what gives when the band narrows. It
   * carries no visible label: above a masthead a bare arrow is ambiguous, which is the labelled
   * BackLink's whole reason, but here a matter came from the docket, the docket is the only place up
   * from it, and the line the arrow sits on names the matter it is leaving. A second caps label
   * competed with the number for the same register and read as a breadcrumb trail with one crumb.
   * The accessible name is on the anchor, so the destination is still spoken.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import MatterCreateControl from "$lib/matters/matter-create-control.svelte";
  import type { MatterCreateSlot } from "$lib/matters/create-action.svelte.ts";
  import MatterSearchControl from "$lib/matters/matter-search-control.svelte";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import MatterStatusDialog from "$lib/matters/matter-status-dialog.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  /** The docket. Every matter came from it, and it is where the way out leads. */
  const MATTERS_HREF = "/matters";

  let { matter, createSlot }: { matter: MatterRecord; createSlot: MatterCreateSlot } = $props();

  // The citation line's entries in reading order, nulls dropped — a consultation simply has a
  // shorter citation, never an empty slot.
  const metaEntries = $derived(
    [
      matter.clientDisplayName === null
        ? null
        : matter.clientCode === null
          ? matter.clientDisplayName
          : `${matter.clientDisplayName} (${matter.clientCode})`,
      matter.matterTypeName,
      matter.responsibleAttorneyName,
      matter.locationName,
    ].filter((entry): entry is string => entry !== null),
  );

  /*
   * The citation as ONE string rather than a row of spans. The band's height is only constant if
   * this line cannot wrap, and a flex row of separate entries cannot ellipsis: truncating each
   * entry to its share gives four stubs and no citation (measured), while clipping the row cuts a
   * word in half with nothing to say it was cut. Joined, the line reads as far as it fits and
   * stops. The cost is the interpunct's own lighter ink — it is text here, not a separator
   * element — which is the smaller loss.
   */
  const citation = $derived(metaEntries.join(" · "));

  /*
   * The number the file is called by. A consultation wears its own tentative number and is LABELLED
   * as one, so nobody reads it as a matter number; once the matter opens the permanent number takes
   * the line and the tentative one stays on the record. A consultation taken before the sequence
   * existed has neither, and says only what it is.
   */
  const ledgerLine = $derived.by(() => {
    if (matter.matterNumber !== null) return `Matter ${matter.matterNumber}`;
    return matter.consultationNumber === null
      ? "Consultation"
      : `Consultation ${matter.consultationNumber}`;
  });
</script>

<Masthead.Root density="compact" class="items-stretch border-b border-border-default">
  <Masthead.Heading class="min-w-0 max-w-2xl flex-1 pb-16">
    <Masthead.Title class="truncate" title={matter.title}>{matter.title}</Masthead.Title>
    <Masthead.Meta class="flex-nowrap">
      <!-- The way back, the ledger line and the status seal lead the citation: still the first
           things read on the line, without costing a line of their own. All three hold their width
           so the citation is what gives when the band narrows.
           One link back to the docket is not a breadcrumb trail, so the landmark is named for what
           it is; announcing it as a breadcrumb would send a reader looking for a path that is not
           there. -->
      <nav aria-label="Back to Matters" class="flex flex-none">
        <EyebrowLink href={MATTERS_HREF} aria-label="Back to Matters">
          <ArrowLeft class="size-12" aria-hidden="true" />
        </EyebrowLink>
      </nav>
      <span
        class="flex-none text-xs font-semibold text-text-subtle uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {ledgerLine}
      </span>
      <!-- The seal is where the matter's status is read, and now also where it is changed. -->
      <span class="flex-none"><MatterStatusDialog {matter} /></span>
      <Masthead.MetaSeparator />
      <span class="truncate" title={citation}>{citation}</span>
    </Masthead.Meta>
  </Masthead.Heading>

  <!-- The inline-end column holds the search over the strip. It stays a flex column with items-end
       so the strip sits on the band's bottom rule (the Masthead's own items-stretch would
       otherwise hold it at the top of a full-height cell), and min-w-0 so the strip's measured
       fold has a width it can actually shrink to. justify-between is what pins the two to the
       band's two edges rather than letting them bunch.

       THE SEARCH SITS ABOVE THE STRIP, NOT ON ITS ROW, and that is measured rather than aesthetic:
       the field grows toward the inline start as it opens, so sharing the row would shove the tabs
       sideways on the first keystroke — and the strip's own fold would then re-measure mid-typing.
       Rendering it in the HEADER, which the matter layout draws over every section, is what puts
       one search on every screen and stops a section growing its own.

       THE CREATE CONTROL ENDS THE ROW, AFTER THE SEARCH. The search grows toward the inline start,
       so a control placed after it is the one place on the row the field's growth cannot reach —
       the file manager's own ruling about New keeping its place, applied here. The control's width
       is a token, so the row is the same shape on every section. -->
  <div class="flex min-w-0 flex-1 flex-col items-end justify-between gap-8">
    <div class="flex flex-none items-center gap-8 pt-4">
      <MatterSearchControl matterId={matter.id} />
      <MatterCreateControl slot={createSlot} matterId={matter.id} />
    </div>
    <MatterSectionNav matterId={matter.id} />
  </div>
</Masthead.Root>

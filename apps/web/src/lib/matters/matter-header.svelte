<script lang="ts">
  /*
   * The matter's header band — the ceremonial edge and the section navigation, in ONE band.
   *
   * The arrangement (owner's selections, 2026-08-31 and 2026-09-01): the identity block on the
   * reading edge, the section strip and the overflow control sharing ONE row at the inline end,
   * flush against the band's bottom rule. 152px of chrome became 111px when the strip moved off
   * its own row, and 76px when the identity block stopped spending three rows on itself.
   *
   * WHY THE OVERFLOW CONTROL IS ON THE STRIP'S ROW, AND NOT ABOVE IT. Stacked, that column is the
   * control (40px) over the strip (41px) with a gap between them — 89px, which floored the whole
   * band at 90px however short the identity block got. Three quite different identity treatments
   * were measured at exactly 90px because of it. One row at the inline end is 41px, and the
   * identity block sets the height again. The control carries `pb-8` so it sits ABOVE the rule
   * rather than on it: the rule belongs to the sections, whose gold active bar draws on it, and a
   * bordered button sitting on it reads as part of the strip.
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
   * on the Title. The Actions slot is left unused: this action belongs to the strip's row, not to
   * the title's inline end.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases: the
   * seal and the number-or-Consultation line.
   *
   * THE SEAL IS THE CONTROL, AND THERE IS NO OVERFLOW MENU. Pressing the status seal opens the
   * status window, which is where a matter is opened, closed or reopened
   * (matter-status-dialog.svelte). The lifecycle action used to sit in a ⋯ menu on the strip's row,
   * disabled and marked Soon; it is live now and it belongs on the fact it changes, so the menu —
   * which held nothing else — went with it. An action that belongs to a fact belongs on it, and the
   * strip's row is one control shorter for it.
   *
   * THE WAY BACK LEADS THE CITATION, AS AN ARROW ALONE. The return to the docket is the first thing
   * on the line, ahead of the ledger line, wearing the same eyebrow register the ledger line wears.
   * It holds its width with them, so the citation is still what gives when the band narrows.
   *
   * It carries no visible label, which is the one place this differs from the labelled BackLink the
   * tools pages use. That component's rule is right where it applies: above a masthead, a bare
   * arrow leaves a reader guessing which "back" is meant. Here it is unambiguous — a matter came
   * from the docket, the docket is the only place up from it, and the line the arrow sits on names
   * the matter it is leaving. A second caps label beside "MATTER 2026-0147" competed with the
   * number for the same register and read as a breadcrumb trail with one crumb. The accessible name
   * is on the anchor, so the destination is still spoken; it is EyebrowLink directly rather than a
   * label-hiding option on BackLink, because a component whose stated reason for existing is that
   * it names its destination should not grow a mode that does not.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import MatterStatusDialog from "$lib/matters/matter-status-dialog.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  /** The docket. Every matter came from it, and it is where the way out leads. */
  const MATTERS_HREF = "/matters";

  let { matter }: { matter: MatterRecord } = $props();

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

  <div class="flex min-w-0 flex-1 items-end justify-end gap-8">
    <div class="min-w-0 flex-1">
      <MatterSectionNav matterId={matter.id} />
    </div>
  </div>
</Masthead.Root>

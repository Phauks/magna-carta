<script lang="ts">
  /*
   * The matter's header band — the ceremonial edge and the section navigation, in ONE band.
   *
   * The arrangement (owner's selections, 2026-08-31 through 2026-09-01): the identity block on the
   * reading edge, the section strip alone in the column at the inline end, flush against the
   * band's bottom rule. 152px of chrome became 111px when the strip moved off its own row, and
   * 76px when the identity block stopped spending three rows on itself.
   *
   * THE BAND CARRIES NO ACTIONS. It held one overflow (...) control whose only item was the
   * status's lifecycle action, shipped disabled and marked Soon. The owner removed it on
   * 2026-09-01: a menu that has to be opened to find out it holds nothing pressable is chrome that
   * costs a control's width and returns nothing. When the lifecycle action is wired it comes back
   * as a named button, on the row and legible at rest, not behind a glyph.
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
   * on the Title. The Actions slot is left unused: the inline-end column belongs to the strip.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases: the
   * seal and the number-or-Consultation line.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The status seal comes from the one matter-status register, so the header and the docket's
  // status column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));

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
      <!-- The ledger line and the status seal lead the citation: still the first thing read on the
           line, without costing a line of their own. Both hold their width so the citation is what
           gives when the band narrows. -->
      <span
        class="flex-none text-xs font-semibold text-text-subtle uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {ledgerLine}
      </span>
      <Badge
        variant={seal.variant}
        class="flex-none uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {seal.label}
      </Badge>
      <Masthead.MetaSeparator />
      <span class="truncate" title={citation}>{citation}</span>
    </Masthead.Meta>
  </Masthead.Heading>

  <!-- The inline-end column is the strip and nothing else. It stays a flex column with items-end
       so the strip sits on the band's bottom rule (the Masthead's own items-stretch would
       otherwise hold it at the top of a full-height cell), and min-w-0 so the strip's measured
       fold has a width it can actually shrink to. -->
  <div class="flex min-w-0 flex-1 items-end">
    <MatterSectionNav matterId={matter.id} />
  </div>
</Masthead.Root>

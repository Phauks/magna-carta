<script lang="ts">
  /*
   * The matter header's create control — the design system's CreateControl, answered from two
   * places: the section registry says WHAT it reads, and the section's page says what pressing
   * DOES. It sits beside the matter's search (owner's placement, 2026-09-03) and holds one width
   * on every section; the control itself owns the width, the truncation and the disabled-with-
   * reason treatment, so this file only decides what to hand it.
   *
   * THE LABEL COMES FROM THE ADDRESS. sections.ts answers "New <what>" for the section the reader is
   * on, so "New Fee" is showing before the Fees page has mounted and stays showing while it loads.
   * The page then claims the behaviour (create-action.svelte.ts); until it has, and whenever it
   * states a refusal, the control is disabled carrying the line that says why.
   *
   * A SECTION THAT MAKES SEVERAL KINDS READS THE BARE "NEW", and its menu names them. The registry
   * says which sections those are rather than this file reading it off the claim's choices: a label
   * derived from the claim would show the noun until the page mounted and then change under the
   * reader, and the header's business is holding still.
   *
   * A CLAIM IS CHECKED AGAINST THE ADDRESS, AND A MISMATCH IS IGNORED RATHER THAN THROWN. The label
   * comes from the address and the behaviour from the claim, so a claim belonging to another section
   * must never be pressable — the label would say one thing and the press would do another. It is
   * NOT, however, a defect: leaving a section updates `page.url` before the outgoing page's effect
   * cleanup releases its claim, so for one flush every ordinary navigation holds a claim for the
   * section the reader has just left. This threw on that window, which crashed the screen on any tab
   * change (Files to Parties, and every other pair). Ignoring the stale claim closes the window
   * honestly: the control falls back to disabled carrying the line that says it has no action yet,
   * which is exactly what it shows in the moment before a section claims — and the same treatment
   * makes a genuine mismatch visible as a control that never becomes pressable, instead of a
   * white screen.
   */
  import { page } from "$app/state";
  import CreateControl from "@magna-carta/design-system/create-control";
  import { honouredClaim, type MatterCreateSlot } from "$lib/matters/create-action.svelte.ts";
  import { CREATE_SEVERAL_KINDS, sectionForPathname } from "$lib/matters/sections.ts";

  let { slot, matterId }: { slot: MatterCreateSlot; matterId: string } = $props();

  const section = $derived(sectionForPathname(matterId, page.url.pathname));

  const claim = $derived(honouredClaim(slot.held, section?.slug));

  /** Why the control cannot be pressed right now, or undefined while it can. */
  const refusal = $derived.by((): string | undefined => {
    if (section === undefined) return "Nothing is created from this screen.";
    if (section.createNoun === null) return section.createWaitingOn;
    if (claim === null) return "This section has not offered its create action yet.";
    return claim.refusal;
  });

  /** The noun the control reads, or null for the bare "New" — nothing here, or several kinds. */
  const noun = $derived.by((): string | null => {
    const declared = section?.createNoun ?? null;
    return declared === CREATE_SEVERAL_KINDS ? null : declared;
  });

  /* The menu's items in the design system's vocabulary; the claim's `run` is the item's select. */
  const choices = $derived(
    claim?.choices?.map((choice) => ({
      label: choice.label,
      icon: choice.icon,
      onselect: choice.run,
      refusal: choice.refusal,
    })),
  );
</script>

<CreateControl
  {noun}
  title={claim?.title}
  {refusal}
  onpress={claim?.run}
  {choices}
/>

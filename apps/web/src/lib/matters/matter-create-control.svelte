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
   * A CLAIM IS CHECKED AGAINST THE ADDRESS. A page that claims for a section other than the one the
   * reader is standing on is a defect refused loudly rather than rendered: the label would say one
   * thing and the press would do another.
   */
  import { page } from "$app/state";
  import CreateControl from "@magna-carta/design-system/create-control";
  import type { MatterCreateSlot } from "$lib/matters/create-action.svelte.ts";
  import { sectionForPathname } from "$lib/matters/sections.ts";

  let { slot, matterId }: { slot: MatterCreateSlot; matterId: string } = $props();

  const section = $derived(sectionForPathname(matterId, page.url.pathname));

  const claim = $derived.by(() => {
    const held = slot.held;
    if (held === null) return null;
    if (section === undefined || held.section !== section.slug) {
      throw new Error(
        `The create control is claimed for "${held.section}" but the reader is on ` +
          `${section === undefined ? "no section" : `"${section.slug}"`}. A page claims the ` +
          "control only for the section it renders.",
      );
    }
    return held;
  });

  /** Why the control cannot be pressed right now, or undefined while it can. */
  const refusal = $derived.by((): string | undefined => {
    if (section === undefined) return "Nothing is created from this screen.";
    if (section.createNoun === null) return section.createWaitingOn;
    if (claim === null) return "This section has not offered its create action yet.";
    return claim.refusal;
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
  noun={section?.createNoun ?? null}
  title={claim?.title}
  {refusal}
  onpress={claim?.run}
  {choices}
/>

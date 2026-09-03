<script lang="ts">
  /*
   * The matter layout stand-in: provides the slot, hands it out, and swaps one section page for
   * another the way navigation does — the leaving page in one branch, the arriving one in the
   * other — so the test can watch the claim change hands.
   */
  import { provideMatterCreateSlot } from "$lib/matters/create-action.svelte.ts";
  import Claimant from "./create-claimant.svelte";

  let { onSlot }: { onSlot: (slot: ReturnType<typeof provideMatterCreateSlot>) => void } = $props();

  const slot = provideMatterCreateSlot();
  // svelte-ignore state_referenced_locally
  onSlot(slot);

  let section = $state("fees");
  let doubled = $state(false);

  /** Move the reader to another section. */
  export function show(next: string): void {
    section = next;
  }

  /** Mount a second claimant beside the first — the defect the slot refuses. */
  export function double(): void {
    doubled = true;
  }
</script>

<!-- Keyed on the section, as a route is: navigation replaces the page component rather than
     handing the old one a new slug. -->
{#key section}
  <Claimant {section} />
{/key}
{#if doubled}
  <Claimant section="costs" />
{/if}

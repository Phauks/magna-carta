<script lang="ts">
  /*
   * Picking a colleague — the one control every seat on a matter's team is filled from.
   *
   * It is the design system's single Combobox in the documented shape: the consumer owns the input
   * text, typing narrows the list, a pick writes the chosen name back, and closing the listbox
   * resets the text to whatever is actually selected, so typed-but-unchosen text is never mistaken
   * for a value.
   *
   * THE FIELD SHOWS WHO IS IN THE SEAT, WHICHEVER WAY IT WAS FILLED. Two callers use this control
   * differently: one HOLDS a person (the responsible attorney — exactly one seat) and one COLLECTS
   * them (the assigned lists, which empty the field after each pick and show the people as chips).
   * Both may hand over `onpick`, so the reset cannot key on that: it keys on whether anything is
   * actually selected. A held seat that rendered its ghost text read as an empty field with nobody
   * in it, on a screen whose whole job is saying who carries the matter.
   *
   * WHO IT OFFERS. Members who are still here, minus anybody already holding a seat on this matter.
   * A departed colleague is deliberately absent: there is nobody to hand new work to. That is the
   * opposite of how their name is treated on a matter they already carry, where it always renders —
   * a name is history, not a join against current membership.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";

  let {
    members,
    value = $bindable(null),
    inputId,
    label,
    exclude = [],
    disabled = false,
    onpick,
  }: {
    /** The firm's roster. Deactivated members are filtered out here, not by the caller. */
    members: readonly FirmMemberSummary[];
    /** The chosen member's identifier, or null for "nobody". Bindable. */
    value?: string | null;
    /** The input's id, so the caller's Label points at it. */
    inputId: string;
    /** The field's own name, which is also its ghost text. */
    label: string;
    /** Members already seated elsewhere on this matter, which this control must not offer again. */
    exclude?: readonly string[];
    disabled?: boolean;
    /**
     * Called with the picked identifier. A caller that COLLECTS people rather than holding one
     * (the assigned lists) uses this and leaves `value` alone, so the field can clear itself.
     */
    onpick?: (memberId: string) => void;
  } = $props();

  /** What has been typed. Meaningful only while the field is being edited. */
  let query = $state("");
  /**
   * Whether the reader is searching rather than reading the seat.
   *
   * The field has two jobs and they want two different texts in it: at rest it must say who holds
   * the seat, and while somebody is looking for a colleague it must say what they have typed. The
   * flag is what keeps the second from overwriting the first — without it, a seat that is already
   * filled narrows the roster to the person already in it, and the only way to name somebody else
   * is to empty the field first.
   */
  let searching = $state(false);

  const offered = $derived(
    members.filter((member) => member.status === "active" && !exclude.includes(member.userId)),
  );
  const selectedName = $derived(
    value === null ? "" : (members.find((member) => member.userId === value)?.displayName ?? ""),
  );

  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return offered;
    return offered.filter((member) => member.displayName.toLowerCase().includes(needle));
  });

  /** Searching stops the moment a person is chosen, so the field goes back to naming the seat. */
  function settle(): void {
    searching = false;
    query = "";
  }

  /**
   * Bumped after every pick a CALLER owns, which remounts the control.
   *
   * The primitive's input text is its own: it writes the chosen person's name into the field and
   * offers no way to set it back afterwards. That is right for a control that holds its selection
   * and wrong for one that hands the person over and must be ready for the next — the field went on
   * printing the last person's name beside the chip that had already been made from them. So a
   * caller-owned pick starts a fresh control, whose text is read from the seat as it now stands.
   */
  let handedOver = $state(0);

  function pick(picked: string | string[]): void {
    const memberId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (memberId === "") {
      value = null;
      settle();
      return;
    }
    if (onpick) {
      onpick(memberId);
      settle();
      handedOver += 1;
      return;
    }
    value = memberId;
    settle();
  }
</script>

{#key handedOver}
  <!-- A re-pick of the chosen member confirms them; the primitive's default deselect would empty
       the field on the next click outside ($lib/time/matter-picker.svelte says it in full). -->
  <Combobox.Root
    type="single"
    allowDeselect={false}
    {disabled}
    items={matching.map((member) => ({ value: member.userId, label: member.displayName }))}
    inputValue={searching ? query : selectedName}
    onValueChange={pick}
    onOpenChange={(open) => {
      if (!open) settle();
    }}
  >
    <Combobox.Input
      id={inputId}
      placeholder={label}
      onfocus={() => {
        // Arriving in the field is asking to search, so the whole roster is on offer again rather
        // than the one person whose name happens to be sitting in it.
        searching = true;
        query = "";
      }}
      onblur={settle}
      oninput={(event) => {
        searching = true;
        query = event.currentTarget.value;
      }}
    />
    <Combobox.Content>
      {#each matching as member (member.userId)}
        <Combobox.Item value={member.userId} label={member.displayName} />
      {/each}
    </Combobox.Content>
  </Combobox.Root>
{/key}

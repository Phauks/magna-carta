<script lang="ts">
  /*
   * Picking a colleague — the one control every seat on a matter's team is filled from.
   *
   * It is the design system's single Combobox in the documented shape: the consumer owns the input
   * text, typing narrows the list, a pick writes the chosen name back, and closing the listbox
   * resets the text to whatever is actually selected, so typed-but-unchosen text is never mistaken
   * for a value.
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

  let query = $state("");

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

  function pick(picked: string | string[]): void {
    const memberId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (memberId === "") {
      value = null;
      query = "";
      return;
    }
    if (onpick) {
      onpick(memberId);
      query = "";
      return;
    }
    value = memberId;
    query = members.find((member) => member.userId === memberId)?.displayName ?? "";
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={matching.map((member) => ({ value: member.userId, label: member.displayName }))}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (!open) query = onpick ? "" : selectedName;
  }}
>
  <Combobox.Input
    id={inputId}
    placeholder={label}
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each matching as member (member.userId)}
      <Combobox.Item value={member.userId} label={member.displayName} />
    {/each}
  </Combobox.Content>
</Combobox.Root>

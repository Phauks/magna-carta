<script lang="ts">
  /*
   * A participant's role, OFFERED rather than asked for blind.
   *
   * IT IS A DROPDOWN-WITH-ADD, the product's one answer for a vocabulary that is neither closed nor
   * free — the same control the location field beside it and the matter-party role already are. It
   * was a bare text box, and the objection to that was not the spelling drift but the BLANKNESS: a
   * reader met an empty box labelled Role and could not tell what belonged in it. A list of the
   * roles that really occur answers that, and no placeholder could — ghost text is the field's own
   * name and vanishes at the first keystroke, which is exactly when an example would be wanted.
   *
   * WHAT IT STORES IS TEXT, as written. The record's column holds a short firm-supplied label, so a
   * judge, a court reporter and a role this product has never heard of are all just what somebody
   * typed, and nothing here is a key into anything. What the offered list buys is that the twenty
   * roles a firm writes over and over get written the SAME WAY each time —
   * `settledParticipantRole` in calendar-vocabulary.ts is where that happens, and it is why
   * "court reporter" comes back as "Court reporter" instead of founding a second role.
   *
   * A CLOSED LIST WAS THE OTHER OPTION AND IS THE WRONG ONE. The roles a firm needs do not close:
   * a special master, a Rule 30(b)(6) designee, a parenting coordinator, a check interpreter. A
   * closed list missing the role somebody needs makes them pick a wrong-but-adjacent one, which
   * corrupts the very consistency the list was for — and does it invisibly, because a wrong entry
   * from a fixed set looks clean. So the list ends in the add row.
   *
   * ONE CONTROL PER CHIP, each owning its own search. A shared query would filter every row's list
   * at once, and a role is a fact about one person at one event.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { PARTICIPANT_ROLE_OPTIONS, settledParticipantRole } from "./calendar-vocabulary.ts";

  let {
    value = "",
    accessibleName,
    onSettle,
    disabled = false,
  }: {
    /** The role this participant currently carries, as text. */
    value?: string;
    /** This row's field, named for a screen reader: "Role for Marian Holt". */
    accessibleName: string;
    /**
     * The settled role. A callback rather than a binding because the caller holds its participants
     * as an immutable list and replaces the one row — there is no element to bind into.
     */
    onSettle: (role: string) => void;
    disabled?: boolean;
  } = $props();

  /** The field's own name — its ghost text, and the noun the add row's sentence takes. */
  const FIELD_NAME = "Role";

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching rather than reading the role the field holds. */
  let searching = $state(false);

  const needle = $derived(searching ? query.trim().toLowerCase() : "");
  const offered = $derived(
    PARTICIPANT_ROLE_OPTIONS.filter((role) => role.toLowerCase().includes(needle)),
  );
  /** Whether what is typed is already an offered role, so the add row would only repeat it. */
  const typedIsOffered = $derived(
    query.trim() === "" ||
      PARTICIPANT_ROLE_OPTIONS.some((role) => role.toLowerCase() === query.trim().toLowerCase()),
  );

  function settle(next: string): void {
    searching = false;
    query = "";
    onSettle(settledParticipantRole(next));
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    // The add row means "keep what I typed", which is already the whole of what this field holds.
    settle(Combobox.isAddOption(chosen) ? query : chosen);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={offered.map((role) => ({ value: role, label: role }))}
  value={PARTICIPANT_ROLE_OPTIONS.includes(value) ? value : ""}
  inputValue={searching ? query : value}
  onValueChange={pick}
  onOpenChange={(open) => {
    // Leaving keeps what was typed: a role this list does not offer is an ordinary answer here, and
    // a field that discarded it would be the closed dropdown this deliberately is not.
    if (!open) settle(searching && query.trim() !== "" ? query : value);
  }}
>
  <Combobox.Input
    class="w-3xs"
    aria-label={accessibleName}
    fieldName={FIELD_NAME}
    autocomplete="off"
    oninput={(event) => {
      searching = true;
      query = event.currentTarget.value;
    }}
  />
  <Combobox.Content>
    {#each offered as role (role)}
      <Combobox.Item value={role} label={role} />
    {/each}
    <!-- The add row is what keeps a narrowed-to-nothing list from being a dead end, so it is the
         one thing rendered when the vocabulary offers nothing. -->
    {#if !typedIsOffered}
      <Combobox.AddOption fieldName={FIELD_NAME} {query} />
    {/if}
  </Combobox.Content>
</Combobox.Root>

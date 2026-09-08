<script lang="ts">
  /*
   * The prefix and suffix control — one component, wherever a person's name is entered.
   *
   * WHY A DROPDOWN AT ALL, over a plain box: nine times in ten the answer is one of a dozen words,
   * and typing it invites the drift a name record cannot afford — "Jr", "Jr.", "JR" and "junior"
   * are one suffix spelled four ways, and they read as four on a letter and sort as four in a
   * listing. Offering the written form is what keeps the record's punctuation consistent without
   * anybody proofreading it.
   *
   * AND WHY IT STILL TAKES ANYTHING TYPED: the set of things people are called has no edge. A
   * closed list would refuse a person their own name, which is not a trade-off worth any amount of
   * tidiness. So the list is a suggestion (the honorifics module says so in its own header), the
   * stored column stays free text, and the combobox's own add row is the affordance that says the
   * typing counts.
   *
   * SEVERAL AT ONCE, because people carry several: "III, Esq.", "M.D., Ph.D.", "Jr., C.P.A.". The
   * field holds them as ONE line of text, comma-separated, exactly as they are written after a
   * name — which is also exactly what is stored, because the column is a string and the string is
   * what goes on the letter. Picking from the list APPENDS rather than replaces; picking one that
   * is already there takes it back off, so the list doubles as the record of what is held. Typing
   * the whole line by hand stays the fastest path for somebody who knows what they want, and the
   * list is filtering against the part after the last comma while they do it.
   *
   * ORDER IS THE PERSON'S, never the list's. Suffixes have conventions (generational before
   * degrees) and they are not universal, so a pick lands at the end of what is already there and
   * nothing is reordered behind somebody's back.
   *
   * THE ONE DEPARTURE FROM THE CATEGORIES PICKER, which is otherwise this control's model: closing
   * the list settles the value on whatever is TYPED, not on what was picked. There, a typed word
   * nobody picked would mint a firm-wide category, so it must be a deliberate act; here there is
   * nothing to mint — the field is free text and what somebody typed is already a legitimate
   * answer. Losing it on close would be the control eating a name.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { LabelledFieldControlProperties } from "@magna-carta/design-system/labelled-field";
  import { honorificSuggestions } from "@magna-carta/directory/honorifics";

  let {
    part,
    value = $bindable(""),
    disabled = false,
    fieldName,
    inputProps,
  }: {
    /** Which half of the name this is; decides the suggestions and the default field name. */
    part: "prefix" | "suffix";
    /**
     * The stored text — the whole line as it is written, several honorifics separated by commas.
     * Free text: a suggestion is a shortcut to a value, never the only one it will accept.
     */
    value?: string;
    disabled?: boolean;
    /** Overrides the field's own name, for a surface that words it differently. */
    fieldName?: string;
    /** The props a LabelledField hands its control, so the label and the input stay wired. */
    inputProps?: LabelledFieldControlProperties;
  } = $props();

  const name = $derived(fieldName ?? (part === "prefix" ? "Prefix" : "Suffix"));
  const suggestions = $derived(honorificSuggestions(part));

  /** The line as a list. A comma is the separator because it is how the line is written anyway. */
  function tokensOf(line: string): string[] {
    return line
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token !== "");
  }

  /*
   * What is typed. It tracks `value` while the list is closed and is the person's own text while
   * they are typing — the two are the same thing at rest, and the separation exists so that
   * narrowing the list does not have to mean rewriting the record on every keystroke.
   */
  let query = $state(value);
  let open = $state(false);

  // The value settling from elsewhere (a record loading, a form resetting) re-seeds the text; a
  // person's own typing does not, because `query` is what they are typing.
  $effect(() => {
    if (!open) query = value;
  });

  const held = $derived(tokensOf(query));

  /** The part after the last comma — the one being typed, and what the list filters against. */
  const pending = $derived((query.split(",").at(-1) ?? "").trim());

  const matching = $derived.by(() => {
    const typed = pending.toLowerCase();
    if (typed === "") return suggestions;
    return suggestions.filter((entry) => entry.toLowerCase().includes(typed));
  });

  /** Whether what is being typed already IS a suggestion, in which case the add row is noise. */
  const pendingIsSuggested = $derived(
    pending === "" || suggestions.some((entry) => entry.toLowerCase() === pending.toLowerCase()),
  );

  function settle(tokens: readonly string[]): void {
    const line = tokens.join(", ");
    value = line;
    query = line;
  }

  /** Appends, or takes back off — matched without regard to case, so one is never held twice. */
  function toggle(entry: string): void {
    const alreadyHeld = held.some((token) => token.toLowerCase() === entry.toLowerCase());
    if (alreadyHeld) {
      settle(held.filter((token) => token.toLowerCase() !== entry.toLowerCase()));
      return;
    }
    // The part being typed is what the pick answers, so it is replaced rather than kept beside it.
    settle([...held.slice(0, pending === "" ? held.length : held.length - 1), entry]);
  }

  function pick(chosen: string | undefined): void {
    if (chosen === undefined) return;
    // The add row carries a reserved value rather than the text: what it means here is "keep the
    // part I am typing", which is already the last token of the line.
    if (Combobox.isAddOption(chosen)) {
      settle(held);
      return;
    }
    toggle(chosen);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={matching.map((entry) => ({ value: entry, label: entry }))}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(listboxOpen) => {
    open = listboxOpen;
    // Settling on the typed line, not on the last pick — see the departure noted above.
    if (!listboxOpen) settle(tokensOf(query));
  }}
>
  <Combobox.Input
    {...inputProps}
    fieldName={name}
    {disabled}
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each matching as entry (entry)}
      {@const isHeld = held.some((token) => token.toLowerCase() === entry.toLowerCase())}
      <!-- A held entry reads as held and takes itself back off when chosen, so the list is both
           the picker and the record of what the line carries. -->
      <Combobox.Item value={entry} label={isHeld ? `${entry} (remove)` : entry} />
    {/each}
    {#if !pendingIsSuggested}
      <Combobox.AddOption fieldName={name} query={pending} />
    {/if}
  </Combobox.Content>
</Combobox.Root>

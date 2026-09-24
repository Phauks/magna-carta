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
   *
   * WHERE THE JUDGEMENT LIVES. What the line holds, which part of it is being typed, what the list
   * should offer and what the line becomes after a pick are all in ./honorific-line.ts — pure, and
   * walked step by step by apps/web/test/honorific-line.test.ts. This file owns the primitive, the
   * markup, and the two pieces of state the module cannot see: whether the field's text is
   * keystrokes, and how many picks have been taken.
   *
   * ============================================================================================
   * HOLDING SEVERAL ON A PRIMITIVE THAT HOLDS ONE. Both pieces of state exist because the listbox
   * underneath is a SINGLE-selection combobox and this control is not one. The owner's report is
   * what they cost when either is missing: "the dropdown says it allows for multiple selections,
   * but once I select one, I cannot select another until it is removed."
   *
   *   `typing` — whether the text in the field is somebody's keystrokes or a settled line. The list
   *   narrows against the part after the last comma, which while somebody types is the word they
   *   are typing and at rest is the honorific they last chose. Without the distinction, a settled
   *   "Hon." filters the list down to "Hon." itself and every other suggestion is unreachable until
   *   that one is cleared — precisely the defect reported. A settled line narrows nothing.
   *
   *   `picks` — a sequence number carried in each row's VALUE. The primitive holds one value and
   *   treats a click on the row already holding it as a DESELECT: it reports the empty string,
   *   which names no row, so the act cannot be carried out and the click is dead. (The primitive
   *   also closes the list on every pick, so a person picks, reopens, and picks again — which is
   *   why a settled line must not narrow, and why the row it holds is the one they are most likely
   *   to click next.) Re-keying every row on every pick means the value the primitive is holding is
   *   never the value of any row on screen, so every click is a fresh selection reported as the row
   *   it actually was. The entry is recovered from the part after the first colon; the composed
   *   value is never stored and never shown.
   * ============================================================================================
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import type { LabelledFieldControlProperties } from "@magna-carta/design-system/labelled-field";
  import { honorificSuggestions } from "@magna-carta/directory/honorifics";
  import {
    isHeld,
    lineWithPick,
    settledLine,
    suggestionsMatching,
    tokensOf,
    typedPart,
  } from "./honorific-line.ts";

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

  /*
   * What is typed. It tracks `value` while the list is closed and is the person's own text while
   * they are typing — the two are the same thing at rest, and the separation exists so that
   * narrowing the list does not have to mean rewriting the record on every keystroke.
   */
  let query = $state(value);
  let open = $state(false);
  /** Whether the field's text is keystrokes rather than a settled line — see the header. */
  let typing = $state(false);
  /** How many picks this field has taken. Re-keys the rows; see the header. */
  let picks = $state(0);

  // The value settling from elsewhere (a record loading, a form resetting) re-seeds the text; a
  // person's own typing does not, because `query` is what they are typing.
  $effect(() => {
    if (!open) {
      query = value;
      typing = false;
    }
  });

  const held = $derived(tokensOf(query));
  const pending = $derived(typedPart(query, typing));
  const matching = $derived(suggestionsMatching(suggestions, pending));

  /** Whether what is being typed already IS a suggestion, in which case the add row is noise. */
  const pendingIsSuggested = $derived(
    pending === "" || suggestions.some((entry) => entry.toLowerCase() === pending.toLowerCase()),
  );

  /** A row's value for this round of picks. Never stored, never shown — see the header. */
  function rowValue(entry: string): string {
    return `${picks}:${entry}`;
  }

  /** The entry a reported row value names. Split at the FIRST colon, so an entry may carry one. */
  function entryOf(reported: string): string {
    return reported.slice(reported.indexOf(":") + 1);
  }

  function settle(line: string): void {
    value = line;
    query = line;
    typing = false;
  }

  function pick(chosen: string | undefined): void {
    if (chosen === undefined) return;
    // The add row carries a reserved value rather than the text: what it means here is "keep the
    // part I am typing", which is already the last token of the line.
    if (Combobox.isAddOption(chosen)) {
      settle(settledLine(query));
      picks += 1;
      return;
    }
    // The primitive reports the empty string when it clears its own held value. The rows are
    // re-keyed on every pick precisely so that never names an act — so it is bookkeeping, and
    // treating it as one would append an empty token and leave a dangling comma in a stored name.
    if (chosen === "") return;
    settle(lineWithPick(query, pending, entryOf(chosen)));
    picks += 1;
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={matching.map((entry) => ({ value: rowValue(entry), label: entry }))}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(listboxOpen) => {
    open = listboxOpen;
    // Settling on the typed line, not on the last pick — see the departure noted above.
    if (!listboxOpen) settle(settledLine(query));
  }}
>
  <Combobox.Input
    {...inputProps}
    fieldName={name}
    {disabled}
    oninput={(event) => {
      query = event.currentTarget.value;
      typing = true;
    }}
  />
  <Combobox.Content>
    {#each matching as entry (entry)}
      <!-- A held entry reads as held and takes itself back off when chosen, so the list is both
           the picker and the record of what the line carries. The row's TEXT says so; its `label`
           stays the bare entry, because the primitive writes the chosen row's label into the field
           and "(remove)" is a sentence about the row, not part of anybody's name. -->
      <Combobox.Item value={rowValue(entry)} label={entry}>
        {isHeld(held, entry) ? `${entry} (remove)` : entry}
      </Combobox.Item>
    {/each}
    {#if !pendingIsSuggested}
      <Combobox.AddOption fieldName={name} query={pending} />
    {/if}
  </Combobox.Content>
</Combobox.Root>

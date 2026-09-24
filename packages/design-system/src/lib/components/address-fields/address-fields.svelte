<script lang="ts">
  /*
   * AddressFields — the one place an address is entered, and its shape is the country's.
   *
   * THE COUNTRY IS THE FIRST FIELD BECAUSE IT DECIDES THE REST. Which boxes an address form has,
   * what each is called and what order they read in are properties of the country, not of the
   * platform (address-format.ts holds them). So the country leads, and choosing one re-labels and
   * re-arranges the boxes beneath it: an Irish address stops asking for a state and starts asking
   * for an Eircode; a Japanese one puts the postal code first and reads down to the street; a German
   * one puts the code before the town on one line, the way an envelope is written there.
   *
   * IT NEVER MOVES A VALUE BETWEEN FIELDS. The stored fields are named for their POSITION in an
   * address — street, dependent locality, city, region, postal, sorting code — which is what lets
   * the form be a presentation of them. Changing the country changes the words and the order and
   * nothing else, so an address entered as American and corrected to Irish keeps every character
   * somebody typed. A field the new country's form does not show is still HELD, and the component
   * says so rather than dropping it silently: a value nobody can see and nobody was told about is
   * the worst of the three possible behaviours.
   *
   * NOTHING IS REQUIRED, and the component enforces no shape. An address a firm holds half of is
   * still the address it holds; whether half of one is enough for whatever the caller is doing is
   * the caller's rule to state, beside its own commit.
   *
   * THE COUNTRY FIELD IS TYPED INTO, NOT SCROLLED THROUGH. Two hundred countries in a select is a
   * list nobody can use, and the standing rule is that every closed choice takes typing whatever its
   * length (docs/conventions/design-corrections.md, "Every closed choice is a combobox, never a
   * select"). It follows this package's own documented data-safe pattern: the query drives the
   * filter, a pick writes the value back, and closing the listbox settles the text on the country
   * actually held — so typed-but-unchosen text is never mistaken for one.
   *
   * A SEARCH STARTS ON OPENING OR TYPING, NEVER ON FOCUS ALONE, AND THE SETTLE WRITES THE INPUT
   * ITSELF. Choosing the country already chosen writes nothing (the primitive treats it as no
   * change), so the name's restoration rests on the close settling the text, after which the
   * primitive hands focus back to the input; a search that began on every focus blanked the field
   * again at exactly that moment. And the typed text reaches the input from the keyboard, not from
   * this component, so the framework's record of what it last wrote there still says the chosen
   * name and it writes nothing when the settle hands it that same name — which is exactly the
   * re-pick case. The same two halves the app's closed-choice picker had
   * (apps/web/src/lib/components/choice-picker.svelte, owner-reported 2026-09-14), and the same
   * remedy: focus only selects the text that is there, and the settle and the search reset put
   * their text into the input directly as well as through the controlled `inputValue`.
   *
   * DOMAIN-BLIND, like every component here. It takes the parts, the country and the list of
   * countries to offer, and hands back the parts. It knows nothing about who an address belongs to.
   */
  import * as Combobox from "../combobox/index.ts";
  import Input from "../input/index.ts";
  import LabelledField from "../labelled-field/index.ts";
  import { placeholderOf } from "../../formatters/placeholder.ts";
  import { addressFormatFor, type AddressFieldKey } from "./address-format.ts";
  import StreetSuggestionField from "./street-suggestion-field.svelte";
  import { withResolvedAddress, type AddressLookup } from "./street-lookup.ts";
  import type { AddressAdministrativeArea, AddressCountry, AddressParts } from "./types.ts";

  let {
    value = $bindable(),
    countries,
    administrativeAreas = [],
    postalCodeNote,
    lookup,
    disabled = false,
    /** The refusal to show on the first line, where the caller has one. */
    error,
  }: {
    /** The parts, bindable. Only the keys the country's form shows are edited. */
    value: AddressParts;
    /** What the country field offers. A country with no known form takes the international one. */
    countries: readonly AddressCountry[];
    /**
     * The administrative areas to OFFER in the region box — states, provinces, prefectures,
     * counties. Suggestions, never a closed set: the box still takes anything typed into it. An
     * empty list (the default) leaves the box as plain free text, which is the right answer for
     * every country that publishes no list.
     */
    administrativeAreas?: readonly AddressAdministrativeArea[];
    /**
     * Asked whether the postal code reads like one for the country it is in. Returning a string
     * shows it under the box; returning null says nothing.
     *
     * A NOTE, NEVER A REFUSAL. It renders as the field's hint rather than its error, so the box is
     * never marked invalid and nothing here can stop a commit — a code can match its country's
     * published format perfectly and reach nobody, and a new development can carry one no published
     * format knows yet. Whether a malformed code matters at all is the caller's rule, beside its
     * own commit.
     */
    postalCodeNote?: (country: string | undefined, value: string) => string | null;
    /**
     * How real addresses are looked up. Given, the street box offers addresses as it is typed into,
     * and choosing one fills the rest of the form (street-suggestion-field.svelte). Absent, the street
     * box is the plain box it always was. The form never fetches: the caller supplies the lookup, and
     * a lookup with no service behind it answers "unavailable" and the box quietly stays plain.
     */
    lookup?: AddressLookup;
    disabled?: boolean;
    error?: string;
  } = $props();

  const format = $derived(addressFormatFor(value.country));

  /** What has been typed into the country field, and whether it is being searched at all. */
  let countryQuery = $state("");
  let searchingCountry = $state(false);
  const chosenCountry = $derived(
    countries.find((country) => country.code === value.country)?.name ?? "",
  );
  const matchingCountries = $derived.by(() => {
    const needle = searchingCountry ? countryQuery.trim().toLowerCase() : "";
    if (needle === "") return countries;
    // A person types the name or the code, because those are the two things they have in their head.
    return countries.filter(
      (country) =>
        country.name.toLowerCase().includes(needle) || country.code.toLowerCase().includes(needle),
    );
  });

  /** The input element, for the two writes the framework cannot be relied on to make (see above). */
  let countryInput = $state<HTMLInputElement | null>(null);

  /** Back to reading the country the address is in, rather than searching for another. */
  function settleCountry(): void {
    searchingCountry = false;
    countryQuery = "";
    if (countryInput !== null) countryInput.value = chosenCountry;
  }

  /** Opening is asking to choose again: the whole world is on offer, not the one country in the field. */
  function startCountrySearch(): void {
    searchingCountry = true;
    countryQuery = "";
    if (countryInput !== null) countryInput.value = "";
  }
  const shown = $derived(new Set(format.lines.flat().map((field) => field.key)));

  /**
   * What the record holds that this country's form has no box for.
   *
   * Stated rather than cleared. A firm that recorded a neighbourhood under a Brazilian address and
   * then corrected the country to the United States still HAS that neighbourhood, and quietly
   * dropping it would lose a line of somebody's address on a keystroke that was about something
   * else. Naming it is what lets a reader decide.
   */
  const heldButNotShown = $derived(
    (Object.keys(value) as (keyof AddressParts)[])
      .filter(
        (key): key is AddressFieldKey =>
          key !== "country" && !shown.has(key as AddressFieldKey) && (value[key] ?? "") !== "",
      )
      .map((key) => value[key] ?? ""),
  );

  function set(key: AddressFieldKey, text: string): void {
    value = { ...value, [key]: text };
  }

  /** The line's own grid: each box takes its share, so a postal code is not as wide as a street. */
  function templateFor(spans: readonly number[]): string {
    return spans.map((span) => `minmax(0, ${String(span)}fr)`).join(" ");
  }

  /**
   * The note under the postal box, asked fresh as the code is typed. `undefined` rather than null,
   * because that is what LabelledField takes to mean "no hint".
   */
  const postalNote = $derived(postalCodeNote?.(value.country, value.postal ?? "") ?? undefined);

  /**
   * The region box's suggestion list, offered through a native datalist.
   *
   * A DATALIST AND NOT A COMBOBOX, because the region box is NOT a closed choice. The standing rule
   * that every closed choice is a combobox is about choices with a known, complete set of answers;
   * this one has neither. Addresses exist in places a published list does not carry — a territory
   * in dispute, a region renamed last month, a military post — and a record entered before any list
   * existed already holds whatever somebody typed. A datalist offers the list and keeps the typing,
   * which is exactly the semantics required; a combobox would settle the box back onto a listed
   * value on close and silently destroy the other kind of answer.
   *
   * Honest limit: a datalist filters on the option's VALUE, which is the stored code ("CA"), so
   * typing a state's full name may narrow to nothing in some browsers. Nothing is lost when it does
   * — the typed text stands — and storing the code is what an envelope prints.
   */
  const areaListIdentifier = $props.id();
</script>

<div class="flex flex-col gap-12">
  <LabelledField label="Country">
    {#snippet children({ props })}
      <Combobox.Root
        type="single"
        {disabled}
        allowDeselect={false}
        items={matchingCountries.map((country) => ({
          value: country.code,
          label: country.name,
        }))}
        value={value.country ?? ""}
        inputValue={searchingCountry ? countryQuery : chosenCountry}
        onValueChange={(picked) => {
          const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
          settleCountry();
          // A country is never taken back off: an address always sits in one, and the form beneath
          // this field is a function of it, so a deselect settles back on what is held.
          if (chosen !== "") value = { ...value, country: chosen };
        }}
        onOpenChange={(open) => {
          if (open) startCountrySearch();
          else settleCountry();
        }}
      >
        <Combobox.Input
          {...props}
          bind:ref={countryInput}
          fieldName="Country"
          autocomplete="off"
          spellcheck={false}
          onfocus={(event) => {
            // Arriving selects what is there, so the first letter typed replaces the name rather
            // than appending to it. Nothing else: a focus that is the primitive returning to the
            // input after a close must leave the settled name standing.
            event.currentTarget.select();
          }}
          onblur={settleCountry}
          oninput={(event) => {
            searchingCountry = true;
            countryQuery = event.currentTarget.value;
          }}
        />
        <Combobox.Content>
          {#each matchingCountries as country (country.code)}
            <Combobox.Item value={country.code} label={country.name} />
          {/each}
          {#if matchingCountries.length === 0}
            <!-- The heading needs a group: a bare one has no identity to label and throws when the
                 listbox opens, which nothing but narrowing a list to nothing would show. -->
            <Combobox.Group>
              <Combobox.GroupHeading>
                Nothing matches "{countryQuery.trim()}".
              </Combobox.GroupHeading>
            </Combobox.Group>
          {/if}
        </Combobox.Content>
      </Combobox.Root>
    {/snippet}
  </LabelledField>

  {#each format.lines as line, index (index)}
    <div class="grid gap-8" style="grid-template-columns: {templateFor(line.map((field) => field.span ?? 1))}">
      {#each line as field (field.key)}
        <LabelledField
          label={field.label}
          hint={field.key === "postal" ? postalNote : undefined}
          error={index === 0 && field.key === "street" ? error : undefined}
        >
          {#snippet children({ props })}
            {#if field.key === "street" && lookup !== undefined}
              <StreetSuggestionField
                text={value.street ?? ""}
                country={value.country}
                {lookup}
                fieldName={field.label}
                controlProperties={props}
                {disabled}
                onType={(typed) => set("street", typed)}
                onChoose={(parts) => (value = withResolvedAddress(value, parts))}
              />
            {:else}
              <Input
                {...props}
                autocomplete="off"
                list={field.key === "region" && administrativeAreas.length > 0
                  ? areaListIdentifier
                  : undefined}
                value={value[field.key] ?? ""}
                {disabled}
                placeholder={placeholderOf(field.label)}
                oninput={(event) => set(field.key, event.currentTarget.value)}
              />
            {/if}
          {/snippet}
        </LabelledField>
      {/each}
    </div>
  {/each}

  {#if administrativeAreas.length > 0}
    <datalist id={areaListIdentifier}>
      {#each administrativeAreas as area (area.code)}
        <option value={area.code} label={area.name}></option>
      {/each}
    </datalist>
  {/if}

  {#if heldButNotShown.length > 0}
    <p class="text-xs text-text-muted">
      Also held on this address, which addresses in this country have no line for: {heldButNotShown.join(
        ", ",
      )}
    </p>
  {/if}
</div>

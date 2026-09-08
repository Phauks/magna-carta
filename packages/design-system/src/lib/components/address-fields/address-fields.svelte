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
   * DOMAIN-BLIND, like every component here. It takes the parts, the country and the list of
   * countries to offer, and hands back the parts. It knows nothing about who an address belongs to.
   */
  import Input from "../input/index.ts";
  import Label from "../label/index.ts";
  import LabelledField from "../labelled-field/index.ts";
  import * as Select from "../select/index.ts";
  import { placeholderOf } from "../../formatters/placeholder.ts";
  import { addressFormatFor, type AddressFieldKey } from "./address-format.ts";
  import type { AddressCountry, AddressParts } from "./types.ts";

  let {
    value = $bindable(),
    countries,
    disabled = false,
    /** The refusal to show on the first line, where the caller has one. */
    error,
  }: {
    /** The parts, bindable. Only the keys the country's form shows are edited. */
    value: AddressParts;
    /** What the country field offers. A country with no known form takes the international one. */
    countries: readonly AddressCountry[];
    disabled?: boolean;
    error?: string;
  } = $props();

  const identity = $props.id();
  const countryLabelId = `${identity}-country`;

  const format = $derived(addressFormatFor(value.country));
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
</script>

<div class="flex flex-col gap-12">
  <div class="flex flex-col gap-8">
    <Label id={countryLabelId}>Country</Label>
    <Select.Root
      type="single"
      items={countries.map((country) => ({ value: country.code, label: country.name }))}
      bind:value={
        () => value.country ?? "", (chosen) => (value = { ...value, country: chosen })
      }
      allowDeselect={false}
      {disabled}
    >
      <Select.Trigger aria-labelledby={countryLabelId}>
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        {#each countries as country (country.code)}
          <Select.Item value={country.code} label={country.name} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#each format.lines as line, index (index)}
    <div class="grid gap-8" style="grid-template-columns: {templateFor(line.map((field) => field.span ?? 1))}">
      {#each line as field (field.key)}
        <LabelledField label={field.label} error={index === 0 && field.key === "street" ? error : undefined}>
          {#snippet children({ props })}
            <Input
              {...props}
              autocomplete="off"
              value={value[field.key] ?? ""}
              {disabled}
              placeholder={placeholderOf(field.label)}
              oninput={(event) => set(field.key, event.currentTarget.value)}
            />
          {/snippet}
        </LabelledField>
      {/each}
    </div>
  {/each}

  {#if heldButNotShown.length > 0}
    <p class="text-xs text-text-muted">
      Also held on this address, which addresses in this country have no line for: {heldButNotShown.join(
        ", ",
      )}
    </p>
  {/if}
</div>

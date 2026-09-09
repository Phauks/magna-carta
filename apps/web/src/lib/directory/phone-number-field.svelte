<script lang="ts">
  /*
   * A telephone number, entered — the country it belongs to and the digits, as ONE field.
   *
   * WHY IT IS ONE COMPONENT (owner ruling, 2026-09-08: "we have a field for this already, should
   * consolidate"). The directory's contact rows and the call log both asked for a number, and both
   * had built the same pair by hand: a country control beside a text field, the same grouping call
   * on every keystroke, the same two labels. Two copies of a field is two places for the country to
   * stop reformatting the digits, and that is exactly what happened — the backspace defect the
   * ruling names was in both of them.
   *
   * THE COUNTRY IS TYPED INTO, NOT SCROLLED THROUGH. Two hundred and forty-five countries in a
   * select is a list nobody can use; the field answers to "44", "+44", "GB" and "United Kingdom",
   * because those are the four things a person has in their head. It carries the flag as well, which
   * is what makes the right row findable at a glance once the list is narrowed to a handful.
   *
   * THE EXTENSION IS PART OF THIS FIELD, not a control somebody remembers to put beside it. The
   * Directory built its own next to this one, and the call log had none at all — which is how a
   * direct dial typed onto the end of a number silently stopped the grouping (owner ruling,
   * 2026-09-08: "for numbers longer than expected length of phone number, don't drop formatting,
   * show as extension instead, or allow a special extension field"). Both, in the end: the extra
   * digits ROLL INTO the extension as they are typed, and the extension stands as its own field for
   * somebody who knows the two halves apart already.
   *
   * THE GHOST TEXT IS THE COUNTRY'S OWN GROUPING — `(XXX) XXX-XXXX` here, `XXXXX XXXXXX` in Britain.
   * It is the one placeholder in the product that is not its field's name (phone-entry.ts says why),
   * and it is derived rather than written, so it is right in every country.
   */
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { CountryCode } from "libphonenumber-js/min";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import CountryFlag from "./country-flag.svelte";
  import {
    formatPhoneAfterEdit,
    formatPhoneAsTyped,
    phoneCountries,
    phoneCountryShortLabel,
    phoneNumberPlaceholder,
    splitTypedExtension,
  } from "./phone-entry.ts";

  let {
    region = $bindable(),
    number = $bindable(),
    extension = $bindable(""),
    withExtension = true,
    label = "Number",
    countryInputId,
    numberInputId,
    extensionInputId,
    disabled = false,
    error,
  }: {
    /** The country the number belongs to, as its two-letter region code. Bindable. */
    region: string;
    /** The number as typed, grouped in that country's national form. Bindable. */
    number: string;
    /** The direct dial behind it, digits only. Bindable, and filled by overflow as well as by hand. */
    extension?: string;
    /**
     * Whether the extension half is asked for at all.
     *
     * True everywhere today. It is a prop rather than an assumption because a surface that wants a
     * bare mobile number should be able to say so — and because turning it off has to also turn off
     * the overflow roll, since digits that have nowhere to go must stay in the number rather than
     * being quietly dropped.
     */
    withExtension?: boolean;
    /** What the number half is called. The country half is always Country. */
    label?: string;
    countryInputId?: string;
    numberInputId?: string;
    extensionInputId?: string;
    disabled?: boolean;
    /** What is wrong with the number, said under it. */
    error?: string;
  } = $props();

  const countryOptions: readonly ChoiceOption[] = phoneCountries().map((country) => ({
    value: country.region,
    label: phoneCountryShortLabel(country),
    aside: country.name,
    // What a person has in their head when they reach for this field, in every form they hold it.
    keywords: [country.name, country.region, country.callingCode, `+${country.callingCode}`],
  }));

  // The country's own grouping, or the field's name where a country has no shape to show — an empty
  // placeholder would read as a field with no ghost text at all rather than as one with no example.
  const ghostText = $derived(
    phoneNumberPlaceholder(region as CountryCode) || placeholderOf(label),
  );

  /**
   * A country chosen after the digits regroups them.
   *
   * The digits are the same digits; only the way they are written down changed. Leaving them in the
   * old country's grouping would show a number in a form no country writes.
   */
  function regroup(): void {
    if (number.trim() === "") return;
    number = formatPhoneAsTyped(region as CountryCode, number);
  }

  /**
   * A keystroke in the number half, with anything past the country's own length moved to the
   * extension.
   *
   * The roll only ever ADDS to the extension: an extension already typed by hand is left alone,
   * because the person who typed it knows something the digit count does not.
   */
  function numberTyped(typed: string): string {
    const formatted = formatPhoneAfterEdit(region as CountryCode, number, typed);
    if (!withExtension) return formatted;
    const split = splitTypedExtension(region as CountryCode, formatted);
    if (split.extension !== "" && extension.trim() === "") extension = split.extension;
    return split.extension === "" ? formatted : split.number;
  }
</script>

<div class="flex min-w-0 items-start gap-8">
  <div class="flex shrink-0 flex-col gap-8" style="inline-size: 11.5rem">
    <LabelledField label="Country" id={countryInputId}>
      {#snippet children({ props })}
        <div class="flex min-w-0 items-center gap-8">
          <CountryFlag {region} />
          <div class="min-w-0 flex-auto">
            <ChoicePicker
              inputId={props.id}
              label="Country"
              options={countryOptions}
              {disabled}
              bind:value={region}
              onchange={regroup}
              whenNoMatch={(query) => `No country matches "${query}".`}
            >
              {#snippet row(option)}
                <span class="flex min-w-0 items-center gap-8">
                  <CountryFlag region={option.value} />
                  <span class="tabular-nums">{option.label}</span>
                  <span class="truncate text-xs text-text-muted">{option.aside}</span>
                </span>
              {/snippet}
            </ChoicePicker>
          </div>
        </div>
      {/snippet}
    </LabelledField>
  </div>

  <LabelledField {label} id={numberInputId} class="min-w-0 flex-auto" {error}>
    {#snippet children({ props })}
      <!-- Grouped as it is typed, in the chosen country's own national form, so an area code lands
           where the eye expects it. The record stores the international form composed from the two. -->
      <Input
        {...props}
        type="tel"
        inputmode="tel"
        autocomplete="off"
        class="tabular-nums"
        {disabled}
        placeholder={ghostText}
        value={number}
        oninput={(event) => {
          const typed = numberTyped(event.currentTarget.value);
          event.currentTarget.value = typed;
          number = typed;
        }}
      />
    {/snippet}
  </LabelledField>

  {#if withExtension}
    <!-- Narrow, and last: a direct dial is three or four digits and it is the half a reader's eye
         skips. Digits only, because "ext." is what the label already says. -->
    <div class="shrink-0" style="inline-size: 6rem">
      <LabelledField label="Extension" id={extensionInputId}>
        {#snippet children({ props })}
          <Input
            {...props}
            inputmode="numeric"
            autocomplete="off"
            class="tabular-nums"
            {disabled}
            placeholder={placeholderOf("Extension")}
            value={extension}
            oninput={(event) => {
              const digits = event.currentTarget.value.replaceAll(/\D/gu, "");
              event.currentTarget.value = digits;
              extension = digits;
            }}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/if}
</div>

<script module lang="ts">
  /*
   * AddressFields — the address form, shaped by the country the address is in.
   *
   * The stories are the countries, because the country IS the variant axis: the whole claim the
   * component makes is that an Irish address does not ask for a state, a Japanese one reads from the
   * postal code down, and a German one puts the code before the town. Each play asserts that claim
   * through the accessibility tree, by the words a person in that country would look for.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import AddressFields from "../lib/components/address-fields/address-fields.svelte";
  import type { AddressCountry, AddressParts } from "../lib/components/address-fields/types.ts";

  const COUNTRIES: readonly AddressCountry[] = [
    { code: "US", name: "United States" },
    { code: "IE", name: "Ireland" },
    { code: "DE", name: "Germany" },
    { code: "JP", name: "Japan" },
    { code: "ZZ", name: "Somewhere Else" },
  ];

  const { Story } = defineMeta({
    title: "Compound Inputs/AddressFields",
    component: AddressFields,
    args: { countries: COUNTRIES, disabled: false },
    parameters: { controls: { include: ["countries", "disabled", "error"] } },
  });

  /*
   * Every prop but the value, which each story owns: the whole point of the component is that the
   * form differs by country, so a story is a country and the parts it holds are its own state.
   */
  type AddressStoryArgs = {
    countries: readonly AddressCountry[];
    disabled?: boolean;
    error?: string;
  };
</script>

<script lang="ts">
  let american = $state<AddressParts>({ country: "US" });
  let irish = $state<AddressParts>({ country: "IE" });
  let german = $state<AddressParts>({ country: "DE" });
  let japanese = $state<AddressParts>({ country: "JP" });
  let unknown = $state<AddressParts>({ country: "ZZ" });
  let corrected = $state<AddressParts>({ country: "ZZ", dependentLocality: "Copacabana" });
</script>

{#snippet american_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={american} {countries} {...rest} /></div>
{/snippet}

<Story
  name="UnitedStates"
  template={american_}
  play={async ({ canvas, step }) => {
    await step("It asks for a state and a ZIP code, in that order", async () => {
      expect(canvas.getByLabelText("State")).toBeInTheDocument();
      expect(canvas.getByLabelText("ZIP Code")).toBeInTheDocument();
      await userEvent.type(canvas.getByLabelText("City"), "Reno");
      expect(canvas.getByLabelText("City")).toHaveValue("Reno");
    });
  }}
/>

{#snippet irish_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={irish} {countries} {...rest} /></div>
{/snippet}

<Story
  name="Ireland"
  template={irish_}
  play={async ({ canvas, step }) => {
    await step("There is no state, and the postal code is an Eircode", () => {
      expect(canvas.queryByLabelText("State")).toBeNull();
      expect(canvas.queryByLabelText("ZIP Code")).toBeNull();
      expect(canvas.getByLabelText("Eircode")).toBeInTheDocument();
      expect(canvas.getByLabelText("County")).toBeInTheDocument();
    });
  }}
/>

{#snippet german_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={german} {countries} {...rest} /></div>
{/snippet}

<Story
  name="Germany"
  template={german_}
  play={async ({ canvas, step }) => {
    await step("The postal code is named in German and leads the town on its line", () => {
      expect(canvas.getByLabelText("Postleitzahl")).toBeInTheDocument();
      expect(canvas.queryByLabelText("Region")).toBeNull();
    });
  }}
/>

{#snippet japanese_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={japanese} {countries} {...rest} /></div>
{/snippet}

<Story
  name="Japan"
  template={japanese_}
  play={async ({ canvas, step }) => {
    await step("It reads from the largest unit down: code, prefecture, ward, then street", () => {
      const boxes = canvas.getAllByRole("textbox");

      // The order is not decoration: a person fills a form in the order it is written, and in Japan
      // an address is written from the largest unit down.
      expect(boxes[0]).toBe(canvas.getByLabelText("Postal Code"));
      expect(boxes[1]).toBe(canvas.getByLabelText("Prefecture"));
      expect(boxes[2]).toBe(canvas.getByLabelText("City or Ward"));
      expect(boxes[3]).toBe(canvas.getByLabelText("Street Address"));
    });
  }}
/>

{#snippet unknown_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={unknown} {countries} {...rest} /></div>
{/snippet}

<Story
  name="ACountryWithNoKnownForm"
  template={unknown_}
  play={async ({ canvas, step }) => {
    // The honest default rather than a guess: neutral words, every line the field set has.
    await step("It falls back to the international form rather than to the American one", () => {
      expect(canvas.getByLabelText("Region")).toBeInTheDocument();
      expect(canvas.getByLabelText("Postal Code")).toBeInTheDocument();
      expect(canvas.queryByLabelText("State")).toBeNull();
    });
  }}
/>

{#snippet corrected_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg"><AddressFields bind:value={corrected} {countries} {...rest} /></div>
{/snippet}

<Story
  name="AValueThisCountrysFormHasNoLineFor"
  template={corrected_}
  play={async ({ canvas, step }) => {
    // The listbox is portaled out of the story's own root, so the options are found on the body —
    // the same idiom every other Select story here uses.
    const body = within(document.body);

    // The international form has a neighbourhood line; the American one does not. Moving between
    // them is what strands the value, and is exactly the correction a person makes by hand.
    await step("The stranded value is stated rather than silently dropped", async () => {
      expect(canvas.getByLabelText("District or Neighbourhood")).toHaveValue("Copacabana");

      // The country field is a combobox, so it is typed into rather than scrolled through — the
      // standing rule for every closed choice, and the only usable shape for two hundred countries.
      await userEvent.click(canvas.getByLabelText("Country"));
      await userEvent.type(canvas.getByLabelText("Country"), "United Sta");
      await userEvent.click(await body.findByRole("option", { name: "United States" }));
      // The panel scale-fades out, and the exiting node is still in the tree while it does; the
      // per-story axe check runs after this play, so the settle is waited for rather than raced.
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());

      expect(canvas.queryByLabelText("District or Neighbourhood")).toBeNull();
      expect(canvas.getByText(/Copacabana/)).toBeInTheDocument();
    });
  }}
/>

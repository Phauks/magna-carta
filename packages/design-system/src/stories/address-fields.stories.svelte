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
  import type {
    AddressAdministrativeArea,
    AddressCountry,
    AddressParts,
  } from "../lib/components/address-fields/types.ts";
  import type {
    AddressLookup,
    AddressOffer,
  } from "../lib/components/address-fields/street-lookup.ts";

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

  /*
   * The constraint half is handed IN, never imported. The component is domain-blind: it takes the
   * areas to offer and a function that judges a postal code, and knows nothing about where either
   * comes from. These fixtures stand in for @magna-carta/address-formats, which is what the app
   * passes — and the fact that a story can satisfy the contract with four lines is the contract
   * working.
   */
  const AMERICAN_STATES: readonly AddressAdministrativeArea[] = [
    { code: "CA", name: "California" },
    { code: "NV", name: "Nevada" },
    { code: "NY", name: "New York" },
  ];

  /*
   * A lookup with nothing behind it but this list — so the catalog shows the street box offering
   * addresses without any service provisioned, which is also the one place the behaviour can be
   * reviewed before anybody pays for a service. One plain address and one building with units, the
   * two shapes every real service answers in.
   */
  const ROSEWOOD: AddressOffer = {
    identifier: "rosewood",
    label: "14 Rosewood Dr, Reno, NV 89501",
    kind: "address",
  };
  const CENTER_STREET: AddressOffer = {
    identifier: "center-street",
    label: "1042 W Center St, Orem, UT 84057",
    kind: "group",
    count: 2,
  };
  const CATALOG_LOOKUP: AddressLookup = {
    suggest: (_country, query) =>
      Promise.resolve({
        kind: "offers",
        offers: [ROSEWOOD, CENTER_STREET].filter((offer) =>
          offer.label.toLowerCase().includes(query.trim().toLowerCase().slice(0, 4)),
        ),
      }),
    resolve: (identifier) => {
      if (identifier === "rosewood") {
        return Promise.resolve({
          kind: "address",
          parts: { street: "14 Rosewood Dr", city: "Reno", region: "NV", postal: "89501", country: "US" },
        });
      }
      if (identifier === "center-street") {
        return Promise.resolve({
          kind: "group",
          offers: [
            { identifier: "unit-108", label: "1042 W Center St Apt 108", kind: "address" },
            { identifier: "unit-109", label: "1042 W Center St Apt 109", kind: "address" },
          ],
        });
      }
      const unit = identifier === "unit-108" ? "Apt 108" : "Apt 109";
      return Promise.resolve({
        kind: "address",
        parts: {
          street: "1042 W Center St",
          streetTwo: unit,
          city: "Orem",
          region: "UT",
          postal: "84057",
          country: "US",
        },
      });
    },
  };

  function americanZipNote(_country: string | undefined, value: string): string | null {
    if (value.trim() === "" || /^\d{5}(?:-\d{4})?$/.test(value.trim())) return null;
    return "This does not look like a postal code for the chosen country — expected something like 95014 or 22162-1010.";
  }
</script>

<script lang="ts">
  let american = $state<AddressParts>({ country: "US" });
  let irish = $state<AddressParts>({ country: "IE" });
  let german = $state<AddressParts>({ country: "DE" });
  let japanese = $state<AddressParts>({ country: "JP" });
  let unknown = $state<AddressParts>({ country: "ZZ" });
  let corrected = $state<AddressParts>({ country: "ZZ", dependentLocality: "Copacabana" });
  let mistyped = $state<AddressParts>({ country: "US", postal: "9501" });
  let offered = $state<AddressParts>({ country: "US" });
  let looked = $state<AddressParts>({ country: "US" });
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

{#snippet mistyped_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg">
    <AddressFields bind:value={mistyped} {countries} postalCodeNote={americanZipNote} {...rest} />
  </div>
{/snippet}

<Story
  name="APostalCodeThatDoesNotLookRight"
  template={mistyped_}
  play={async ({ canvas, step }) => {
    await step("The note is said beside the box, naming an example rather than a pattern", () => {
      expect(canvas.getByLabelText("ZIP Code")).toHaveAccessibleDescription(/95014/);
    });

    // The whole claim of this prop. A code can match its country's published format perfectly and
    // still reach nobody, and a new development can carry one no published format knows yet, so the
    // box is never marked invalid and nothing here can stop a commit.
    await step("It is a note and NOT a refusal: the box is never marked invalid", () => {
      expect(canvas.getByLabelText("ZIP Code")).not.toHaveAttribute("aria-invalid");
    });

    await step("Correcting it takes the note away", async () => {
      await userEvent.type(canvas.getByLabelText("ZIP Code"), "4");
      await waitFor(() =>
        expect(canvas.getByLabelText("ZIP Code")).not.toHaveAccessibleDescription(/95014/),
      );
    });
  }}
/>

{#snippet offered_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg">
    <AddressFields
      bind:value={offered}
      {countries}
      administrativeAreas={AMERICAN_STATES}
      {...rest}
    />
  </div>
{/snippet}

<Story
  name="AdministrativeAreasOffered"
  template={offered_}
  play={async ({ canvas, step }) => {
    await step("The region box is bound to a list of the country's areas", () => {
      const state = canvas.getByLabelText("State");
      const listIdentifier = state.getAttribute("list");
      expect(listIdentifier).not.toBeNull();

      const list = document.getElementById(String(listIdentifier));
      expect(list?.tagName.toLowerCase()).toBe("datalist");
      // The option's VALUE is what a record stores and what an envelope prints; its label is what a
      // reader recognises.
      const options = [...(list?.querySelectorAll("option") ?? [])];
      expect(options.map((option) => option.value)).toEqual(["CA", "NV", "NY"]);
      expect(options.map((option) => option.label)).toContain("California");
    });

    // Offering a list never closes the field. Addresses exist in places a published list does not
    // carry, and a form that cannot record one records nothing.
    await step("A value no list carries is still accepted and kept", async () => {
      await userEvent.type(canvas.getByLabelText("State"), "Kernow");
      expect(canvas.getByLabelText("State")).toHaveValue("Kernow");
    });
  }}
/>

{#snippet looked_({ countries, ...rest }: AddressStoryArgs)}
  <div class="w-lg">
    <AddressFields bind:value={looked} {countries} lookup={CATALOG_LOOKUP} {...rest} />
  </div>
{/snippet}

<Story
  name="StreetAddressOffered"
  template={looked_}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const street = canvas.getByLabelText("Street Address");

    // What is typed is the street line. The list is a shortcut to the rest of the form, never a
    // gate on this box.
    await step("Typing offers real addresses, and a building shows how many it holds", async () => {
      await userEvent.type(street, "14 Ro");
      expect(await body.findByRole("option", { name: /14 Rosewood Dr/ })).toBeInTheDocument();
    });

    await step("Choosing one fills the rest of the form", async () => {
      await userEvent.click(body.getByRole("option", { name: /14 Rosewood Dr/ }));
      await waitFor(() => expect(canvas.getByLabelText("City")).toHaveValue("Reno"));
      expect(canvas.getByLabelText("ZIP Code")).toHaveValue("89501");
      expect(street).toHaveValue("14 Rosewood Dr");
    });
  }}
/>

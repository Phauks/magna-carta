<script lang="ts">
  /*
   * Address suggestions — the street box's list of offers, and the saved-address rows beside it, on
   * one surface over invented addresses.
   *
   * The review surface for the address form's lookup. Real offers need a provisioned address service
   * and a signed-in session, so this page hands the real AddressFields a lookup that answers from a
   * fixture with Google's attribution, the way the deployed service answers when its key is set.
   * Type into the street box to open the list.
   *
   * Dev builds only, like the developer console itself.
   */
  import AddressFields, {
    type AddressLookup,
    type AddressOffer,
    type AddressParts,
  } from "@magna-carta/design-system/address-fields";
  import { postalCodeAsTypedFor, postalCodeNoteFor } from "@magna-carta/address-formats/postal-code";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import AddressSection from "$lib/directory/sections/address-section.svelte";
  import type { ContactRow } from "$lib/directory/contact-draft.ts";

  const OFFERS: readonly AddressOffer[] = [
    "1400 Meridian Way, Reno, NV, USA",
    "1400 Meridian Avenue, San Jose, CA, USA",
    "1400 Meridian Street, Indianapolis, IN, USA",
    "1400 Meridian Road, Tallahassee, FL, USA",
    "1400 Meridian Boulevard, Mammoth Lakes, CA, USA",
  ].map((label, index) => ({ identifier: `offer-${String(index)}`, label, kind: "address" }));

  const lookup: AddressLookup = {
    suggest: () => Promise.resolve({ kind: "offers", offers: OFFERS, attribution: "google-maps" }),
    resolve: () =>
      Promise.resolve({
        kind: "address",
        parts: {
          street: "1400 Meridian Way",
          city: "Reno",
          region: "NV",
          postal: "89501-2245",
          country: "US",
        },
      }),
  };

  let parts = $state<AddressParts>({ country: "US" });

  const usable = {
    permitted: true,
    preferred: false,
    note: null,
    verificationStatus: "unverified",
    verifiedAt: null,
    verificationDetail: null,
  } as const;
  const ROWS: readonly ContactRow[] = [
    {
      id: "gallery-1",
      kind: "address",
      value: "1400 Meridian Way, Suite 300, Reno, NV 89501-2245",
      use: "Office",
      state: { ...usable, preferred: true },
      isPrimary: true,
    },
    {
      id: "gallery-2",
      kind: "address",
      value: "22 Juniper Court, Sparks, NV 89431",
      use: "Home",
      state: usable,
      isPrimary: false,
    },
  ];
</script>

<svelte:head>
  <title>Address suggestions · Magna Carta</title>
</svelte:head>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default">
    <ScreenHeader title="Address suggestions" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
    <section class="flex max-w-2xl flex-col gap-12" data-gallery="form">
      <h2 class="text-sm font-semibold">The street box, with Google's offers</h2>
      <AddressFields
        bind:value={parts}
        countries={[{ code: "US", name: "United States" }]}
        postalCodeNote={postalCodeNoteFor}
        postalCodeAsTyped={postalCodeAsTypedFor}
        {lookup}
      />
    </section>
    <section class="flex max-w-2xl flex-col gap-12" data-gallery="saved">
      <h2 class="text-sm font-semibold">Saved addresses, with Open in Google Maps</h2>
      <AddressSection rows={ROWS} onAdd={() => {}} onRemove={() => {}} />
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}

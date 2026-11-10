<script lang="ts">
  /*
   * AddressFields bound to real state, the way every screen binds it. A mount with a plain props
   * object gives the form a value nothing reacts to, which is not the shape it runs in; this is, and
   * `onChange` reports each value the binding carries back.
   */
  import AddressFields, {
    type AddressLookup,
    type AddressParts,
  } from "@magna-carta/design-system/address-fields";

  let {
    start,
    lookup,
    onChange,
  }: {
    start: AddressParts;
    lookup: AddressLookup | undefined;
    onChange: (value: AddressParts) => void;
  } = $props();

  // The starting value is read once, as a screen's draft is; the binding owns it from then on.
  // svelte-ignore state_referenced_locally
  let value = $state<AddressParts>(start);
  $effect(() => onChange($state.snapshot(value)));

  const COUNTRIES = [
    { code: "US", name: "United States" },
    { code: "ER", name: "Eritrea" },
  ];
</script>

{#if lookup === undefined}
  <AddressFields bind:value countries={COUNTRIES} />
{:else}
  <AddressFields bind:value countries={COUNTRIES} {lookup} />
{/if}

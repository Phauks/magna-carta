<script lang="ts">
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { page } from "$app/state";
  import { changelogEntries } from "$lib/product-updates/changelog-entries.ts";
  import OptionA from "$lib/product-updates/mockups/option-a-index.svelte";
  import OptionD from "$lib/product-updates/mockups/option-d-pull-requests.svelte";
  import OptionA2 from "$lib/product-updates/mockups/option-a2-index.svelte";
  import OptionB from "$lib/product-updates/mockups/option-b-reader.svelte";
  import OptionC from "$lib/product-updates/mockups/option-c-highlights.svelte";

  const entries = changelogEntries();
  const option = $derived(page.url.searchParams.get("option") ?? "a");
  let searchText = $state("");
  let query = $state("");
</script>

<svelte:head><title>Changelog · Magna Carta</title></svelte:head>

<ScreenHeader title="Changelog" class="mb-24">
  {#snippet meta()}
    {#if option === "d"}
      <span>Every pull request merged to main · last merged {formatDate(entries[0]?.date ?? "2026-01-01")}</span>
    {:else}
      <span>{entries.length} changes · last updated {formatDate(entries[0]?.date ?? "2026-01-01")}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <ScreenSearch
      bind:value={searchText}
      label="Search the changelog"
      searchOn="keystroke"
      fieldClass="w-2xs sm:w-xs"
      onsearch={(next) => {
        query = next;
      }}
    />
  {/snippet}
</ScreenHeader>

{#if option === "d"}
  <OptionD {query} />
{:else if option === "a2"}
  <OptionA2 {entries} {query} />
{:else if option === "b"}
  <OptionB {entries} {query} />
{:else if option === "c"}
  <OptionC {entries} {query} />
{:else}
  <OptionA {entries} {query} />
{/if}

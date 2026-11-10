<script lang="ts">
  /*
   * The Changelog — every pull request merged into Magna Carta, newest first.
   *
   * NOTHING ON THIS SCREEN IS WRITTEN HERE. The rows come from docs/pull-request-ledger.json, which
   * is rebuilt from git history on `main` and built into this bundle
   * ($lib/product-updates/pull-request-ledger.ts), so the screen updates itself with every build
   * and can only ever describe the build it is part of. There is no read, so there is no loading or
   * failure state.
   *
   * It lives at /updates because that is the product-updates route, and the changelog is its first
   * view. It is reached from the profile menu's Websites > Changelog
   * (src/lib/navigation/ecosystem-sites.ts).
   */
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import PullRequestChangelog from "$lib/product-updates/pull-request-changelog.svelte";
  import { mergedPullRequests } from "$lib/product-updates/pull-request-ledger.ts";

  // Parsed once: the ledger is fixed for the life of the bundle.
  const pullRequests = mergedPullRequests();
  const lastMerged = pullRequests[0]?.date ?? null;

  let searchText = $state("");
  let query = $state("");
</script>

<svelte:head>
  <title>Changelog · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Changelog" class="mb-24">
  {#snippet meta()}
    <span>
      Every pull request merged{lastMerged === null ? "" : ` · last merged ${formatDate(lastMerged)}`}
    </span>
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

<PullRequestChangelog {pullRequests} {query} />

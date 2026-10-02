<script lang="ts" module>
  /** Where a guest's page lives. Everything under it is somebody's link, token and all. */
  const GUEST_PAGE_PATH = "/join";

  /**
   * Whether an address is a guest's page — the one family of addresses whose path is a credential,
   * and so the one where a crash screen must not print the path or offer a way into the application.
   */
  export function isGuestPageAddress(pathname: string): boolean {
    return pathname === GUEST_PAGE_PATH || pathname.startsWith(`${GUEST_PAGE_PATH}/`);
  }
</script>

<script lang="ts">
  /*
   * The render boundary around a guest's page, in place of the application's.
   *
   * It catches what the application's boundary catches — a throw while the page renders, which
   * SvelteKit itself never sees — and mints the same kind of Error ID through the same `noteCrash`,
   * so a firm reporting the crash quotes a handle the diagnostics recognise. What it does not do is
   * record or print the address: the breadcrumb names the guest page's family rather than the path,
   * and the screen is `guest-failure.svelte`, which says why the application's screen is wrong here.
   */
  import type { Snippet } from "svelte";
  import { noteCrash } from "$lib/diagnostics/crash.ts";
  import GuestFailure from "./guest-failure.svelte";

  let { children }: { children: Snippet } = $props();

  let errorId = $state<string | null>(null);
</script>

<svelte:head>
  {#if errorId !== null}
    <title>Something Went Wrong</title>
  {/if}
</svelte:head>

<svelte:boundary
  onerror={(error) => {
    errorId = noteCrash(error, GUEST_PAGE_PATH);
  }}
>
  {@render children()}

  {#snippet failed()}
    <GuestFailure {errorId} />
  {/snippet}
</svelte:boundary>

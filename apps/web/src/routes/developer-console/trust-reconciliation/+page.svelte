<script lang="ts">
  /*
   * Trust reconciliation: the Reconciliation list and one reconciliation over fixtures.
   *
   * A local firm has no trust account with a statement to reconcile, so this is where both screens
   * are reviewed. They are the real components over an in-memory service that keeps the server's
   * rules in miniature, so ticking, notes, Save, Restore Points, Undo, Redo, History and Finish all
   * work here, and the report PDF is composed for real. Reload to start the fixtures over.
   *
   * `?bare` drops this preview's own bar, for screenshots of the screen alone.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { RECONCILIATION_BACK } from "$lib/screen/screen-header.ts";
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import ReconciliationListScreen from "$lib/trust/reconciliation/reconciliation-list-screen.svelte";
  import ReconciliationScreen from "$lib/trust/reconciliation/reconciliation-screen.svelte";
  import {
    GALLERY_ACCOUNT_ID,
    GALLERY_ACCOUNT_NAME,
    GALLERY_RECONCILIATION_ID,
    RECONCILIATION_GALLERY_STATES,
    galleryReconciliationService,
    type ReconciliationGalleryState,
  } from "$lib/trust/reconciliation/reconciliation-gallery-fixtures.ts";
  import type { TrustAccountListing } from "$lib/trust/trust-api.ts";

  const STATE_LABELS: Readonly<Record<ReconciliationGalleryState, string>> = {
    working: "In Progress",
    finished: "Finished",
    first: "First One",
    loading: "Still Loading",
    failed: "Couldn't Load",
  };

  const ACCOUNTS: readonly TrustAccountListing[] = [
    {
      id: GALLERY_ACCOUNT_ID,
      name: GALLERY_ACCOUNT_NAME,
      locationId: "loc_gallery",
      jurisdiction: "US-NV",
      bankName: "First Example Bank",
      accountNumberLastFour: "4417",
      currency: "USD",
      iolta: true,
      status: "open",
      openedOn: "2026-01-02",
      closedAt: null,
      timeZone: "America/Los_Angeles",
    },
  ];

  const screen = $derived(page.url.searchParams.get("screen") === "list" ? "list" : "period");
  const galleryState = $derived.by((): ReconciliationGalleryState => {
    const named = page.url.searchParams.get("state");
    return RECONCILIATION_GALLERY_STATES.find((candidate) => candidate === named) ?? "working";
  });
  const bare = $derived(page.url.searchParams.has("bare"));
  const readOnly = $derived(page.url.searchParams.get("reader") === "read-only");
  const service = $derived(galleryReconciliationService(galleryState));
  const manageRefusal = $derived(
    readOnly ? permissionRefusal("Reconciling a trust account", TRUST_PERMISSIONS.manage) : undefined,
  );
  const periodHref = (state: string): string => `?screen=period&state=${state}`;
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    {#if !bare}
      <ScreenHeader title="Trust Reconciliation" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        A developer preview: these buttons show the screens in situations that are hard to reach
        with real data.
      </p>
      <div class="flex flex-wrap gap-8">
        <Button variant={screen === "list" ? "secondary" : "ghost"} size="sm" href="?screen=list&state=working">
          The List
        </Button>
        {#each RECONCILIATION_GALLERY_STATES as candidate (candidate)}
          <Button
            variant={screen === "period" && candidate === galleryState ? "secondary" : "ghost"}
            size="sm"
            href={periodHref(candidate)}
          >
            {STATE_LABELS[candidate]}
          </Button>
        {/each}
      </div>
    {/if}
    {#key `${screen}:${galleryState}:${readOnly}`}
      {#if screen === "list"}
        <ReconciliationListScreen
          trustAccountId={GALLERY_ACCOUNT_ID}
          accounts={ACCOUNTS}
          {service}
          {manageRefusal}
          today="2026-11-19"
          reconciliationHref={() => periodHref("working")}
          onAccountChange={() => {}}
        />
      {:else}
        <ReconciliationScreen
          reconciliationId={GALLERY_RECONCILIATION_ID}
          accountName={GALLERY_ACCOUNT_NAME}
          back={RECONCILIATION_BACK}
          {service}
          {manageRefusal}
          live={false}
        />
      {/if}
    {/key}
  </div>
{/if}

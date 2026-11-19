<script lang="ts">
  /*
   * Trust checks — the Checks screen and the check stock editor over fixtures, in each state.
   *
   * A local firm has no trust account with payments waiting for checks, and no seed makes one, so
   * this is where both screens are reviewed. They are the real components over an in-memory
   * service that keeps the server's numbering rules, so printing, answering and voiding all work
   * here, and the PDF is composed for real. Reload to start the fixtures over.
   *
   * THE SWITCHES ARE NAMED FOR WHAT A READER WOULD SEE, not for the fixture behind them: the owner
   * reviews from here and could not tell what "ready" or "read fail" meant. The panel row opens
   * Confirm Print, the answer panel and a reprint at once, which a reader otherwise reaches only by
   * printing.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Button from "@magna-carta/design-system/button";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import {
    DEVELOPER_CONSOLE_BACK,
    TRUST_BACK,
    TRUST_CHECKS_BACK,
  } from "$lib/screen/screen-header.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import ChecksScreen from "$lib/trust/checks/checks-screen.svelte";
  import CheckStockEditor from "$lib/trust/checks/check-stock-editor.svelte";
  import {
    CHECKS_GALLERY_STATES,
    GALLERY_ACCOUNT_ID,
    GALLERY_ACCOUNT_NAME,
    GALLERY_MEMBERS,
    GALLERY_REPRINT_PAYMENT,
    galleryChecksService,
    type ChecksGalleryState,
  } from "$lib/trust/checks/checks-gallery-fixtures.ts";

  const STATE_LABELS: Readonly<Record<ChecksGalleryState, string>> = {
    ready: "Checks Waiting",
    waiting: "Waiting for Your Answer",
    empty: "Nothing to Print",
    "no-stock": "No Layout Saved",
    reprint: "Misprinted, Back to Print",
    loading: "Still Loading",
    failed: "Couldn't Load",
  };

  /** The panels the gallery can open at once, each over the situation it needs. */
  const PANELS = [
    { value: "print", label: "Confirm Print", state: "ready" },
    { value: "answer", label: "How They Printed", state: "waiting" },
    { value: "reprint", label: "Print Again", state: "reprint" },
  ] as const satisfies readonly { value: string; label: string; state: ChecksGalleryState }[];
  type PanelName = (typeof PANELS)[number]["value"];

  const screen = $derived(page.url.searchParams.get("screen") === "stock" ? "stock" : "checks");
  const panel = $derived(
    PANELS.find((candidate) => candidate.value === page.url.searchParams.get("panel"))?.value ??
      null,
  );
  const galleryState = $derived.by((): ChecksGalleryState => {
    const fromPanel = PANELS.find((candidate) => candidate.value === panel)?.state;
    if (fromPanel !== undefined) return fromPanel;
    const named = page.url.searchParams.get("state");
    return CHECKS_GALLERY_STATES.find((candidate) => candidate === named) ?? "ready";
  });
  const opening = $derived.by(() => {
    const name: PanelName | null = panel;
    if (name === null || screen !== "checks") return undefined;
    if (name === "reprint") {
      return { panel: "reprint" as const, trustMovementIds: [GALLERY_REPRINT_PAYMENT] };
    }
    return { panel: name };
  });
  const readOnly = $derived(page.url.searchParams.get("reader") === "read-only");
  const service = $derived(galleryChecksService(galleryState));
  const manageRefusal = $derived(
    readOnly ? permissionRefusal("Printing trust checks", TRUST_PERMISSIONS.manage) : undefined,
  );

  function show(next: { screen?: string }): void {
    const url = new URL(page.url);
    if (next.screen !== undefined) url.searchParams.set("screen", next.screen);
    void goto(url, { replaceState: true, noScroll: true });
  }
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    <ScreenHeader title="Trust Checks" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
    <p class="text-sm text-text-muted">
      A developer preview: these buttons show the screen in situations that are hard to reach with
      real data.
    </p>
    <div class="flex flex-wrap items-center gap-12">
      <span id="gallery-screen-label" class="sr-only">Which screen</span>
      <SegmentedControl.Root
        aria-labelledby="gallery-screen-label"
        class="w-full sm:w-xs"
        value={screen}
        onValueChange={(next) => show({ screen: next })}
      >
        <SegmentedControl.Item value="checks">Checks</SegmentedControl.Item>
        <SegmentedControl.Item value="stock">Check Stock</SegmentedControl.Item>
      </SegmentedControl.Root>
      <div class="flex flex-wrap gap-8">
        {#each CHECKS_GALLERY_STATES as candidate (candidate)}
          <Button
            variant={panel === null && candidate === galleryState ? "secondary" : "ghost"}
            size="sm"
            href={`?screen=${screen}&state=${candidate}`}
            aria-current={panel === null && candidate === galleryState ? "page" : undefined}
          >
            {STATE_LABELS[candidate]}
          </Button>
        {/each}
      </div>
      {#if screen === "checks"}
        <div class="flex flex-wrap items-center gap-8">
          <span class="text-sm text-text-muted">Open a panel</span>
          {#each PANELS as candidate (candidate.value)}
            <Button
              variant={candidate.value === panel ? "secondary" : "ghost"}
              size="sm"
              href={`?screen=checks&panel=${candidate.value}`}
              aria-current={candidate.value === panel ? "page" : undefined}
            >
              {candidate.label}
            </Button>
          {/each}
        </div>
      {/if}
    </div>
    {#key `${screen}:${galleryState}:${panel}:${readOnly}`}
      {#if screen === "checks"}
        <ChecksScreen
          trustAccountId={GALLERY_ACCOUNT_ID}
          accountName={GALLERY_ACCOUNT_NAME}
          back={TRUST_BACK}
          {service}
          memberName={(identifier) => GALLERY_MEMBERS[identifier] ?? identifier}
          {manageRefusal}
          {opening}
        />
      {:else}
        <CheckStockEditor
          trustAccountId={GALLERY_ACCOUNT_ID}
          accountName={GALLERY_ACCOUNT_NAME}
          back={TRUST_CHECKS_BACK}
          {service}
          {manageRefusal}
        />
      {/if}
    {/key}
  </div>
{/if}

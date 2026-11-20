<script lang="ts">
  /*
   * Trust checks: the Checks screen and the check stock editor over sample data.
   *
   * A local firm has no trust account with payments waiting for checks, and no seed makes one, so
   * this is where both screens are reviewed. They are the real components over an in-memory
   * service that keeps the server's numbering rules, so printing and returning a check to the list
   * both work here, and the PDF is composed for real. Reload to start the fixtures over.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
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
    GALLERY_ACCOUNT_ID,
    GALLERY_ACCOUNT_NAME,
    GALLERY_MEMBERS,
    galleryChecksService,
  } from "$lib/trust/checks/checks-gallery-fixtures.ts";

  const screen = $derived(page.url.searchParams.get("screen") === "stock" ? "stock" : "checks");
  const readOnly = $derived(page.url.searchParams.get("reader") === "read-only");
  const service = galleryChecksService();
  const manageRefusal = $derived(
    readOnly ? permissionRefusal("Printing trust checks", TRUST_PERMISSIONS.manage) : undefined,
  );

  function show(next: { screen?: string }): void {
    const url = new URL(page.url.href);
    if (next.screen !== undefined) url.searchParams.set("screen", next.screen);
    void goto(url, { replace: true, reset: false });
  }
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    <ScreenHeader title="Trust Checks" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
    <p class="text-sm text-text-muted">
      A developer preview over sample data. Reload to start it over.
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
    </div>
    {#key `${screen}:${readOnly}`}
      {#if screen === "checks"}
        <ChecksScreen
          trustAccountId={GALLERY_ACCOUNT_ID}
          accountName={GALLERY_ACCOUNT_NAME}
          back={TRUST_BACK}
          {service}
          memberName={(identifier) => GALLERY_MEMBERS[identifier] ?? identifier}
          {manageRefusal}
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

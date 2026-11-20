<script lang="ts">
  /*
   * Banking over fixtures. A local firm has no bank feed keys, so this is where the screen is
   * reviewed: the real component over an in-memory service carrying the board's own accounts.
   *
   * `?state=` picks a situation, `?open=connect` or `?open=add-to-books` opens that window as the
   * screen arrives, `?reader=read-only` refuses the acts that need banking:manage, and `?bare` drops
   * this preview's own bar, for screenshots of the screen alone.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import BankingScreen from "$lib/banking/banking-screen.svelte";
  import { BANKING_PERMISSIONS, type BankingOpening } from "$lib/banking/banking-model.ts";
  import {
    BANKING_GALLERY_STATES,
    GALLERY_CUMBERLAND,
    GALLERY_HELCIM_LINE,
    GALLERY_NOW,
    GALLERY_TIME_ZONE,
    galleryBankingService,
    type BankingGalleryState,
  } from "$lib/banking/banking-gallery-fixtures.ts";

  const STATE_LABELS: Readonly<Record<BankingGalleryState, string>> = {
    working: "Connected",
    empty: "No Banks",
    unconfigured: "Not Set Up",
    loading: "Still Loading",
    failed: "Couldn't Load",
  };

  const galleryState = $derived.by((): BankingGalleryState => {
    const named = page.url.searchParams.get("state");
    return BANKING_GALLERY_STATES.find((candidate) => candidate === named) ?? "working";
  });
  const opening = $derived.by((): BankingOpening | undefined => {
    const named = page.url.searchParams.get("open");
    if (named === "connect") return { kind: "connect", connectionId: GALLERY_CUMBERLAND };
    if (named === "add-to-books") return { kind: "addToBooks", transactionId: GALLERY_HELCIM_LINE };
    return undefined;
  });
  const bare = $derived(page.url.searchParams.has("bare"));
  const readOnly = $derived(page.url.searchParams.get("reader") === "read-only");
  const service = $derived(galleryBankingService(galleryState));
  const manageRefusal = $derived(
    readOnly
      ? permissionRefusal("Connecting and managing banks", BANKING_PERMISSIONS.manage)
      : undefined,
  );
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    {#if !bare}
      <ScreenHeader title="Banking Gallery" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <div class="flex flex-wrap gap-8">
        {#each BANKING_GALLERY_STATES as candidate (candidate)}
          <Button
            variant={candidate === galleryState && opening === undefined ? "secondary" : "ghost"}
            size="sm"
            href={`?state=${candidate}`}
          >
            {STATE_LABELS[candidate]}
          </Button>
        {/each}
        <Button variant="ghost" size="sm" href="?state=working&open=connect">Connect Window</Button>
        <Button variant="ghost" size="sm" href="?state=working&open=add-to-books">Add to Books Window</Button>
        <Button variant="ghost" size="sm" href="?state=working&reader=read-only">Read Only</Button>
      </div>
    {/if}
    {#key `${galleryState}:${readOnly}:${opening?.kind ?? ""}`}
      <BankingScreen
        {service}
        {manageRefusal}
        {opening}
        now={() => GALLERY_NOW}
        timeZone={GALLERY_TIME_ZONE}
      />
    {/key}
  </div>
{/if}

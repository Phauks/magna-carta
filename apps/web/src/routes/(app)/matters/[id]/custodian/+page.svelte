<script lang="ts">
  /*
   * The matter's Custodian section — what the firm holds that is linked to this matter.
   *
   * IT IS THE SAME REGISTER, NARROWED, AND THAT MATTERS MORE THAN IT SOUNDS. The listing, the
   * columns, the packet window and every word in them are the firm-wide screen's, asked with one
   * more filter. Written as its own table it would drift from the register it is a view of, and the
   * drift would be silent.
   *
   * A MATTER LINK IS OPTIONAL, AND A MATTER THAT SHOWS NOTHING HERE IS NORMAL. Most of what a firm
   * holds is anchored to a person rather than to a file: a will held for a client whose last matter
   * closed years ago belongs to that client, not to the closed matter. So an empty section says
   * that, rather than implying something is missing.
   *
   * LOGGING FROM HERE PRE-ANSWERS THE MATTER AND NOTHING ELSE. A packet taken in during a
   * conveyance is nearly always logged while somebody is looking at the file, so the form opens
   * with the link already made; every other answer on it, the owner included, is still the
   * register's own question, because the property belongs to a person and not to a file.
   *
   * CLOSING THIS MATTER IS NOT BLOCKED BY WHAT IS HERE. Holding a client's original after their
   * matter closes is the normal, correct, indefinite state of affairs. A gate on it would only
   * teach firms to unlink packets before closing, which destroys exactly the linkage this section
   * exists to show. That is a fact about the CLOSE path, and it is stated where closing happens
   * (packages/custodian/src/close-advisory.ts) rather than as a standing paragraph here.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { matterSections } from "$lib/matters/sections.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import {
    listCustodyLocations,
    MANAGE_CUSTODY_PERMISSION,
    type CustodyLocationNode,
  } from "$lib/custodian/custody-api.ts";
  import NewPacketDialog from "$lib/custodian/new-packet-dialog.svelte";
  import PacketRegister from "$lib/custodian/packet-register.svelte";
  import PacketWindow from "$lib/custodian/packet-window.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "custodian");
  if (!section) throw new Error('The matter section registry is missing "custodian".');

  let locations = $state<readonly CustodyLocationNode[]>([]);
  let session = $state<SessionBootstrap | null>(null);
  let openPacketId = $state<string | null>(null);
  let windowOpen = $state(false);
  let dialogOpen = $state(false);
  let rereadRegister = $state<() => void>(() => {});
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped || isSample) return;
    bootstrapped = true;
    void (async () => {
      const [tree, sessionOutcome] = await Promise.all([
        listCustodyLocations(fetch),
        readSession(fetch),
      ]);
      // A tree that cannot be read leaves the section readable: the packets and their numbers are
      // still true, and only the Location column goes quiet.
      if (tree.kind === "ok") locations = tree.value.data;
      if (sessionOutcome.kind === "ok") session = sessionOutcome.value;
    })();
  });

  const query = $derived({ matterId: matter.id });

  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!session.permissions.includes(MANAGE_CUSTODY_PERMISSION)) {
      return permissionRefusal("Logging a packet", "custody:manage");
    }
    return undefined;
  });

  /*
   * The matter header's New Packet opens the register's own dialog with the matter pre-answered;
   * the section keeps no button for it. The refusal is the register's, stated on the control.
   */
  claimMatterCreate("custodian", () => ({
    title: "Log a packet into custody, linked to this matter.",
    refusal: isSample ? SAMPLE_MATTER_REFUSAL : createRefusal,
    run: () => (dialogOpen = true),
  }));

  function openPacket(packetId: string): void {
    openPacketId = packetId;
    windowOpen = true;
  }

  // The packet this address names — what an Activity row hands this section — opened once per
  // address, the way any packet opens.
  let honouredEntry = $state<string | null>(null);
  $effect(() => {
    const entry = entryFromUrl();
    if (entry === null || isSample || honouredEntry === entry) return;
    honouredEntry = entry;
    openPacket(entry);
  });
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex h-full flex-col gap-16">
  <FieldLabel as="h2" class="border-b border-border-strong pb-8"
  >
    {section.label}
  </FieldLabel>

  {#if isSample}
    <Alert.Root variant="info">
      <Alert.Title>No Custody Register On A Sample Matter</Alert.Title>
      <Alert.Description>
        This is one of the sample matters the interface is reviewed against. It has no firm behind
        it, so there is no register to read.
      </Alert.Description>
    </Alert.Root>
  {:else}
    <PacketRegister
      {query}
      {locations}
      bind:reread={rereadRegister}
      onOpenPacket={openPacket}
      caption="Custody packets linked to this matter"
      emptyTitle="Nothing In Custody For This Matter"
    >
      {#snippet emptyBody()}
        Physical originals a firm holds are anchored to the person they belong to, not to a file, so
        most of what the firm holds for this client will not be linked here. The firm's whole
        register answers the question either way.
      {/snippet}
    </PacketRegister>
  {/if}
</section>

<NewPacketDialog
  bind:open={dialogOpen}
  {locations}
  matterId={matter.id}
  onCreated={() => rereadRegister()}
  onLocationsAdded={(added) => (locations = [...locations, ...added])}
/>

<PacketWindow
  bind:open={windowOpen}
  packetId={openPacketId}
  {locations}
  mayManage={createRefusal === undefined}
/>

<script lang="ts">
  /*
   * The matter's Custodian section — what the firm holds that is linked to this matter.
   *
   * IT IS THE SAME REGISTER, NARROWED, AND THAT MATTERS MORE THAN IT SOUNDS. The listing, the
   * columns, the packet window and every word in them are the firm-wide screen's, asked with one
   * more filter. Written as its own table it would drift from the register it is a view of, and the
   * drift would be silent.
   *
   * EVERY PACKET IS UNDER A MATTER, so this section is the whole of what the firm holds for this
   * file rather than a subset of it. The firm holds property for clients and a client is somebody
   * it has a matter with; property under no matter is property belonging to somebody the firm has
   * no relationship with, which it does not take in. An empty section therefore means what it says.
   *
   * LOGGING FROM HERE PRE-ANSWERS THE MATTER. The form needs one before it can offer an owner at
   * all — the owners on offer are the matter's own parties — so opening it from a file answers its
   * first question and narrows its second.
   *
   * CLOSING THIS MATTER IS NOT BLOCKED BY WHAT IS HERE. Holding a client's original after their
   * matter closes is the normal, correct, indefinite state of affairs. A gate on it would only
   * teach firms to unlink packets before closing, which destroys exactly the linkage this section
   * exists to show. That is a fact about the CLOSE path, and it is stated where closing happens
   * (packages/custodian/src/close-advisory.ts) rather than as a standing paragraph here.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Plus from "@lucide/svelte/icons/plus";
  import { matterSections } from "$lib/matters/sections.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import {
    listCustodyLocations,
    MANAGE_CUSTODY_PERMISSION,
    type CustodyLocationNode,
  } from "$lib/custodian/custody-api.ts";
  import NewPacketDialog from "$lib/custodian/new-packet-dialog.svelte";
  import PacketRegister from "$lib/custodian/packet-register.svelte";
  import PacketWindow from "$lib/custodian/packet-window.svelte";

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
    void readContainerTree();
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  // A tree that cannot be read leaves the section readable: the packets and their numbers are
  // still true, and only the Location column goes quiet. Re-read when the form describes one.
  async function readContainerTree(): Promise<void> {
    const tree = await listCustodyLocations(fetch);
    if (tree.kind === "ok") locations = tree.value.data;
  }

  const query = $derived({ matterId: matter.id });

  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!session.permissions.includes(MANAGE_CUSTODY_PERMISSION)) {
      return "Logging a packet needs the custody:manage permission, which this account does not hold.";
    }
    if (locations.length > 0 && !locations.some((location) => location.status === "active")) {
      return "A packet is logged into a container, and the firm has no open one to put it in.";
    }
    return undefined;
  });

  function openPacket(packetId: string): void {
    openPacketId = packetId;
    windowOpen = true;
  }
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

{#snippet newPacketButton()}
  <Button
    variant="primary"
    disabled={createRefusal !== undefined}
    title={createRefusal}
    onclick={() => (dialogOpen = true)}
  >
    <Plus class="size-16" aria-hidden="true" />
    New
  </Button>
{/snippet}

<section class="flex h-full flex-col gap-16">
  <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
    <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      {section.label}
    </h2>
    {#if !isSample}
      {@render newPacketButton()}
    {/if}
  </div>

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
        A packet is the physical thing the firm holds and moves: an envelope, a deed box, a sealed
        wallet. Nothing has been taken into safekeeping on this matter yet.
      {/snippet}
      {#snippet emptyActions()}
        {@render newPacketButton()}
      {/snippet}
    </PacketRegister>
  {/if}
</section>

<NewPacketDialog
  bind:open={dialogOpen}
  {locations}
  matterId={matter.id}
  onCreated={() => rereadRegister()}
  onLocationsChanged={readContainerTree}
/>

<PacketWindow
  bind:open={windowOpen}
  packetId={openPacketId}
  {locations}
  mayManage={createRefusal === undefined}
/>

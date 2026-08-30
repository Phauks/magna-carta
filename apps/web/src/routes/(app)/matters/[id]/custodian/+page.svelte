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
   * that, rather than implying something is missing — and the register itself is one link away,
   * because that is where the question is usually answered.
   *
   * CLOSING THIS MATTER IS NOT BLOCKED BY WHAT IS HERE. Holding a client's original after their
   * matter closes is the normal, correct, indefinite state of affairs. A gate on it would only
   * teach firms to unlink packets before closing, which destroys exactly the linkage this section
   * exists to show.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { matterSections } from "$lib/matters/sections.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import {
    listCustodyLocations,
    type CustodyLocationNode,
  } from "$lib/custodian/custody-api.ts";
  import PacketRegister from "$lib/custodian/packet-register.svelte";
  import PacketWindow from "$lib/custodian/packet-window.svelte";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "custodian");
  if (!section) throw new Error('The matter section registry is missing "custodian".');

  let locations = $state<readonly CustodyLocationNode[]>([]);
  let openPacketId = $state<string | null>(null);
  let windowOpen = $state(false);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped || isSample) return;
    bootstrapped = true;
    void (async () => {
      const tree = await listCustodyLocations(fetch);
      // A tree that cannot be read leaves the section readable: the packets and their numbers are
      // still true, and only the Location column goes quiet.
      if (tree.kind === "ok") locations = tree.value.data;
    })();
  });

  const query = $derived({ matterId: matter.id });

  function openPacket(packetId: string): void {
    openPacketId = packetId;
    windowOpen = true;
  }
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      {section.label}
    </h2>
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

    <p class="text-xs text-text-muted">
      Closing this matter is never blocked by what the firm holds. Holding a client's original after
      their matter closes is the ordinary state of affairs, and a gate on it would only teach firms
      to unlink packets before closing.
      <a class="underline underline-offset-2" href="/custodian">Open the firm's register</a>
    </p>
  {/if}
</section>

<PacketWindow bind:open={windowOpen} packetId={openPacketId} {locations} />

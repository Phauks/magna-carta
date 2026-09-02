<script lang="ts">
  /*
   * The matter's parties — who is on this matter and in what role, read from the firm's own record.
   *
   * Until this screen existed a party link could be written through the API and never read back:
   * the read function was production code the conflicts checker called, and no route mounted it.
   * That is what this section is for, so nothing here presents fixtures. A SAMPLE matter (the
   * in-repo fixtures the chrome's lifecycle states are reviewed against) has no firm behind it and
   * therefore no parties to read; it says so rather than showing an empty table, because "no
   * parties" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import { matterSections } from "$lib/matters/sections.ts";
  import {
    listMatterParties,
    roleLabel,
    unlinkMatterParty,
    type MatterPartyEntry,
  } from "$lib/matters/party-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "parties");
  if (!section) throw new Error('The matter section registry is missing "parties".');

  let parties = $state<readonly MatterPartyEntry[] | null>(null);
  let loadFailure = $state<StatedFailure | null>(null);
  let severing = $state<MatterPartyEntry | null>(null);
  let severFailure = $state<StatedFailure | null>(null);
  // Bumped to force a re-read after a link is severed.
  let reloadToken = $state(0);

  // Which matter the list on screen belongs to. Only a change of MATTER discards it: a reload after
  // a sever is the same matter's list being read again, and blanking it would flash a skeleton over
  // a table the reader is still looking at.
  let shownMatterId: string | null = null;

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    if (matterId !== shownMatterId) {
      shownMatterId = matterId;
      parties = null;
      loadFailure = null;
    }
    if (isSample) {
      parties = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      // `token` is read so this re-runs when it changes; nothing else needs its value.
      void token;
      const result = await listMatterParties(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        parties = result.value.parties;
        loadFailure = null;
      } else {
        parties = [];
        loadFailure = stated(result.failure, "The parties on this matter could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function confirmSever(): Promise<ActionOutcome> {
    const target = severing;
    if (target === null) return "refused";
    severFailure = null;
    const result = await unlinkMatterParty(fetch, target.id, crypto.randomUUID());
    if (result.kind === "ok") {
      reloadToken += 1;
      return "committed";
    }
    severFailure = stated(
      result.failure,
      "The party could not be removed from this matter.",
      "The party is still on this matter.",
    );
    return "refused";
  }
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8 border-b border-border-strong pb-8">
    <div class="flex items-center justify-between gap-16">
      <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Parties
      </h2>
      <div class="flex items-center gap-8">
        <Badge variant="neutral">Soon</Badge>
        <Button variant="secondary" disabled>
          <Plus aria-hidden="true" />
          Add party
        </Button>
      </div>
    </div>
    <p class="text-xs text-text-muted">
      Adding a party waits on the directory picker, so that the person or organization is chosen
      from the firm's directory rather than typed twice. Parties already on this matter can be read
      and removed here now.
    </p>
  </div>

  {#if loadFailure !== null}
    <FailureNotice
      failure={loadFailure.failure}
      title="Parties Could Not Be Read"
      fallback={loadFailure.fallback}
      whenSilent={loadFailure.whenSilent}
    />
  {:else if parties === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Loading the matter's parties">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if isSample}
    <EmptyState title="No Parties On A Sample Matter">
      This is one of the sample matters the interface is reviewed against. It has no firm behind it,
      so there are no parties to read.
    </EmptyState>
  {:else if parties.length === 0}
    <EmptyState title="No Parties Yet">
      Everyone connected to this matter is recorded here: the client, the opposing party, counsel,
      guardians, witnesses. One person can hold more than one role, and each role is its own entry.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Parties recorded on this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Role</DataTable.Head>
          <DataTable.Head>Directory entry</DataTable.Head>
          <DataTable.Head>Capacity</DataTable.Head>
          <DataTable.Head data-align="end">Actions</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each parties as party (party.id)}
          <DataTable.Row>
            <DataTable.Cell>{roleLabel(party.role)}</DataTable.Cell>
            <DataTable.Cell>
              {#if party.displayName === null}
                <span class="text-text-muted">{party.entityId}</span>
              {:else}
                {party.displayName}
              {/if}
              {#if party.entityKind === "unknown"}
                <Badge variant="warning">Not in the directory</Badge>
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>
              {#if party.capacity === null}
                <span class="text-text-muted">Not recorded</span>
              {:else}
                {party.capacity}
              {/if}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              <Button
                variant="ghost"
                onclick={() => {
                  severing = party;
                  severFailure = null;
                }}
              >
                Remove
              </Button>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

<ActionDialog
  kind="destructive"
  bind:open={() => severing !== null, (next) => {
    if (!next) severing = null;
  }}
  heading="Remove This Party?"
  commitLabel="Remove"
  commitBusyLabel="Removing"
  unsavedChanges={false}
  onCommit={confirmSever}
>
  {#snippet fields()}
    {#if severing !== null}
      <p class="text-sm">
        This removes the {roleLabel(severing.role).toLowerCase()} role from this matter. The record
        is kept so a conflicts report that named this party stays reproducible, and the person stays
        in the directory. Their other roles on this matter are not affected.
      </p>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if severFailure !== null}
      <FailureNotice
        failure={severFailure.failure}
        title="The Party Was Not Severed"
        fallback={severFailure.fallback}
        whenSilent={severFailure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>

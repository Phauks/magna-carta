<script lang="ts">
  /*
   * The matter's Messaging section — the calls and texts on this case.
   *
   * IT IS THE SAME LOG, NARROWED, AND THAT MATTERS MORE THAN IT SOUNDS. The listing, the columns and
   * every word in them are the firm-wide screen's, asked with one more filter. Written as its own
   * table it would drift from the log it is a view of, and the drift would be silent.
   *
   * WHAT THIS SECTION DOES NOT OFFER IS FILING. Filing a call onto a matter is the act of deciding
   * WHICH matter, and inside one that decision is already made — there is nothing left to choose. So
   * the door between the queue and a case is on the firm-wide screen only, and what a section offers
   * instead is the reverse: taking a row that was filed here in error back off, where it returns to
   * the queue rather than being deleted.
   *
   * THE MATTER COLUMN IS ABSENT HERE. Every row is on this matter, and a column of one repeated
   * value costs width and says nothing.
   *
   * AN EMPTY SECTION IS NORMAL AND SAYS SO. Most of what a firm says to a client is said before
   * anybody writes it down, and this log holds only what somebody recorded. An empty one means
   * nothing has been recorded on this case, not that nothing was said.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { matterSections } from "$lib/matters/sections.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import CommunicationLog from "$lib/communications/communication-log.svelte";
  import CommunicationRecordWindow from "$lib/communications/communication-record-window.svelte";
  import {
    LOG_COMMUNICATIONS_PERMISSION,
    REVIEW_UNROUTED_PERMISSION,
    type Communication,
  } from "$lib/communications/communications-api.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "messaging");
  if (!section) throw new Error('The matter section registry is missing "messaging".');

  let session = $state<SessionBootstrap | null>(null);
  let rereadLog = $state<() => void>(() => {});
  let bootstrapped = false;

  // A row opens into its own record here exactly as it does on the firm-wide screen, and so does
  // recording a new one: one listing, one window, and the only difference between the window's two
  // states is whether it opened with a record in it. Taking a row back off this matter is one of the
  // acts inside it.
  let recordOpen = $state(false);
  /** Which record the window is on, or null while it is recording a new one. */
  let openedId = $state<string | null>(null);

  function openRow(row: Communication): void {
    openedId = row.id;
    recordOpen = true;
  }

  function openNew(): void {
    openedId = null;
    recordOpen = true;
  }

  $effect(() => {
    if (bootstrapped || isSample) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const query = $derived({ matterId: matter.id });

  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!session.permissions.includes(LOG_COMMUNICATIONS_PERMISSION)) {
      return permissionRefusal("Logging a call or a text", LOG_COMMUNICATIONS_PERMISSION);
    }
    return undefined;
  });

  /*
   * The matter header's New Message opens the log's own dialog with the matter pre-answered; the
   * section keeps no button for it. The refusal is the log's, stated on the control. "Message",
   * not "Call": a call is one kind of message the log holds, not the thing the control creates
   * (owner ruling, 2026-09-14).
   */
  claimMatterCreate("messaging", () => ({
    title: "Record a call or a text on this matter.",
    refusal: isSample ? SAMPLE_MATTER_REFUSAL : createRefusal,
    run: openNew,
  }));
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex h-full flex-col gap-16">
  <FieldLabel as="h2" class="border-b border-border-strong pb-8">
    {section.label}
  </FieldLabel>

  {#if isSample}
    <Alert.Root variant="info">
      <Alert.Title>No Call Log On A Sample Matter</Alert.Title>
      <Alert.Description>
        This is a sample matter for previewing screens. It has nothing recorded.
      </Alert.Description>
    </Alert.Root>
  {:else}
    <CommunicationLog
      {query}
      showMatter={false}
      bind:reread={rereadLog}
      onOpen={openRow}
      caption="Calls and texts on this matter"
      emptyTitle="Nothing Recorded On This Matter"
    >
      {#snippet emptyBody()}
        No calls or texts on this matter yet.
      {/snippet}
    </CommunicationLog>
  {/if}
</section>

<!-- No picker: inside a matter the matter is settled, so a record being made states it rather than
     offering a choice that does not exist here. That is also why the anchor list is empty — nothing
     here needs one. -->
<CommunicationRecordWindow
  bind:open={recordOpen}
  communicationId={openedId}
  matters={[]}
  matterId={matter.id}
  matterFixed
  matterName={matter.title}
  canWrite={session?.permissions.includes(LOG_COMMUNICATIONS_PERMISSION) ?? false}
  canReviewQueue={session?.permissions.includes(REVIEW_UNROUTED_PERMISSION) ?? false}
  onChanged={() => rereadLog()}
/>

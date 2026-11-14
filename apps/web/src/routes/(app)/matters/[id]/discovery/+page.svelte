<script lang="ts">
  /*
   * The matter's Discovery section — the corpora this case is reviewing, and the way into one.
   *
   * IT IS THE ENTRY, NOT THE WORKSPACE. A review set opens at /discovery/review-sets/<id>, outside
   * the matter's chrome, and that is a deliberate structural choice rather than a routing
   * convenience. The matter header carries a consolidated search on every section by construction,
   * and that search must never reach a review set — the split catalog is keyed by corpus precisely
   * so a matter search cannot name material another party produced. A workspace rendered inside
   * this layout would therefore put a search field on screen, at the top right, aimed at a
   * different corpus from the documents underneath it. The header's one create control has the
   * same problem: its label is settled by the section registry before a section mounts.
   *
   * The reader may also not be a matter reader at all. A review set's access list is separate from
   * who works the matter, so somebody cleared for one production and nothing else can hold it —
   * and the matter's identity block, sections and money have no business above their work.
   *
   * SO THIS SECTION IS SMALL ON PURPOSE. A matter has a handful of review sets, not thousands, and
   * everything expensive happens after one is opened.
   *
   * WHAT THE EMPTY STATE MAY NOT SAY. A member off a review set's access list gets no rows and no
   * error naming it — the corpus is ABSENT rather than refused, because "there is something here
   * you may not see" is itself a disclosure about material that may be under a protective order.
   * So this screen must never say "this matter has no review sets": for a walled-off reader that
   * sentence is false, and a false statement about whether a corpus exists is the same disclosure
   * running the other way. The empty state says what a review set is, and asserts nothing about
   * what the matter holds.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import Import from "@lucide/svelte/icons/import";
  import { goto } from "$app/navigation";
  import { matterSections } from "$lib/matters/sections.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    listMatterReviewSets,
    listRecordCustodians,
    LOAD_DISCOVERY_PERMISSION,
    MANAGE_REVIEW_SETS_PERMISSION,
    type RecordCustodian,
    type ReviewSet,
  } from "$lib/discovery/discovery-api.ts";
  import DeclareLoadDialog from "$lib/discovery/declare-load-dialog.svelte";
  import NewReviewSetDialog from "$lib/discovery/new-review-set-dialog.svelte";
  import ReviewSetList from "$lib/discovery/review-set-list.svelte";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "discovery");
  if (!section) throw new Error('The matter section registry is missing "discovery".');

  let session = $state<SessionBootstrap | null>(null);
  let openReviewSets = $state<readonly ReviewSet[]>([]);
  let custodians = $state<readonly RecordCustodian[]>([]);
  let newReviewSetOpen = $state(false);
  let declareLoadOpen = $state(false);
  let rereadList = $state<() => void>(() => {});
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped || isSample) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
    void readOpenReviewSets();
  });

  /*
   * The OPEN review sets, read for the load menu alone.
   *
   * A locked or closed set takes no more material, so a load control that offered one would exist
   * to be refused. This read is the same access-scoped listing the table below pages; asking twice
   * costs one small request and keeps the menu's options and the table's rows from drifting.
   */
  async function readOpenReviewSets(): Promise<void> {
    const outcome = await listMatterReviewSets(fetch, matter.id);
    if (outcome.kind !== "ok") return;
    openReviewSets = outcome.value.data.filter((set) => set.state === "open");
    const only = openReviewSets.length === 1 ? openReviewSets[0] : undefined;
    if (only === undefined) {
      custodians = [];
      return;
    }
    // Only worth reading where there is one candidate: with several, the load form picks the review
    // set first and reads that one's custodians itself rather than this screen guessing.
    const roster = await listRecordCustodians(fetch, only.id);
    custodians = roster.kind === "ok" ? roster.value.data : [];
  }

  const mayManage = $derived(
    session?.permissions.includes(MANAGE_REVIEW_SETS_PERMISSION) ?? false,
  );
  const mayLoad = $derived(session?.permissions.includes(LOAD_DISCOVERY_PERMISSION) ?? false);

  const createRefusal = $derived.by((): string | undefined => {
    if (isSample) return SAMPLE_MATTER_REFUSAL;
    if (session === null) return "Reading your session.";
    if (!mayManage && !mayLoad) {
      return permissionRefusal("Working a review set", "discovery:manageReviewSets");
    }
    return undefined;
  });

  /*
   * Two kinds, so the header's control reads the bare "New" and the menu names them. It is also the
   * one section where a noun could not have been used: the domain's own term is two words and the
   * label grammar carries one, and the platform does not get to shorten a term a firm writes in
   * correspondence just to fit a button.
   */
  claimMatterCreate("discovery", () => ({
    title: "Start a review set, or declare what is coming into one.",
    refusal: createRefusal,
    choices: [
      {
        label: "New Review Set",
        icon: FolderPlus,
        refusal: mayManage
          ? undefined
          : permissionRefusal("Creating a review set", "discovery:manageReviewSets"),
        run: () => (newReviewSetOpen = true),
      },
      {
        label: "New Load",
        icon: Import,
        refusal: !mayLoad
          ? permissionRefusal("Declaring a load", "discovery:load")
          : openReviewSets.length === 0
            ? "Material goes into a review set, and this matter has no open one to put it in."
            : undefined,
        run: () => (declareLoadOpen = true),
      },
    ],
  }));

  function openReviewSet(reviewSetId: string): void {
    void goto(`/discovery/review-sets/${reviewSetId}`);
  }
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex h-full flex-col gap-16">
  <FieldLabel as="h2" class="border-b border-border-strong pb-8">{section.label}</FieldLabel>

  {#if isSample}
    <Alert.Root variant="info">
      <Alert.Title>No Review Sets On A Sample Matter</Alert.Title>
      <Alert.Description>
        This is a sample matter for previewing screens. It has no review sets.
      </Alert.Description>
    </Alert.Root>
  {:else}
    <ReviewSetList
      matterId={matter.id}
      bind:reread={rereadList}
      onOpen={openReviewSet}
      caption="Review sets on this matter"
      emptyTitle="No Review Set Is Open Here"
    >
      {#snippet emptyBody()}
        No review sets on this matter yet. Start one with New Review Set. Each set has its own access list, so material under a protective order stays limited to the people you add.
      {/snippet}
    </ReviewSetList>
  {/if}
</section>

<NewReviewSetDialog
  bind:open={newReviewSetOpen}
  matterId={matter.id}
  onCreated={(reviewSetId) => {
    rereadList();
    void readOpenReviewSets();
    openReviewSet(reviewSetId);
  }}
/>

<DeclareLoadDialog
  bind:open={declareLoadOpen}
  reviewSets={openReviewSets}
  recordCustodians={custodians}
  onDeclared={(_loadId, reviewSetId) => {
    rereadList();
    openReviewSet(reviewSetId);
  }}
/>

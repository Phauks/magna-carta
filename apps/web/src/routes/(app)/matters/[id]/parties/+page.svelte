<script lang="ts">
  /*
   * The matter's parties — who is on this matter and in what role, read from and written to the
   * firm's own record.
   *
   * This is the first surface built on the directory-linking family, and it is deliberately thin:
   * the tab that lists the parties, offers the picker and asks before removing one is the same tab
   * every record type shows its people in, so what is left here is what only this screen knows —
   * which matter, who may change it, how a link is persisted, and where an entity opens. Nothing
   * here composes a combobox over the directory or a confirmation of its own; the moment it did, it
   * would be the fourth copy of each.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore no parties to read; it says so rather than showing an empty tab,
   * because "no parties" and "not a real matter" are different facts.
   */
  import RecordParties, { type PartyLink, type RecordParty } from "@magna-carta/design-system/record-parties";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { matterSections } from "$lib/matters/sections.ts";
  import {
    linkMatterParty,
    listMatterParties,
    roleLabel,
    storedRoleFor,
    unlinkMatterParty,
    PARTY_ROLE_OPTIONS,
    type MatterPartyEntry,
  } from "$lib/matters/party-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { DIRECTORY_EDIT_PERMISSION } from "$lib/directory/directory-api.ts";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { UNNAMED_ENTITY } from "$lib/directory/entity-presentation.ts";
  import EntityWindow from "$lib/directory/entity-window.svelte";
  import { standingOnMatter } from "$lib/matters/party-standing.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  const section = matterSections.find((candidate) => candidate.slug === "parties");
  if (!section) throw new Error('The matter section registry is missing "parties".');

  // ---- who is asking ---------------------------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let bootstrapped = $state(false);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const mayEdit = $derived(session?.permissions.includes(DIRECTORY_EDIT_PERMISSION) ?? false);

  /*
   * The matter header's New Party opens the parties tab's own add row — the tab keeps its inline
   * Add… as the gesture on the list itself, the way the file manager keeps New Folder in its rail —
   * and states the tab's refusal on the control.
   */
  let partiesTab = $state<ReturnType<typeof RecordParties> | null>(null);
  claimMatterCreate("parties", () => ({
    title: "Link a person or an organization to this matter.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : session === null
        ? "Reading your session."
        : mayEdit
          ? undefined
          : linkDisabledReason,
    run: () => partiesTab?.openAddRow(),
  }));

  // Until the session is read nobody knows whether this account may change the list, so the tab is
  // still loading rather than refused: a refusal that vanishes when the answer arrives is a line
  // that unmounts, and the reader is left wondering what it said.
  const linkDisabledReason = $derived(
    mayEdit
      ? undefined
      : permissionRefusal("Changing who is on a matter", "directory:edit"),
  );

  // ---- the parties -----------------------------------------------------------------------------

  let parties = $state<readonly MatterPartyEntry[] | null>(null);
  let loadFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  // Bumped to force a re-read after a link is made or severed.
  let reloadToken = $state(0);

  // Which matter the list on screen belongs to. Only a change of MATTER discards it: a reload after
  // a write is the same matter's list being read again, and blanking it would flash a skeleton over
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

  /*
   * The tab's shape from the matter's. The association keeps its own id apart from the entity's, so
   * a person on the matter twice is two rows that end on their own. An entity the directory no longer
   * resolves is handed over with no kind, so the mark says so rather than guessing a glyph, and is
   * named by the one wording the product uses for a record with nothing readable on it. A row
   * carries no address: a party opens in the entity window over this tab, so the matter stays where
   * it was and its own way back stays true.
   */
  const recordParties = $derived<readonly RecordParty[]>(
    (parties ?? []).map((party) => {
      const row: RecordParty = {
        identifier: party.id,
        entityIdentifier: party.entityId,
        name: party.displayName ?? UNNAMED_ENTITY,
        kind: party.entityKind === "unknown" ? null : party.entityKind,
        role: party.role,
        roleLabel: roleLabel(party.role),
      };
      if (party.capacity !== null) row.capacity = party.capacity;
      return row;
    }),
  );

  // ---- the open party --------------------------------------------------------------------------

  let entityOpen = $state(false);
  let openEntityId = $state("");
  // What this matter knows about the open party and the directory does not: its roles here.
  const standing = $derived(
    openEntityId === "" ? null : standingOnMatter(matter.title, parties ?? [], openEntityId),
  );

  function openParty(party: RecordParty): void {
    openEntityId = party.entityIdentifier;
    entityOpen = true;
  }

  const search = directoryPickerSearch(fetch);

  async function link(request: PartyLink): Promise<void> {
    writeFailure = null;
    const role = request.role === null ? "" : storedRoleFor(request.role);
    if (role === "") return;
    const result = await linkMatterParty(
      fetch,
      { matterId: matter.id, entityId: request.entity.identifier, role, capacity: request.capacity },
      crypto.randomUUID(),
    );
    if (result.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      result.failure,
      "The party could not be added to this matter.",
      "Couldn't connect. The matter's parties are unchanged.",
    );
  }

  async function unlink(party: RecordParty): Promise<void> {
    writeFailure = null;
    const result = await unlinkMatterParty(fetch, party.identifier, crypto.randomUUID());
    if (result.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      result.failure,
      "The party could not be removed from this matter.",
      "The party is still on this matter.",
    );
  }
</script>

<svelte:head>
  <title>{section.label} · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <FieldLabel as="h2" class="border-b border-border-strong pb-8"
  >
    Parties
  </FieldLabel>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="The Parties Were Not Changed"
      fallback={writeFailure.fallback}
      whenSilent={writeFailure.whenSilent}
    />
  {/if}

  {#if isSample}
    <EmptyState title="No Parties On A Sample Matter">
      This is a sample matter for previewing screens. It has no parties.
    </EmptyState>
  {:else}
    <!-- A form is never full-width: the tab keeps a readable measure on the matter's canvas. -->
    <RecordParties
      bind:this={partiesTab}
      class="max-w-xl"
      parties={recordParties}
      roles={PARTY_ROLE_OPTIONS}
      allowNewRole
      {search}
      canEdit={mayEdit}
      {linkDisabledReason}
      loading={parties === null || session === null}
      loadingMessage="Loading the matter's parties"
      errorMessage={loadFailure?.fallback}
      errorIdentifier={loadFailure?.failure.problem?.errorId ?? undefined}
      onRetry={() => (reloadToken += 1)}
      onLink={(request) => void link(request)}
      onUnlink={(party) => void unlink(party)}
      onOpen={openParty}
    />
  {/if}
</section>

<!-- A party's record, over this tab rather than in the directory's place. A name changed in the
     window is read back into the list. -->
<EntityWindow
  bind:open={entityOpen}
  bind:entityId={openEntityId}
  {standing}
  onChanged={() => (reloadToken += 1)}
/>

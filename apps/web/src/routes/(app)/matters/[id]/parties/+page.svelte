<script lang="ts">
  import { untrack } from "svelte";
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
   * IT IS A TABLE, AND IT SAYS WHETHER EACH PARTY WAS CHECKED (owner's ask, 2026-11-14: "parties
   * screen needs to be improved in matters as well"). Name, role, capacity, and whether the matter's
   * latest conflicts check searched the party. A party linked after that check has never been
   * searched for this matter, and the row says so in the warning tone, because that is the gap a
   * conflicts procedure exists to close. The tab still owns the add row and the Remove confirmation:
   * this screen only lays the rows out.
   *
   * COUNSEL ARE READ WITH THEIR FIRM (owner's ask, 2026-11-14). A counsel's row names the firm the
   * Directory says they practice with, and offers to put that firm on the matter as counsel's firm,
   * so the next check searches the firm as a party rather than only reaching it through a
   * relationship. counsel-firm.ts holds which relationships count.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore no parties to read; it says so rather than showing an empty tab,
   * because "no parties" and "not a real matter" are different facts.
   */
  import RecordParties, { type PartyLink, type RecordParty } from "@magna-carta/design-system/record-parties";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Unlink from "@lucide/svelte/icons/unlink";
  import Building2 from "@lucide/svelte/icons/building-2";
  import { readDirectoryEdges } from "$lib/directory/directory-api.ts";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import {
    COUNSEL_FIRM_ROLES,
    currentFirmOf,
    isCounselRole,
    type CounselFirm,
  } from "$lib/matters/counsel-firm.ts";
  import {
    readConflictsCheck,
    readMatterConflictsPosture,
    type MatterConflictsPosture,
  } from "$lib/conflicts/conflicts-api.ts";
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

  // ---- whether each party was checked -----------------------------------------------------------

  /*
   * The matter's latest conflicts check, and the parties it searched. Read once per matter and again
   * after a party is added or removed. An account that may not read conflicts gets no column rather
   * than a column of guesses.
   */
  let posture = $state<MatterConflictsPosture | null>(null);
  let searched = $state<ReadonlySet<string> | null>(null);
  let conflictsReadable = $state(false);

  $effect(() => {
    const matterId = matter.id;
    void reloadToken;
    if (isSample) return;
    let cancelled = false;
    void (async () => {
      const outcome = await readMatterConflictsPosture(fetch, matterId);
      if (cancelled) return;
      if (outcome.kind !== "ok") {
        conflictsReadable = false;
        return;
      }
      posture = outcome.value;
      conflictsReadable = true;
      const latestRun = outcome.value.latestCheck?.id ?? null;
      if (latestRun === null) {
        searched = new Set();
        return;
      }
      const check = await readConflictsCheck(fetch, latestRun, latestRun);
      if (cancelled) return;
      searched =
        check.kind === "ok" && check.value.record !== null
          ? new Set(check.value.record.check.subjectEntityIds)
          : null;
    })();
    return () => {
      cancelled = true;
    };
  });

  const latestCheckName = $derived(posture?.latestCheck?.checkNumber ?? "the latest check");
  const latestCheckId = $derived(posture?.latestCheck?.id ?? null);

  /** What the Conflicts column says about one party, and in which tone. */
  function conflictsStanding(entityId: string): { text: string; tone: "neutral" | "warning" } | null {
    if (!conflictsReadable || posture === null) return null;
    if (posture.latestCheck === null) return { text: "Never checked", tone: "warning" };
    if (searched === null) return null;
    return searched.has(entityId)
      ? { text: `Searched in ${latestCheckName}`, tone: "neutral" }
      : { text: "Added after the latest check", tone: "warning" };
  }

  const uncheckedCount = $derived(
    (parties ?? []).filter((party) => conflictsStanding(party.entityId)?.tone === "warning").length,
  );

  const summary = $derived.by(() => {
    if (parties === null || parties.length === 0) return "";
    const count = `${String(parties.length)} ${parties.length === 1 ? "party" : "parties"}.`;
    if (!conflictsReadable || posture === null) return count;
    if (posture.latestCheck === null) return `${count} No conflicts check has been run yet.`;
    if (uncheckedCount === 0) return `${count} The latest conflicts check searched every one.`;
    return `${count} ${String(uncheckedCount)} ${uncheckedCount === 1 ? "was" : "were"} added after the latest conflicts check.`;
  });

  // ---- counsel and their firms -----------------------------------------------------------------

  /** The firm each counsel on the matter practices with, by the counsel's entity; null for none. */
  let counselFirms = $state<ReadonlyMap<string, CounselFirm | null>>(new Map());
  let addingFirm = $state<string | null>(null);

  $effect(() => {
    const counsel = (parties ?? []).filter(
      (party) => isCounselRole(party.role) && party.entityKind === "person",
    );
    const unread = counsel.filter((party) => !untrack(() => counselFirms).has(party.entityId));
    if (unread.length === 0) return;
    let cancelled = false;
    void (async () => {
      const today = todayCivil();
      const found = await Promise.all(
        unread.map(async (party) => {
          const outcome = await readDirectoryEdges(fetch, party.entityId);
          return [party.entityId, outcome.kind === "ok" ? currentFirmOf(outcome.value.data, today) : null] as const;
        }),
      );
      if (cancelled) return;
      counselFirms = new Map([...untrack(() => counselFirms), ...found]);
    })();
    return () => {
      cancelled = true;
    };
  });

  /** Whether the firm is already on the matter, in any role. */
  function firmOnMatter(firmId: string): boolean {
    return (parties ?? []).some((party) => party.entityId === firmId);
  }

  /** Put a counsel's firm on the matter, in the role that matches the counsel's. */
  async function addFirm(counselRole: string | undefined, firm: CounselFirm): Promise<void> {
    const role = counselRole === undefined ? undefined : COUNSEL_FIRM_ROLES.get(counselRole);
    if (role === undefined || addingFirm !== null) return;
    addingFirm = firm.entityId;
    writeFailure = null;
    const result = await linkMatterParty(
      fetch,
      { matterId: matter.id, entityId: firm.entityId, role, capacity: null },
      crypto.randomUUID(),
    );
    addingFirm = null;
    if (result.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      result.failure,
      "The firm could not be added to this matter.",
      "Couldn't connect. The matter's parties are unchanged.",
    );
  }

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
  <div class="flex flex-col gap-4 border-b border-border-strong pb-8">
    <FieldLabel as="h2">Parties</FieldLabel>
    {#if summary !== ""}
      <p class="text-sm text-text-muted">{summary}</p>
    {/if}
  </div>

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
    <RecordParties
      bind:this={partiesTab}
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
    >
      {#snippet rows({ parties: shown, removeLabel, askToRemove })}
        <DataTable.Root>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Name</DataTable.Head>
              <DataTable.Head>Role</DataTable.Head>
              <DataTable.Head>Capacity</DataTable.Head>
              {#if conflictsReadable}<DataTable.Head>Conflicts</DataTable.Head>{/if}
              <DataTable.Head><span class="sr-only">Remove</span></DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each shown as party (party.identifier)}
              {@const standing = conflictsStanding(party.entityIdentifier)}
              <DataTable.Row data-party={party.entityIdentifier}>
                {@const firm = counselFirms.get(party.entityIdentifier)}
                <DataTable.Cell>
                  <div class="flex flex-col gap-4">
                    <EntityIdentity
                      kind={party.kind}
                      name={party.name}
                      onOpen={() => openParty(party)}
                    />
                    {#if firm !== undefined && party.role !== undefined && isCounselRole(party.role)}
                      <!-- The firm the Directory says this counsel practices with. -->
                      <div class="flex flex-wrap items-center gap-8 ps-24 text-sm text-text-muted" data-counsel-firm>
                        {#if firm === null}
                          <span>No firm recorded in the Directory</span>
                        {:else}
                          <span class="flex items-center gap-4">
                            <Building2 class="size-12" aria-hidden="true" />
                            With {firm.name ?? "an unnamed organization"}
                          </span>
                          {#if !firmOnMatter(firm.entityId)}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!mayEdit || addingFirm !== null}
                              title={mayEdit
                                ? "Put the firm on this matter, so a conflicts check searches it as a party."
                                : linkDisabledReason}
                              onclick={() => void addFirm(party.role, firm)}
                            >
                              {addingFirm === firm.entityId ? "Adding" : "Add Their Firm"}
                            </Button>
                          {/if}
                        {/if}
                      </div>
                    {/if}
                  </div>
                </DataTable.Cell>
                <DataTable.Cell>{party.roleLabel ?? party.role ?? ""}</DataTable.Cell>
                <DataTable.Cell>{party.capacity ?? ""}</DataTable.Cell>
                {#if conflictsReadable}
                  <DataTable.Cell>
                    {#if standing !== null}
                      {#if latestCheckId !== null && standing.tone === "neutral"}
                        <a
                          class="text-sm underline-offset-2 hover:underline"
                          href="/conflicts/checks/{latestCheckId}"
                        >
                          {standing.text}
                        </a>
                      {:else}
                        <Badge variant={standing.tone}>{standing.text}</Badge>
                      {/if}
                    {/if}
                  </DataTable.Cell>
                {/if}
                <DataTable.Cell class="text-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mayEdit}
                    title={mayEdit ? undefined : linkDisabledReason}
                    aria-label={removeLabel(party)}
                    onclick={() => askToRemove(party)}
                  >
                    <Unlink class="size-16" aria-hidden="true" />
                    Remove
                  </Button>
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      {/snippet}
    </RecordParties>
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

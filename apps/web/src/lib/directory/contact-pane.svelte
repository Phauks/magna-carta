<script lang="ts">
  /*
   * How the firm can reach this record — email addresses, telephone and fax numbers, or the postal
   * addresses — read from and written to the firm's own record.
   *
   * ONE PANE, TWO SECTIONS, BECAUSE ONE READ ANSWERS BOTH. The record's Contact section and its
   * Address section are two halves of the same `contact-points` read — one round trip for a
   * question a person asked once — so this pane makes that read and renders whichever half its
   * `channel` names. Two panes with a read each would ask the record the same question twice
   * whenever somebody moved between the two rail items.
   *
   * The pane is thin on purpose. The Address half is the section the New Person screen drafts with;
   * the Contact half is ./contact-card-editor.svelte, which reads as a plain list and is changed all
   * at once behind one Edit button, its Save turned into single writes by ./contact-edit-plan.ts.
   * What is left here is what only this pane knows: which record, who may change it, and how each
   * write is persisted.
   *
   * Two facts a screen must not merge: `permitted` (may the firm use this) and `preferred` (the one
   * way the person asked to be reached). A person can be reachable at a number they would rather
   * the firm did not ring, and prefer post while their email stays perfectly usable. Withdrawing the
   * permission is recorded, never deleted: a number that came back "do not call" is a fact about
   * the record, and the next person must not ring it again.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    addressDraftFrom,
    contactRequestsFrom,
    contactRowsFrom,
    contactUpdateFrom,
    emailDraftFrom,
    emptyContactDraft,
    numberDraftFrom,
    type AddressDraft,
    type ContactDraft,
    type ContactRow,
  } from "./contact-draft.ts";
  import {
    addDirectoryAddress,
    addDirectoryEmail,
    addDirectoryPhone,
    readDirectoryContactPoints,
    removeDirectoryContactPoint,
    updateDirectoryContactPoint,
    type DirectoryContactPoints,
  } from "./directory-api.ts";
  import AddressSection from "./sections/address-section.svelte";
  import ContactCardEditor from "./contact-card-editor.svelte";
  import type { ContactEdit } from "./contact-edit-plan.ts";

  let {
    entityId,
    mayEdit,
    editDisabledReason,
    channel = "reachable",
  }: {
    entityId: string;
    mayEdit: boolean;
    editDisabledReason?: string;
    /**
     * Which half of the record's contact points this pane is showing: the one-line ways to reach
     * them, or the postal addresses. Both read the same answer.
     */
    channel?: "reachable" | "addresses";
  } = $props();

  let points = $state<DirectoryContactPoints | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);
  /** True while details already on screen are being read again, after a write landed. */
  let refreshing = $state(false);
  // The record whose details last landed. Only a change of RECORD discards what is on screen: a
  // re-read after a write keeps the list where the reader is looking and marks the region busy.
  let shownFor: string | null = null;

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      points = null;
    }
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryContactPoints(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        shownFor = id;
        points = outcome.value;
        return;
      }
      shownFor = null;
      points = { emails: [], phones: [], addresses: [] };
      readFailure = stated(outcome.failure, "This record's contact details could not be read.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  const allRows = $derived(points === null ? [] : contactRowsFrom(points));
  const rows = $derived(
    allRows.filter((row) => (channel === "addresses") === (row.kind === "address")),
  );

  /**
   * The shape the section takes while the record's contact details are being read: three lines of
   * the kinds it lists, in the same section, over the sample vocabulary. The address is invented
   * to the vocabulary's length; the vocabulary carries none of its own.
   */
  const CONTACT_FIXTURE: readonly ContactRow[] = [
    {
      id: "fixture-1",
      kind: "email",
      value: samplePerson(0).email,
      use: "Work",
      state: {
        permitted: true,
        preferred: true,
        note: null,
        verificationStatus: "unverified",
        verifiedAt: null,
        verificationDetail: null,
      },
      isPrimary: true,
    },
    {
      id: "fixture-2",
      kind: "telephone",
      value: samplePerson(0).phone,
      use: "Mobile",
      state: {
        permitted: true,
        preferred: false,
        note: null,
        verificationStatus: "unverified",
        verifiedAt: null,
        verificationDetail: null,
      },
      isPrimary: false,
    },
    {
      id: "fixture-3",
      kind: "address",
      value: "1400 Meridian Way, Suite 300, Reno, NV 89501",
      use: "Office",
      state: {
        permitted: true,
        preferred: false,
        note: null,
        verificationStatus: "unverified",
        verifiedAt: null,
        verificationDetail: null,
      },
      isPrimary: false,
    },
  ];

  /** The fixture, narrowed to whichever half is on screen — a loading shape of the real one. */
  const fixtureRows = $derived(
    CONTACT_FIXTURE.filter((row) => (channel === "addresses") === (row.kind === "address")),
  );

  /*
   * A listed row, back as the draft its own fields edit.
   *
   * The row is what a LIST needs — a formatted value and the marks against it — and a correction
   * needs the parts that value was assembled from, so the recorded entry is found again by its own
   * handle. A row whose entry has gone (a re-read landed between the press and this) falls back to
   * an empty draft rather than throwing: the correction then reads as an entry, which is honest.
   */
  function reachableDraftFor(row: ContactRow): ContactDraft {
    const email = points?.emails.find((entry) => entry.id === row.id);
    if (email !== undefined) return emailDraftFrom(email);
    const phone = points?.phones.find((entry) => entry.id === row.id);
    if (phone !== undefined) return numberDraftFrom(phone);
    return emptyContactDraft(row.kind === "fax" ? "fax" : "email");
  }

  function addressDraftFor(row: ContactRow): AddressDraft {
    const address = points?.addresses.find((entry) => entry.id === row.id);
    return address === undefined
      ? (emptyContactDraft("address") as AddressDraft)
      : addressDraftFrom(address);
  }

  type Channel = "emails" | "phones" | "addresses";

  function channelOf(row: ContactRow): Channel {
    return row.kind === "email" ? "emails" : row.kind === "address" ? "addresses" : "phones";
  }

  // ---- writes, one at a time --------------------------------------------------------------------

  let busyId = $state<string | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);

  async function add(draft: ContactDraft): Promise<void> {
    writeFailure = null;
    busyId = "adding";
    const requests = contactRequestsFrom([draft]);
    const key = crypto.randomUUID();
    const outcome =
      requests.emails[0] !== undefined
        ? await addDirectoryEmail(fetch, entityId, requests.emails[0], key)
        : requests.phones[0] !== undefined
          ? await addDirectoryPhone(fetch, entityId, requests.phones[0], key)
          : requests.addresses[0] !== undefined
            ? await addDirectoryAddress(fetch, entityId, requests.addresses[0], key)
            : null;
    busyId = null;
    if (outcome === null) return;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      outcome.failure,
      "That could not be recorded.",
      "Nothing was recorded; the record's contact details are as they were.",
    );
  }

  async function change(
    row: ContactRow,
    preference: { preferred?: boolean; permitted?: boolean },
    whenSilent: string,
  ): Promise<void> {
    writeFailure = null;
    busyId = row.id;
    const outcome = await updateDirectoryContactPoint(
      fetch,
      channelOf(row),
      row.id,
      { preference },
      crypto.randomUUID(),
    );
    busyId = null;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(outcome.failure, "That could not be changed.", whenSilent);
  }

  /**
   * Correct a recorded value in place.
   *
   * The write path has always taken a changed value; nothing on screen ever asked for one, so a
   * mistyped digit could only be fixed by deleting the row and typing it again — which loses the
   * permission, the preference and the confirmation recorded against it, and leaves the removal on
   * the record as a fact of its own.
   */
  async function correct(row: ContactRow, draft: ContactDraft): Promise<void> {
    writeFailure = null;
    const body = contactUpdateFrom(draft);
    if (body === null) return;
    busyId = row.id;
    const outcome = await updateDirectoryContactPoint(
      fetch,
      channelOf(row),
      row.id,
      body,
      crypto.randomUUID(),
    );
    busyId = null;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      outcome.failure,
      "That could not be corrected.",
      "Nothing was changed; the value is as it was.",
    );
  }

  /**
   * One Save of the Contact card: its writes, one at a time, in the plan's order. The first that
   * fails stops the rest and is reported, and the card re-reads either way, so what is on screen is
   * what the record holds; the reader's edit stays open on a failure so nothing typed is lost.
   */
  async function applyEdits(edits: readonly ContactEdit[]): Promise<boolean> {
    writeFailure = null;
    busyId = "saving";
    let failed = false;
    for (const edit of edits) {
      const key = crypto.randomUUID();
      if (edit.kind === "remove") {
        const outcome = await removeDirectoryContactPoint(fetch, channelOf(edit.row), edit.row.id, key);
        if (outcome.kind !== "ok") {
          writeFailure = stated(outcome.failure, "That could not be removed.", "Nothing more was changed.");
          failed = true;
          break;
        }
      } else if (edit.kind === "update") {
        const outcome = await updateDirectoryContactPoint(fetch, channelOf(edit.row), edit.row.id, edit.body, key);
        if (outcome.kind !== "ok") {
          writeFailure = stated(outcome.failure, "That could not be changed.", "Nothing more was changed.");
          failed = true;
          break;
        }
      } else {
        const requests = contactRequestsFrom([edit.draft]);
        const preference = edit.preference;
        const outcome =
          requests.emails[0] !== undefined
            ? await addDirectoryEmail(fetch, entityId, { ...requests.emails[0], preference }, key)
            : requests.phones[0] !== undefined
              ? await addDirectoryPhone(fetch, entityId, { ...requests.phones[0], preference }, key)
              : null;
        if (outcome !== null && outcome.kind !== "ok") {
          writeFailure = stated(outcome.failure, "That could not be recorded.", "Nothing more was changed.");
          failed = true;
          break;
        }
      }
    }
    busyId = null;
    reloadToken += 1;
    return !failed;
  }

  async function remove(row: ContactRow): Promise<void> {
    writeFailure = null;
    busyId = row.id;
    const outcome = await removeDirectoryContactPoint(
      fetch,
      channelOf(row),
      row.id,
      crypto.randomUUID(),
    );
    busyId = null;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    writeFailure = stated(outcome.failure, "That could not be removed.", "Nothing was removed.");
  }
</script>

<section class="flex flex-col gap-16">
  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="The Contact Details Were Not Changed"
      fallback={writeFailure.fallback}
      whenSilent={writeFailure.whenSilent}
    />
  {/if}

  <LoadingRegion
    loading={points === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading this record's contact details"
    onRetry={retry}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="This Record's Contact Details Could Not Be Read"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render contactSection(fixtureRows)}
    {/snippet}
    {@render contactSection(rows)}
  </LoadingRegion>
</section>

<!-- One section for the rows and for the shape they take while they are read, so the two cannot
     drift. Which section is a fact about the channel, and both take the same handlers: the writes
     are the same writes whichever half of the record's contact points they are about. -->
{#snippet contactSection(listed: readonly ContactRow[])}
  {#if channel === "addresses"}
    <AddressSection
      rows={listed}
      canEdit={mayEdit}
      {editDisabledReason}
      {busyId}
      onAdd={(draft) => void add(draft)}
      onEdit={(row) => addressDraftFor(row)}
      onChange={(row, draft) => void correct(row, draft)}
      onPreferred={(row, preferred) => void change(row, { preferred }, "The preference is as it was.")}
      onPermitted={(row, permitted) => void change(row, { permitted }, "The permission is as it was.")}
      onRemove={(row) => void remove(row)}
    />
  {:else}
    <ContactCardEditor
      rows={listed}
      canEdit={mayEdit && points !== null}
      {editDisabledReason}
      draftFor={reachableDraftFor}
      onSave={applyEdits}
    />
  {/if}
{/snippet}

<script lang="ts">
  /*
   * How the firm can reach this record — email addresses, telephone and fax numbers, and postal
   * addresses — read from and written to the firm's own record.
   *
   * The pane is thin on purpose: the list, the kind-first add row and every shape check are the
   * contact section, the same component the New Person screen drafts with, so a way to reach
   * someone reads and is entered the same way whether the record exists yet or not. What is left
   * here is what only this pane knows: which record, who may change it, and how each change is
   * persisted one at a time.
   *
   * Two facts a screen must not merge: `permitted` (may the firm use this) and `preferred` (the one
   * way the person asked to be reached). A person can be reachable at a number they would rather
   * the firm did not ring, and prefer post while their email stays perfectly usable. Withdrawing the
   * permission is recorded, never deleted: a number that came back "do not call" is a fact about
   * the record, and the next person must not ring it again.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    contactRequestsFrom,
    contactRowsFrom,
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
  import ContactSection from "./sections/contact-section.svelte";

  let {
    entityId,
    mayEdit,
    editDisabledReason,
  }: {
    entityId: string;
    mayEdit: boolean;
    editDisabledReason?: string;
  } = $props();

  let points = $state<DirectoryContactPoints | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryContactPoints(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        points = outcome.value;
        return;
      }
      points = { emails: [], phones: [], addresses: [] };
      readFailure = stated(outcome.failure, "This record's contact details could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

  const rows = $derived(points === null ? [] : contactRowsFrom(points));

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

  {#if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      title="This Record's Contact Details Could Not Be Read"
      fallback={readFailure.fallback}
      whenSilent={readFailure.whenSilent}
    />
  {:else if points === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading this record's contact details">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else}
    {#if rows.length === 0}
      <EmptyState title="No Way To Reach Them Yet">
        The firm holds no email address, telephone number or postal address for this record.
      </EmptyState>
    {/if}
    <ContactSection
      {rows}
      canEdit={mayEdit}
      {editDisabledReason}
      {busyId}
      onAdd={(draft) => void add(draft)}
      onPreferred={(row) => void change(row, { preferred: true }, "The preference is as it was.")}
      onPermitted={(row, permitted) => void change(row, { permitted }, "The permission is as it was.")}
      onRemove={(row) => void remove(row)}
    />
  {/if}
</section>

<script lang="ts">
  /*
   * The sealed identifiers a record holds, and the reveal that is the privileged act.
   *
   * The list and the type-first add row are the identifiers section, the same component the New
   * Person screen seals with; what only this pane knows is which record, who may change it, who may
   * reveal, and that a reveal is recorded against the reader's name. Values are sealed under the
   * firm's key on the way in and never stored in the clear; the list names what is held without
   * decrypting anything, and revealing one is a separate, audited read.
   */
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { maskedIdentifier } from "@magna-carta/directory/identifier-shape";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { guidanceFor } from "$lib/diagnostics/guidance.ts";
  import {
    addDirectoryIdentifier,
    readDirectoryIdentifier,
    readDirectoryIdentifierRecords,
    type DirectoryEntityKind,
    type DirectoryIdentifierRecord,
    type DirectoryIdentifierType,
  } from "./directory-api.ts";
  import {
    identifierRequestFrom,
    identifierRowsFrom,
    type IdentifierDraft,
    type IdentifierRow,
  } from "./identifier-draft.ts";
  import IdentifiersSection from "./sections/identifiers-section.svelte";

  let {
    entityId,
    kind,
    mayEdit,
    editDisabledReason,
    mayReveal,
    revealDisabledReason,
  }: {
    entityId: string;
    kind: DirectoryEntityKind;
    mayEdit: boolean;
    editDisabledReason?: string;
    mayReveal: boolean;
    revealDisabledReason?: string;
  } = $props();

  // ---- what is held ---------------------------------------------------------------------------

  let held = $state<readonly DirectoryIdentifierRecord[] | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);
  /** True while a list already on screen is being read again, after another was sealed. */
  let refreshing = $state(false);
  // The record whose list last landed. Only a change of RECORD discards what is on screen: a
  // re-read after a seal keeps the lines where the reader is looking and marks the region busy.
  let shownFor: string | null = null;

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      held = null;
      reveals = {};
    }
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryIdentifierRecords(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        shownFor = id;
        held = outcome.value.data;
        return;
      }
      shownFor = null;
      held = [];
      readFailure = stated(outcome.failure, "Couldn't load this record's details.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  const rows = $derived(identifierRowsFrom(held ?? []));

  /**
   * The shape the section takes while what the record holds is being read: two sealed lines in
   * the same section, masked the way a real one is. Nothing here was ever a value.
   */
  const IDENTIFIER_FIXTURE: readonly IdentifierRow[] = [
    {
      id: "fixture-1",
      type: "ssn",
      typeLabel: "Social security number",
      label: null,
      masked: maskedIdentifier("ssn", null),
      recordedAt: null,
    },
    {
      id: "fixture-2",
      type: "drivers_license",
      typeLabel: "Driver's license",
      label: "Nevada",
      masked: maskedIdentifier("drivers_license", null),
      recordedAt: null,
    },
  ];

  // ---- the reveal, per type -------------------------------------------------------------------
  //
  // A reveal reads the most recent value of a TYPE (the route is by type), so its state is kept by
  // type; every row of that type shows the same answer.

  type RevealState =
    | { phase: "sealed" }
    | { phase: "reading" }
    | { phase: "shown"; value: string }
    | { phase: "hidden"; value: string }
    | { phase: "none" }
    | { phase: "refused"; message: string };

  let reveals = $state<Record<string, RevealState>>({});

  function stateOf(type: DirectoryIdentifierType): RevealState {
    return reveals[type] ?? { phase: "sealed" };
  }

  function shownValue(row: IdentifierRow): string | null {
    const revealed = stateOf(row.type);
    switch (revealed.phase) {
      case "shown":
        return revealed.value;
      case "reading":
        return "Reading";
      case "none":
        return "None held";
      case "refused":
        return revealed.message;
      default:
        return null;
    }
  }

  async function reveal(type: DirectoryIdentifierType): Promise<void> {
    const current = stateOf(type);
    if (current.phase === "reading") return;
    if (current.phase === "shown") {
      reveals = { ...reveals, [type]: { phase: "hidden", value: current.value } };
      return;
    }
    if (current.phase === "hidden") {
      reveals = { ...reveals, [type]: { phase: "shown", value: current.value } };
      return;
    }
    reveals = { ...reveals, [type]: { phase: "reading" } };
    const outcome = await readDirectoryIdentifier(fetch, entityId, type);
    if (outcome.kind === "ok") {
      const { value, username, secret } = outcome.value;
      // An account reveals its three parts together, on the one line.
      const shown =
        value === null
          ? null
          : [value, username ? `user ${username}` : null, secret ? `secret ${secret}` : null]
              .filter((part): part is string => part !== null)
              .join(" · ");
      reveals = {
        ...reveals,
        [type]: shown === null ? { phase: "none" } : { phase: "shown", value: shown },
      };
      return;
    }
    reveals = {
      ...reveals,
      [type]: { phase: "refused", message: guidanceFor(outcome.failure, "The value").message },
    };
  }

  // ---- sealing another --------------------------------------------------------------------------

  let writeFailure = $state<StatedFailure | null>(null);

  async function seal(draft: IdentifierDraft): Promise<void> {
    writeFailure = null;
    const outcome = await addDirectoryIdentifier(
      fetch,
      entityId,
      identifierRequestFrom(draft),
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      reveals = { ...reveals, [draft.type]: { phase: "sealed" } };
      reloadToken += 1;
      return;
    }
    writeFailure = stated(outcome.failure, "Couldn't seal the identifier.", "Nothing was sealed.");
  }
</script>

<section class="flex flex-col gap-16">
  <!-- Said once, above the controls, because it governs every one of them and a person has to know
       it BEFORE they press: reading a sealed value is recorded against their name. -->
  <p class="flex items-center gap-8 text-xs text-text-muted">
    <ShieldCheck class="size-16" aria-hidden="true" />
    Revealing a value is recorded in the firm's audit log.
  </p>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      title="Identifier Not Sealed"
      fallback={writeFailure.fallback}
      whenSilent={writeFailure.whenSilent}
    />
  {/if}

  <LoadingRegion
    loading={held === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading this record's details"
    onRetry={retry}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Couldn't Load Details"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render identifiersSection(IDENTIFIER_FIXTURE)}
    {/snippet}
    {@render identifiersSection(rows)}
  </LoadingRegion>
</section>

<!-- One section for the rows and for the shape they take while they are read, so the two cannot drift. -->
{#snippet identifiersSection(listed: readonly IdentifierRow[])}
  <IdentifiersSection
    rows={listed}
    {kind}
    canEdit={mayEdit}
    {editDisabledReason}
    onAdd={(draft) => void seal(draft)}
    {shownValue}
    rowEnd={revealControl}
  />
{/snippet}

{#snippet revealControl(row: IdentifierRow)}
  {@const revealed = stateOf(row.type)}
  <Button
    variant="ghost"
    size="icon"
    disabled={!mayReveal}
    title={revealDisabledReason}
    aria-label={revealed.phase === "shown"
      ? `Hide the ${row.typeLabel.toLowerCase()}`
      : `Reveal the ${row.typeLabel.toLowerCase()}`}
    onclick={() => void reveal(row.type)}
  >
    {#if revealed.phase === "shown"}
      <EyeOff class="size-16" aria-hidden="true" />
    {:else}
      <Eye class="size-16" aria-hidden="true" />
    {/if}
  </Button>
{/snippet}

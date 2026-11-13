<script lang="ts">
  /*
   * Naming a Custodian of Record — whose electronic records these were.
   *
   * TWO WORDS, ALWAYS. The platform already registers physical client originals under a family
   * called custody, and a Custodian of Record is a completely different thing. The two appear on the
   * same matter and sometimes on the same screen, so the bare word is never written — not in code,
   * not in schema, and not in anything a person reads.
   *
   * "NOBODY ATTRIBUTED" IS A REAL ANSWER, not a blank one. A production that arrives with no
   * custodial attribution is a fact about that production, and recording it as "we do not know" is
   * a different statement from leaving a field empty — the first can be said to a court.
   *
   * THE DIRECTORY LINK IS OPTIONAL BY CONSTRUCTION. A production may name somebody the firm has
   * never met and never will, and requiring a Directory record for them would either stop the load
   * or teach somebody to invent an entity. The link is added later, from the Directory, where it
   * belongs.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createRecordCustodian } from "./discovery-api.ts";
  import {
    RECORD_CUSTODIAN_KIND_ORDER,
    recordCustodianKindLabel,
    type RecordCustodianKind,
  } from "./discovery-vocabulary.ts";

  let {
    open = $bindable(false),
    reviewSetId,
    onCreated,
  }: {
    open?: boolean;
    reviewSetId: string;
    onCreated: () => void;
  } = $props();

  let displayName = $state("");
  let kind = $state<RecordCustodianKind>("person");
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived.by((): string | undefined => {
    if (kind === "unattributed") return undefined;
    return displayName.trim() === ""
      ? "Name whose records these were, as the production names them."
      : undefined;
  });

  function reset(): void {
    displayName = "";
    kind = "person";
    failure = null;
  }

  // Unattributed material is not named by anybody, so the field is cleared rather than left holding
  // a value that would still be sent.
  $effect(() => {
    if (kind === "unattributed") displayName = "";
  });

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await createRecordCustodian(
      fetch,
      reviewSetId,
      {
        displayName: kind === "unattributed" ? "Unattributed" : displayName.trim(),
        kind,
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onCreated();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The Custodian of Record could not be added.",
      "Couldn't connect. Nothing was added. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Custodian of Record"
  commitLabel="Add"
  commitBusyLabel="Adding"
  commitRefusal={refusal}
  unsavedChanges={displayName.trim() !== ""}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Custodian Of Record Was Not Added"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label id="new-record-custodian-kind-label">What they are</Label>
        <RadioGroup.Root
          bind:value={kind}
          disabled={busy}
          aria-labelledby="new-record-custodian-kind-label"
        >
          {#each RECORD_CUSTODIAN_KIND_ORDER as candidate (candidate)}
            <div class="flex items-center gap-8">
              <RadioGroup.Item value={candidate} id="new-record-custodian-kind-{candidate}" />
              <Label for="new-record-custodian-kind-{candidate}">
                {recordCustodianKindLabel(candidate)}
              </Label>
            </div>
          {/each}
        </RadioGroup.Root>
      </div>

      {#if kind === "unattributed"}
        <p class="text-text-muted text-sm">
          Material that arrived with no custodial attribution. Recording that is a statement the firm
          can make to a court; leaving the question blank is not.
        </p>
      {:else}
        <div class="flex flex-col gap-8">
          <Label for="new-record-custodian-name">Name</Label>
          <Input id="new-record-custodian-name" disabled={busy} bind:value={displayName} />
          <p class="text-text-muted text-sm">
            As named in the production. They don't need to be in the firm's Directory.
          </p>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

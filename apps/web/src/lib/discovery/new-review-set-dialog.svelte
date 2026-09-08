<script lang="ts">
  /*
   * Creating a review set — the corpus every other discovery capability is a function over.
   *
   * IT ASKS FOR ONE THING, AND THE REST OF THE FORM IS WHAT IT TELLS YOU. A review set needs a
   * name. Everything else it starts with is decided by the model rather than by a person: it starts
   * open and empty, it snapshots the firm's document ceiling so a ceiling lowered later does not
   * invalidate it, and its access list starts with the member creating it and nobody else.
   *
   * THE PERMANENCE IS STATED HERE RATHER THAN DEFENDED BY A CONFIRMATION. A review set is forward
   * only: it locks, it closes, and it does not reopen — because the corpus under review is what was
   * reviewed, and one that could be reopened is a corpus whose contents depend on when you looked.
   * A second dialog asking "are you sure" would be clicked through; a sentence beside the field is
   * read once and remembered, and it is the honest place to spend the words.
   *
   * SEMANTIC INDEXING IS NOT OFFERED. The column exists and nothing reads it: embedding a corpus is
   * a real metered cost incurred whether or not anybody runs a semantic query, the recall gain has
   * never been measured on judged legal prose, and the embedding model cannot be changed once one
   * vector exists. A switch here would ask a firm to decide that on a guess. It arrives when the
   * question is answered with evidence, not before.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createReviewSet } from "./discovery-api.ts";

  let {
    open = $bindable(false),
    matterId,
    onCreated,
  }: {
    open?: boolean;
    matterId: string;
    onCreated: (reviewSetId: string) => void;
  } = $props();

  let name = $state("");
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived(
    name.trim() === "" ? "A review set is named so it can be told from the others." : undefined,
  );

  function reset(): void {
    name = "";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not create a second corpus for one act, so every attempt names itself
    // and the server answers the repeat with the first result.
    const outcome = await createReviewSet(
      fetch,
      matterId,
      { name: name.trim() },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onCreated(outcome.value.id);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The review set could not be created.",
      "Nothing answered. Nothing was created, so pressing again creates one review set.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Review Set"
  subtitle="A corpus of its own — its own documents, its own search index, its own access list, and its own lifecycle."
  commitLabel="Create Review Set"
  commitBusyLabel="Creating"
  commitRefusal={refusal}
  unsavedChanges={name.trim() !== ""}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Review Set Was Not Created"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="new-review-set-name">Name</Label>
        <Input id="new-review-set-name" disabled={busy} bind:value={name} />
        <p class="text-text-muted text-sm">
          What this corpus is, in the words the firm would use in correspondence — the plaintiff's
          March production, the firm's own collection for the second request.
        </p>
      </div>

      <p class="text-text-muted text-sm">
        It starts open and empty. Only you can reach it until you add somebody: a review set's access
        list is separate from who works the matter, because material another party produced may be
        under a protective order the whole matter team is not cleared for. A review set locks and
        closes, and it does not reopen.
      </p>
    </div>
  {/snippet}
</ActionDialog>

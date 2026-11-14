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
   * IT ASKS WHICH MATTER ONLY WHERE THE SURFACE DOES NOT ALREADY KNOW. Opened from a matter's own
 * Discovery section it states nothing about the matter and asks nothing; opened from the firm-wide
 * register, which lists corpora across every case, it asks — the same two doors the conflicts
 * composer opens through, for the same reason. A corpus with no matter is not a thing this model
 * has: the matter is what decides the ceiling the set snapshots, the lifecycle it lives under, and
 * whose case it is, so the question is asked here rather than the act being sent somewhere else.
 *
 * THE PICKER IS THE CASELOAD, NOT THE FIRM. Creating a review set is an act on a matter a person is
 * working, and a picker over every matter a firm has ever opened is a longer list that answers the
 * question less often.
 *
 * SEMANTIC INDEXING IS NOT OFFERED. The column exists and nothing reads it: embedding a corpus is
   * a real metered cost incurred whether or not anybody runs a semantic query, the recall gain has
   * never been measured on judged legal prose, and the embedding model cannot be changed once one
   * vector exists. A switch here would ask a firm to decide that on a guess. It arrives when the
   * question is answered with evidence, not before.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";
  import { createReviewSet } from "./discovery-api.ts";

  let {
    open = $bindable(false),
    matterId = null,
    chooseMatter = false,
    onCreated,
  }: {
    open?: boolean;
    /** The matter this corpus belongs to, where the surface already knows it. */
    matterId?: string | null;
    /** Whether the panel asks which matter. The firm-wide register does; a matter's section cannot. */
    chooseMatter?: boolean;
    onCreated: (reviewSetId: string) => void;
  } = $props();

  let name = $state("");
  let failure = $state<StatedFailure | null>(null);
  let matters = $state<readonly MatterSummary[]>([]);
  let matterQuery = $state("");
  let settledMatterQuery = $state("");
  let chosenMatter = $state<MatterSummary | null>(null);

  /** The matter the corpus is created on: the surface's, or the one chosen here. */
  const createsOnId = $derived(matterId ?? chosenMatter?.id ?? null);

  $effect(() => {
    if (!chooseMatter) return;
    const typed = matterQuery;
    const timer = setTimeout(() => (settledMatterQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!open || !chooseMatter) return;
    const asked = settledMatterQuery.trim();
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      matters = outcome.kind === "ok" ? outcome.value.data : [];
    })();
  });

  /** How a matter reads in the picker: its number where it has one, which is what people say. */
  function matterLine(matter: MatterSummary): string {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  }

  function recordMatter(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    chosenMatter = matters.find((matter) => matter.id === id) ?? null;
  }

  const refusal = $derived.by((): string | undefined => {
    if (createsOnId === null) return "A review set belongs to one matter. Name the matter first.";
    if (name.trim() === "") return "A review set is named so it can be told from the others.";
    return undefined;
  });

  function reset(): void {
    name = "";
    failure = null;
    matterQuery = "";
    settledMatterQuery = "";
    chosenMatter = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const createsOn = createsOnId;
    if (createsOn === null) return "refused";
    failure = null;
    // A retried submit must not create a second corpus for one act, so every attempt names itself
    // and the server answers the repeat with the first result.
    const outcome = await createReviewSet(
      fetch,
      createsOn,
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
      "Couldn't connect. The review set wasn't created. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Review Set"
  commitLabel="Create Review Set"
  commitBusyLabel="Creating"
  commitRefusal={refusal}
  unsavedChanges={name.trim() !== "" || chosenMatter !== null}
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
      {#if chooseMatter}
        <div class="flex flex-col gap-8">
          <Label for="new-review-set-matter">Matter</Label>
          <Combobox.Root
            type="single"
            items={matters.map((matter) => ({ value: matter.id, label: matterLine(matter) }))}
            inputValue={matterQuery}
            onValueChange={recordMatter}
            disabled={busy}
          >
            <Combobox.Input
              id="new-review-set-matter"
              placeholder="Matter"
              autocomplete="off"
              oninput={(event) => (matterQuery = event.currentTarget.value)}
            />
            <Combobox.Content>
              {#each matters as matter (matter.id)}
                <Combobox.Item value={matter.id} label={matterLine(matter)}>
                  {matterLine(matter)}
                </Combobox.Item>
              {/each}
            </Combobox.Content>
          </Combobox.Root>
          <p class="text-text-muted text-sm">
            The matter this review set belongs to. It sets the document limit and can't be changed later.
          </p>
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label for="new-review-set-name">Name</Label>
        <Input id="new-review-set-name" disabled={busy} bind:value={name} />
        <p class="text-text-muted text-sm">
          A name the firm would use in a letter, such as "plaintiff's March production".
        </p>
      </div>

      <p class="text-text-muted text-sm">
        It starts open and empty, and only you can see it until you add people. Access is separate from the matter team, because produced material may be under a protective order. Once a review set is closed, it can't be reopened.
      </p>
    </div>
  {/snippet}
</ActionDialog>

<script lang="ts">
  /*
   * Declaring a load — saying what is coming, before it comes.
   *
   * THE ORDERING IS THE POINT, and it is why this form exists at all rather than material simply
   * being added to a corpus. A load is declared first, with a count and a source; what then arrives
   * is reconciled against that declaration, and the manifest states both. Without the declaration
   * there is nothing to reconcile against, so "everything arrived" would be a claim rather than a
   * finding. It is also what lets a load resume across a dropped connection.
   *
   * THE TRANSCRIPT CONTROL HAS NO DEFAULT, IN EITHER DIRECTION. The firm's own assistant
   * transcripts are its work product, and whether the firm's reasoning about a matter belongs in a
   * corpus it is about to certify the contents of is a decision somebody makes on purpose. A silent
   * exclusion decides as much for somebody as a silent inclusion would, so the commit is refused
   * until it is answered, and the refusal says which answer is missing.
   *
   * THE UNBUILT LANE IS OFFERED AND REFUSED BY NAME. Collection from a client's own system needs a
   * collection tool rather than an ingest path. Leaving it off the list would make a firm wonder
   * whether the platform knows what it is; showing it disabled, with the reason, is the difference
   * between a gap and a mystery.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { declareLoad, type RecordCustodian, type ReviewSet } from "./discovery-api.ts";
  import {
    loadLaneEntry,
    SELECTABLE_LOAD_LANES,
    type DiscoveryLoadLane,
    type TranscriptScope,
  } from "./discovery-vocabulary.ts";

  let {
    open = $bindable(false),
    reviewSets,
    reviewSetId = null,
    recordCustodians,
    onDeclared,
  }: {
    open?: boolean;
    /**
     * The review sets a load may be declared into: the open ones. A locked or closed set takes no
     * more material, so offering one would be a control that exists to be refused.
     */
    reviewSets: readonly ReviewSet[];
    /** Preselected where the dialog was opened from one review set's own screen. */
    reviewSetId?: string | null;
    /** The chosen review set's Custodians of Record, for the load's default. */
    recordCustodians: readonly RecordCustodian[];
    onDeclared: (loadId: string, reviewSetId: string) => void;
  } = $props();

  let chosenReviewSetId = $state<string | null>(null);
  let lane = $state<DiscoveryLoadLane>("internal-files");
  let transcriptScope = $state<TranscriptScope | null>(null);
  let declaredCount = $state("");
  let sourceDescription = $state("");
  let defaultRecordCustodianId = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const laneEntry = $derived(loadLaneEntry(lane));

  const reviewSetItems = $derived(
    reviewSets.map((set) => ({ value: set.id, label: set.name })),
  );

  const laneItems = $derived(
    SELECTABLE_LOAD_LANES.map((candidate) => ({
      value: candidate,
      label: loadLaneEntry(candidate).label,
      disabled: !loadLaneEntry(candidate).built,
    })),
  );

  const custodianItems = $derived(
    recordCustodians.map((custodian) => ({ value: custodian.id, label: custodian.displayName })),
  );

  /** The declared count as a number, or null while it is empty or not a whole number. */
  const declaredNumber = $derived.by(() => {
    const trimmed = declaredCount.trim();
    if (trimmed === "") return null;
    if (!/^\d+$/u.test(trimmed)) return null;
    return Number(trimmed);
  });

  /*
   * Why the commit is unavailable, in the order a person meets the questions. The dialog shows the
   * first shortfall beside the control it refuses rather than hiding the control, so a reader is
   * told which answer is missing instead of hunting for it.
   */
  const refusal = $derived.by((): string | undefined => {
    if (reviewSets.length === 0) {
      return "Material goes into a review set, and this matter has no open one to put it in.";
    }
    if (chosenReviewSetId === null) return "Say which review set this is going into.";
    if (!laneEntry.built) return laneEntry.describes;
    if (declaredNumber === null) {
      return "Enter the number of documents expected. It's checked against what arrives.";
    }
    if (transcriptScope === null) {
      return "Say whether the firm's own assistant transcripts are in scope. There is no default either way.";
    }
    return undefined;
  });

  const started = $derived(
    declaredCount.trim() !== "" || sourceDescription.trim() !== "" || transcriptScope !== null,
  );

  function reset(): void {
    chosenReviewSetId = reviewSetId ?? (reviewSets.length === 1 ? (reviewSets[0]?.id ?? null) : null);
    lane = "internal-files";
    transcriptScope = null;
    declaredCount = "";
    sourceDescription = "";
    defaultRecordCustodianId = recordCustodians[0]?.id ?? null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (declaredNumber === null || transcriptScope === null || chosenReviewSetId === null) {
      return "refused";
    }
    // A retried declaration must not produce a second load: a load is the provenance record for one
    // act of loading, and two rows for one act is a defect in a record handed to another party.
    const outcome = await declareLoad(
      fetch,
      chosenReviewSetId,
      {
        lane,
        transcriptScope,
        declaredDocumentCount: declaredNumber,
        sourceDescription: sourceDescription.trim() === "" ? null : sourceDescription.trim(),
        defaultRecordCustodianId,
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onDeclared(outcome.value.id, chosenReviewSetId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The load could not be declared.",
      "Couldn't connect. No load was declared. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Load"
  commitLabel="Declare Load"
  commitBusyLabel="Declaring"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Load Was Not Declared"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      {#if reviewSetItems.length > 1}
        <div class="flex flex-col gap-8">
          <Label id="declare-load-review-set-label">Review set</Label>
          <Select.Root
            type="single"
            items={reviewSetItems}
            value={chosenReviewSetId ?? ""}
            onValueChange={(value) => (chosenReviewSetId = value === "" ? null : value)}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="declare-load-review-set-label">
              <Select.Value placeholder={placeholderOf("Review set")} />
            </Select.Trigger>
            <Select.Content>
              {#each reviewSetItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label id="declare-load-lane-label">Where it comes from</Label>
        <Select.Root
          type="single"
          items={laneItems}
          value={lane}
          onValueChange={(value) => (lane = value as DiscoveryLoadLane)}
          allowDeselect={false}
          disabled={busy}
        >
          <Select.Trigger aria-labelledby="declare-load-lane-label">
            <Select.Value placeholder={placeholderOf("Where it comes from")} />
          </Select.Trigger>
          <Select.Content>
            {#each laneItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} disabled={item.disabled} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-text-muted text-sm">{laneEntry.describes}</p>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="declare-load-count">Documents expected</Label>
        <Input
          id="declare-load-count"
          inputmode="numeric"
          disabled={busy}
          bind:value={declaredCount}
        />
        <p class="text-text-muted text-sm">
          What you expect to receive. It's shown beside what actually arrives, and any difference is flagged.
        </p>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="declare-load-source">What it is</Label>
        <Input
          id="declare-load-source"
          disabled={busy}
          bind:value={sourceDescription}
          placeholder={placeholderOf("What it is")}
        />
        <p class="text-text-muted text-sm">
          How this delivery is referred to in correspondence.
        </p>
      </div>

      {#if custodianItems.length > 0}
        <div class="flex flex-col gap-8">
          <Label id="declare-load-custodian-label">Custodian of Record</Label>
          <Select.Root
            type="single"
            items={custodianItems}
            value={defaultRecordCustodianId ?? ""}
            onValueChange={(value) =>
              (defaultRecordCustodianId = value === "" ? null : value)}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="declare-load-custodian-label">
              <Select.Value placeholder={placeholderOf("Custodian of Record")} />
            </Select.Trigger>
            <Select.Content>
              {#each custodianItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
          <p class="text-text-muted text-sm">
            Whose electronic records these are, where the load does not say per document.
          </p>
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label id="declare-load-transcripts-label">The firm's assistant transcripts</Label>
        <!-- No option is preselected. A control that defaulted to "not in scope" would record an
             exclusion nobody stated, and one that defaulted the other way would put the firm's own
             work product into a corpus on nobody's decision. -->
        <RadioGroup.Root
          value={transcriptScope ?? ""}
          onValueChange={(value) => (transcriptScope = value as TranscriptScope)}
          disabled={busy}
          aria-labelledby="declare-load-transcripts-label"
        >
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="exclude" id="declare-load-transcripts-exclude" />
            <Label for="declare-load-transcripts-exclude">Not in scope</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="include" id="declare-load-transcripts-include" />
            <Label for="declare-load-transcripts-include">In scope</Label>
          </div>
        </RadioGroup.Root>
        <p class="text-text-muted text-sm">
          Transcripts of the firm's questions to its assistant about this matter are work product. Decide whether to include them in this load; your answer is recorded.
        </p>
      </div>
    </div>
  {/snippet}
</ActionDialog>

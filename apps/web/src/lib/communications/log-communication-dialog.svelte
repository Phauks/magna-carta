<script lang="ts">
  /*
   * Recording a call or a text that happened.
   *
   * WHY A FORM AT ALL, WHEN THE CARRIER WILL DO THIS BY ITSELF. Because it will not do it yet. A2P
   * 10DLC registration is weeks of procurement, and until the messaging and telephony ports land
   * nothing writes into the log but a person. This form is the first of the three producers the log
   * is built for, and the rows it writes are the same rows the adapter will write — which is what
   * makes the seam real rather than aspirational.
   *
   * THE FIELDS ARE NOT HERE. They are communication-fields.svelte, shared with the record window
   * that corrects a record, so entering a call and correcting one cannot drift into two layouts
   * asking two different sets of questions. This file owns the panel, the readiness and the write.
   *
   * A MISSED CALL IS A REAL RECORD. A call with no description and no length is refused, because a
   * member sat down and typed it and an empty one means they abandoned the form — but a call with a
   * length and nothing written is accepted, because the phone rang and that is the whole fact.
   *
   * THE MATTER IS OPTIONAL, AND AN UNNUMBERED ONE COUNTS. A matter number is drawn when a matter
   * opens; an intake and a consultation carry none, and they are where a first contact usually
   * lands. The picker offers all three (anchor-matters.svelte.ts) precisely so a firm can record the
   * call from a prospect before the file exists. Not every call is a case, either: a wrong number or
   * the landlord is set aside with a reason instead, which is what keeps the queue emptiable.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import CommunicationFields from "./communication-fields.svelte";
  import { logCommunication, newWriteKey } from "./communications-api.ts";
  import {
    emptyLogDraft,
    isTextDraft,
    logDraftReady,
    logDraftRequest,
    logDraftShortfalls,
    type LogDraft,
  } from "./log-draft.ts";

  let {
    open = $bindable(false),
    matters,
    mattersCapped = false,
    matterId = null,
    matterFixed = false,
    matterName = null,
    onLogged,
  }: {
    open?: boolean;
    /** The anchors a row may be filed onto — caseload, consultations AND intakes. */
    matters: readonly SheetMatter[];
    /** Whether that list is a page of the record rather than all of it. */
    mattersCapped?: boolean;
    /** The matter the form was opened from, where it was opened from one. */
    matterId?: string | null;
    /**
     * Whether that matter is settled rather than merely suggested.
     *
     * True inside a matter, where the decision is already made — and there the anchor controls are
     * not disabled, they are ABSENT. A disabled control implies a choice is being withheld, and an
     * empty one implies the row is on no matter, which is the opposite of what is true. The matter
     * is stated in a line instead.
     */
    matterFixed?: boolean;
    /** What that settled matter is called, so the line names it rather than printing a handle. */
    matterName?: string | null;
    onLogged: () => void;
  } = $props();

  const now = (): string => new Date().toISOString();

  let draft = $state<LogDraft>(emptyLogDraft(now()));
  let failure = $state<StatedFailure | null>(null);

  const text = $derived(isTextDraft(draft));
  const shortfalls = $derived(logDraftShortfalls(draft, now()));
  /*
   * Why the commit is unavailable, or undefined when it is available. The window shows this beside
   * the control it refuses rather than hiding the control, so a reader is told which answer is still
   * missing instead of hunting for it. Short, because it stands in the action bar for as long as the
   * answer is missing — which on a form somebody has just opened is the whole time they are typing.
   */
  const refusal = $derived(logDraftReady(draft, now()) ? undefined : shortfalls[0]);

  /** Whether anything has been entered. A blank form has nothing to lose, so leaving never asks. */
  const started = $derived(
    draft.counterpartyNumber.trim() !== "" ||
      draft.description.trim() !== "" ||
      draft.durationMinutes.trim() !== "" ||
      draft.counterpartyEntityId !== null ||
      draft.matterId !== null ||
      draft.disposition !== null,
  );

  function reset(): void {
    draft = {
      ...emptyLogDraft(now()),
      matterId,
      anchor: matterId === null ? "undecided" : "matter",
    };
    failure = null;
  }

  // The matter the form was opened from is the matter it records, and a form reopened from a
  // different matter must not carry the last one's link.
  $effect(() => {
    const opened = open;
    if (!opened) return;
    draft.matterId = matterId;
    if (matterId !== null) draft.anchor = "matter";
  });

  // Switching the type drops the answer that no longer belongs, rather than hiding a value that
  // would still be sent: the server refuses a duration on a text, so a stale one left in the draft
  // would turn a correction into a rejection.
  $effect(() => {
    if (text) draft.durationMinutes = "";
  });

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not put two identical accounts of one phone call on the matter, so
    // every attempt carries its own key and the server answers the repeat with the first result.
    const outcome = await logCommunication(fetch, logDraftRequest(draft), newWriteKey());
    if (outcome.kind === "ok") {
      onLogged();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The call or text could not be recorded.",
      // Nothing answered is a stronger statement than a refusal, and it is the one a person about to
      // press the button again needs: nothing was written, so pressing again records one row.
      "Nothing answered. Nothing was recorded.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading={text ? "Record A Text" : "Record A Call"}
  subtitle="What happened, and when. The firm's own record of it — nothing is sent from here."
  commitLabel="Save"
  commitBusyLabel="Saving"
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
        title="Nothing Was Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <CommunicationFields
      bind:draft
      {busy}
      {matters}
      {mattersCapped}
      {matterFixed}
      {matterName}
    />
  {/snippet}
</ActionDialog>

<script lang="ts">
  /*
   * Logging a call or a text that happened.
   *
   * WHY A FORM AT ALL, WHEN THE CARRIER WILL DO THIS BY ITSELF. Because it will not do it yet. A2P
   * 10DLC registration is weeks of procurement, and until the messaging and telephony ports land
   * nothing writes into the log but a person. This form is the first of the three producers the log
   * is built for, and the rows it writes are the same rows the adapter will write — which is what
   * makes the seam real rather than aspirational.
   *
   * WHAT IT ASKS DEPENDS ON THE CHANNEL, and that is not cosmetic. A text has words and no length; a
   * call has a length and whatever the member wrote down. A form that showed both to everybody would
   * invite a duration on a text, which the database refuses outright.
   *
   * A MISSED CALL IS A REAL RECORD. A call with no summary and no length is refused, because a
   * member sat down and typed it and an empty one means they abandoned the form — but a call with a
   * length and nothing written is accepted, because the phone rang and that is the whole fact.
   *
   * THE MATTER IS OPTIONAL, AND AN UNNUMBERED ONE COUNTS. A matter number is drawn when a matter
   * opens; an intake and a consultation carry none, and they are where a first contact usually
   * lands. The picker offers all three (anchor-matters.svelte.ts) precisely so a firm can record the
   * call from a prospect before the file exists. Leaving it empty puts the row in the queue.
   *
   * THE COUNTERPARTY IS A NUMBER, AND FOR NOW ONLY A NUMBER. Linking it to a Directory entity is
   * what the carrier adapter will do when it resolves an inbound number against the firm's contacts;
   * the column model already prefers the resolved name where one exists. Asking a person to pick an
   * entity by hand before they may record a call would put a Directory lookup in front of the one
   * act this form exists to make quick.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { logCommunication, newWriteKey } from "./communications-api.ts";
  import {
    emptyLogDraft,
    isTextDraft,
    logDraftReady,
    logDraftRequest,
    logDraftShortfalls,
    type LogDraft,
  } from "./log-draft.ts";
  import { instantFromLocalInput, localInputValue } from "./occurred-at.ts";

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
     * True inside a matter, where the decision is already made — and there the picker is not
     * disabled, it is ABSENT. A disabled control implies a choice is being withheld, and an empty
     * one implies the row is on no matter, which is the opposite of what is true. The matter is
     * stated in a line instead.
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
   * missing instead of hunting for it.
   */
  const refusal = $derived(logDraftReady(draft, now()) ? undefined : shortfalls[0]);

  /** Whether anything has been entered. A blank form has nothing to lose, so leaving never asks. */
  const started = $derived(
    draft.counterpartyNumber.trim() !== "" ||
      draft.body.trim() !== "" ||
      draft.summary.trim() !== "" ||
      draft.durationMinutes.trim() !== "" ||
      draft.matterId !== null,
  );

  const occurredAtInput = $derived(localInputValue(draft.occurredAt));

  function recordOccurredAt(value: string): void {
    draft.occurredAt = instantFromLocalInput(value);
  }

  function reset(): void {
    draft = { ...emptyLogDraft(now()), matterId };
    failure = null;
  }

  // The matter the form was opened from is the matter it records, and a form reopened from a
  // different matter must not carry the last one's link.
  $effect(() => {
    const opened = open;
    if (!opened) return;
    draft.matterId = matterId;
  });

  // Switching the channel drops the answers that no longer belong, rather than hiding values that
  // would still be sent: the server refuses a body on a call and a duration on a text, so a stale
  // one would turn a correction into a rejection.
  $effect(() => {
    if (text) draft.durationMinutes = "";
    else draft.body = "";
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
      "The call or text could not be logged.",
      // Nothing answered is a stronger statement than a refusal, and it is the one a person about to
      // press the button again needs: nothing was written, so pressing again logs one row.
      "Nothing answered. Nothing was logged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading={text ? "Log A Text" : "Log A Call"}
  subtitle="What happened, and when. The firm's own record of it — nothing is sent from here."
  commitLabel={text ? "Log Text" : "Log Call"}
  commitBusyLabel="Logging"
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
        title="Nothing Was Logged"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="grid gap-16 sm:grid-cols-2">
      <div class="flex flex-col gap-8">
        <Label id="log-communication-channel-label">Kind</Label>
        <Select.Root type="single" disabled={busy} bind:value={draft.channel}>
          <Select.Trigger aria-labelledby="log-communication-channel-label">
            <Select.Value placeholder={placeholderOf("Kind")} />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="voice" label="Call" />
            <Select.Item value="sms" label="Text" />
            <Select.Item value="mms" label="Picture" />
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="log-communication-direction-label">Which way</Label>
        <Select.Root type="single" disabled={busy} bind:value={draft.direction}>
          <Select.Trigger aria-labelledby="log-communication-direction-label">
            <Select.Value placeholder={placeholderOf("Which way")} />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="outbound" label="The firm contacted them" />
            <Select.Item value="inbound" label="They contacted the firm" />
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="log-communication-number">Number</Label>
        <Input
          id="log-communication-number"
          inputmode="tel"
          disabled={busy}
          placeholder={placeholderOf("Number")}
          bind:value={draft.counterpartyNumber}
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="log-communication-when">When</Label>
        <!-- The wall clock, read in the reader's own zone in both directions: the person typing it is
             saying what their own clock said. -->
        <Input
          id="log-communication-when"
          type="datetime-local"
          disabled={busy}
          value={occurredAtInput}
          oninput={(event) => recordOccurredAt(event.currentTarget.value)}
        />
      </div>

      {#if !text}
        <div class="flex flex-col gap-8">
          <Label for="log-communication-length">Length in minutes</Label>
          <Input
            id="log-communication-length"
            inputmode="numeric"
            disabled={busy}
            placeholder={placeholderOf("Length in minutes")}
            bind:value={draft.durationMinutes}
          />
        </div>
      {/if}

      {#if !matterFixed}
        <div class="flex flex-col gap-8">
          <Label for="log-communication-matter">Matter</Label>
          <!-- Every anchor, not only the numbered ones: an intake and a consultation are where a
               first contact lands, so a picker filtered to open matters would refuse the common
               case. -->
          <MatterPicker
            {matters}
            capped={mattersCapped}
            disabled={busy}
            inputId="log-communication-matter"
            value={draft.matterId}
            onpick={(picked) => (draft.matterId = picked)}
          />
        </div>
      {/if}
    </div>

    {#if text}
      <div class="flex flex-col gap-8">
        <Label for="log-communication-body">The message</Label>
        <Textarea id="log-communication-body" rows={3} disabled={busy} bind:value={draft.body} />
      </div>
    {/if}

    {#if matterFixed && matterName !== null}
      <p class="text-xs text-text-muted">Recorded on {matterName}.</p>
    {/if}

    <div class="flex flex-col gap-8">
      <Label for="log-communication-summary">
        {text ? "Your note about it" : "What was said"}
      </Label>
      <Textarea id="log-communication-summary" rows={4} disabled={busy} bind:value={draft.summary} />
    </div>
  {/snippet}
</ActionDialog>

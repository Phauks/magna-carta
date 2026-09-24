<script lang="ts">
  /*
   * One attempt to reach the owner of money the firm is holding.
   *
   * IT RECORDS SOMETHING THAT ALREADY HAPPENED. A letter went out, a number was called, the firm's
   * own file was read through: every field here is a fact about that event, which is why the day
   * defaults to today WHERE THE ACCOUNT IS HELD rather than where the reader is sitting, and why
   * nothing here asks what should happen next.
   *
   * ONE CHANNEL NEEDS NO ADDRESS, and the field says which. A review of the firm's own records
   * reaches nobody, so there is nothing for it to name; every other channel must say what was
   * actually used, because an attempt nobody can repeat is an attempt nobody can check. The rule
   * lives in unclaimed-funds-requests.ts so the refusal and the field read it from one place.
   *
   * THE CONTACT FIELD STANDS REFUSED RATHER THAN DISAPPEARING on that one channel: a control that
   * vanishes reflows the panel under the hand of the person filling it in, and what the hover says
   * is the fact itself, that there is nothing to name.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY. An attempt recorded twice is a diligence record
   * claiming two letters where one went out.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    recordTrustContactAttempt,
    type TrustContactChannel,
    type TrustContactOutcome,
  } from "./trust-api.ts";
  import { defaultEffectiveDate, fieldRefusal } from "./trust-write-requests.ts";
  import {
    contactUsedIsRequired,
    readTrustContactAttemptEntry,
  } from "./unclaimed-funds-requests.ts";
  import {
    CONTACT_USED_HINT,
    CONTACT_USED_LABEL,
    contactChannelChoices,
    contactOutcomeChoices,
  } from "./unclaimed-funds-vocabulary.ts";

  let {
    open = $bindable(false),
    reviewId,
    matterNumber,
    matterTitle,
    timeZone,
    onRecorded,
  }: {
    open?: boolean;
    /** The file the attempt is recorded on, or null while none is open in the window. */
    reviewId: string | null;
    matterNumber: string | null;
    matterTitle: string | null;
    /** The account's own zone: the day an attempt is made is the firm's day, not the reader's. */
    timeZone: string;
    /** The attempt landed: the window re-reads the file and the section re-reads the ledgers. */
    onRecorded: () => void;
  } = $props();

  let channel = $state<TrustContactChannel>("regular_mail");
  let attemptedOn = $state("");
  let contactUsed = $state("");
  let outcome = $state<TrustContactOutcome>("no_response");
  let note = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const channelChoices = contactChannelChoices();
  const outcomeChoices = contactOutcomeChoices();

  function reset(): void {
    channel = "regular_mail";
    attemptedOn = defaultEffectiveDate(timeZone);
    contactUsed = "";
    outcome = "no_response";
    note = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const contactWanted = $derived(contactUsedIsRequired(channel));

  const reading = $derived(
    readTrustContactAttemptEntry({ channel, attemptedOn, contactUsed, outcome, note }),
  );

  const refusal = $derived.by((): string | undefined => {
    if (reviewId === null) return "No file is open to record this attempt on.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  /* The matter whose owner is being looked for, by the number somebody reads back out loud. */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: matterTitle === null ? [] : [matterTitle],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);
  const dayRefusal = $derived(fieldRefusal(serverProblem, "attemptedOn"));

  const started = $derived(contactUsed.trim() !== "" || note.trim() !== "");

  async function record(): Promise<ActionOutcome> {
    if (reviewId === null || reading.kind !== "request") return "refused";
    failure = null;
    const result = await recordTrustContactAttempt(
      fetch,
      reviewId,
      reading.request,
      submissionKey,
    );
    if (result.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = stated(
      result.failure,
      "The attempt was not recorded, so the file does not carry it.",
      "Nothing answered, so the attempt was not recorded. The file is unchanged.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Record Contact Attempt"
  {subtitle}
  commitLabel="Record Attempt"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={record}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Attempt Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField label="Channel" error={fieldRefusal(serverProblem, "channel")}>
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Channel"
              options={channelChoices}
              disabled={busy}
              bind:value={
                () => channel, (chosen) => (channel = chosen as TrustContactChannel)
              }
            />
          {/snippet}
        </LabelledField>

        <!-- The picker renders its own label, so it stands outside LabelledField rather than
             carrying a second one. -->
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Attempted On"
            value={civilDateValue(attemptedOn)}
            onValueChange={(next) => (attemptedOn = civilDateTextOrEmpty(next))}
            disabled={busy}
            aria-invalid={dayRefusal === undefined ? undefined : "true"}
          />
          {#if dayRefusal !== undefined}
            <p class="mc-form-errors">{dayRefusal}</p>
          {:else}
            <p class="mc-form-description">The day the attempt was made.</p>
          {/if}
        </div>
      </div>

      <LabelledField
        label={CONTACT_USED_LABEL}
        hint={CONTACT_USED_HINT}
        error={fieldRefusal(serverProblem, "contactUsed")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf(CONTACT_USED_LABEL)}
            disabled={busy || !contactWanted}
            title={contactWanted
              ? undefined
              : "A review of the firm's own records reaches nobody, so there is no address or number to name."}
            bind:value={contactUsed}
          />
        {/snippet}
      </LabelledField>

      <LabelledField label="Outcome" error={fieldRefusal(serverProblem, "outcome")}>
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Outcome"
            options={outcomeChoices}
            disabled={busy}
            bind:value={
              () => outcome, (chosen) => (outcome = chosen as TrustContactOutcome)
            }
          />
        {/snippet}
      </LabelledField>

      <LabelledField
        label="Note"
        hint="What was said, or what came back."
        error={fieldRefusal(serverProblem, "note")}
      >
        {#snippet children({ props })}
          <Textarea
            {...props}
            rows={3}
            resizable={false}
            placeholder={placeholderOf("Note")}
            disabled={busy}
            bind:value={note}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>

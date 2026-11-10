<script lang="ts">
  /*
   * Answering one hit — the act with professional consequences, and the only place on this surface
   * where a conclusion is drawn at all.
   *
   * FOUR THINGS THIS DIALOG EXISTS TO MAKE UNMISSABLE.
   *
   *   1. WHOSE CONCLUSION IT IS. The reviewer is the signed-in member and cannot be somebody else:
   *      the request carries no reviewer field, so the server records whoever is asking. The dialog
   *      names them before the control is pressed, because a person about to put their name on a
   *      professional-responsibility judgement should see the name going on it.
   *   2. THAT A REASON IS REQUIRED. The server refuses a blank rationale, and so does the control
   *      that sends it. The rationale is what an auditor reads years later, and a conclusion with
   *      no reasoning behind it is not defensible whoever signed it.
   *   3. THAT NOTHING IS EVER EDITED. Every answer appends a row. A reviewer who changes their mind
   *      records a second answer and both stay on the books, which is what makes the trail evidence
   *      rather than a current opinion.
   *   4. WHAT A WAIVER ACTUALLY HAS TO RECORD. What a firm is asked to produce when a waiver is
   *      questioned is the client's informed consent, confirmed in writing — not a sentence saying
   *      one was obtained. So a waiver records who consented, whether that consent was confirmed in
   *      writing, the filed document evidencing it, and the date it was given.
   *
   *      THE CONSENTING PARTY AND THE DATE ARE REQUIRED; THE WRITING IS NOT. Who consented and when
   *      are the act itself — a reviewer who cannot say either is recording an impression. The
   *      written confirmation is evidence that follows the act and genuinely arrives afterwards, so
   *      refusing the answer until it existed would only mean the firm's log never heard about the
   *      waiver at all. The answer is recorded, and it reads as incomplete on every surface that
   *      shows it until a later answer supplies the rest. That is stated here, before the control is
   *      pressed, so nobody records an unevidenced waiver believing it complete.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import Separator from "@magna-carta/design-system/separator";
  import { personName } from "@magna-carta/design-system/formatters";
  import type { DateValue } from "@internationalized/date";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import MatterDocumentPicker from "$lib/documents/matter-document-picker.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    recordConflictsDisposition,
    DISPOSE_CONFLICTS_PERMISSION,
    type DispositionKind,
    type HitDetail,
  } from "./conflicts-api.ts";
  import {
    DISPOSITION_KINDS,
    dispositionVocabulary,
    evidenceTier,
    sourceVocabulary,
    waiverShortfallText,
  } from "./conflicts-vocabulary.ts";

  let {
    open = $bindable(false),
    hit,
    partyName = null,
    matterId = null,
    reviewerName,
    permissions = null,
    initialKind = "cleared",
    onRecorded,
  }: {
    open?: boolean;
    /** The hit being answered. Null closes the dialog's subject with it. */
    hit: HitDetail | null;
    /** The matched party's name where one read has answered it; null where it has not. */
    partyName?: string | null;
    /**
     * The matter this check named, so a waiver's confirmation can be picked out of the matter's own
     * files. Null on a pre-consult check, which has no matter to file into — the document field says
     * so rather than offering a list that cannot exist.
     */
    matterId?: string | null;
    /** The signed-in member, as their name reads. */
    reviewerName: string | null;
    permissions?: readonly string[] | null;
    /** The answer the dialog opens on, where the reader already picked one from a result's menu. */
    initialKind?: DispositionKind;
    /** The answer was written. The consumer re-reads the check. */
    onRecorded: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  let kind = $state<DispositionKind>("cleared");
  let rationale = $state("");
  let failure = $state<StatedFailure | null>(null);

  // The waiver's own record. `confirmedInWriting` starts unanswered on purpose: it is a fact in its
  // own right and a reviewer has to state it, so there is no default for the control to imply.
  let consentingParty = $state<PickableEntity | null>(null);
  const partySearch = directoryPickerSearch(fetch);
  let confirmedInWriting = $state<"yes" | "no" | "">("");
  let documentFileId = $state<string | null>(null);
  let givenOn = $state("");

  const mayDispose = $derived(
    permissions === null || permissions.includes(DISPOSE_CONFLICTS_PERMISSION),
  );

  // A fresh opening is a fresh answer: reopening on another hit must never carry the last one's
  // reasoning — or the last one's waiver — into it.
  function reset(): void {
    kind = initialKind;
    rationale = "";
    consentingParty = null;
    confirmedInWriting = "";
    documentFileId = null;
    givenOn = "";
    failure = null;
  }

  /** Whether anything has been answered: what the guard asks about before a stray Escape. */
  const started = $derived(
    rationale.trim() !== "" || kind !== "cleared" || consentingParty !== null || givenOn !== "",
  );

  /** The typed date as a calendar date, or undefined while it is empty or half-entered. */
  const givenOnValue = $derived(civilDateValue(givenOn));

  function recordGivenOn(next: DateValue | undefined): void {
    givenOn = civilDateTextOrEmpty(next);
  }

  const refusal = $derived.by((): string | undefined => {
    if (hit === null) return "No hit is open.";
    if (permissions !== null && !mayDispose) {
      return permissionRefusal("Answering a hit", "conflicts:dispose");
    }
    if (rationale.trim() === "") return "A reason is required. It is what an auditor reads.";
    if (kind === "waiver_obtained") {
      if (consentingParty === null) return "A waiver has to name who gave it.";
      if (givenOn === "") return "A waiver has to say when it was given.";
      if (confirmedInWriting === "") {
        return "Say whether the consent was confirmed in writing. Either answer is recordable; not answering is not.";
      }
    }
    return undefined;
  });

  /**
   * What this answer will be short of, stated before it is recorded.
   *
   * The same sentences the record will carry afterwards, from the same catalogue — so a reviewer
   * about to record a waiver the firm cannot yet evidence sees exactly what every later reader of
   * this row will see, rather than discovering it on the hit list.
   */
  const shortfallsAhead = $derived.by((): string[] => {
    if (kind !== "waiver_obtained") return [];
    const ahead: string[] = [];
    if (confirmedInWriting !== "yes") {
      ahead.push(waiverShortfallText("consent-not-confirmed-in-writing"));
    }
    if (documentFileId === null) ahead.push(waiverShortfallText("confirmation-not-filed"));
    return ahead;
  });

  const subtitle = $derived<RecordSubject>(
    hit === null
      ? {}
      : {
          facts: [
            evidenceTier(hit.evidenceTier).label,
            sourceVocabulary(hit.sourceClass).label,
            partyName ?? "Party unread",
          ],
        },
  );

  async function record(): Promise<ActionOutcome> {
    if (hit === null || refusal !== undefined) return "refused";
    failure = null;
    const outcome = await recordConflictsDisposition(
      fetch,
      hit.id,
      {
        kind,
        rationale: rationale.trim(),
        waiver:
          kind === "waiver_obtained" && consentingParty !== null
            ? {
                givenByEntityId: consentingParty.identifier,
                confirmedInWriting: confirmedInWriting === "yes",
                documentFileId,
                givenOn,
              }
            : undefined,
      },
      // A retried submit must not append a second answer to the same hit.
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onRecorded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The answer was refused.",
      "The answer could not be sent. Nothing was recorded.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Answer This Hit"
  {subtitle}
  commitLabel="Record the Answer"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={record}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label>Reviewer</Label>
      <p class="text-sm">{personName(reviewerName)}</p>
    </div>

    <div class="flex flex-col gap-8">
      <Label id="{fieldPrefix}-kind-label">Adjudication</Label>
      <RadioGroup.Root
        bind:value={kind}
        disabled={busy}
        aria-labelledby="{fieldPrefix}-kind-label"
      >
        {#each DISPOSITION_KINDS as candidate (candidate)}
          {@const word = dispositionVocabulary(candidate)}
          <div class="flex items-center gap-8">
            <RadioGroup.Item value={candidate} id="{fieldPrefix}-kind-{candidate}" />
            <Label for="{fieldPrefix}-kind-{candidate}" title={word.meaning}>{word.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>

    <LabelledField label="Rationale">
      {#snippet children({ props })}
        <Textarea {...props} rows={4} placeholder="Rationale" disabled={busy} bind:value={rationale} />
      {/snippet}
    </LabelledField>

    {#if kind === "waiver_obtained"}
      <Separator />
      <!-- The waiver's own record. This is what a firm is asked to produce when a waiver is
           questioned, so it is captured as facts rather than left to the rationale sentence. -->
      <LabelledField label="Waiver Given By">
        {#snippet children({ props })}
          <!-- A Directory record, not a typed name: the consenting party has to be somebody a
               reader can look up, which is the difference between a waiver and a claim of one. -->
          <DirectoryEntityPicker
            search={partySearch}
            bind:value={consentingParty}
            label="Waiver given by"
            inputId="{fieldPrefix}-waiver-given-by"
            disabled={busy}
            disabledReason={busy ? "The disposition is being recorded." : undefined}
          />
        {/snippet}
      </LabelledField>

      <div class="flex flex-col gap-8">
        <Label id="{fieldPrefix}-waiver-confirmed-label">Confirmed In Writing</Label>
        <!-- Answered, never assumed. There is no preselected option, because a control that
             defaults to Yes records a confirmation nobody stated and one that defaults to No
             reports a firm as short of something it may well hold. -->
        <RadioGroup.Root
          bind:value={confirmedInWriting}
          disabled={busy}
          aria-labelledby="{fieldPrefix}-waiver-confirmed-label"
          class="flex flex-row gap-16"
        >
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="yes" id="{fieldPrefix}-waiver-confirmed-yes" />
            <Label for="{fieldPrefix}-waiver-confirmed-yes">Yes</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="no" id="{fieldPrefix}-waiver-confirmed-no" />
            <Label for="{fieldPrefix}-waiver-confirmed-no">Not yet</Label>
          </div>
        </RadioGroup.Root>
      </div>

      <LabelledField label="Evidencing Document">
        {#snippet children({ props })}
          <!-- The filed document that evidences the written confirmation, from the matter's own
               files. A firm asked to produce a client's informed consent has to produce the
               document, not a note saying where it might be. -->
          <MatterDocumentPicker
            bind:value={documentFileId}
            {matterId}
            inputId={props.id}
            fieldName="Evidencing Document"
            noMatterNote="This check names no matter, so there is nowhere to file the confirmation yet. The waiver can be recorded without it and reads as incomplete until a later answer names the document."
            noFilesNote="This matter holds no files yet. Filing the confirmation and recording a second answer is what completes the record."
            chosenNoun="the evidencing document"
            disabled={busy}
          />
        {/snippet}
      </LabelledField>

      <!-- The date the waiver was GIVEN, which is not the instant this answer is being written.
           The interval between the two is exactly what a reviewer gets asked about. -->
      <DatePicker label="Waiver Given On" value={givenOnValue} onValueChange={recordGivenOn} />

      {#if shortfallsAhead.length > 0}
        <div class="flex flex-col gap-4 text-xs text-text-muted">
          <p>Recorded like this, the answer will read as incomplete wherever it is shown:</p>
          <ul class="flex flex-col gap-4">
            {#each shortfallsAhead as sentence (sentence)}
              <li>{sentence}</li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    <p class="text-xs text-text-muted">Recorded as a new row. An earlier answer is never edited.</p>
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Answer Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>

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
   *   4. WHAT A WAIVER STILL DOES NOT RECORD. Recording that a waiver was obtained is a kind and a
   *      sentence today. Who gave it, whether it was informed and confirmed in writing, and the
   *      document evidencing it have no columns behind them, so those fields render in their real
   *      place, refused, saying what they wait on. A reviewer must not be able to believe the
   *      platform captured a waiver it never captured.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Separator from "@magna-carta/design-system/separator";
  import { personName } from "@magna-carta/design-system/formatters";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { soonControlProperties } from "$lib/maturity/soon-affordance.ts";
  import { gapReason } from "./conflicts-gaps.ts";
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
  } from "./conflicts-vocabulary.ts";

  let {
    open = $bindable(false),
    hit,
    partyName = null,
    reviewerName,
    permissions = null,
    onRecorded,
  }: {
    open?: boolean;
    /** The hit being answered. Null closes the dialog's subject with it. */
    hit: HitDetail | null;
    /** The matched party's name where one read has answered it; null where it has not. */
    partyName?: string | null;
    /** The signed-in member, as their name reads. */
    reviewerName: string | null;
    permissions?: readonly string[] | null;
    /** The answer was written. The consumer re-reads the check. */
    onRecorded: () => void;
  } = $props();

  const fieldPrefix = $props.id();
  const waiverDescription = `${fieldPrefix}-waiver`;

  let kind = $state<DispositionKind>("cleared");
  let rationale = $state("");
  let recording = $state(false);
  let failure = $state<string | null>(null);

  const soonWaiver = soonControlProperties(gapReason("waiverEvidence"), waiverDescription);
  const mayDispose = $derived(
    permissions === null || permissions.includes(DISPOSE_CONFLICTS_PERMISSION),
  );

  // A fresh subject is a fresh answer: reopening on another hit must never carry the last one's
  // reasoning into it.
  $effect(() => {
    const subject = hit?.id ?? null;
    if (subject === null) return;
    kind = "cleared";
    rationale = "";
    failure = null;
  });

  const refusal = $derived.by((): string | null => {
    if (permissions !== null && !mayDispose) {
      return "Answering a hit needs the conflicts:dispose permission, which this account does not hold.";
    }
    if (rationale.trim() === "") return "A reason is required. It is what an auditor reads.";
    return null;
  });

  async function record(): Promise<void> {
    if (hit === null || refusal !== null || recording) return;
    recording = true;
    failure = null;
    const outcome = await recordConflictsDisposition(
      fetch,
      hit.id,
      { kind, rationale: rationale.trim() },
      // A retried submit must not append a second answer to the same hit.
      crypto.randomUUID(),
    );
    recording = false;
    if (outcome.kind === "ok") {
      open = false;
      onRecorded();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "The answer could not be sent. Nothing was recorded."
        : `${outcome.problem.detail ?? "The answer was refused."}${
            outcome.problem.errorId === undefined ? "" : ` Error ID ${outcome.problem.errorId}.`
          }`;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Answer This Hit</Dialog.Title>
    <Dialog.Description>
      {#if hit === null}
        No hit is open.
      {:else}
        {evidenceTier(hit.evidenceTier).label} &middot; {sourceVocabulary(hit.sourceClass).label}
        &middot; {partyName ?? "Party unread"}
      {/if}
    </Dialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Answer Was Not Recorded</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label>Reviewer</Label>
        <p class="text-sm">{personName(reviewerName)}</p>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="{fieldPrefix}-kind-label">Adjudication</Label>
        <RadioGroup.Root bind:value={kind} aria-labelledby="{fieldPrefix}-kind-label">
          {#each DISPOSITION_KINDS as candidate (candidate)}
            {@const word = dispositionVocabulary(candidate)}
            <div class="flex items-center gap-8">
              <RadioGroup.Item value={candidate} id="{fieldPrefix}-kind-{candidate}" />
              <Label for="{fieldPrefix}-kind-{candidate}" title={word.meaning}>{word.label}</Label>
            </div>
          {/each}
        </RadioGroup.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-rationale">Rationale</Label>
        <Textarea
          id="{fieldPrefix}-rationale"
          rows={4}
          placeholder="Rationale"
          disabled={recording}
          bind:value={rationale}
        />
      </div>

      {#if kind === "waiver_obtained"}
        <Separator />
        <!-- The waiver's own record, rendered in its real place and refused. Omitting these would
             let a reviewer believe the platform holds evidence of a waiver that it does not. -->
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-waiver-given-by">Waiver Given By</Label>
          <Input id="{fieldPrefix}-waiver-given-by" placeholder="Waiver Given By" {...soonWaiver} />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-waiver-confirmed">Confirmed In Writing</Label>
          <Input
            id="{fieldPrefix}-waiver-confirmed"
            placeholder="Confirmed In Writing"
            {...soonWaiver}
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-waiver-document">Evidencing Document</Label>
          <Input
            id="{fieldPrefix}-waiver-document"
            placeholder="Evidencing Document"
            {...soonWaiver}
          />
        </div>
        <div class="flex items-center gap-8">
          <MaturityBadge stage="soon" />
          <p id={waiverDescription} class="text-xs text-text-muted">{soonWaiver.title}</p>
        </div>
      {/if}
    </div>

    <div class="mt-16 flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto text-xs text-text-muted">
        Recorded as a new row. An earlier answer is never edited.
      </span>
      <Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
      <Button
        variant="primary"
        disabled={refusal !== null || recording || hit === null}
        title={refusal ?? undefined}
        onclick={() => void record()}
      >
        {recording ? "Recording" : "Record the answer"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="mt-8 text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<script lang="ts">
  /*
   * Amending the fee agreement.
   *
   * AN AMENDMENT IS A NEW VERSION. The version in force keeps the dates it governed and stays on the
   * record, because every bill composed under it says so. The dialog states which version it is
   * about to write before anything is typed.
   *
   * THE FIELDS ARE SHAPED EXACTLY AS THE RECORD IS. A flat fee carries its amount; a contingency
   * carries its share and its costs election — the election the written agreement must state and the
   * client signs; a retainer carries its target and its replenishment floor.
   *
   * THE ADVANCE-DEPOSIT DESTINATION IS RECORDED, NEVER DEFAULTED. Jurisdictions genuinely differ on
   * where an advance fee must sit, and a wrong silence states a wrong fact about client money — so
   * the control opens unanswered and the act is refused until somebody answers it.
   *
   * THE SIGNED AGREEMENT IS A FILE, NOT A SENTENCE. A version may name the paper it rests on — the
   * intake agreement the client signed at opening, the amendment signed later — picked from the
   * matter's own files, so it is something the firm can produce. Optional, because the paper may
   * follow the deal by a day and a version recorded before it is filed is still a true record.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import MatterDocumentPicker from "$lib/documents/matter-document-picker.svelte";
  import {
    billingFailure,
    setArrangement,
    type ArrangementKind,
    type ArrangementRecord,
    type ArrangementRequest,
    type ContingencyBasis,
  } from "./billing-api.ts";
  import { readAmountMinor, readShareE4 } from "./amount-entry.ts";
  import {
    amendmentNote,
    ARRANGEMENT_KIND_LABELS,
    ARRANGEMENT_KINDS,
    CONTINGENCY_BASIS_LABELS,
    DEPOSIT_DESTINATION_LABELS,
    takesAdvanceDeposit,
  } from "./fee-agreement.ts";
  import { civilToday } from "./invoice-standing.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  let {
    open = $bindable(false),
    arrangement,
    matterId,
    onRecorded,
  }: {
    open?: boolean;
    /** The agreement as it stands, or null where nothing has been read. */
    arrangement: ArrangementRecord | null;
    matterId: string;
    onRecorded: (record: ArrangementRecord) => void;
  } = $props();

  const fieldPrefix = $props.id();

  const UNANSWERED = "unanswered";

  const KIND_ITEMS = ARRANGEMENT_KINDS.map((candidate) => ({
    value: candidate,
    label: ARRANGEMENT_KIND_LABELS[candidate],
  }));
  const DEPOSIT_ITEMS = [
    { value: UNANSWERED, label: "Choose: trust or operating…" },
    { value: "trust", label: DEPOSIT_DESTINATION_LABELS.trust },
    { value: "operating", label: DEPOSIT_DESTINATION_LABELS.operating },
  ];
  const BASIS_ITEMS = [
    { value: UNANSWERED, label: "Choose the election…" },
    { value: "gross_recovery", label: CONTINGENCY_BASIS_LABELS.gross_recovery },
    { value: "net_after_costs", label: CONTINGENCY_BASIS_LABELS.net_after_costs },
  ];

  // The Select works in plain strings; the closed unions are restored on the way out.
  let kindValue = $state<string>("hourly");
  let validFrom = $state(civilToday());
  let depositValue = $state<string>(UNANSWERED);
  let basisValue = $state<string>(UNANSWERED);
  let flatFeeText = $state("");
  let shareText = $state("");
  let retainerTargetText = $state("");
  let retainerFloorText = $state("");
  let agreementFileId = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const inForce = $derived(arrangement?.inForce ?? null);
  const nextVersion = $derived((inForce?.version ?? 0) + 1);

  function reset(): void {
    kindValue = inForce?.kind ?? "hourly";
    validFrom = civilToday();
    depositValue = UNANSWERED;
    basisValue = UNANSWERED;
    flatFeeText = "";
    shareText = "";
    retainerTargetText = "";
    retainerFloorText = "";
    agreementFileId = null;
    failure = null;
  }

  const kind = $derived(
    (ARRANGEMENT_KINDS.find((candidate) => candidate === kindValue) ?? "hourly") as ArrangementKind,
  );

  const flatFeeReading = $derived(readAmountMinor(flatFeeText));
  const shareReading = $derived(readShareE4(shareText));
  const targetReading = $derived(readAmountMinor(retainerTargetText));
  const floorReading = $derived(readAmountMinor(retainerFloorText));

  const refusal = $derived.by((): string | undefined => {
    if (validFrom === "") return "Say when the amendment takes effect.";
    if (takesAdvanceDeposit(kind) && depositValue === UNANSWERED) {
      return "Say where the advance deposit sits. It is recorded, never defaulted.";
    }
    if (kind === "flat_fee") {
      if (flatFeeReading.kind === "empty") return "Say what the flat fee is.";
      if (flatFeeReading.kind === "refused") return flatFeeReading.reason;
    }
    if (kind === "contingency") {
      if (shareReading.kind === "empty") return "Say what share of any recovery the fee is.";
      if (shareReading.kind === "refused") return shareReading.reason;
      if (basisValue === UNANSWERED) {
        return "Say whether costs come off before or after the fee is computed.";
      }
    }
    if (kind === "retainer") {
      if (targetReading.kind === "empty") return "Say what the retainer is meant to hold.";
      if (targetReading.kind === "refused") return targetReading.reason;
      if (floorReading.kind === "empty") return "Say the balance a replenishment is asked at.";
      if (floorReading.kind === "refused") return floorReading.reason;
    }
    return undefined;
  });

  function composeRequest(): ArrangementRequest {
    const request: ArrangementRequest = { kind, currency: "USD", validFrom, agreementFileId };
    if (takesAdvanceDeposit(kind)) {
      request.advanceDepositDestination = depositValue === "operating" ? "operating" : "trust";
    }
    if (kind === "flat_fee" && flatFeeReading.kind === "amount") {
      request.flatFeeAmountMinor = flatFeeReading.minor;
    }
    if (kind === "contingency" && shareReading.kind === "amount") {
      request.contingencyShareE4 = shareReading.minor;
      request.contingencyBasis = basisValue as ContingencyBasis;
    }
    if (kind === "retainer" && targetReading.kind === "amount" && floorReading.kind === "amount") {
      request.retainerTargetMinor = targetReading.minor;
      request.retainerThresholdMinor = floorReading.minor;
    }
    return request;
  }

  async function record(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await setArrangement(fetch, matterId, composeRequest(), crypto.randomUUID());
    if (outcome.kind === "ok") {

      onRecorded(outcome.value);
      return "committed";
    }
    failure = billingFailure(outcome, "The agreement is unchanged.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Amend Agreement"
  commitLabel="Record Amendment"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={
    flatFeeText !== "" ||
    shareText !== "" ||
    retainerTargetText !== "" ||
    retainerFloorText !== "" ||
    depositValue !== UNANSWERED ||
    basisValue !== UNANSWERED ||
    agreementFileId !== null
  }
  onOpen={reset}
  onCommit={record}
>
  {#snippet subtitle()}
    Records version {nextVersion}.{inForce === null
      ? " Nothing was recorded before, so the matter has been billed hourly by absence."
      : ` Version ${inForce.version} stays on the record with the dates it governed.`}
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Recorded"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
      <div class="flex flex-col gap-16">
        <div class="grid gap-12 sm:grid-cols-3">
          <div class="flex flex-col gap-8">
            <Label id="{fieldPrefix}-kind-label">Billed As</Label>
            <Select.Root
              type="single"
              items={KIND_ITEMS}
              bind:value={kindValue}
              allowDeselect={false}
              disabled={busy}
            >
              <Select.Trigger aria-labelledby="{fieldPrefix}-kind-label">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each KIND_ITEMS as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-8">
            <DatePicker
              label="Effective From"
              value={civilDateValue(validFrom)}
              onValueChange={(next) => (validFrom = civilDateTextOrEmpty(next))}
              disabled={busy}
            />
          </div>
          {#if takesAdvanceDeposit(kind)}
            <div class="flex flex-col gap-8">
              <Label id="{fieldPrefix}-deposit-label">Advance Deposit Sits In</Label>
              <Select.Root
                type="single"
                items={DEPOSIT_ITEMS}
                bind:value={depositValue}
                allowDeselect={false}
                disabled={busy}
              >
                <Select.Trigger aria-labelledby="{fieldPrefix}-deposit-label">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {#each DEPOSIT_ITEMS as item (item.value)}
                    <Select.Item value={item.value} label={item.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          {/if}
        </div>

        {#if kind === "flat_fee"}
          <div class="grid gap-12 sm:grid-cols-3">
            <div class="flex flex-col gap-8">
              <Label for="{fieldPrefix}-flat">Flat Fee</Label>
              <Input id="{fieldPrefix}-flat" disabled={busy} bind:value={flatFeeText} />
            </div>
          </div>
        {:else if kind === "contingency"}
          <div class="grid gap-12 sm:grid-cols-3">
            <div class="flex flex-col gap-8">
              <Label for="{fieldPrefix}-share">Share of Recovery</Label>
              <Input id="{fieldPrefix}-share" disabled={busy} bind:value={shareText} />
              <p class="text-xs text-text-muted">As a percentage, such as 33.33.</p>
            </div>
            <div class="flex flex-col gap-8 sm:col-span-2">
              <Label id="{fieldPrefix}-basis-label">Costs and the Fee</Label>
              <Select.Root
                type="single"
                items={BASIS_ITEMS}
                bind:value={basisValue}
                allowDeselect={false}
                disabled={busy}
              >
                <Select.Trigger aria-labelledby="{fieldPrefix}-basis-label">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {#each BASIS_ITEMS as item (item.value)}
                    <Select.Item value={item.value} label={item.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
        {:else if kind === "retainer"}
          <div class="grid gap-12 sm:grid-cols-3">
            <div class="flex flex-col gap-8">
              <Label for="{fieldPrefix}-target">Retainer Target</Label>
              <Input id="{fieldPrefix}-target" disabled={busy} bind:value={retainerTargetText} />
            </div>
            <div class="flex flex-col gap-8">
              <Label for="{fieldPrefix}-floor">Replenish Below</Label>
              <Input id="{fieldPrefix}-floor" disabled={busy} bind:value={retainerFloorText} />
            </div>
          </div>
        {:else}
          <p class="text-xs text-text-muted">
            Nothing else to record: rates resolve per timekeeper from the firm&rsquo;s rate cards in
            force on each work date.
          </p>
        {/if}

        <p class="text-xs text-text-muted">{amendmentNote(kind)}</p>

        <LabelledField
          label="Signed Agreement"
          hint="The intake agreement or amendment the client signed, from this matter's files. A version can be recorded before the paper is filed."
        >
          {#snippet children({ props })}
            <MatterDocumentPicker
              bind:value={agreementFileId}
              {matterId}
              inputId={props.id}
              fieldName="Signed Agreement"
              noMatterNote="No matter is named, so there is nowhere to file the agreement."
              noFilesNote="This matter has no files yet. File the signed agreement and it can be named on the next version."
              chosenNoun="the signed agreement"
              disabled={busy}
            />
          {/snippet}
        </LabelledField>

        <!-- What recording actually does. It sat in the action bar before the shell owned that bar;
             it is content rather than a control, so it reads here with the rest. -->
        <p class="text-xs text-text-subtle">
          Records a new version, in force from the effective date. Every bill names the version it
          was composed under.
        </p>
      </div>
  {/snippet}
</ActionDialog>

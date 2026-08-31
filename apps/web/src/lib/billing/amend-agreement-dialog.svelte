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
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import {
    billingFailureText,
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
  let working = $state(false);
  let failure = $state<string | null>(null);

  const inForce = $derived(arrangement?.inForce ?? null);
  const nextVersion = $derived((inForce?.version ?? 0) + 1);

  $effect(() => {
    if (!open) return;
    kindValue = inForce?.kind ?? "hourly";
    validFrom = civilToday();
    depositValue = UNANSWERED;
    basisValue = UNANSWERED;
    flatFeeText = "";
    shareText = "";
    retainerTargetText = "";
    retainerFloorText = "";
    failure = null;
  });

  const kind = $derived(
    (ARRANGEMENT_KINDS.find((candidate) => candidate === kindValue) ?? "hourly") as ArrangementKind,
  );

  const flatFeeReading = $derived(readAmountMinor(flatFeeText));
  const shareReading = $derived(readShareE4(shareText));
  const targetReading = $derived(readAmountMinor(retainerTargetText));
  const floorReading = $derived(readAmountMinor(retainerFloorText));

  const refusal = $derived.by((): string | null => {
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
    return null;
  });

  function composeRequest(): ArrangementRequest {
    const request: ArrangementRequest = { kind, currency: "USD", validFrom };
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

  async function record(): Promise<void> {
    if (working || refusal !== null) return;
    working = true;
    failure = null;
    const outcome = await setArrangement(fetch, matterId, composeRequest(), crypto.randomUUID());
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onRecorded(outcome.value);
      return;
    }
    failure = billingFailureText(outcome, "The agreement is unchanged.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} class="max-w-2xl">
    <Dialog.Title>Amend Agreement</Dialog.Title>
    <Dialog.Description>
      Records version {nextVersion}.{inForce === null
        ? " Nothing was recorded before, so the matter has been billed hourly by absence."
        : ` Version ${inForce.version} stays on the record with the dates it governed.`}
    </Dialog.Description>

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Was Recorded</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-3">
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-kind-label">Billed As</Label>
          <Select.Root
            type="single"
            items={KIND_ITEMS}
            bind:value={kindValue}
            allowDeselect={false}
            disabled={working}
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
          <Label for="{fieldPrefix}-from">Effective From</Label>
          <Input id="{fieldPrefix}-from" type="date" disabled={working} bind:value={validFrom} />
        </div>
        {#if takesAdvanceDeposit(kind)}
          <div class="flex flex-col gap-8">
            <Label id="{fieldPrefix}-deposit-label">Advance Deposit Sits In</Label>
            <Select.Root
              type="single"
              items={DEPOSIT_ITEMS}
              bind:value={depositValue}
              allowDeselect={false}
              disabled={working}
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
            <Input id="{fieldPrefix}-flat" disabled={working} bind:value={flatFeeText} />
          </div>
        </div>
      {:else if kind === "contingency"}
        <div class="grid gap-12 sm:grid-cols-3">
          <div class="flex flex-col gap-8">
            <Label for="{fieldPrefix}-share">Share of Recovery</Label>
            <Input id="{fieldPrefix}-share" disabled={working} bind:value={shareText} />
            <p class="text-xs text-text-muted">As a percentage, such as 33.33.</p>
          </div>
          <div class="flex flex-col gap-8 sm:col-span-2">
            <Label id="{fieldPrefix}-basis-label">Costs and the Fee</Label>
            <Select.Root
              type="single"
              items={BASIS_ITEMS}
              bind:value={basisValue}
              allowDeselect={false}
              disabled={working}
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
            <Input id="{fieldPrefix}-target" disabled={working} bind:value={retainerTargetText} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="{fieldPrefix}-floor">Replenish Below</Label>
            <Input id="{fieldPrefix}-floor" disabled={working} bind:value={retainerFloorText} />
          </div>
        </div>
      {:else}
        <p class="text-xs text-text-muted">
          Nothing else to record: rates resolve per timekeeper from the firm&rsquo;s rate cards in
          force on each work date.
        </p>
      {/if}

      <p class="text-xs text-text-muted">{amendmentNote(kind)}</p>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto max-w-sm text-xs text-text-subtle">
        Records a new version, in force from the effective date. Every bill names the version it was
        composed under.
      </span>
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={working || refusal !== null}
        title={refusal ?? "Record this amendment as a new version"}
        onclick={() => void record()}
      >
        <SquarePen class="size-16" aria-hidden="true" />
        {working ? "Recording" : "Record Amendment"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

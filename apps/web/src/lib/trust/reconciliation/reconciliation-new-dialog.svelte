<script lang="ts">
  /*
   * NEW RECONCILIATION — one period of one trust account, for the dates the statement covers.
   *
   * The first period asks for its start date and start balance, because nothing came before it.
   * Every later one carries both over from the period before it and says so. The end date and the
   * end balance are the statement's, and the end balance may wait: it can be typed on the
   * reconciliation itself. Statement files chosen here are attached once the period exists. A file
   * the server refuses (the malware scan flagged it, or it is not a PDF or an image) keeps the dialog
   * open saying so, and the commit then opens the period that was started.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { fieldRefusal } from "$lib/trust/trust-write-requests.ts";
  import type { TrustBankReconciliationList } from "./reconciliation-api.ts";
  import type { ReconciliationService } from "./reconciliation-service.ts";
  import { readBalanceMinor } from "./reconciliation-model.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    accountName,
    nextStart,
    today,
    money,
    service,
    onStarted,
  }: {
    open?: boolean;
    trustAccountId: string;
    accountName: string | null;
    /** Where the next period starts, carried over; null for the account's first. */
    nextStart: TrustBankReconciliationList["nextStart"];
    /** Today where the account is held, as YYYY-MM-DD. */
    today: string;
    money: (minor: number) => string;
    service: ReconciliationService;
    onStarted: (reconciliationId: string) => void;
  } = $props();

  let startDate = $state("");
  let startBalanceText = $state("");
  let endDate = $state("");
  let endBalanceText = $state("");
  let files = $state<FileList | undefined>(undefined);
  let failure = $state<StatedFailure | null>(null);
  let failureTitle = $state("Nothing Was Started");
  /** The period already started when one of its files was refused; committing again opens it. */
  let startedId = $state<string | null>(null);
  let key = "";

  function reset(): void {
    startDate = "";
    startBalanceText = "";
    endDate = today;
    endBalanceText = "";
    files = undefined;
    failure = null;
    failureTitle = "Nothing Was Started";
    startedId = null;
    key = crypto.randomUUID();
  }

  const first = $derived(nextStart === null);
  const startBalance = $derived(readBalanceMinor(startBalanceText));
  const endBalance = $derived(readBalanceMinor(endBalanceText));
  const effectiveStart = $derived(nextStart?.startDate ?? startDate);

  const refusal = $derived.by((): string | undefined => {
    if (first && startDate === "") return "Enter the start date.";
    if (first && startBalance === null) return "Enter the start balance.";
    if (typeof startBalance === "object" && startBalance !== null) return startBalance.refused;
    if (endDate === "") return "Enter the end date.";
    if (effectiveStart !== "" && endDate < effectiveStart) {
      return "The end date is before the start date.";
    }
    if (typeof endBalance === "object" && endBalance !== null) return endBalance.refused;
    return undefined;
  });

  const problem = $derived(failure?.failure.problem ?? null);
  const started = $derived(startDate !== "" || startBalanceText !== "" || endBalanceText !== "");

  async function start(): Promise<ActionOutcome> {
    if (startedId !== null) {
      onStarted(startedId);
      return "committed";
    }
    if (refusal !== undefined) return "refused";
    failure = null;
    const outcome = await service.start(
      {
        trustAccountId,
        endDate,
        ...(first
          ? { startDate, startBalanceMinor: typeof startBalance === "number" ? startBalance : 0 }
          : {}),
        ...(typeof endBalance === "number" ? { endBalanceMinor: endBalance } : {}),
      },
      key,
    );
    if (outcome.kind !== "ok") {
      failure = stated(
        outcome.failure,
        "Nothing was started. The account's reconciliations are as they were.",
        "Couldn't connect. Nothing was started.",
      );
      return "refused";
    }
    const reconciliationId = outcome.value.trustBankReconciliationId;
    for (const file of Array.from(files ?? [])) {
      const attached = await service.attachFile(reconciliationId, file, crypto.randomUUID());
      if (attached.kind !== "ok") {
        startedId = reconciliationId;
        failureTitle = "File Not Kept";
        failure = stated(
          attached.failure,
          `The reconciliation was started, but ${file.name} was not kept. You can attach a file on the reconciliation.`,
          `Couldn't connect. The reconciliation was started, but ${file.name} was not kept.`,
        );
      }
    }
    if (startedId !== null) return "refused";
    onStarted(reconciliationId);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  heading="New Reconciliation"
  subtitle={accountName === null ? undefined : { facts: [accountName] }}
  commitLabel={startedId === null ? "Start Reconciliation" : "Open Reconciliation"}
  commitBusyLabel="Starting"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={start}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title={failureTitle}
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="@container flex flex-col gap-16">
      {#if nextStart !== null}
        <p class="text-sm text-text-muted">
          Starts {formatDate(nextStart.startDate)} at {money(nextStart.startBalanceMinor)}, carried
          over from the last reconciliation.
        </p>
      {:else}
        <div class="grid gap-12 @sm:grid-cols-2">
          <div class="flex flex-col gap-8">
            <DatePicker
              necessity="required"
              label="Start Date"
              value={civilDateValue(startDate)}
              onValueChange={(next) => (startDate = civilDateTextOrEmpty(next))}
              disabled={busy}
              aria-invalid={fieldRefusal(problem, "startDate") === undefined ? undefined : "true"}
            />
          </div>
          <LabelledField
            necessity="required"
            label="Start Balance"
            hint="The balance the statement starts with."
            error={fieldRefusal(problem, "startBalanceMinor")}
          >
            {#snippet children({ props })}
              <Input {...props} inputmode="decimal" disabled={busy} bind:value={startBalanceText} />
            {/snippet}
          </LabelledField>
        </div>
      {/if}

      <div class="grid gap-12 @sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <DatePicker
            necessity="required"
            label="End Date"
            value={civilDateValue(endDate)}
            onValueChange={(next) => (endDate = civilDateTextOrEmpty(next))}
            disabled={busy}
            aria-invalid={fieldRefusal(problem, "endDate") === undefined ? undefined : "true"}
          />
        </div>
        <LabelledField
          label="End Balance"
          hint="From the statement. You can add it later."
          error={fieldRefusal(problem, "endBalanceMinor")}
        >
          {#snippet children({ props })}
            <Input {...props} inputmode="decimal" disabled={busy} bind:value={endBalanceText} />
          {/snippet}
        </LabelledField>
      </div>

      <LabelledField label="Statement Files" hint="PDF, PNG or JPEG. You can attach more later.">
        {#snippet children({ props })}
          <FileInput
            {...props}
            accept="application/pdf,image/png,image/jpeg"
            multiple
            disabled={busy}
            onchange={(event) => (files = event.currentTarget.files ?? undefined)}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>

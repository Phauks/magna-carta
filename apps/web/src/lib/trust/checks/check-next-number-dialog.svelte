<script lang="ts">
  /*
   * Setting the account's next check number: the number on the paper now in the printer.
   *
   * THE NUMBER IS THE READER'S, AT ANY POINT, higher or lower than before. It is saved as the
   * stock's starting number with everything else on the stock kept as it is, and the next check
   * prints on the first number at or after it that no check on the account has used. Where the
   * number typed is already used, the line under the field says which number the next check will
   * actually print on, composed from the account's own register, so it cannot promise a number the
   * server will not give.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TrustCheckStock } from "./checks-api.ts";
  import type { TrustChecksService } from "./checks-service.ts";
  import { nextUnusedNumber, typedCheckNumber } from "./checks-model.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    stock,
    nextCheckNumber,
    usedNumbers,
    service,
    onSaved,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The account's saved stock, which the number is saved on. */
    stock: TrustCheckStock | null;
    /** The account's next number now. */
    nextCheckNumber: number;
    /** Every number a check on the account already carries. */
    usedNumbers: readonly number[];
    service: TrustChecksService;
    onSaved: () => void;
  } = $props();

  let text = $state("");
  let submissionKey = "";
  let failure = $state<StatedFailure | null>(null);

  function opened(): void {
    text = String(nextCheckNumber);
    submissionKey = crypto.randomUUID();
    failure = null;
  }

  const typed = $derived(typedCheckNumber(text));
  const landsOn = $derived(typed === null ? null : nextUnusedNumber(typed, usedNumbers));

  const subtitle = $derived<RecordSubject>({ facts: stock === null ? [] : [stock.name] });

  const refusal = $derived.by((): string | undefined => {
    if (stock === null) return "Set up this account's check stock first.";
    if (typed === null) return "Give the number on the next check in the printer.";
    if (typed === nextCheckNumber) return "That is already the next number.";
    return undefined;
  });

  async function save(): Promise<ActionOutcome> {
    if (stock === null || typed === null) return "refused";
    failure = null;
    const outcome = await service.saveStock(
      {
        trustAccountId,
        name: stock.name,
        pageLayout: stock.pageLayout,
        fields: stock.fields.map((field) => ({ ...field })),
        shiftXMils: stock.shiftXMils,
        shiftYMils: stock.shiftYMils,
        startingCheckNumber: typed,
        scan: "keep",
      },
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onSaved();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The next check number is unchanged.",
      "Couldn't connect. The next check number is unchanged, and trying again won't save it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Change the Next Check Number"
  {subtitle}
  commitLabel="Save Number"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  unsavedChanges={typed !== nextCheckNumber}
  onOpen={opened}
  onCommit={save}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Number Was Not Saved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-12">
      <div class="w-full sm:w-3xs">
        <LabelledField necessity="required" label="Next Check Number">
          {#snippet children({ props })}
            <Input
              {...props}
              bind:value={text}
              inputmode="numeric"
              autocomplete="off"
              class="tabular-nums"
              disabled={busy}
              aria-invalid={typed === null}
            />
          {/snippet}
        </LabelledField>
      </div>
      {#if typed !== null && landsOn !== null}
        <p class="text-sm text-text-muted" aria-live="polite">
          {landsOn === typed
            ? `The next check prints on ${typed}.`
            : `${typed} is already used on this account, so the next check prints on ${landsOn}.`}
        </p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

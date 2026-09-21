<script lang="ts">
  /*
   * Changing the firm's authorization posture.
   *
   * IT IS THE FIRM'S RULE, NOT AN ACCOUNT'S. One posture governs money leaving any client ledger in
   * any of the firm's trust accounts, which is why the panel opens from the firm's own screen and
   * says so rather than sitting beside the account a reader happens to have selected.
   *
   * A NEW VERSION GOVERNS WHAT COMES NEXT AND RE-DECIDES NOTHING. Requests already waiting were
   * proposed under the version in force when they were raised, and the panel says so: a firm that
   * tightened its rule this morning has not thereby refused what was proposed last night.
   *
   * THE TWO ANSWERS ARE INDEPENDENT. Whether a second person is needed and whether whoever releases
   * the money must hold the authority capability are different questions with different answers — a
   * firm can want a second pair of eyes from anybody, and a firm can want one qualified person and
   * no second pair of eyes — so the form asks both rather than folding them into one control.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS and reused on every retry, so a submission
   * that timed out and was pressed again writes one version rather than two identical ones with two
   * different numbers.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Switch from "@magna-carta/design-system/switch";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { amountFieldText, readAmountMinor } from "$lib/billing/amount-entry.ts";
  import {
    changeTrustAuthorizationPolicy,
    type TrustAuthorizationPolicyKind,
    type TrustAuthorizationPolicyVersion,
  } from "./trust-api.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import { postureSentence } from "./firm-trust-model.ts";

  let {
    open = $bindable(false),
    current,
    currency,
    onChanged,
  }: {
    open?: boolean;
    /** The version in force, which the form opens on. Null while the posture has not been read. */
    current: TrustAuthorizationPolicyVersion | null;
    currency: string;
    onChanged: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  let policy = $state<TrustAuthorizationPolicyKind>("off");
  let thresholdText = $state("");
  let requireAuthorizedApprover = $state(false);
  let failure = $state<StatedFailure | null>(null);

  /** Minted on the gesture that opened this panel and reused on every retry of this change. */
  let submissionKey = "";

  /** The amount field's text for a version: empty where the version names no threshold. */
  function thresholdTextOf(version: TrustAuthorizationPolicyVersion | null): string {
    if (version === null || version.thresholdAmountMinor === null) return "";
    return amountFieldText(version.thresholdAmountMinor);
  }

  function reset(): void {
    policy = current?.policy ?? "off";
    thresholdText = thresholdTextOf(current);
    requireAuthorizedApprover = current?.requireAuthorizedApprover ?? false;
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const thresholdReading = $derived(readAmountMinor(thresholdText));

  const commitRefusal = $derived.by((): string | undefined => {
    if (policy !== "threshold") return undefined;
    if (thresholdReading.kind === "empty") {
      return "Say the amount above which a second person is needed.";
    }
    if (thresholdReading.kind === "refused") return thresholdReading.reason;
    return undefined;
  });

  /** What the firm's rule will read as once this is written, in the same words the panel prints. */
  const preview = $derived(
    postureSentence(
      {
        id: null,
        version: (current?.version ?? 0) + 1,
        policy,
        thresholdAmountMinor:
          policy === "threshold" && thresholdReading.kind === "amount"
            ? thresholdReading.minor
            : null,
        requireAuthorizedApprover,
        setBy: null,
        setAt: null,
      },
      currency,
    ),
  );

  const started = $derived(
    current === null ||
      policy !== current.policy ||
      requireAuthorizedApprover !== current.requireAuthorizedApprover ||
      thresholdText !== thresholdTextOf(current),
  );

  async function change(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await changeTrustAuthorizationPolicy(
      fetch,
      {
        policy,
        thresholdAmountMinor:
          policy === "threshold" && thresholdReading.kind === "amount"
            ? thresholdReading.minor
            : null,
        requireAuthorizedApprover,
      },
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onChanged();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The posture is unchanged: the version in force still governs.",
      "Nothing answered, so the posture is unchanged. The version in force still governs.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Change the Authorization Posture"
  commitLabel="Change Posture"
  commitBusyLabel="Changing"
  {commitRefusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={change}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Posture Is Unchanged"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label id="{fieldPrefix}-policy-label">When a second person is needed</Label>
        <RadioGroup.Root
          value={policy}
          onValueChange={(value) => (policy = value as TrustAuthorizationPolicyKind)}
          disabled={busy}
          aria-labelledby="{fieldPrefix}-policy-label"
        >
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="off" id="{fieldPrefix}-policy-off" />
            <Label for="{fieldPrefix}-policy-off">Never</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="threshold" id="{fieldPrefix}-policy-threshold" />
            <Label for="{fieldPrefix}-policy-threshold">Above an amount</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="always" id="{fieldPrefix}-policy-always" />
            <Label for="{fieldPrefix}-policy-always">Always</Label>
          </div>
        </RadioGroup.Root>
      </div>

      {#if policy === "threshold"}
        <LabelledField
          label="Amount"
          hint="A second person is needed strictly above this figure."
          error={fieldRefusal(failure?.failure.problem ?? null, "thresholdAmountMinor")}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              placeholder={placeholderOf("Amount")}
              inputmode="decimal"
              disabled={busy}
              bind:value={thresholdText}
            />
          {/snippet}
        </LabelledField>
      {/if}

      <div class="flex items-center justify-between gap-16">
        <div class="flex min-w-0 flex-col gap-4">
          <Label for="{fieldPrefix}-authority">Require the authority capability</Label>
          <p class="mc-form-description">
            Whoever releases client money must hold trust:authorize. Independent of the answer
            above: a firm can ask for a second person who is anybody, or for one qualified person
            and nobody else.
          </p>
        </div>
        <Switch
          id="{fieldPrefix}-authority"
          disabled={busy}
          bind:checked={requireAuthorizedApprover}
        />
      </div>

      <p class="mc-form-description">{preview}</p>
      <p class="mc-form-description">
        A new version governs requests raised after it is written. Requests already waiting were
        proposed under the version in force at the time and keep it.
      </p>
    </div>
  {/snippet}
</ActionDialog>

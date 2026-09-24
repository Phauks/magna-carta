<script lang="ts">
  /*
   * Add Two-Factor — one panel, three steps: the password, then the authenticator, then the
   * recovery codes.
   *
   * ONE PANEL RATHER THAN THREE, because the steps are one act and a window that closed and another
   * that opened between them would read as two. The ActionDialog carries it with the outcomes it
   * already has: a step that succeeded and has a next one reports "refused" — to the shell that
   * means only "stay standing" — and moves `step` on, so the heading, fields and commit all turn
   * over in place. The last step reports "done", which is the shell's own shape for an act that
   * happened and has something to show for it: the recovery codes, with Close as the only way out.
   *
   * THE ORDER IS THE SAFETY ($lib/account/two-factor.ts states it in full). The password step
   * stores a secret but changes nothing about how the account signs in; only the code step turns
   * two-factor on, and only with a code the authenticator made from that secret. A member who gives
   * up at the QR code — wrong app, camera will not focus — walks away with an account exactly as it
   * was.
   *
   * THE SECRET IS ON THE SCREEN AS TEXT TOO, beside the QR code and never instead of it: a symbol is
   * one way in (the QrCode component says why), and somebody setting this up on the same phone they
   * are reading it on cannot scan their own screen.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import QrCode from "@magna-carta/design-system/qr-code";
  import VerificationCodeInput from "@magna-carta/design-system/verification-code-input";
  import RecoveryCodes from "$lib/account/components/recovery-codes.svelte";
  import {
    beginEnrolment,
    confirmEnrolment,
    groupedSecret,
    type EnrolmentIssued,
  } from "$lib/account/two-factor.ts";
  import { VERIFICATION_CODE_LENGTH } from "$lib/auth/two-factor-policy.ts";

  let {
    open = $bindable(false),
    accountAddress,
    onTurnedOn,
  }: {
    open?: boolean;
    accountAddress: string | null;
    /** Fired the moment the account starts asking for a code — before the panel closes. */
    onTurnedOn: () => void;
  } = $props();

  type Step = "password" | "authenticator" | "recovery-codes";

  let step = $state<Step>("password");
  let password = $state("");
  let code = $state("");
  let issued = $state<EnrolmentIssued | null>(null);
  let refusal = $state<string | null>(null);

  function clear(): void {
    step = "password";
    password = "";
    code = "";
    issued = null;
    refusal = null;
  }

  const commitLabel = $derived(step === "password" ? "Continue" : "Add Two-Factor");
  const commitBusyLabel = $derived(step === "password" ? "Checking" : "Verifying");

  const commitRefusal = $derived.by((): string | undefined => {
    if (step === "password" && password === "") return "Enter your password.";
    if (step === "authenticator" && code.length !== VERIFICATION_CODE_LENGTH) {
      return `Enter the ${VERIFICATION_CODE_LENGTH}-digit code your app shows.`;
    }
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    if (commitRefusal !== undefined) return "refused";
    refusal = null;

    if (step === "password") {
      const outcome = await beginEnrolment(password);
      if (outcome.kind === "refused") {
        refusal = outcome.message;
        return "refused";
      }
      // The password has done its job; it is not kept in the panel's state past the step that
      // needed it.
      password = "";
      issued = outcome;
      step = "authenticator";
      return "refused";
    }

    const outcome = await confirmEnrolment(code);
    if (outcome.kind === "refused") {
      refusal = outcome.message;
      code = "";
      return "refused";
    }
    step = "recovery-codes";
    onTurnedOn();
    return "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Add Two-Factor"
  {commitLabel}
  {commitBusyLabel}
  {commitRefusal}
  unsavedChanges={step === "authenticator" || password !== ""}
  onOpen={clear}
  onDismiss={clear}
  onCommit={commit}
>
  {#snippet notice()}
    {#if refusal !== null}
      <Alert.Root variant="danger">
        <Alert.Description>{refusal}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    {#if step === "password"}
      <LabelledField label="Password">
        {#snippet children({ props })}
          <PasswordInput
            {...props}
            bind:value={password}
            autocomplete="current-password"
            disabled={busy}
          />
        {/snippet}
      </LabelledField>
    {:else if step === "authenticator" && issued !== null}
      <div class="flex flex-col gap-24">
        <div class="flex flex-col gap-12">
          <p class="text-sm">Scan this with your authenticator app.</p>
          <QrCode value={issued.uri} label="QR code for your authenticator app" />
          {#if issued.secret !== ""}
            <p class="text-sm">
              Or enter this key: <span class="font-mono">{groupedSecret(issued.secret)}</span>
            </p>
          {/if}
        </div>

        <div class="flex flex-col gap-8">
          <Label for="two-factor-setup-code">Code From Your App</Label>
          <VerificationCodeInput
            inputId="two-factor-setup-code"
            bind:value={code}
            length={VERIFICATION_CODE_LENGTH}
            charset="numeric"
            aria-invalid={refusal !== null ? "true" : undefined}
            disabled={busy}
          />
        </div>
      </div>
    {:else if issued !== null}
      <RecoveryCodes codes={issued.recoveryCodes} {accountAddress} />
    {/if}
  {/snippet}
</ActionDialog>

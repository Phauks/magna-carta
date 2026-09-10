<script lang="ts">
  /*
   * Enter Your Two-Factor Code — one screen for every channel that can issue one.
   *
   * The channel decides the FIELD, not just the wording: length, character set, keyboard, and
   * whether a fresh code can be asked for at all (see ../code-channels.ts). One screen with a
   * channel prop rather than four screens, because the layout, the trust-device dial and the
   * attempt ladder are identical and four copies would drift.
   *
   * TWO DIALS, NOT ONE. "Remember Me" on the previous screen is session lifetime; the
   * checkbox here only skips the second step on future sign-ins from this device, and the password
   * is still required whenever the session ends. They are separate because a visitor can reasonably
   * want either without the other, so each is labelled by its effect rather than by its mechanism.
   */
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import VerificationCodeInput from "@magna-carta/design-system/verification-code-input";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { QUIET_LINK } from "../quiet-link.ts";
  import { type CodeChannel, codeChannelShape, codeShapeDescription } from "../code-channels.ts";
  import { TRUSTED_DEVICE_DAYS } from "../two-factor-policy.ts";

  let {
    channel = "authenticator",
    code = $bindable(""),
    trustDevice = $bindable(false),
    pending = false,
    rejected = false,
    attemptsRemaining = null,
    lockoutSeconds = null,
    sentTo = null,
    resendSecondsRemaining = null,
    codeFieldReference = $bindable(null),
    onSubmit,
    onResend,
    onRecoveryCode,
    back,
  }: {
    channel?: CodeChannel;
    code?: string;
    trustDevice?: boolean;
    pending?: boolean;
    rejected?: boolean;
    attemptsRemaining?: number | null;
    lockoutSeconds?: number | null;
    /** The masked destination, for a channel that sent the code somewhere. */
    sentTo?: string | null;
    /** Seconds until another send is allowed. Null once a send is available. */
    resendSecondsRemaining?: number | null;
    codeFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    onResend?: () => void;
    onRecoveryCode?: () => void;
    back?: () => void;
  } = $props();

  const shape = $derived(codeChannelShape(channel));
  const lockedOut = $derived(lockoutSeconds !== null);
  const complete = $derived(code.length === shape.length);
  const canSubmit = $derived(!pending && !lockedOut && complete);
</script>

<AuthPanel title="Enter Your Two-Factor Code" {back} backLabel="Sign In">
  {#snippet meta()}
    {sentTo ? `${shape.origin} to ${sentTo}` : shape.origin}, {codeShapeDescription(channel)}.
  {/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="two-factor-code">Two-Factor Code</Label>
        <VerificationCodeInput
          bind:inputRef={codeFieldReference}
          inputId="two-factor-code"
          bind:value={code}
          length={shape.length}
          charset={shape.charset}
          aria-invalid={rejected ? "true" : undefined}
          disabled={pending || lockedOut}
        />
      </div>

      <div class="flex items-center gap-8">
        <Checkbox
          id="two-factor-trust-device"
          bind:checked={trustDevice}
          disabled={pending || lockedOut}
        />
        <Label for="two-factor-trust-device">
          Don't ask for Two-Factor on this device for {TRUSTED_DEVICE_DAYS} days.
        </Label>
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Verifying…" : "Verify Code"}
      </Button>

      <CredentialNotice
        message={rejected ? shape.rejection : null}
        {attemptsRemaining}
        {lockoutSeconds}
        subject="this sign-in"
      />

      <div class="flex flex-wrap items-center justify-between gap-8">
        {#if onRecoveryCode}
          <button type="button" class={QUIET_LINK} onclick={onRecoveryCode}>
            Use a recovery code
          </button>
        {/if}
        <!--
          Every resend waits out a window with a VISIBLE countdown, uniformly: messages need time
          to arrive, and a send path that can be hammered is a send path that will be.
        -->
        {#if shape.resendable && onResend}
          <Button
            variant="secondary"
            size="sm"
            disabled={resendSecondsRemaining !== null || lockedOut}
            onclick={onResend}
          >
            {resendSecondsRemaining === null
              ? "Send New Code"
              : `New code available in ${resendSecondsRemaining}s`}
          </Button>
        {/if}
      </div>
    </form>
  {/snippet}
</AuthPanel>

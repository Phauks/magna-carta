<script lang="ts">
  /*
   * Confirm a registration — the screen the emailed token is spent on.
   *
   * IT READS A TOKEN OUT OF THE ADDRESS BAR AND DOES NOT SPEND IT. The field is filled from
   * `?token=`, and confirming stays a deliberate press. A token is single-use, and anything that
   * fetches a URL before a person reads it — a mail client's link preview, a security scanner, a
   * browser prefetch — would burn it and leave the owner staring at a link that says it has already
   * been used. One press costs a second and cannot be spent by a machine that never asked.
   *
   * The confirmation mail carries a link that lands here with the field filled, plus the bare code
   * for a mail client that will not open links. Both paths end at the same deliberate press; the
   * step's reach is declared in $lib/auth/joining-availability.ts under "confirm-registration".
   *
   * The firm is NOT built by the time this answers. Provisioning creates a bucket and mints a key,
   * which is not work an anonymous request does inline, so the route queues it and answers
   * "under way" — and the success screen says that rather than pretending a workspace is waiting.
   */
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { confirmRegistration } from "$lib/auth/joining-api.ts";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import ConfirmRegistrationScreen from "$lib/auth/screens/confirm-registration-screen.svelte";
  import {
    CONFIRMATION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
  } from "../joining-messages.ts";

  let token = $state(page.url.searchParams.get("token") ?? "");
  let pending = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let confirmedAddress = $state<string | null>(null);
  let confirmedAt = $state(new Date());

  let tokenFieldReference = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (confirmedAddress === null) tokenFieldReference?.focus();
  });

  async function confirm(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || token.trim() === "") return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await confirmRegistration(fetch, token);
    pending = false;
    if (outcome.kind !== "ok") {
      rejection = joiningErrorMessage(outcome, CONFIRMATION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      return;
    }
    confirmedAt = new Date();
    confirmedAddress = outcome.value.email;
  }
</script>

<svelte:head><title>Confirm your registration · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if confirmedAddress === null}
    <ConfirmRegistrationScreen
      bind:token
      bind:tokenFieldReference
      {pending}
      {rejection}
      {supportErrorId}
      onSubmit={confirm}
    />
  {:else}
    <CheckEmailScreen
      address={confirmedAddress}
      instruction="Your workspace is being built. We have sent a second email with the link that sets your password — open it once your workspace is ready."
      sentAt={confirmedAt}
      remedy="Building takes a moment. If the second email has not arrived after a few minutes, use Reset Password from the sign-in screen."
    />
  {/if}
</AuthFrame>

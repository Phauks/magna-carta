<script lang="ts">
  /*
   * Redeem an invitation — where both invited doors land, on one URL from the form to the mail.
   *
   * THE REFUSAL IS ONE SENTENCE AND THIS PAGE CHOOSES IT, not the server. The route already answers
   * every unsuccessful combination identically, because the invitation row holds one digest over the
   * code, the surname and the date of birth together and cannot tell them apart. Rendering a
   * constant of our own on top of that means the screen still says one thing even if the wording on
   * the other side of the wire ever changes — see ../joining-messages.ts.
   *
   * WHAT DOES VARY IS THE BUDGET, and it is shown, because it is a fact about how many attempts the
   * caller has left rather than about any invitation. The wording narrows as the count drops and the
   * lockout replaces it entirely, exactly as on the sign-in screens ($lib/auth/attempt-ladder.ts).
   */
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { redeemInvitation } from "$lib/auth/joining-api.ts";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import RedeemInvitationScreen from "$lib/auth/screens/redeem-invitation-screen.svelte";
  import { goto } from "$app/navigation";
  import {
    REDEMPTION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
    lockoutFrom,
  } from "../joining-messages.ts";

  let step = $state<"redeem" | "sent">("redeem");
  let code = $state("");
  let lastName = $state("");
  let dateOfBirth = $state("");
  let pending = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let attemptsRemaining = $state<number | null>(null);
  let lockoutSeconds = $state<number | null>(null);
  let redeemedAddress = $state("");
  let sentAt = $state(new Date());

  let codeFieldReference = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (step === "redeem") codeFieldReference?.focus();
  });

  async function redeem(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await redeemInvitation(fetch, {
      code: code.trim(),
      lastName: lastName.trim(),
      dateOfBirth,
    });
    pending = false;

    if (outcome.kind !== "ok") {
      /*
       * ONE message for the whole combination. There is deliberately no branch here on which field
       * might have been wrong, and there is nothing to branch on: the server holds one digest over
       * all three facts and so cannot say. If this ever feels like a missing kindness, that is the
       * design working — a form that could say "the code is right, check the date of birth" would
       * confirm to a stranger holding a forwarded code that a named person was invited to a named
       * firm, which for a law firm's client list is the confidential fact itself.
       */
      rejection = joiningErrorMessage(outcome, REDEMPTION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      attemptsRemaining =
        outcome.kind === "problem" ? (outcome.problem.attemptsRemaining ?? null) : null;
      lockoutSeconds = outcome.kind === "problem" ? lockoutFrom(outcome.problem) : null;
      return;
    }

    attemptsRemaining = null;
    lockoutSeconds = null;
    redeemedAddress = outcome.value.email;
    sentAt = new Date();
    step = "sent";
  }
</script>

<svelte:head><title>Redeem an invitation · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "redeem"}
    <RedeemInvitationScreen
      bind:code
      bind:lastName
      bind:dateOfBirth
      bind:codeFieldReference
      {pending}
      {rejection}
      {supportErrorId}
      {attemptsRemaining}
      {lockoutSeconds}
      onSubmit={redeem}
      backLabel="Sign In"
      back={() => goto("/login")}
    />
  {:else}
    <CheckEmailScreen
      address={redeemedAddress}
      instruction="Open the link we sent and choose a password. Then you can sign in."
      {sentAt}
      remedy="If it does not arrive, check the spam folder, then ask the firm that invited you to send a new invitation."
      back={() => goto("/login")}
    />
  {/if}
</AuthFrame>

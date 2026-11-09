<script lang="ts">
  /*
   * Start a new law firm — the SUPERSEDED founding door, all three of its steps on ONE URL.
   *
   * NOTHING LINKS HERE ANY MORE. Joining is account-first: /register makes a person, and founding a
   * firm happens afterwards from /welcome, signed in. This route stays reachable because a
   * confirmation token minted under the old flow lives for 24 hours and its owner may have this
   * page open or bookmarked — breaking a joining flow that works is worse than leaving an unlinked
   * one standing. It is removable once no such registration is outstanding.
   *
   * The steps are held in component state and the address bar never changes, the same posture the
   * sign-in surface takes: a /register/firm/details path would be bookmarkable and reloadable into
   * a half-filled state that has lost the firm's name, and a refresh returning to the first step is
   * the correct behaviour rather than a bug to work around.
   *
   * ONE CALL AT THE END. The route takes the person and the firm together
   * (apps/api-worker/src/http/routes/session/registrations.ts), so nothing is sent until the second step is
   * complete; the split between the two forms is a reading order, not a round trip.
   *
   * A TAKEN ADDRESS AND A FREE ONE ANSWER IDENTICALLY, and this page must keep it that way. The
   * server sends different MAIL in the two cases — to the address in question, which is a channel
   * the person filling this form does not necessarily control — and returns the same body either
   * way. There is nothing here to branch on, and adding a branch would be inventing the
   * account-existence oracle the route was built to deny.
   */
  import { goto } from "$app/navigation";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { startRegistration } from "$lib/auth/joining-api.ts";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import FoundFirmScreen from "$lib/auth/screens/found-firm-screen.svelte";
  import { MINIMUM_PASSWORD_LENGTH } from "$lib/auth/password-rule.ts";
  import RegisterDetailsScreen from "$lib/auth/screens/register-details-screen.svelte";
  import {
    REGISTRATION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
  } from "../joining-messages.ts";

  let step = $state<"firm" | "details" | "sent">("firm");
  let firmName = $state("");
  let firstName = $state("");
  let lastName = $state("");
  let email = $state("");
  let password = $state("");
  let agreedToTerms = $state(false);
  let agreedToPrivacy = $state(false);
  let pending = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let sentAt = $state(new Date());

  let firmNameFieldReference = $state<HTMLInputElement | null>(null);
  let firstNameFieldReference = $state<HTMLInputElement | null>(null);

  // Each step opens with focus in its own first field, so the keyboard never has to catch up.
  $effect(() => {
    if (step === "firm") firmNameFieldReference?.focus();
    else if (step === "details") firstNameFieldReference?.focus();
  });

  function continueToDetails(event: SubmitEvent): void {
    event.preventDefault();
    if (firmName.trim() === "") return;
    step = "details";
  }

  async function register(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await startRegistration(fetch, {
      role: "foundFirm",
      // One display name is what the registration row holds; the two fields exist because that is
      // how a person reads their own name back, not because the server stores them apart.
      name: `${firstName.trim()} ${lastName.trim()}`,
      email: email.trim(),
      // NOT trimmed — whitespace is part of a password (see the account door's note).
      password,
      firmName: firmName.trim(),
    });
    pending = false;
    if (outcome.kind !== "ok") {
      rejection = joiningErrorMessage(outcome, REGISTRATION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      return;
    }
    sentAt = new Date();
    step = "sent";
  }
</script>

<svelte:head><title>Start a new law firm · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "firm"}
    <FoundFirmScreen
      bind:firmName
      bind:firmNameFieldReference
      onContinue={continueToDetails}
      backLabel="Sign In"
      back={() => goto("/login")}
    />
  {:else if step === "details"}
    <RegisterDetailsScreen
      bind:firstName
      bind:lastName
      bind:email
      bind:password
      minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
      bind:agreedToTerms
      bind:agreedToPrivacy
      bind:firstNameFieldReference
      firmName={firmName.trim()}
      {pending}
      {rejection}
      {supportErrorId}
      onSubmit={register}
      back={() => {
        step = "firm";
        rejection = null;
        supportErrorId = null;
      }}
    />
  {:else}
    <CheckEmailScreen
      address={email.trim()}
      instruction="Open the link we sent, or type the confirmation code from that email. Your workspace is built once that is done."
      {sentAt}
      remedy="If it does not arrive, check the spam folder, then register again — a second registration replaces the first, and the newest code is the one that works."
      onEnterCode={() => goto("/register/confirm")}
      enterCodeLabel="Enter the Confirmation Code"
      back={() => goto("/login")}
    />
  {/if}
</AuthFrame>

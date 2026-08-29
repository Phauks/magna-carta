<script lang="ts">
  /*
   * Welcome — the dedicated signed-in screen that settles what an account IS.
   *
   * THIS IS THE SECOND HALF OF JOINING. Registration makes a person; this decides which firm they
   * belong to. Splitting the two is the whole reflow: the front door no longer asks a stranger to
   * classify themselves before anything about them exists.
   *
   * IT LIVES OUTSIDE THE (app) GROUP, deliberately. There is nothing to render around it — no
   * matters, no timer, no notifications, all of which are per-firm reads that a person with no firm
   * would only ever see fail. So it wears the same auth frame the sign-in and register screens wear,
   * and it is the one signed-in surface that does.
   *
   * EVERY STEP IS ONE URL. The choice, the firm's name, the wait and the redemption are held in
   * component state and the address bar never changes — the same posture the sign-in surface takes.
   * A /welcome/firm path would be bookmarkable into a half-filled state, and a reload returning to
   * the choice is correct rather than a bug to work around.
   *
   * THE WAIT IS POLLED FROM THE SERVER, never remembered here. The bootstrap says whether a firm is
   * building, so closing the tab and coming back lands wherever the work actually got to.
   */
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import {
    foundFirm,
    readBootstrap,
    redeemInvitationIntoAccount,
    type Bootstrap,
  } from "$lib/auth/joining-api.ts";
  import {
    forgetInvitationCode,
    pendingInvitationCode,
    rememberInvitationCode,
  } from "$lib/auth/pending-invitation.ts";
  import FirmBuildingScreen from "$lib/auth/screens/firm-building-screen.svelte";
  import FoundFirmScreen from "$lib/auth/screens/found-firm-screen.svelte";
  import JoiningChoiceScreen from "$lib/auth/screens/joining-choice-screen.svelte";
  import RedeemInvitationScreen from "$lib/auth/screens/redeem-invitation-screen.svelte";
  import {
    REDEMPTION_REFUSED,
    REGISTRATION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
    lockoutFrom,
  } from "../register/joining-messages.ts";

  let { data }: { data: { bootstrap: Bootstrap | null } } = $props();

  /*
   * Where the person is. `choose` unless something says otherwise: a firm already building puts
   * them on `building`, and a code they arrived with opens `redeem` — the two cases where landing
   * on a menu would make them re-choose something they have already chosen.
   */
  // Read once, on purpose: this is where the person STARTS, and a later bootstrap must not yank the
  // screen out from under somebody mid-form. `untrack` says that deliberately rather than leaving a
  // reactive read that only looks like an oversight.
  let step = $state<"choose" | "firm" | "building" | "redeem">(
    untrack(() =>
      data.bootstrap?.joining?.state === "firmProvisioning"
        ? "building"
        : pendingInvitationCode() !== null
          ? "redeem"
          : "choose",
    ),
  );

  let firmName = $state("");
  let code = $state(pendingInvitationCode() ?? "");
  let lastName = $state("");
  let dateOfBirth = $state("");
  let pending = $state(false);
  let checking = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let attemptsRemaining = $state<number | null>(null);
  let lockoutSeconds = $state<number | null>(null);

  let firmNameFieldReference = $state<HTMLInputElement | null>(null);
  let codeFieldReference = $state<HTMLInputElement | null>(null);

  // Each step opens with focus in its own first field, so the keyboard never has to catch up.
  $effect(() => {
    if (step === "firm") firmNameFieldReference?.focus();
    else if (step === "redeem") codeFieldReference?.focus();
  });

  // A code in the query string beats one already stashed — somebody who follows a second invitation
  // link means the second one.
  $effect(() => {
    const arriving = page.url.searchParams.get("invitation");
    if (arriving !== null && arriving.trim() !== "") {
      rememberInvitationCode(arriving);
      code = arriving.trim();
      step = "redeem";
    }
  });

  /*
   * THE POLL, and it only runs while a firm is building. Every four seconds is often enough that
   * the wait feels answered and rare enough that a forgotten tab is not a load profile. It stops
   * the moment the effect is torn down, which includes arriving.
   */
  $effect(() => {
    if (step !== "building") return;
    const timer = setInterval(() => void arrivedYet(), 4000);
    return () => clearInterval(timer);
  });

  /** Ask the bootstrap whether the firm has arrived, and go in when it has. */
  async function arrivedYet(): Promise<void> {
    if (checking) return;
    checking = true;
    const outcome = await readBootstrap(fetch);
    checking = false;
    if (outcome.kind !== "ok") return;
    if (outcome.value.firm !== null) {
      await goto("/home");
      return;
    }
    // A build that fell over leaves the server saying "choose" again, and this follows it rather
    // than stranding somebody on a waiting screen for work nothing is doing.
    if (outcome.value.joining?.state === "chooseFirm") step = "choose";
  }

  async function submitFirm(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || firmName.trim() === "") return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await foundFirm(fetch, firmName);
    pending = false;
    if (outcome.kind !== "ok") {
      rejection = joiningErrorMessage(outcome, REGISTRATION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      return;
    }
    step = "building";
    // Ask once immediately: a small firm can be built before the first poll would have fired.
    void arrivedYet();
  }

  async function submitRedemption(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await redeemInvitationIntoAccount(fetch, {
      code: code.trim(),
      lastName: lastName.trim(),
      dateOfBirth,
    });
    pending = false;

    if (outcome.kind !== "ok") {
      /*
       * ONE message for the whole combination, and deliberately no branch on which fact might have
       * been wrong — there is nothing to branch on. The server holds one digest over all three and
       * so cannot say, and a form that could say "the code is right, check the date of birth" would
       * confirm to a stranger holding a forwarded code that a named person was invited to a named
       * firm. The same sentence also covers an invitation addressed to somebody else's mailbox.
       */
      rejection = joiningErrorMessage(outcome, REDEMPTION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      attemptsRemaining =
        outcome.kind === "problem" ? (outcome.problem.attemptsRemaining ?? null) : null;
      lockoutSeconds = outcome.kind === "problem" ? lockoutFrom(outcome.problem) : null;
      return;
    }

    // Redeemed: the code has done its work and must not survive to be offered again.
    forgetInvitationCode();
    await goto("/home");
  }

  function backToChoice(): void {
    step = "choose";
    rejection = null;
    supportErrorId = null;
    attemptsRemaining = null;
    lockoutSeconds = null;
    // Offered and declined — a stashed code that keeps reopening the redemption step would take the
    // choice away from somebody who has decided to found a firm instead.
    forgetInvitationCode();
  }
</script>

<svelte:head><title>Welcome · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "choose"}
    <JoiningChoiceScreen
      name={data.bootstrap?.user.name}
      onFoundFirm={() => {
        step = "firm";
      }}
      onRedeemInvitation={() => {
        step = "redeem";
      }}
    />
  {:else if step === "firm"}
    <FoundFirmScreen
      bind:firmName
      bind:firmNameFieldReference
      {pending}
      {rejection}
      {supportErrorId}
      submitLabel="Start This Firm"
      backLabel="Back to your choices"
      onContinue={submitFirm}
      back={backToChoice}
    />
  {:else if step === "building"}
    <FirmBuildingScreen firmName={firmName.trim()} {checking} onCheckAgain={() => void arrivedYet()} />
  {:else}
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
      backLabel="Back to your choices"
      onSubmit={submitRedemption}
      back={backToChoice}
    />
  {/if}
</AuthFrame>

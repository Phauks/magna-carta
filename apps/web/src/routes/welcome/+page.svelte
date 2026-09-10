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
   *
   * AND THE WAIT RUNS ONE STEP PAST THE FIRM EXISTING. A firm becomes active in the control plane
   * before the member record mirroring its owner into the firm's OWN database has landed, and this
   * screen used to go in the moment the firm appeared — straight into a workspace where every screen
   * that checks a permission refuses, because there is nobody to check it against. So "ready" here
   * means the firm exists AND this account can use it, which is what the bootstrap's membership
   * state reports.
   */
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import {
    FIRM_BUILD_UNREPORTED,
    firmBuildComplete,
    firmBuildStalled,
    firmBuildSteps,
    firmBuiltReading,
    type FirmBuildReading,
    type JoinKind,
  } from "$lib/auth/firm-build-progress.ts";
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
      buildUnderWay(data.bootstrap)
        ? "building"
        : pendingInvitationCode() !== null
          ? "redeem"
          : "choose",
    ),
  );

  /*
   * Whether this bootstrap describes a workspace still being made. TWO SHAPES, one question: a firm
   * that does not exist yet reports it as a joining state, and a firm that exists but has not
   * finished admitting its owner reports it as a membership state. The second is invisible from the
   * first — the account HAS a firm by then — and it is the half that let somebody into a workspace
   * that refused them everything. An `unknown` membership is not counted: a read that did not answer
   * is not a verdict, and treating it as one would hold a working member on a waiting screen.
   */
  function buildUnderWay(bootstrap: Bootstrap | null | undefined): boolean {
    if (bootstrap === null || bootstrap === undefined) return false;
    if (bootstrap.firm === null) return bootstrap.joining?.state === "firmProvisioning";
    const membership = bootstrap.membership?.state;
    return membership === "provisioning" || membership === "stalled";
  }

  /**
   * The build a bootstrap describes, or null when it describes none. A firm that is already active
   * has every build step behind it by construction — activation is the last of them and commits as
   * one batch — so only the member record is still an open question there.
   */
  function readingFrom(bootstrap: Bootstrap | null | undefined): FirmBuildReading | null {
    if (bootstrap === null || bootstrap === undefined) return null;
    if (bootstrap.firm !== null) {
      const membership = bootstrap.membership?.state;
      return firmBuiltReading({
        // An ABSENT membership reads as landed, deliberately: a reply from a deployment older than
        // the field must not strand every member of every firm on a waiting screen.
        memberRecord: membership !== "provisioning" && membership !== "stalled",
        memberRecordStalled: membership === "stalled",
      });
    }
    const build = bootstrap.joining?.build;
    return build === undefined
      ? null
      : { ...build, memberRecord: false, memberRecordStalled: false };
  }

  /*
   * WHICH WAIT THIS IS, which decides how many steps there are to show. Somebody founding a firm
   * watches it being made; somebody redeeming an invitation into a firm that has existed for years
   * waits on the last step alone, and four ticks against work nobody did today would be filler.
   *
   * It is inferred from where the wait STARTED rather than from anything the server says, because
   * the server cannot tell the two apart once the firm exists: an active firm looks identical
   * whether it was made a minute ago or in 2019. A bootstrap that arrived with no firm is somebody
   * watching one being built; a bootstrap that arrived with one is somebody being let into it.
   */
  let joinKind = $state<JoinKind>(
    untrack(() => (data.bootstrap?.firm === null ? "founding" : "joining")),
  );

  /** How far the build has got, as the last answered poll reported it. */
  let building = $state<FirmBuildReading>(
    untrack(() => readingFrom(data.bootstrap) ?? FIRM_BUILD_UNREPORTED),
  );

  /*
   * When this browser started waiting, so the screen can admit a wait is running long. Wall-clock
   * from HERE rather than a fact from the server: somebody who reopened the page an hour later does
   * not need to be told their own wait has been long. Null until a wait is actually under way.
   */
  let waitingSince = $state<number | null>(null);
  let clock = $state(Date.now());

  /** Longer than a build normally takes. Not a timeout — nothing is abandoned, it is just said. */
  const SLOW_BUILD_MILLISECONDS = 45_000;

  const buildHasStalled = $derived(firmBuildStalled(building));
  const buildIsSlow = $derived(
    waitingSince !== null && !buildHasStalled && clock - waitingSince > SLOW_BUILD_MILLISECONDS,
  );

  let firmName = $state("");
  /*
   * The firm's own name once it exists, so somebody who signs in while the last step is still
   * landing sees what is being finished rather than an unnamed wait. `firmName` above is what THIS
   * browser typed, and it is empty for a person who founded the firm on another device or in an
   * earlier session — which is exactly who reaches this screen through the membership wait.
   */
  // `untrack` for the same reason `step` above takes it: this is where the screen STARTS, and a
  // later bootstrap reaches it through the poll rather than by re-reading the load's data.
  let builtFirmName = $state(untrack(() => data.bootstrap?.firm?.name ?? ""));
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
   *
   * The same tick advances the clock the "taking longer than usual" line reads, so the screen needs
   * one timer rather than two — and a wait can only become slow between polls that did not finish
   * it, which is exactly when this fires.
   */
  $effect(() => {
    if (step !== "building") return;
    waitingSince ??= Date.now();
    const timer = setInterval(() => {
      clock = Date.now();
      void arrivedYet();
    }, 4000);
    return () => clearInterval(timer);
  });

  /**
   * Ask the bootstrap where the build has got to, and go in once it is finished.
   *
   * FINISHED IS TWO FACTS, NOT ONE. The firm existing is the one this used to read, and it arrives
   * before the member record that makes the workspace usable — so going in on it alone dropped
   * somebody into an app where every screen refused. It now waits for both, and shows which of them
   * it is still waiting on.
   */
  async function arrivedYet(): Promise<void> {
    if (checking) return;
    checking = true;
    const outcome = await readBootstrap(fetch);
    checking = false;
    // A poll that did not answer is not news about the build: leave the sequence showing what the
    // last answered read said rather than resetting it to "nothing has happened yet".
    if (outcome.kind !== "ok") return;

    building = readingFrom(outcome.value) ?? building;
    builtFirmName = outcome.value.firm?.name ?? builtFirmName;
    if (firmBuildComplete(building)) {
      await goto("/home");
      return;
    }
    // A build that fell over leaves the server saying "choose" again, and this follows it rather
    // than stranding somebody on a waiting screen for work nothing is doing.
    if (outcome.value.firm === null && outcome.value.joining?.state === "chooseFirm") {
      step = "choose";
      waitingSince = null;
      building = FIRM_BUILD_UNREPORTED;
    }
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
    joinKind = "founding";
    building = FIRM_BUILD_UNREPORTED;
    waitingSince = Date.now();
    clock = waitingSince;
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

    // AND THE SAME LAST STEP APPLIES HERE. Redemption attaches the account to the firm in the
    // control plane and queues the member record that every permission resolves through; going
    // straight to /home would land on the app guard, which would send them back here anyway. So the
    // wait is entered directly, on its one relevant step.
    step = "building";
    joinKind = "joining";
    building = FIRM_BUILD_UNREPORTED;
    waitingSince = Date.now();
    clock = waitingSince;
    void arrivedYet();
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
      backLabel="Your Choices"
      onContinue={submitFirm}
      back={backToChoice}
    />
  {:else if step === "building"}
    <FirmBuildingScreen
      firmName={firmName.trim() === "" ? builtFirmName : firmName.trim()}
      kind={joinKind}
      steps={firmBuildSteps(building, joinKind)}
      slow={buildIsSlow}
      stalled={buildHasStalled}
      {checking}
      onCheckAgain={() => void arrivedYet()}
    />
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
      backLabel="Your Choices"
      onSubmit={submitRedemption}
      back={backToChoice}
    />
  {/if}
</AuthFrame>

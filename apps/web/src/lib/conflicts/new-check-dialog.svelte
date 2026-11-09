<script lang="ts">
  /*
   * New Check — the panel a conflicts check is asked for in.
   *
   * WHY IT IS A PANEL AND NOT A SCREEN (owner's direction, 2026-09-08). The conflicts destination
   * is the firm's LOG: what has been searched, when, by whom. Running a check is an act performed
   * over that log, and an act is asked for in the one panel the product asks acts in, reached from
   * the register's own create control.
   *
   * WHY IT HAS TWO PANES (owner's direction, same day). "Left would be general information, right
   * would be advanced and technical settings. Left side is the input. Right side is the engine
   * settings." So the panel takes the frame's context pane: the left pane holds the two things a
   * member always fills in — the parties, and where the check is filed — and the right pane holds
   * everything that tunes the search. One column put the parties and a bank of hop budgets on the
   * same footing, which is how a form comes to look like a control panel for something nobody can
   * name.
   *
   * IT DOES NOT ASK FOR A MATTER (owner's ruling, 2026-11-09). A check is a search for parties;
   * the matter it belongs to is chosen from its report once somebody knows it. Opened from a
   * matter's own section the check is that matter's, and the panel states it. Both panes bind to one
   * draft (check-draft.svelte.ts) and the request is composed from it in one place
   * (check-request.ts).
   *
   * IT NO LONGER ASKS WHICH TRIGGER TO FILE UNDER. Preliminary and comprehensive name WHEN a check
   * ran, not how it searched, and the record already knows: a check filed against a matter the firm
   * has taken on is comprehensive, and every other check is preliminary. The panel says which, in
   * the left pane's read-back, rather than asking a member to classify their own act.
   *
   * WHAT IT WRITES IS APPEND-ONLY, so the commit carries an idempotency key: a retried submit must
   * not leave the firm's record showing two searches where a member asked for one.
   *
   * PRESSING RUN OPENS THE CHECK; IT DOES NOT WAIT FOR THE SEARCH. The server draws the check's
   * number, queues the first run and answers at once, and the panel hands the surface the check's
   * handle so the reader lands on the check's own screen and watches the run there. The number the
   * check will draw is previewed on the panel, so a member can quote it before pressing anything.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import { PreviewedNumber } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import CheckScope from "./check-scope.svelte";
  import CheckSubject from "./check-subject.svelte";
  import { CheckDraft } from "./check-draft.svelte.ts";
  import { composeCheck, type CheckSurface } from "./check-request.ts";
  import { openConflictsCheck, readNextConflictsCheckNumber } from "./conflicts-api.ts";

  let {
    open = $bindable(false),
    matterId = null,
    matterLabel = null,
    matterEngaged = false,
    permissions = null,
    onRan,
  }: {
    /** The matter this check is filed under, where the surface already knows it. */
    matterId?: string | null;
    open?: boolean;
    /** How that matter reads, so the panel states what the check is filed against. */
    matterLabel?: string | null;
    /**
     * Whether the firm has taken that matter on — it carries a matter number rather than only a
     * consultation number. It is what decides the trigger, and nothing else.
     */
    matterEngaged?: boolean;
    /** The signed-in member's permissions; null until the session lands. */
    permissions?: readonly string[] | null;
    /** The check was opened and its first run queued. Where that leads belongs to the surface. */
    onRan: (checkId: string) => void;
  } = $props();

  /*
   * A draft per opening. A panel reopened after a run must not still be holding the last run's
   * parties, and a fresh draft is the whole reset — there is no second copy of the opening values
   * for a hand-written one to drift from.
   */
  let draft = $state(new CheckDraft());

  let failure = $state<StatedFailure | null>(null);
  /** The number the next check would draw. A preview, never a reservation: two panels may show it. */
  /*
   * The number this check will be filed under, said before it exists. Held by the shared seam, so
   * the wording, the guard against a stale read landing on a newer one, and the reset are the ones
   * every panel that previews a number uses.
   */
  const previewed = new PreviewedNumber("Check");

  // The number is read on EVERY opening: a check opened from another panel in between draws it.
  $effect(() => {
    if (!open) {
      previewed.clear();
      return;
    }
    void previewed.read(async () => {
      const outcome = await readNextConflictsCheckNumber(fetch);
      return outcome.kind === "ok" ? outcome.value.checkNumber : null;
    });
  });

  /** The matter the check is filed under: the surface's own, where it was opened from one. */
  const surface: CheckSurface = $derived({ matterId, matterEngaged, permissions });

  const composed = $derived(composeCheck(draft, surface));

  function reset(): void {
    draft = new CheckDraft();
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const asked = composed.request;
    if (asked === null) return "refused";
    failure = null;
    // A retried submit must not open a second check under a second number.
    const outcome = await openConflictsCheck(fetch, asked, crypto.randomUUID());
    if (outcome.kind === "ok") {
      onRan(outcome.value.id);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The check was refused.",
      // Nothing answered is the stronger statement, and the one somebody about to press again
      // needs: no search ran, so nothing was written to the log.
      "The check could not be sent. Nothing was recorded.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Check"
  subtitle={{ reference: previewed.reference }}
  commitLabel="Run Check"
  commitBusyLabel="Opening"
  commitRefusal={composed.refusal ?? undefined}
  unsavedChanges={composed.started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Check Did Not Run"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <CheckSubject {draft} {matterLabel} {busy} />
  {/snippet}

  {#snippet context({ busy }: { busy: boolean })}
    <CheckScope {draft} {busy} />
  {/snippet}
</ActionDialog>

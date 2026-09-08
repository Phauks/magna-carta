<script lang="ts">
  /*
   * New Check — the panel a conflicts check is asked for in.
   *
   * WHY IT IS A PANEL AND NOT A SCREEN (owner's direction, 2026-09-08). The conflicts destination
   * is the firm's LOG: what has been searched, when, by whom. Running a check is an act performed
   * over that log, and an act is asked for in the one panel the product asks acts in, reached from
   * the register's own create control. Before this, the composer sat permanently above the log on
   * the firm-wide screen and permanently below the standing inside a matter, so the thing a reader
   * came for was pushed down the page by a form almost nobody was filling in that visit.
   *
   * THE SAME PANEL FROM BOTH DOORS. Opened from the firm's log it asks which matter, if any; opened
   * from a matter it states the matter and asks nothing about it. Everything else is identical by
   * construction, because it is the same form (check-form.svelte) either way.
   *
   * A CHECK MAY NAME NO MATTER AT ALL, and the field says so rather than being required. The
   * pre-engagement screen — parties named on the phone, before a file exists — is the case the
   * whole preliminary trigger exists for, and demanding a matter would make the platform's own
   * earliest check the one it refused to record.
   *
   * WHAT IT WRITES IS APPEND-ONLY, so the commit carries an idempotency key: a retried submit must
   * not leave the firm's record showing two searches where a member asked for one.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import CheckForm from "./check-form.svelte";
  import {
    runConflictsCheck,
    type ConflictsTrigger,
    type RunCheckRequest,
  } from "./conflicts-api.ts";
  import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";

  let {
    open = $bindable(false),
    matterId = null,
    matterLabel = null,
    chooseMatter = false,
    permissions = null,
    defaultTrigger = "comprehensive",
    onRan,
  }: {
    /** The matter this check is for, where the surface already knows it. */
    matterId?: string | null;
    open?: boolean;
    /** How that matter reads, so the panel states what it is checking against. */
    matterLabel?: string | null;
    /** Whether the panel asks which matter. The firm-wide log does; a matter's own section cannot. */
    chooseMatter?: boolean;
    /** The signed-in member's permissions; null until the session lands. */
    permissions?: readonly string[] | null;
    defaultTrigger?: ConflictsTrigger;
    /** The check was written. Where that leads belongs to the surface. */
    onRan: (checkId: string) => void;
  } = $props();

  /*
   * Bumped on every opening, and keyed on below. A panel reopened after a run must not still be
   * holding the last run's parties: remounting the form is the whole reset, so there is no second
   * copy of the opening values for a hand-written one to drift from.
   */
  let opening = $state(0);

  let matters = $state<readonly MatterSummary[]>([]);
  let matterQuery = $state("");
  let settledMatterQuery = $state("");
  let chosenMatter = $state<MatterSummary | null>(null);

  let refusal = $state<string | null>(null);
  let request = $state<RunCheckRequest | null>(null);
  let started = $state(false);
  let failure = $state<StatedFailure | null>(null);

  /** The matter the check runs against: the surface's, or the one chosen here. */
  const runsAgainstId = $derived(matterId ?? chosenMatter?.id ?? null);
  const runsAgainstLabel = $derived(
    matterLabel ?? (chosenMatter === null ? null : matterLine(chosenMatter)),
  );

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the firm's own search over title, number and client is the authoritative one.
  $effect(() => {
    const typed = matterQuery;
    const timer = setTimeout(() => (settledMatterQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!open || !chooseMatter) return;
    const asked = settledMatterQuery.trim();
    let live = true;
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      if (!live) return;
      // A docket that cannot be read leaves the picker empty; the check itself does not need one.
      matters = outcome.kind === "ok" ? outcome.value.data : [];
    })();
    return () => {
      live = false;
    };
  });

  /**
   * How a matter reads in the picker and back on the form: its number where it has one. A
   * consultation's tentative number counts — running a check against one is the whole point of
   * taking the consultation, and the number is what the result will be filed under.
   */
  function matterLine(matter: MatterSummary): string {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  }

  function recordMatter(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    chosenMatter = matters.find((matter) => matter.id === id) ?? null;
  }

  function reset(): void {
    opening += 1;
    matterQuery = "";
    settledMatterQuery = "";
    chosenMatter = null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const asked = request;
    if (asked === null) return "refused";
    failure = null;
    // A retried submit must not write a second check into the firm's append-only log.
    const outcome = await runConflictsCheck(fetch, asked, crypto.randomUUID());
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
  subtitle="A conflicts check searches the firm's own record and writes what it searched into the log. It is not a verdict; what it surfaces is answered by a reviewer, one candidate at a time."
  commitLabel="Run Check"
  commitBusyLabel="Running"
  commitRefusal={refusal ?? undefined}
  width="wide"
  unsavedChanges={started || chosenMatter !== null}
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
    {#key opening}
      <div class="flex flex-col gap-24">
        <section class="flex flex-col gap-16">
          <FieldLabel as="h4">The Matter</FieldLabel>
          {#if chooseMatter}
            <div class="flex flex-col gap-8">
              <Label for="conflicts-check-matter">Matter</Label>
              <Combobox.Root
                type="single"
                items={matters.map((matter) => ({
                  value: matter.id,
                  label: matterLine(matter),
                }))}
                inputValue={matterQuery}
                onValueChange={recordMatter}
                disabled={busy}
              >
                <Combobox.Input
                  id="conflicts-check-matter"
                  placeholder="Matter"
                  autocomplete="off"
                  oninput={(event) => (matterQuery = event.currentTarget.value)}
                />
                <Combobox.Content>
                  {#each matters as matter (matter.id)}
                    <Combobox.Item value={matter.id} label={matterLine(matter)}>
                      {matterLine(matter)}
                    </Combobox.Item>
                  {/each}
                </Combobox.Content>
              </Combobox.Root>
              <!-- The consequence of leaving it empty, which is a real choice rather than an
                   omission: the firm's members have no matter parties to be joined against, so
                   imputation records unavailable instead of searched. -->
              <p class="text-xs text-text-muted">
                A check may name no matter. Without one the imputation class has nothing to join
                the firm's members against, and the check records it as unavailable.
              </p>
            </div>
          {:else if runsAgainstLabel !== null}
            <p class="text-sm">{runsAgainstLabel}</p>
          {/if}
        </section>

        <Separator />

        <CheckForm
          matterId={runsAgainstId}
          {permissions}
          {defaultTrigger}
          {busy}
          bind:refusal
          bind:request
          bind:started
        />
      </div>
    {/key}
  {/snippet}
</ActionDialog>

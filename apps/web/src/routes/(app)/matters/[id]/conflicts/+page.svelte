<script lang="ts">
  /*
   * The matter's conflicts section: whether this file was checked, what the check found, and who
   * answered each thing it surfaced.
   *
   * WHY THIS IS A SECTION OF ITS OWN, BESIDE INTAKE RATHER THAN INSIDE IT (owner's ruling,
   * 2026-09-07). Running a check is not one of the intake procedure's steps — it is the act a step
   * ASKS ABOUT, and the record it writes outlives the intake that prompted it. The two are separate
   * destinations in the global sidebar for the same reason they are separate here.
   *
   * WHAT A READER WANTS FROM IT CHANGES ONCE, EARLY. A check is run at the front of a file, and
   * after that the question is almost never "check again" — it is "was this checked, and what did
   * it say", asked months later by somebody assembling an answer for a court. So the standing
   * leads and the runner sits below it: the record is the destination, running is the exception.
   *
   * THE HEADER CARRIES THE RUN CONTROL, NOT THIS PAGE. New Check is the matter header's one create
   * control, claimed here while this section is mounted, and it opens the same panel the firm's own
   * conflicts log opens rather than firing a search from a press — a check is a
   * professional-responsibility act and choosing its scope is part of it. Re-check now is a
   * DIFFERENT act and keeps its own control inside the standing panel: it takes no scope, because
   * what runs is the firm's own floor.
   *
   * A SAMPLE MATTER HAS NO FIRM BEHIND IT, so it has no log to read and nothing to record against.
   * It says so rather than showing a matter that has never been checked, which is a different fact
   * and a far more alarming one.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { goto } from "$app/navigation";
  import NewCheckDialog from "$lib/conflicts/new-check-dialog.svelte";
  import PosturePanel from "$lib/conflicts/posture-panel.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import {
    readMatterConflictsPosture,
    recheckMatterConflicts,
    READ_CONFLICTS_PERMISSION,
    RUN_CHECK_PERMISSION,
    type MatterConflictsPosture,
  } from "$lib/conflicts/conflicts-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const matterId = $derived(matter.id);
  const isSample = $derived(matter.source === "sample");

  let posture = $state<MatterConflictsPosture | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);
  let session = $state<SessionBootstrap | null>(null);
  let rechecking = $state(false);

  const permissions = $derived(session?.permissions ?? null);
  const mayRead = $derived(permissions === null || permissions.includes(READ_CONFLICTS_PERMISSION));
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));
  const RUN_REFUSAL = permissionRefusal("Running a conflicts check", RUN_CHECK_PERMISSION);

  /**
   * How this matter reads on the check form: its number where it has one. A consultation's
   * tentative number counts — running a check against one is the whole point of taking the
   * consultation, and the number is what the result will be filed under.
   */
  const matterLabel = $derived.by(() => {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  });

  /*
   * The header's New Check. It opens the composer rather than running anything: the scope a check
   * runs under is a choice on the record, and a create control that searched on one press would
   * make that choice silently on the reader's behalf.
   */
  let composerOpen = $state(false);

  claimMatterCreate("conflicts", () => ({
    title: "Run a conflicts check for this matter. It writes a new entry in the firm's log.",
    refusal: isSample ? SAMPLE_MATTER_REFUSAL : !mayRun ? RUN_REFUSAL : undefined,
    run: () => (composerOpen = true),
  }));

  async function read(): Promise<void> {
    loading = true;
    const outcome = await readMatterConflictsPosture(fetch, matterId);
    loading = false;
    if (outcome.kind === "ok") {
      posture = outcome.value;
      failure = null;
      return;
    }
    posture = null;
    failure = stated(
      outcome.failure,
      "This matter's conflicts standing could not be read.",
      "This matter's conflicts standing could not be reached.",
    );
  }

  /*
   * A re-check is a WRITE against the append-only log, so it takes an idempotency key like every
   * other one: a double-press must not leave the firm's record showing two searches where a member
   * asked for one.
   */
  async function recheckNow(): Promise<void> {
    if (rechecking) return;
    rechecking = true;
    const outcome = await recheckMatterConflicts(fetch, matterId, crypto.randomUUID());
    rechecking = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The re-check could not be started.");
      return;
    }
    // Straight to the run, which the check's screen shows as it goes, rather than back to a panel
    // the reader would have to re-read to learn anything. The run is named so the screen opens on
    // this run rather than on whichever the check ran last.
    await goto(
      `/conflicts/checks/${outcome.value.id}?run=${encodeURIComponent(outcome.value.runId)}`,
    );
  }

  $effect(() => {
    const asked = matterId;
    if (asked === "" || isSample) {
      loading = false;
      return;
    }
    void read();
    void firmRoster.load(fetch);
  });

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  /*
   * A deep link into this section names ONE check — the matter's Activity chronology and its search
   * both hand a section `?entry={rowId}`, and here that row is a conflicts check. A check opens as
   * its own record, so the link is honoured by going there rather than by landing the reader on the
   * standing and leaving them to find the check again (entry-from-url.ts states the obligation).
   *
   * It REPLACES this address rather than stacking on it, so Back returns to wherever the reader
   * came from instead of bouncing them through a section that immediately leaves again.
   */
  $effect(() => {
    const asked = entryFromUrl();
    if (asked === null) return;
    void goto(`/conflicts/checks/${encodeURIComponent(asked)}`, { replaceState: true });
  });

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );

  /*
   * The one line under the section's name: what the record says at a glance, so "was this checked"
   * is answered before anything is opened. It never concludes — a count of candidates nobody has
   * answered is a count, and the word "clear" appears nowhere on this surface.
   */
  const summary = $derived.by(() => {
    if (posture === null) return "";
    const latest = posture.latestCheck;
    if (latest === null) return "A conflicts check has not been run for this matter.";
    const open = posture.undisposedByTier.reduce((total, entry) => total + entry.count, 0);
    return open === 0
      ? "Every candidate the last check surfaced has been answered."
      : `${open} ${open === 1 ? "candidate is" : "candidates are"} waiting for an answer.`;
  });
</script>

<svelte:head>
  <title>Conflicts · {matter.title} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-4 border-b border-border-strong pb-8">
    <FieldLabel as="h2">Conflicts</FieldLabel>
    {#if summary !== ""}
      <p class="text-sm text-text-muted">{summary}</p>
    {/if}
  </div>

  {#if isSample}
    <EmptyState title="A sample matter has no check record">
      This matter is one of the in-repo samples and has no firm behind it, so there is no log to
      read and nothing a check could be recorded against.
    </EmptyState>
  {:else}
    {#if session !== null && !mayRead}
      <Alert.Root variant="info">
        <Alert.Title>Reading Conflicts Is Not Available To This Account</Alert.Title>
        <Alert.Description>
          {permissionRefusal("Reading a matter's conflicts standing", READ_CONFLICTS_PERMISSION)}
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Standing Could Not Be Read"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
        onRetry={() => void read()}
      />
    {:else}
      <div class="flex max-w-3xl flex-col gap-24">
        <PosturePanel
          {posture}
          {loading}
          {memberNames}
          onRetry={() => void read()}
          checkHref={(checkId) => `/conflicts/checks/${checkId}`}
        >
          {#snippet recheckAction()}
            <!-- Asking for a re-check now. It takes no scope: the firm's own floor is what runs,
                 which is why this is one button rather than a form. -->
            <Button
              variant="secondary"
              size="sm"
              disabled={!mayRun || rechecking}
              title={mayRun ? undefined : RUN_REFUSAL}
              onclick={() => void recheckNow()}
            >
              <RefreshCw class="size-16" aria-hidden="true" />
              {rechecking ? "Re-checking" : "Re-check now"}
            </Button>
          {/snippet}
        </PosturePanel>
      </div>
    {/if}
  {/if}
</div>

<!-- The same panel the firm's conflicts log opens, with this matter already named: one form, two
     doors. A sample matter has no firm behind it, so the header's control refuses before this. -->
<NewCheckDialog
  bind:open={composerOpen}
  {matterId}
  {matterLabel}
  matterEngaged={matter.matterNumber !== null}
  {permissions}
  onRan={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
/>

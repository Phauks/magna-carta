<script lang="ts">
  /*
   * Making a set's exhibit package: the list, then a cover sheet and the pages of each exhibit
   * still in the set, as one PDF saved to the matter's files. Bates numbers are on by default, in
   * the bottom right, and come from one of the matter's Bates logs: the log named after the set if
   * there is one, otherwise a new log named after the set, because a set is usually one filing.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listBatesLogs,
    resolveBatesLog,
    type BatesLogChoice,
    type BatesLogSummary,
  } from "$lib/bates/bates-api.ts";
  import BatesLogPicker, { newLogProblems, openingChoice } from "$lib/bates/bates-log-picker.svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import { makeExhibitPackage, type PackageContext, type PackageOutcome } from "./exhibit-package.ts";

  let {
    open = $bindable(false),
    context,
    onMade,
  }: {
    open?: boolean;
    context: PackageContext;
    onMade: (outcome: PackageOutcome) => void;
  } = $props();

  let stamp = $state(true);
  let logs = $state<readonly BatesLogSummary[]>([]);
  let choice = $state<BatesLogChoice>(openingChoice([], null, ""));
  let failure = $state<StatedFailure | null>(null);
  let failedMessage = $state<string | null>(null);
  let progress = $state<string | null>(null);

  function reset(): void {
    stamp = true;
    failure = null;
    failedMessage = null;
    progress = null;
    logs = [];
    choice = openingChoice([], context.set.name, context.set.name);
    void listBatesLogs(fetch, context.matterId).then((outcome) => {
      if (outcome.kind !== "ok") return;
      logs = outcome.value;
      choice = openingChoice(outcome.value, context.set.name, context.set.name);
    });
  }

  const included = $derived(context.set.members.filter((member) => member.status === "active").length);
  const refusal = $derived.by((): string | undefined => {
    if (included === 0) return "The set has no exhibits to put in a package.";
    if (stamp && Object.keys(newLogProblems(choice, logs)).length > 0) {
      return "Give the new Bates log a name no other log on this matter has.";
    }
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    failedMessage = null;
    let bates = null;
    if (stamp) {
      const log = await resolveBatesLog(fetch, context.matterId, choice);
      if (log.kind !== "ok") {
        failure = stated(
          log.failure,
          "The Bates log couldn't be started.",
          "Couldn't connect, so nothing was made.",
        );
        return "refused";
      }
      bates = { logId: log.value.id, prefix: log.value.prefix, digits: log.value.digits };
      if (choice.kind === "new") {
        // Started now, so a second try uses it rather than asking to start it again.
        const started = { ...log.value, nextNumber: 1, rangeCount: 0, pagesStamped: 0, lastStampedAt: null, createdAt: new Date().toISOString() };
        logs = [started, ...logs];
        choice = { kind: "log", log: started };
      }
    }
    progress = "Reading the exhibits and making the package";
    const outcome = await makeExhibitPackage(context, bates);
    progress = null;
    if (outcome.kind === "refused") {
      failure = outcome.failure;
      return "refused";
    }
    if (outcome.kind === "failed") {
      failedMessage = outcome.message;
      return "refused";
    }
    onMade(outcome);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Exhibit Package"
  commitLabel="Save Package"
  commitBusyLabel="Making"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={false}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Made"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {:else if failedMessage !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Was Made</Alert.Title>
        <Alert.Description>{failedMessage}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="text-sm">
        One PDF: the exhibit list, then a cover sheet and the pages of each of the {included}
        {included === 1 ? "exhibit" : "exhibits"} in the set. Withdrawn exhibits are on the list but
        not in the package. It is saved to this matter's files.
      </p>
      <div class="flex items-center gap-8">
        <Checkbox
          id="exhibit-package-bates"
          disabled={busy}
          checked={stamp}
          onCheckedChange={(on) => (stamp = on)}
        />
        <Label for="exhibit-package-bates">Stamp Bates Numbers</Label>
      </div>
      {#if stamp}
        <BatesLogPicker {logs} bind:choice disabled={busy} />
        <p class="text-xs text-text-muted">
          Every page is numbered in the bottom right, carrying on in the log. The list shows where each
          exhibit's pages fall.
        </p>
      {/if}
      {#if progress !== null}
        <p class="text-sm text-text-muted" aria-live="polite">{progress}</p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

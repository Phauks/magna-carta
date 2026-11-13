<script lang="ts">
  /*
   * The issue-report dialog ("Report an Issue" — owner-renamed from "Report a bug") — reachable
   * from the profile menu on EVERY screen (owner ask 2026-07-02: report from any location). The
   * user describes what happened; the dialog assembles that description plus the same trace every
   * other failure surface copies ($lib/diagnostics/failure-trace.ts — build identity, route,
   * environment and the breadcrumb ring, with no failing call because nobody's call provoked this
   * one) into one paste-ready block behind the Copy action.
   *
   * SUBMISSION IS WIRED. It files through the firm's own pipeline, the same one the failure screens
   * use. It was Soon-marked for a long time on the belief that the platform had no report-ingest
   * endpoint; it had one, and two area dialogs were already posting to it — this dialog is the
   * always-available door the standard asks for, so during an incident a member does not have to
   * find a broken panel in costs or billing before they can tell anybody.
   *
   * Still Soon: the optional in-office recipients and the email-me-a-copy flag. Those are not the
   * ingest — the incident route carries no recipients — so they stay honestly marked, and the copy
   * block still records them so a pasted report tells the administrator who else was meant to know.
   *
   * COPY SITS BESIDE WHAT IT COPIES. The action bar is the shell's and holds the one commit; the
   * copy is a second act, so it sits in the body beside the diagnostics it copies rather than in
   * the bar as a third control.
   *
   * A filed report is a DONE panel: it stays open to show the reference, with nothing left to
   * ask, and leaves through Close. The draft survives an ordinary close/reopen on purpose — an
   * accidental dismiss must not eat a half-written report — which is why the shell is told there
   * is nothing to lose: nothing is.
   *
   * The profile menu owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import { page } from "$app/state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import Switch from "@magna-carta/design-system/switch";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import * as Alert from "@magna-carta/design-system/alert";
  import { copyText } from "@magna-carta/design-system/failure-details";
  import RecipientPicker from "$lib/components/recipient-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { currentTrace } from "$lib/diagnostics/current-trace.ts";
  import { reportProblem } from "$lib/diagnostics/report.ts";

  let {
    open = $bindable(false),
    deployment = null,
  }: {
    open?: boolean;
    /**
     * What the deployment was doing, from a surface that knew. The Build Information panel opens
     * this dialog with its whole diagnosis — the fleet's builds, the firm's database, the upload
     * preconditions — so a report filed during an incident carries the state of the platform and
     * not only the reporter's words. Null everywhere else, which is every other trigger.
     */
    deployment?: string | null;
  } = $props();

  let description = $state("");
  let diagnosticsExpanded = $state(false);
  let copied = $state<"copied" | "failed" | null>(null);
  let sendFailure = $state<StatedFailure | null>(null);
  let filedIdentifier = $state<string | null>(null);

  // OPTIONAL in-office recipients (any colleague — the whole roster, not a permission slice)
  // and the email-me-a-copy flag. Zero recipients is fine: the report still files to the
  // platform; telling colleagues is a courtesy, not a requirement.
  let alsoSendToIds = $state<string[]>([]);
  let emailMeCopy = $state(false);
  // The firm's own colleagues, read once and shared with every other composer. Only the people who
  // are still here: a report is addressed to somebody who can read it. The read is asked for when
  // the dialog first opens rather than on page load — nothing on a screen needs the roster until
  // somebody reaches for the report.
  const members = $derived(firmRoster.active);
  $effect(() => {
    if (open) void firmRoster.load(fetch);
  });

  /*
   * A filed report is finished: reopening starts a fresh one. An unfiled draft is kept — see the
   * head of this file — so the reset is only ever of a report that has already gone.
   */
  function startAfresh(): void {
    sendFailure = null;
    if (filedIdentifier === null) return;
    filedIdentifier = null;
    description = "";
    alsoSendToIds = [];
    emailMeCopy = false;
  }

  function addRecipient(id: string): void {
    if (!alsoSendToIds.includes(id)) alsoSendToIds = [...alsoSendToIds, id];
  }

  function removeRecipient(id: string): void {
    alsoSendToIds = alsoSendToIds.filter((candidate) => candidate !== id);
  }

  // Snapshotted when the dialog opens (guarded on `open`, so it recomputes per open and never
  // touches `navigator` before the dialog is ever shown): the time and route pin the moment the
  // user reached for the report, not the moment the page loaded. `null` for the failure, because
  // nobody's call provoked this — the trace says so rather than inventing a request line.
  const trace = $derived(open ? currentTrace(null, page.url.pathname) : "");
  // The deployment's own account of itself, beneath the trace rather than folded into it: the two
  // are separate documents in one paste, and they share a line grammar
  // ($lib/diagnostics/diagnostic-report.ts) so the join reads as one report and not as two formats
  // stapled together.
  const diagnostics = $derived(
    deployment === null || !open ? trace : [trace, "", deployment].join("\n"),
  );

  const descriptionEmpty = $derived(description.trim().length === 0);

  async function copyReport(): Promise<void> {
    const report = ["Magna Carta — bug report", "", description.trim(), "", diagnostics].join("\n");
    copied = await copyText(report);
    setTimeout(() => (copied = null), copied === "copied" ? 2000 : 6000);
  }

  /** File the report through the firm's own pipeline — the same one the failure screens use. */
  async function submitReport(): Promise<ActionOutcome> {
    if (descriptionEmpty) return "refused";
    sendFailure = null;
    const outcome = await reportProblem(fetch, {
      description: description.trim(),
      // Nothing here was a caught failure, so there is no platform handle to correlate it to.
      errorIds: [],
      route: page.url.pathname,
      ...(deployment === null ? {} : { deployment }),
    });
    if (outcome.kind === "ok") {
      filedIdentifier = outcome.value.id;
      return "done";
    }
    sendFailure = stated(
      outcome.failure,
      "The report wasn't sent. Copy it and send it yourself.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Report an Issue"
  commitLabel="Submit Issue"
  commitBusyLabel="Submitting"
  commitRefusal={descriptionEmpty
    ? "Say what happened: the report is read by a person, and the diagnostics alone say nothing about what went wrong."
    : undefined}
  unsavedChanges={false}
  onOpen={startAfresh}
  onCommit={submitReport}
>
  {#snippet fields({ busy, done })}
    {#if done && filedIdentifier !== null}
      <Alert.Root variant="success">
        <Alert.Title>Report Filed</Alert.Title>
        <Alert.Description>
          It was recorded as {filedIdentifier}. Quoting that reference gets support to it directly.
        </Alert.Description>
      </Alert.Root>
    {:else}
      <p class="text-xs text-text-muted">
        This goes to the firm's own reporting pipeline, not to a third party.
      </p>

      <LabelledField
        label="What happened?"
        hint="What you did, what you expected, what happened instead"
      >
        {#snippet children({ props })}
          <Textarea {...props} required disabled={busy} bind:value={description} />
        {/snippet}
      </LabelledField>

      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-8">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={diagnosticsExpanded}
            aria-controls="bug-report-diagnostics"
            onclick={() => (diagnosticsExpanded = !diagnosticsExpanded)}
          >
            {#if diagnosticsExpanded}
              <ChevronDown class="size-16" aria-hidden="true" />
            {:else}
              <ChevronRight class="size-16" aria-hidden="true" />
            {/if}
            Included diagnostics
          </Button>
          <!-- Disabled while the description is empty: a report with no words is read by a person
               who has nothing to go on. -->
          <Button variant="secondary" size="sm" disabled={descriptionEmpty || busy} onclick={copyReport}>
            {#if copied === "copied"}
              <Check class="size-16" aria-hidden="true" />
              Copied
            {:else}
              <Copy class="size-16" aria-hidden="true" />
              Copy report
            {/if}
          </Button>
        </div>
        {#if diagnosticsExpanded}
          <pre
            id="bug-report-diagnostics"
            class="rounded-md border border-border-default bg-surface-sunken p-12 text-start font-mono text-xs whitespace-pre-wrap text-text-muted select-all">{diagnostics}</pre>
        {/if}
        {#if copied === "failed"}
          <p class="text-xs text-text-muted">
            Your browser would not let us copy. Select the diagnostics above and copy them by hand.
          </p>
        {/if}
      </div>

      <LabelledField
        label="Also Send To"
        hint="Optional — colleagues who should see this report; they ride the filed report once it carries recipients"
      >
        {#snippet children({ props })}
          <RecipientPicker
            {members}
            selectedIds={alsoSendToIds}
            onAdd={addRecipient}
            onRemove={removeRecipient}
            inputId={props.id}
          />
        {/snippet}
      </LabelledField>
      <!-- The roster is a courtesy field, so a failed read never fails the dialog: the picker is
           simply empty and says why, and the report still files. -->
      {#if firmRoster.failure !== null}
        <p class="text-xs text-text-muted">{firmRoster.failure}</p>
      {/if}

      <div class="flex items-center justify-between gap-16">
        <div class="flex min-w-0 flex-col gap-4">
          <Label for="issue-report-email-me">Email Me a Copy</Label>
          <!-- Not part of the filing, which is wired: emailing rides the platform's transactional
               email, which does not exist yet. -->
          <p class="text-xs text-text-muted">Sends with the report once email delivery ships</p>
        </div>
        <Switch id="issue-report-email-me" disabled={busy} bind:checked={emailMeCopy} />
      </div>

      <p class="text-xs text-text-muted">
        No document, file name, client name or matter content leaves the firm.
      </p>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if sendFailure !== null}
      <FailureNotice
        failure={sendFailure.failure}
        title="Not Sent"
        fallback={sendFailure.fallback}
      />
    {/if}
  {/snippet}
</ActionDialog>

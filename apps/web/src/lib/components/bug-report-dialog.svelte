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
   * The profile menu owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import { page } from "$app/state";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
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

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // The draft survives close/reopen on purpose: an accidental dismiss must not eat a
  // half-written report.
  let description = $state("");
  let diagnosticsExpanded = $state(false);
  let copied = $state<"copied" | "failed" | null>(null);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let sending = $state(false);
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
  const diagnostics = $derived(open ? currentTrace(null, page.url.pathname) : "");

  const descriptionEmpty = $derived(description.trim().length === 0);

  async function copyReport(): Promise<void> {
    const report = ["Magna Carta — bug report", "", description.trim(), "", diagnostics].join("\n");
    copied = await copyText(report);
    setTimeout(() => (copied = null), copied === "copied" ? 2000 : 6000);
  }

  /** File the report through the firm's own pipeline — the same one the failure screens use. */
  async function submitReport(): Promise<void> {
    if (descriptionEmpty || sending) return;
    sending = true;
    sendFailure = null;
    const outcome = await reportProblem(fetch, {
      description: description.trim(),
      // Nothing here was a caught failure, so there is no platform handle to correlate it to.
      errorIds: [],
      route: page.url.pathname,
    });
    sending = false;
    if (outcome.kind === "ok") {
      filedIdentifier = outcome.value.id;
      return;
    }
    sendFailure = stated(
      outcome.failure,
      "The report was not sent — copy it instead and send it on.",
    );
  }

  function focusDescription(event: Event): void {
    // The report starts with the user's words, so the first focus lands in the textarea rather
    // than on Bits' default first-tabbable.
    event.preventDefault();
    textareaRef?.focus();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} onOpenAutoFocus={focusDescription}>
    <Dialog.Title>Report an Issue</Dialog.Title>
    <div class="flex flex-col gap-4">
      <Label for="bug-report-description">What happened?</Label>
      <p id="bug-report-description-hint" class="text-xs text-text-muted">
        What you did, what you expected, what happened instead
      </p>
      <Textarea
        id="bug-report-description"
        bind:ref={textareaRef}
        bind:value={description}
        required
        aria-describedby="bug-report-description-hint"
      />
    </div>
    <div class="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        class="self-start"
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
      {#if diagnosticsExpanded}
        <pre
          id="bug-report-diagnostics"
          class="rounded-md border border-border-default bg-surface-sunken p-12 text-start font-mono text-xs whitespace-pre-wrap text-text-muted select-all">{diagnostics}</pre>
      {/if}
    </div>
    <div class="flex flex-col gap-4">
      <Label for="issue-report-recipients">Also Send To</Label>
      <p id="issue-report-recipients-hint" class="text-xs text-text-muted">
        Optional — colleagues who should see this report; they ride the filed report once it carries
        recipients
      </p>
      <RecipientPicker
        {members}
        selectedIds={alsoSendToIds}
        onAdd={addRecipient}
        onRemove={removeRecipient}
        inputId="issue-report-recipients"
      />
      <!-- The roster is a courtesy field, so a failed read never fails the dialog: the picker is
           simply empty and says why, and the report still files. -->
      {#if firmRoster.failure !== null}
        <p class="text-xs text-text-muted">{firmRoster.failure}</p>
      {/if}
    </div>

    <div class="flex items-center justify-between gap-16">
      <div class="flex min-w-0 flex-col gap-4">
        <Label for="issue-report-email-me">Email Me a Copy</Label>
        <!-- Not part of the filing, which is wired: emailing rides the platform's transactional
             email, which does not exist yet. -->
        <p class="text-xs text-text-muted">Sends with the report once email delivery ships</p>
      </div>
      <Switch id="issue-report-email-me" bind:checked={emailMeCopy} />
    </div>

    {#if sendFailure !== null}
      <FailureNotice
        failure={sendFailure.failure}
        title="Not Sent"
        fallback={sendFailure.fallback}
      />
    {/if}
    {#if filedIdentifier !== null}
      <Alert.Root variant="success">
        <Alert.Title>Report Filed</Alert.Title>
        <Alert.Description>
          It was recorded as {filedIdentifier}. Quoting that reference gets support to it directly.
        </Alert.Description>
      </Alert.Root>
    {/if}
    {#if copied === "failed"}
      <p class="text-xs text-text-muted">
        Your browser would not let us copy. Select the diagnostics above and copy them by hand.
      </p>
    {/if}

    <p class="text-xs text-text-muted">
      This goes to the firm&rsquo;s own reporting pipeline, not to a third party. No document, file
      name, client name or matter content leaves the firm.
    </p>
    <div class="flex justify-end gap-8">
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
      <!-- Disabled while the description is empty: a report with no words is read by a person who
           has nothing to go on, and the diagnostics alone say nothing about what went wrong. -->
      <Button variant="secondary" disabled={descriptionEmpty} onclick={copyReport}>
        {#if copied === "copied"}
          <Check class="size-16" aria-hidden="true" />
          Copied
        {:else}
          <Copy class="size-16" aria-hidden="true" />
          Copy report
        {/if}
      </Button>
      <Button
        variant="primary"
        disabled={descriptionEmpty || sending || filedIdentifier !== null}
        onclick={() => void submitReport()}
      >
        Submit Issue
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

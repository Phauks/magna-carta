<script lang="ts">
  /*
   * The issue-report dialog ("Report an Issue" — owner-renamed from "Report a bug") — reachable
   * from the profile menu on EVERY screen (owner ask 2026-07-02: report from any location). The
   * user describes what happened; the dialog assembles that description plus the same
   * trace-shaped diagnostics the error surfaces emit (error-details.svelte is the sibling
   * idiom: build identity, time, path, browser — but NO error id line, because this is a
   * user-initiated report, not a caught failure) into one paste-ready block behind the Copy
   * action.
   *
   * Honesty rule: submission is not wired. The Submit Issue button renders disabled + Soon (the
   * designed-but-not-wired rule) until the platform's report-ingest endpoint ships; Copy is the
   * working carrier. The optional in-office recipients and the email-me-a-copy flag join the
   * FILED report's payload when that ingest ships (the transactional email sender does not
   * exist yet either) — until then the copy block records them so a pasted report still tells
   * the administrator who else was told.
   *
   * The profile menu owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import { page } from "$app/state";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Switch from "@magna-carta/design-system/switch";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import { buildIdentityLine } from "$lib/build-identity.ts";
  import RecipientPicker from "$lib/components/recipient-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // The draft survives close/reopen on purpose: an accidental dismiss must not eat a
  // half-written report.
  let description = $state("");
  let diagnosticsExpanded = $state(false);
  let copied = $state(false);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);

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
  // user reached for the report, not the moment the page loaded.
  const diagnostics = $derived.by(() => {
    if (!open) {
      return "";
    }
    return [
      `build: ${buildIdentityLine()}`,
      `time: ${new Date().toISOString()}`,
      `path: ${page.url.pathname}${page.url.search}`,
      `browser: ${navigator.userAgent}`,
    ].join("\n");
  });

  const descriptionEmpty = $derived(description.trim().length === 0);

  async function copyReport(): Promise<void> {
    const report = [
      "Magna Carta — bug report",
      "",
      description.trim(),
      "",
      diagnostics,
    ].join("\n");
    await navigator.clipboard.writeText(report);
    copied = true;
    setTimeout(() => (copied = false), 2000);
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
        Optional — colleagues who should see this report; they ride the filed report when
        submission ships
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
        <!-- Part of the Soon-marked submission, not the Copy action: emailing rides the
             platform's transactional email when the report ingest ships. -->
        <p class="text-xs text-text-muted">Sends with the report when submission ships</p>
      </div>
      <Switch id="issue-report-email-me" bind:checked={emailMeCopy} />
    </div>

    <p class="text-xs text-text-muted">
      In-application submission arrives when the platform's report endpoint ships; until then,
      send the copied report to your firm's administrator.
    </p>
    <div class="flex justify-end gap-8">
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
      <!-- Designed-but-not-wired actions render disabled + Soon rather than being omitted —
           the dialog shows its final anatomy (owner rule). Submission lights up when the
           platform's report endpoint ships. -->
      <Button variant="secondary" disabled>
        Submit Issue
        <Badge variant="neutral">Soon</Badge>
      </Button>
      <!-- Disabled while the description is empty: a report with no words is never worth
           copying, and the diagnostics alone say nothing about what went wrong. -->
      <Button variant="primary" disabled={descriptionEmpty} onclick={copyReport}>
        {#if copied}
          <Check class="size-16" aria-hidden="true" />
          Copied
        {:else}
          <Copy class="size-16" aria-hidden="true" />
          Copy report
        {/if}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<script lang="ts">
  /*
   * The bug-report dialog — reachable from the profile menu on EVERY screen (owner ask
   * 2026-07-02: report a bug from any location). The user describes what happened; the dialog
   * assembles that description plus the same trace-shaped diagnostics the error surfaces emit
   * (error-details.svelte is the sibling idiom: build identity, time, path, browser — but NO
   * error id line, because this is a user-initiated report, not a caught failure) into one
   * paste-ready block behind a single Copy action.
   *
   * Honesty rule: there is no submit. The platform's report-ingest endpoint does not exist yet,
   * so the dialog never pretends to send — Copy is the whole action, and the footer says so
   * plainly. When the endpoint ships, submission replaces the copy-and-send-yourself line here.
   *
   * The profile menu owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import { page } from "$app/state";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import { buildIdentityLine } from "$lib/build-identity.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // The draft survives close/reopen on purpose: an accidental dismiss must not eat a
  // half-written report.
  let description = $state("");
  let diagnosticsExpanded = $state(false);
  let copied = $state(false);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);

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
    <Dialog.Title>Report a bug</Dialog.Title>
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
    <p class="text-xs text-text-muted">
      In-application submission arrives when the platform's report endpoint ships; until then,
      send the copied report to your firm's administrator.
    </p>
    <div class="flex justify-end gap-8">
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
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

<script lang="ts">
  /*
   * The see-but-cannot-edit composer, pre-scoped to ONE setting: the request affordance lives on
   * the row being asked about, so the dialog opens already knowing which setting — and states
   * its CURRENT value engraved. Both sides gain information: the member asks about the thing in
   * front of them, and the administrator receives the setting, what it reads today, the proposed
   * value, and the reason, addressed to named recipients. (The setting is open-sensitivity by
   * construction — restricted settings never render for non-editors — so stating its current
   * value discloses nothing the member cannot already see.)
   *
   * Recipients ride a SEARCH PICKER (owner-directed, v1 of a fuller routing workflow later):
   * the combobox filters ONLY the administrators holding the section's edit right (the mock
   * roster seam in settings-permissions.ts), each pick becomes its own removable chip, and the
   * copied block carries the To: line so the request lands with the people who can act on it.
   * The list starts EMPTY: with an explicit picker, adding someone is the deliberate act, and
   * the at-least-one-recipient gate (not preselection) prevents a request addressed to no one.
   *
   * Honesty rule: filing is not wired yet. The real "File Request" action renders disabled with
   * the Soon badge rather than being omitted — designed-but-not-wired actions keep their place
   * so the dialog shows its final anatomy (owner rule) — and it lights up when requests ride
   * the access-request rails with firm accounts; until then Copy carries it, and the footer
   * says so plainly.
   *
   * The page owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import RecipientPicker from "$lib/components/recipient-picker.svelte";
  import { settingValueLabel, type SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { committedSettingValue } from "$lib/settings/settings-draft.svelte.ts";
  import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";
  import { administratorsForPermissionArea } from "$lib/settings/settings-permissions.ts";

  let {
    open = $bindable(false),
    definition,
  }: {
    open?: boolean;
    definition: SettingDefinition;
  } = $props();

  // The section's edit right names the eligible recipients; a section without a declared area
  // falls back to firm administration (whoever governs the firm governs its unclaimed areas).
  const permissionArea = $derived(
    SETTINGS_SECTIONS.find((section) => section.id === definition.sectionId)
      ?.editPermissionArea ?? "firm",
  );
  const administrators = $derived(administratorsForPermissionArea(permissionArea));

  /*
   * Draft retention: the composition survives close/reopen FOR THE SAME SETTING (an accidental
   * dismiss must not eat a half-written request — the bug-report dialog sets the precedent), but
   * switching to a different setting starts fresh: a reason written about time increments must
   * never ride along under a request about rounding. The stored composition is keyed by the
   * definition it was written for; while the key does not match, the fields read as pristine
   * (no recipients — assembling them is the deliberate act) and the first edit snapshots a
   * fresh composition for the new setting.
   */
  interface RequestComposition {
    definitionId: string;
    proposedValue: string;
    reason: string;
    recipientIds: string[];
  }

  let composition = $state<RequestComposition>({
    definitionId: "",
    proposedValue: "",
    reason: "",
    recipientIds: [],
  });
  let copied = $state(false);

  const pristine = $derived(composition.definitionId !== definition.id);
  const proposedValue = $derived(pristine ? "" : composition.proposedValue);
  const reason = $derived(pristine ? "" : composition.reason);
  const selectedRecipientIds = $derived(pristine ? [] : composition.recipientIds);

  function editComposition(mutate: (draft: RequestComposition) => void): void {
    if (pristine) {
      composition = {
        definitionId: definition.id,
        proposedValue: "",
        reason: "",
        recipientIds: [],
      };
    }
    mutate(composition);
  }

  const currentValueLabel = $derived(
    settingValueLabel(definition, committedSettingValue(definition)),
  );

  function addRecipient(id: string): void {
    editComposition((draft) => {
      if (!draft.recipientIds.includes(id)) draft.recipientIds = [...draft.recipientIds, id];
    });
  }

  function removeRecipient(id: string): void {
    editComposition((draft) => {
      draft.recipientIds = draft.recipientIds.filter((candidate) => candidate !== id);
    });
  }

  // Copy is gated on substance (trim-aware, like the bug dialog): a request needs a reason and
  // someone to receive it; the proposed value may live in the reason's prose, so it alone is
  // not required.
  const copyDisabled = $derived(reason.trim().length === 0 || selectedRecipientIds.length === 0);

  /*
   * Kill the reveal latch at the source. Bits' Dialog restores focus to its trigger when the
   * dialog closes, and a focused per-row request trigger keeps ANY focus-based reveal latched
   * open until the user clicks elsewhere (owner-reported twice: "the request a change text
   * will not go away") — Chromium even marks the programmatically refocused button
   * :focus-visible after an Escape close. Cancelling the restore through Bits' own
   * close-auto-focus seam (no timing race against the exit animation, unlike a blur scheduled
   * after close) leaves the row at rest the moment the dialog leaves. The trade, accepted for
   * simplicity: keyboard users lose the restored tab position and re-enter with Tab — the
   * affordance re-reveals on focus as they do.
   */
  function preventTriggerRefocus(event: Event): void {
    event.preventDefault();
  }

  async function copyRequest(): Promise<void> {
    const recipients = administrators
      .filter((administrator) => selectedRecipientIds.includes(administrator.id))
      .map((administrator) => `${administrator.name} (${administrator.role})`)
      .join(", ");
    const request = [
      "Magna Carta — settings change request",
      `To: ${recipients}`,
      "",
      `setting: ${definition.label}`,
      `current value: ${currentValueLabel}`,
      `proposed value: ${proposedValue.trim() || "(described in the reason)"}`,
      "",
      "reason:",
      reason.trim(),
    ].join("\n");
    await navigator.clipboard.writeText(request);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} onCloseAutoFocus={preventTriggerRefocus}>
    <Dialog.Title>Request a change</Dialog.Title>

    <!-- The setting under discussion, stated as facts: name and what it reads today — the
         context the administrator needs before weighing the proposal. -->
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Setting
      </p>
      <p class="text-sm font-medium">{definition.label}</p>
      <p class="text-xs text-text-muted">
        Current value: <span class="tabular-nums">{currentValueLabel}</span>
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <Label for="request-change-recipients">Send to</Label>
      <RecipientPicker
        members={administrators}
        selectedIds={selectedRecipientIds}
        onAdd={addRecipient}
        onRemove={removeRecipient}
        inputId="request-change-recipients"
        placeholder="Search administrators…"
      />
    </div>

    <div class="flex flex-col gap-4">
      <Label for="request-change-proposed-value">Proposed value</Label>
      <p id="request-change-proposed-value-hint" class="text-xs text-text-muted">
        In your own words — the administrator making the change interprets it
      </p>
      <Input
        id="request-change-proposed-value"
        bind:value={
          () => proposedValue,
          (next) => editComposition((draft) => (draft.proposedValue = String(next ?? "")))
        }
        aria-describedby="request-change-proposed-value-hint"
      />
    </div>

    <div class="flex flex-col gap-4">
      <Label for="request-change-reason">Reason</Label>
      <p id="request-change-reason-hint" class="text-xs text-text-muted">
        Why the firm should make this change
      </p>
      <Textarea
        id="request-change-reason"
        bind:value={
          () => reason,
          (next) => editComposition((draft) => (draft.reason = String(next ?? "")))
        }
        required
        aria-describedby="request-change-reason-hint"
      />
    </div>

    <p class="text-xs text-text-muted">
      Filing this with your firm's administrators arrives with firm accounts — requests will ride
      the same rails as access requests. Until then, send the copied request to the recipients
      yourself.
    </p>

    <div class="flex justify-end gap-8">
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
      <!-- Designed-but-not-wired actions render disabled + Soon rather than being omitted —
           the dialog shows its final anatomy (owner rule). Filing lights up when requests ride
           the access-request rails with firm accounts. -->
      <Button variant="secondary" disabled>
        File Request
        <Badge variant="neutral">Soon</Badge>
      </Button>
      <Button variant="primary" disabled={copyDisabled} onclick={copyRequest}>
        {#if copied}
          <Check class="size-16" aria-hidden="true" />
          Copied
        {:else}
          <Copy class="size-16" aria-hidden="true" />
          Copy request
        {/if}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

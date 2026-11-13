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
   * Recipients ride a SEARCH PICKER (owner-directed, v1 of a fuller routing workflow later): the
   * combobox offers the firm's own colleagues — the real roster, read from GET /api/v1/members —
   * each with the role they hold beside their name, each pick becomes its own removable chip, and
   * the copied block carries the To: line so the request lands with the people who can act on it.
   * The list starts EMPTY: with an explicit picker, adding someone is the deliberate act, and
   * the at-least-one-recipient gate (not preselection) prevents a request addressed to no one.
   *
   * It offers every active colleague rather than "the administrators for this area", and that is
   * the honest shape rather than a regression. The roster answers what ROLES a member holds; it
   * does not answer which settings surfaces their permissions reach, and nothing on the server does
   * yet. The previous narrowing ran over an invented field on an invented roster. Showing the role
   * line and letting the person choose states what is actually known — and the section's own edit
   * right is still what the dialog is ABOUT, named in the sentence at the foot.
   *
   * Honesty rule: filing is not wired yet. The real "File Request" commit is the shell's, told
   * what it waits on, so it renders disabled beside its Soon mark rather than being omitted —
   * designed-but-not-wired actions keep their place so the dialog shows its final anatomy (owner
   * rule) — and it lights up when requests ride the access-request rails with firm accounts. Until
   * then Copy carries it, seated in the body beside the request it copies, and the foot says so.
   *
   * The page owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import RecipientPicker from "$lib/components/recipient-picker.svelte";
  import { settingValueLabel, type SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { committedSettingValue } from "$lib/settings/settings-draft.svelte.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { memberRoleLine } from "$lib/members/members-api.ts";

  let {
    open = $bindable(false),
    definition,
  }: {
    open?: boolean;
    definition: SettingDefinition;
  } = $props();

  // The firm's colleagues who are still here, read once and shared with the other composers. Asked
  // for when the dialog opens: a settings page nobody is filing a request from needs no roster.
  const recipientRoster = $derived(firmRoster.active);
  $effect(() => {
    if (open) void firmRoster.load(fetch);
  });

  /*
   * Draft retention: the composition survives close/reopen FOR THE SAME SETTING (an accidental
   * dismiss must not eat a half-written request — the bug-report dialog sets the precedent), but
   * switching to a different setting starts fresh: a reason written about time increments must
   * never ride along under a request about rounding. The stored composition is keyed by the
   * definition it was written for; while the key does not match, the fields read as pristine
   * (no recipients — assembling them is the deliberate act) and the first edit snapshots a
   * fresh composition for the new setting. Because the draft is kept, the shell is told there is
   * nothing to lose on a close: nothing is.
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

  async function copyRequest(): Promise<void> {
    const recipients = recipientRoster
      .filter((member) => selectedRecipientIds.includes(member.userId))
      .map((member) => {
        const roleLine = memberRoleLine(member);
        // The role is context for whoever reads the pasted request, and a colleague holding no
        // role gets their name alone rather than an empty pair of brackets after it.
        return roleLine === "" ? member.displayName : `${member.displayName} (${roleLine})`;
      })
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

  /** Unreachable until filing is wired: the shell refuses the commit while `commitSoon` is given. */
  async function fileRequest(): Promise<ActionOutcome> {
    return "refused";
  }
</script>

<!-- restoreFocus={false}: Bits restores focus to the trigger when a dialog closes, and a focused
     per-row request trigger keeps its focus-based reveal latched open until the user clicks
     elsewhere (owner-reported twice: "the request a change text will not go away"). The trade,
     accepted for simplicity: keyboard users re-enter the row with Tab, and the affordance
     re-reveals on focus as they do. -->
<ActionDialog
  bind:open
  kind="form"
  heading="Request a Change"
  commitLabel="File Request"
  commitSoon={{ reason: "requests riding the access-request rails with firm accounts" }}
  restoreFocus={false}
  unsavedChanges={false}
  onCommit={fileRequest}
>
  {#snippet fields()}
    <!-- The setting under discussion, stated as facts: name and what it reads today — the
         context the administrator needs before weighing the proposal. -->
    <div class="flex flex-col gap-4">
      <FieldLabel as="p">
        Setting
      </FieldLabel>
      <p class="text-sm font-medium">{definition.label}</p>
      <p class="text-xs text-text-muted">
        Current value: <span class="tabular-nums">{currentValueLabel}</span>
      </p>
    </div>

    <LabelledField label="Send to">
      {#snippet children({ props })}
        <RecipientPicker
          members={recipientRoster}
          selectedIds={selectedRecipientIds}
          onAdd={addRecipient}
          onRemove={removeRecipient}
          inputId={props.id}
          placeholder="Search colleagues…"
        />
      {/snippet}
    </LabelledField>
    {#if firmRoster.failure !== null}
      <p class="text-xs text-text-muted">{firmRoster.failure}</p>
    {/if}

    <LabelledField
      label="Proposed value"
      hint="In your own words. The administrator making the change will interpret it."
    >
      {#snippet children({ props })}
        <Input
          {...props}
          bind:value={
            () => proposedValue,
            (next) => editComposition((draft) => (draft.proposedValue = String(next ?? "")))
          }
        />
      {/snippet}
    </LabelledField>

    <LabelledField label="Reason" hint="Why the firm should make this change">
      {#snippet children({ props })}
        <Textarea
          {...props}
          required
          bind:value={
            () => reason,
            (next) => editComposition((draft) => (draft.reason = String(next ?? "")))
          }
        />
      {/snippet}
    </LabelledField>

    <div class="flex flex-wrap items-center justify-between gap-8">
      <p class="text-xs text-text-muted">
        Sending this to your firm's administrators is coming soon. For now, send the copied request yourself.
      </p>
      <Button variant="secondary" size="sm" disabled={copyDisabled} onclick={copyRequest}>
        {#if copied}
          <Check class="size-16" aria-hidden="true" />
          Copied
        {:else}
          <Copy class="size-16" aria-hidden="true" />
          Copy request
        {/if}
      </Button>
    </div>
  {/snippet}
</ActionDialog>

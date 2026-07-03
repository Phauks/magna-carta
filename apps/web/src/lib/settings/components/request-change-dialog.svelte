<script lang="ts">
  /*
   * The see-but-cannot-edit composer — a member who can read a section's settings but not change
   * them asks here. The dialog gathers which setting, the proposed value (free text: the
   * administrator interprets it), and the required reason, and assembles them into one
   * paste-ready block behind a single Copy action (bug-report-dialog.svelte is the sibling
   * idiom).
   *
   * Honesty rule: there is no submit. Filing straight to the firm's administrators arrives with
   * firm accounts — the request will ride the same rails as access requests when they land;
   * until then Copy carries it, and the footer says so plainly. The committed value is NOT part
   * of the block: this surface cannot see restricted state, so the request never pretends to
   * know it — the administrator reads it off their own screen.
   *
   * The page owns the trigger state (`bind:open`); this component renders no trigger.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import { visibleSettingsForSection } from "$lib/settings/settings-definitions.ts";

  let { open = $bindable(false), sectionId }: { open?: boolean; sectionId: string } = $props();

  // The draft survives close/reopen on purpose: an accidental dismiss must not eat a
  // half-written request.
  let settingId = $state("");
  let proposedValue = $state("");
  let reason = $state("");
  let copied = $state(false);

  // Only the section's OPEN settings are requestable: restricted ones are not shown to
  // non-editors, and a request about a setting the member cannot see would name nothing.
  const openSettings = $derived(visibleSettingsForSection(sectionId, false));
  const selectItems = $derived(
    openSettings.map((definition) => ({ value: definition.id, label: definition.label })),
  );

  // Copy is gated on substance (trim-aware, like the bug dialog): a request needs a setting and
  // a reason; the proposed value may live in the reason's prose, so it alone is not required.
  const reasonEmpty = $derived(reason.trim().length === 0);
  const copyDisabled = $derived(reasonEmpty || settingId === "");

  async function copyRequest(): Promise<void> {
    const selected = openSettings.find((definition) => definition.id === settingId);
    const request = [
      "Magna Carta — settings change request",
      "",
      `setting: ${selected?.label ?? settingId}`,
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
  <Dialog.Content showClose={false}>
    <Dialog.Title>Request a change</Dialog.Title>

    <div class="flex flex-col gap-4">
      <Label for="request-change-setting">Setting</Label>
      <Select.Root type="single" items={selectItems} bind:value={settingId} allowDeselect={false}>
        <Select.Trigger id="request-change-setting" class="w-full">
          <Select.Value placeholder="Select a setting" />
        </Select.Trigger>
        <Select.Content>
          {#each selectItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex flex-col gap-4">
      <Label for="request-change-proposed-value">Proposed value</Label>
      <p id="request-change-proposed-value-hint" class="text-xs text-text-muted">
        In your own words — the administrator making the change interprets it
      </p>
      <Input
        id="request-change-proposed-value"
        bind:value={proposedValue}
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
        bind:value={reason}
        required
        aria-describedby="request-change-reason-hint"
      />
    </div>

    <p class="text-xs text-text-muted">
      Filing this with your firm's administrators arrives with firm accounts — requests will ride
      the same rails as access requests. Until then, send the copied request to your firm's
      administrator.
    </p>

    <div class="flex justify-end gap-8">
      <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
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

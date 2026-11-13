<script lang="ts" module>
  import type { DeclineReason as Reason, RequestStatus as Status } from "@magna-carta/community/vocabulary";

  export interface StatusUpdate {
    status: Status;
    declineReason?: Reason;
    declineNote?: string;
    duplicateOfNumber?: number;
    linkedChangelogAnchor?: string;
  }
</script>

<script lang="ts">
  /*
   * The Magna Carta team's triage of one request, beside the post. A decline needs a reason and a
   * note, because the board shows both to everyone; a duplicate names the request it duplicates;
   * Completed may name the changelog entry it shipped in. The board service refuses anyone off the
   * team, so this panel is a convenience, not the guard.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { BoardPostView } from "@magna-carta/community/board-service";
  import {
    DECLINE_REASON_LABELS,
    DECLINE_REASONS,
    REQUEST_STATUSES,
    STATUS_LABELS,
    type DeclineReason,
    type RequestStatus,
  } from "@magna-carta/community/vocabulary";


  let {
    post,
    onSave,
  }: {
    post: BoardPostView;
    /** Resolves true when the board took the change. */
    onSave: (update: StatusUpdate) => Promise<boolean>;
  } = $props();

  const STATUS_ITEMS = REQUEST_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
  const REASON_ITEMS = DECLINE_REASONS.map((value) => ({ value, label: DECLINE_REASON_LABELS[value] }));

  // Seeded from the post once; a re-read after saving re-mounts the panel through its key.
  // svelte-ignore state_referenced_locally
  let status = $state<RequestStatus>(post.status as RequestStatus);
  // svelte-ignore state_referenced_locally
  let declineReason = $state<DeclineReason | "">((post.declineReason as DeclineReason | null) ?? "");
  // svelte-ignore state_referenced_locally
  let declineNote = $state(post.declineNote ?? "");
  let duplicateOf = $state("");
  // svelte-ignore state_referenced_locally
  let changelogAnchor = $state(post.linkedChangelogAnchor ?? "");
  let saving = $state(false);

  const declining = $derived(status === "not-on-the-roadmap");
  const ready = $derived(
    !saving &&
      (!declining || (declineReason !== "" && declineNote.trim() !== "")) &&
      (status !== "duplicate" || Number.isInteger(Number(duplicateOf)) && Number(duplicateOf) > 0),
  );

  async function save(): Promise<void> {
    saving = true;
    await onSave({
      status,
      ...(declining && declineReason !== "" ? { declineReason, declineNote: declineNote.trim() } : {}),
      ...(status === "duplicate" ? { duplicateOfNumber: Number(duplicateOf) } : {}),
      ...(status === "completed" && changelogAnchor.trim() !== ""
        ? { linkedChangelogAnchor: changelogAnchor.trim() }
        : {}),
    });
    saving = false;
  }
</script>

<section aria-labelledby="community-triage-heading" class="flex flex-col gap-12 rounded-lg border border-border-default bg-surface-default p-16">
  <h2 id="community-triage-heading" class="text-sm font-semibold">Team Triage</h2>
  <div class="flex flex-col gap-8">
    <Label id="community-triage-status-label">Status</Label>
    <Select.Root type="single" items={STATUS_ITEMS} allowDeselect={false} bind:value={status}>
      <Select.Trigger aria-labelledby="community-triage-status-label">
        <Select.Value placeholder={placeholderOf("Status")} />
      </Select.Trigger>
      <Select.Content>
        {#each STATUS_ITEMS as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
  {#if declining}
    <div class="flex flex-col gap-8">
      <Label id="community-triage-reason-label">Why Not</Label>
      <Select.Root
        type="single"
        items={REASON_ITEMS}
        bind:value={() => declineReason, (picked) => (declineReason = (picked as DeclineReason) || "")}
      >
        <Select.Trigger aria-labelledby="community-triage-reason-label">
          <Select.Value placeholder={placeholderOf("Reason")} />
        </Select.Trigger>
        <Select.Content>
          {#each REASON_ITEMS as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <LabelledField label="Note" hint="Shown to everyone under the reason.">
      {#snippet children({ props })}
        <Textarea {...props} bind:value={declineNote} rows={3} />
      {/snippet}
    </LabelledField>
  {:else if status === "duplicate"}
    <LabelledField label="Duplicate Of" hint="The number of the request this repeats.">
      {#snippet children({ props })}
        <Input {...props} bind:value={duplicateOf} inputmode="numeric" />
      {/snippet}
    </LabelledField>
  {:else if status === "completed"}
    <LabelledField label="Shipped In" hint="The changelog entry, if there is one.">
      {#snippet children({ props })}
        <Input {...props} bind:value={changelogAnchor} />
      {/snippet}
    </LabelledField>
  {/if}
  <div class="flex justify-end">
    <Button size="sm" disabled={!ready} onclick={save}>Save Status</Button>
  </div>
</section>

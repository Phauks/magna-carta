<script lang="ts">
  /*
   * How a client found the firm: the Referral row of the About card.
   *
   * READ, THEN EDIT IN PLACE. The row reads as two lines, Source and Referred By; Edit opens the
   * two fields inside the card with Cancel and Save, never a window over the record (the owner's
   * ruling on the person screen: data changes are inline).
   *
   * EITHER OR BOTH. A source with no person is ordinary (a client who found the firm through a
   * search engine), and so is a person with no source. A retired source is never offered, but a
   * record already recorded under one keeps showing it (referral-draft.ts).
   *
   * The referral is read by the window, which also says it in the header, and handed in here, so
   * the two never disagree; a save asks the window to read the record again.
   */
  import Button from "@magna-carta/design-system/button";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import { failureToast } from "$lib/diagnostics/failure-toast.ts";
  import { setEntityReferral, type EntityReferral } from "./referral-api.ts";
  import {
    RETIRED_SOURCE_MARK,
    referralDraftChanged,
    referralDraftFrom,
    referralPayload,
    type ReferralDraft,
  } from "./referral-draft.ts";
  import ReferralSection from "./sections/referral-section.svelte";

  let {
    entityId,
    referral,
    mayEdit,
    editDisabledReason,
    onRecorded,
    onOpenEntity,
  }: {
    entityId: string;
    /** What the record holds, as the window read it; undefined while it is still being read. */
    referral: EntityReferral | null | undefined;
    mayEdit: boolean;
    editDisabledReason?: string;
    onRecorded: () => void;
    /** Opens the referrer's record in the same window. */
    onOpenEntity: (entityId: string) => void;
  } = $props();

  const identity = $props.id();

  let editing = $state(false);
  let saving = $state(false);
  let draft = $state<ReferralDraft>(referralDraftFrom(null));
  let shownFor = $state<string | null>(null);

  // Another record's referral is another record's business: an open edit closes when it changes.
  $effect(() => {
    if (shownFor === entityId) return;
    shownFor = entityId;
    editing = false;
  });

  const changed = $derived(referralDraftChanged(draft, referral ?? null));

  function startEditing(): void {
    draft = referralDraftFrom(referral ?? null);
    editing = true;
  }

  async function save(): Promise<void> {
    if (saving || !changed) return;
    saving = true;
    const outcome = await setEntityReferral(
      fetch,
      entityId,
      referralPayload(draft),
      crypto.randomUUID(),
    );
    saving = false;
    if (outcome.kind === "ok") {
      editing = false;
      onRecorded();
      return;
    }
    failureToast(outcome.failure, "Couldn't save the referral.");
  }

  function sourceText(): string | null {
    const source = referral?.source;
    if (source === null || source === undefined) return null;
    return source.archived ? `${source.name} ${RETIRED_SOURCE_MARK}` : source.name;
  }
</script>

<section class="flex flex-col gap-12" aria-labelledby="{identity}-heading">
  <div class="flex flex-wrap items-center justify-between gap-16">
    <h4 id="{identity}-heading" class="text-sm font-semibold">Referral</h4>
    {#if !editing}
      <Button
        variant="secondary"
        size="sm"
        disabled={!mayEdit || referral === undefined}
        title={editDisabledReason}
        onclick={startEditing}
      >
        <PenLine class="size-16" aria-hidden="true" />
        Edit
      </Button>
    {/if}
  </div>

  {#if editing}
    <ReferralSection
      bind:draft
      currentSourceId={referral?.source?.id ?? null}
      {entityId}
      disabled={saving}
    />
    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button variant="ghost" disabled={saving} onclick={() => (editing = false)}>Cancel</Button>
      <Button variant="primary" disabled={saving || !changed} onclick={() => void save()}>
        {saving ? "Saving" : "Save"}
      </Button>
    </div>
  {:else}
    <dl class="grid gap-x-16 gap-y-8 text-sm" style="grid-template-columns: 8rem minmax(0, 1fr)">
      <dt class="text-text-muted">Source</dt>
      <dd>
        {#if referral === undefined}
          <span class="text-text-subtle">Reading</span>
        {:else}
          {sourceText() ?? "None recorded"}
        {/if}
      </dd>
      <dt class="text-text-muted">Referred By</dt>
      <dd>
        {#if referral?.referrer}
          {@const referrer = referral.referrer}
          <button
            type="button"
            class="underline underline-offset-2 hover:text-text-default"
            onclick={() => onOpenEntity(referrer.mergedIntoId ?? referrer.entityId)}
          >
            {referrer.displayName ?? "An unnamed record"}
          </button>
        {:else if referral !== undefined}
          None recorded
        {/if}
      </dd>
    </dl>
  {/if}
</section>

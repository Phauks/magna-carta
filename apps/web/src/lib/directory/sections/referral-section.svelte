<script lang="ts">
  /*
   * How a client found the firm, as two fields: a Source from the firm's list and the person or
   * organization who Referred them. Either or both, or neither.
   *
   * One component for every place a referral is typed: New Person, New Organization and the About
   * card's Edit, so the three never drift. The firm's list is read here, once per opening. A source
   * the firm has retired is never offered, and stays the current choice where it already stands
   * (referral-draft.ts). The record itself is kept out of the Referred By field: nobody refers
   * themselves.
   *
   * The Referred By field is the design system's picker over the directory's own search, not the
   * directory's wrapper: the wrapper adds only the New Person and New Organization windows, a referrer
   * is never recorded from here, and New Person and New Organization hold this section, so the
   * wrapper would import its way back to them.
   */
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import EntityPicker from "@magna-carta/design-system/entity-picker";
  import * as Select from "@magna-carta/design-system/select";
  import { directoryPickerSearch } from "../directory-picker-source.ts";
  import { listReferralSources, type ReferralSource } from "../referral-api.ts";
  import {
    REFERRED_BY_HINT,
    referralSourceChoices,
    type ReferralDraft,
  } from "../referral-draft.ts";

  let {
    draft = $bindable(),
    currentSourceId = null,
    entityId = null,
    disabled = false,
  }: {
    draft: ReferralDraft;
    /** The source the record already stands under, kept as a choice even when it is retired. */
    currentSourceId?: string | null;
    /** The record being edited, kept out of Referred By; null for a record not yet saved. */
    entityId?: string | null;
    disabled?: boolean;
  } = $props();

  let sources = $state<readonly ReferralSource[] | null>(null);
  /** The list could not be read: the Source field turns red, its reason on hover. */
  let sourcesFailed = $state(false);

  $effect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await listReferralSources(fetch);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        sources = outcome.value.data;
        sourcesFailed = false;
      } else {
        sourcesFailed = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const referrerSearch = directoryPickerSearch(fetch);

  const choices = $derived(referralSourceChoices(sources ?? [], currentSourceId));
</script>

<div class="grid gap-16 md:grid-cols-2">
  <LabelledField
    label="Source"
    necessity="optional"
    error={sourcesFailed ? "Couldn't load the list of sources." : undefined}
  >
    {#snippet children({ props })}
      <Select.Root
        type="single"
        items={choices}
        bind:value={draft.sourceId}
        allowDeselect={false}
        disabled={disabled || sources === null}
      >
        <Select.Trigger {...props} class="w-full">
          <Select.Value placeholder="None" />
        </Select.Trigger>
        <Select.Content>
          {#each choices as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    {/snippet}
  </LabelledField>
  <LabelledField label="Referred By" necessity="optional" hint={REFERRED_BY_HINT}>
    {#snippet children({ props })}
      <EntityPicker
        search={referrerSearch}
        inputId={props.id}
        label="Referred By"
        excluded={entityId === null ? [] : [entityId]}
        {disabled}
        value={draft.referrer}
        onSelect={(entity) => (draft.referrer = entity)}
        onClear={() => (draft.referrer = null)}
      />
    {/snippet}
  </LabelledField>
</div>

<script lang="ts">
  /*
   * The pronouns a person stated, chosen from a dropdown.
   *
   * The sets most people state are offered by name; "Another set…" opens the five forms the
   * record keeps (subject, object, the two possessives, the reflexive) with the verb agreement,
   * because a label like "she/her" names two of five and a document needs all of them. Nothing is
   * inferred from the name.
   */
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { PronounSet, PronounVerbNumber } from "../directory-api.ts";
  import { PRONOUN_FORMS, PRONOUN_VERB_NUMBERS } from "../directory-vocabulary.ts";
  import {
    emptyPronounDraft,
    missingPronounForms,
    pronounDraftFrom,
    pronounDraftPayload,
    type PronounDraft,
  } from "../pronoun-draft.ts";
  import {
    pronounChoiceFor,
    pronounSetForChoice,
    PRONOUN_PRESETS,
    PRONOUNS_ANOTHER_SET,
    PRONOUNS_NOT_STATED,
  } from "../person-draft.ts";

  let {
    value = $bindable(null),
    disabled = false,
  }: {
    /** The stated set, or null for none stated. Null also while another set is still incomplete. */
    value: PronounSet | null;
    disabled?: boolean;
  } = $props();

  const identity = $props.id();
  const choiceLabelId = `${identity}-choice`;
  const verbLabelId = `${identity}-verb`;

  const choiceItems = [
    ...PRONOUN_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    { value: PRONOUNS_NOT_STATED, label: "Not stated" },
    { value: PRONOUNS_ANOTHER_SET, label: "Another set…" },
  ];

  let choice = $state(pronounChoiceFor(value));
  let custom = $state<PronounDraft>(value === null ? emptyPronounDraft() : pronounDraftFrom(value));

  function choose(next: string): void {
    choice = next;
    if (next === PRONOUNS_ANOTHER_SET) {
      custom = value === null ? emptyPronounDraft() : pronounDraftFrom(value);
      value = pronounDraftPayload(custom) ?? null;
      return;
    }
    value = pronounSetForChoice(next);
  }

  function editCustom(changes: Partial<PronounDraft>): void {
    custom = { ...custom, ...changes };
    // A set is whole or not at all: an incomplete one states nothing yet.
    value = pronounDraftPayload(custom) ?? null;
  }

  const verbItems = PRONOUN_VERB_NUMBERS.map((entry) => ({ value: entry.value, label: entry.label }));
  const missing = $derived(choice === PRONOUNS_ANOTHER_SET ? missingPronounForms(custom) : []);
  // A set is whole or not at all: once one form is written, each empty one says so on itself.
  const partial = $derived(missing.length > 0 && missing.length < PRONOUN_FORMS.length);
</script>

<section class="flex flex-col gap-16">
  <div class="flex flex-col gap-8" style="max-width: 18rem">
    <Label id={choiceLabelId}>Pronouns</Label>
    <Select.Root
      type="single"
      items={choiceItems}
      bind:value={() => choice, choose}
      allowDeselect={false}
      {disabled}
    >
      <Select.Trigger aria-labelledby={choiceLabelId}>
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        {#each choiceItems as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#if choice === PRONOUNS_ANOTHER_SET}
    <div class="grid gap-12 sm:grid-cols-2">
      {#each PRONOUN_FORMS as entry (entry.form)}
        <LabelledField
          label="{entry.label} ({entry.reading})"
          error={partial && missing.includes(entry.label) ? "Needed for a whole set." : undefined}
        >
          {#snippet children({ props })}
            <Input
              {...props}
              value={custom[entry.form]}
              {disabled}
              placeholder={placeholderOf(entry.label)}
              oninput={(event) => editCustom({ [entry.form]: event.currentTarget.value })}
            />
          {/snippet}
        </LabelledField>
      {/each}
      <div class="flex flex-col gap-8">
        <Label id={verbLabelId}>Verb agreement</Label>
        <Select.Root
          type="single"
          items={verbItems}
          bind:value={() => custom.verbNumber, (chosen) => editCustom({ verbNumber: chosen as PronounVerbNumber })}
          allowDeselect={false}
          {disabled}
        >
          <Select.Trigger aria-labelledby={verbLabelId}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each verbItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/if}
</section>

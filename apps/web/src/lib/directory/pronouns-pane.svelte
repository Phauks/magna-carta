<script lang="ts">
  /*
   * The pronouns a person stated.
   *
   * Two rules govern this pane and neither is negotiable.
   *
   * NOTHING IS INFERRED. Not from the given name, not from a courtesy title, not from anything
   * else. A guessed pronoun misgenders a real person in a document that gets filed, served, and
   * read by people who were not in the room. A person who has stated none has stated none, and the
   * pane says so rather than filling the gap.
   *
   * THE SET IS RECORDED WHOLE OR NOT AT ALL. Five forms and the verb agreement travel together,
   * because a half-recorded set is what puts one set's "she" and another's "them" in the same
   * sentence, which is invisible on the page and wrong everywhere it is read. The save control
   * therefore has three positions and not two: record the complete set, clear the set on file, and
   * refuse a partly filled one while naming what is still missing.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    setDirectoryPersonPronouns,
    type DirectoryPersonDetail,
    type PronounVerbNumber,
  } from "./directory-api.ts";
  import { PRONOUN_FORMS, PRONOUN_VERB_NUMBERS } from "./directory-vocabulary.ts";
  import { pronounShortForm } from "./entity-presentation.ts";
  import {
    missingPronounForms,
    pronounDraftFrom,
    pronounDraftPayload,
    pronounDraftState,
    type PronounDraft,
  } from "./pronoun-draft.ts";

  let {
    person,
    mayEdit,
    editDisabledReason,
    onRecorded,
  }: {
    person: DirectoryPersonDetail;
    mayEdit: boolean;
    editDisabledReason?: string;
    onRecorded: () => void;
  } = $props();

  /*
   * What is in the boxes is the set on file until somebody types, and then it is what they typed.
   * Holding the edit as an OVERLAY rather than as a copy of the record is what makes a different
   * person a different set for free: clearing the overlay is all it takes, and the boxes go back to
   * reading the record they are showing.
   */
  let edited = $state<PronounDraft | null>(null);
  let submitting = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let shownFor = $state<string | null>(null);

  const draft = $derived(edited ?? pronounDraftFrom(person.pronouns));

  $effect(() => {
    if (shownFor === person.id) return;
    shownFor = person.id;
    edited = null;
    failure = null;
  });

  const draftState = $derived(pronounDraftState(draft));
  const missing = $derived(missingPronounForms(draft));
  const verbNumberItems = PRONOUN_VERB_NUMBERS.map((entry) => ({
    value: entry.value,
    label: entry.label,
  }));

  const saveLabel = $derived(
    submitting ? "Recording" : draftState === "empty" ? "Clear The Set On File" : "Record Pronouns",
  );

  const saveDisabledReason = $derived(
    !mayEdit
      ? editDisabledReason
      : draftState === "partial"
        ? `A set is recorded whole. Still to fill: ${missing.join(", ")}.`
        : undefined,
  );

  async function submit(): Promise<void> {
    const payload = pronounDraftPayload(draft);
    if (payload === undefined || submitting || !mayEdit) return;
    submitting = true;
    failure = null;
    const outcome = await setDirectoryPersonPronouns(
      fetch,
      person.id,
      payload,
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      // The overlay is dropped so the boxes go back to reading the record, which is about to be
      // re-read: what is on screen afterwards is what the firm actually holds, not what was typed.
      edited = null;
      onRecorded();
      return;
    }
    failure = stated(
      outcome.failure,
      "The pronouns could not be recorded.",
      "The set on file is unchanged.",
    );
  }
</script>

<section class="flex flex-col gap-16">
  <div class="flex flex-wrap items-center justify-between gap-16">
    <h4 class="text-sm font-semibold">Pronouns</h4>
    {#if person.pronouns !== null}
      <span class="text-sm text-text-muted">{pronounShortForm(person.pronouns)}</span>
    {:else}
      <span class="text-sm text-text-muted">None stated</span>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-16">
    {#each PRONOUN_FORMS as entry (entry.form)}
      <div class="flex flex-col gap-8">
        <Label for="pronoun-{entry.form}">{entry.label} ({entry.reading})</Label>
        <!-- A function binding, because the field is chosen by the loop: the rendered value always
             re-reads the draft rather than the control keeping a copy of its own. -->
        <Input
          id="pronoun-{entry.form}"
          bind:value={
            () => draft[entry.form], (typed) => (edited = { ...draft, [entry.form]: typed })
          }
          disabled={!mayEdit}
          placeholder={placeholderOf(entry.label)}
        />
      </div>
    {/each}
    <div class="flex flex-col gap-8">
      <Label id="pronoun-verb-number-label">Verb agreement</Label>
      <Select.Root
        type="single"
        items={verbNumberItems}
        bind:value={
          () => draft.verbNumber,
          (chosen) => (edited = { ...draft, verbNumber: chosen as PronounVerbNumber })
        }
        allowDeselect={false}
        disabled={!mayEdit}
      >
        <Select.Trigger class="min-w-64" aria-labelledby="pronoun-verb-number-label">
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {#each verbNumberItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Pronouns Could Not Be Recorded"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}

  <div class="flex items-center justify-end gap-16">
    {#if saveDisabledReason !== undefined}
      <p class="me-auto text-xs text-text-muted">{saveDisabledReason}</p>
    {/if}
    <Button
      variant="primary"
      disabled={submitting || saveDisabledReason !== undefined}
      title={saveDisabledReason}
      onclick={submit}
    >
      {saveLabel}
    </Button>
  </div>
</section>

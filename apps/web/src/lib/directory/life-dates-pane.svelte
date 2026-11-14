<script lang="ts">
  /*
   * When this person was born, and when they died.
   *
   * WHY THIS IS ITS OWN THING AND NOT A SEALED IDENTIFIER. A date of birth used to be filed with the
   * social security numbers and the driver's licences, sealed under the firm's key. That table
   * matches by exact index, a date of birth is too low-entropy to index safely, and so the code
   * deliberately refused to index it — which meant a firm could store one and then ask it nothing.
   * Every question a firm actually has about a date of birth is a range: is this client a minor, has
   * a limitation period tolled, is this person over sixty-five, whose birthday falls this month. So
   * it is an ordinary attribute of the person now, and those questions are answerable.
   *
   * KNOWN DEAD WITH THE DATE UNKNOWN IS A REAL STATE, which is why the flag is separate from the
   * date rather than derived from whether one was entered. Probate work meets it constantly.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import {
    setDirectoryPersonLifeDates,
    type DirectoryPersonDetail,
  } from "./directory-api.ts";

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

  // The draft starts empty and is filled by the effect below, which is also what refills it when the
  // screen moves to another record. Seeding it from the prop here would capture only the first value
  // the pane ever saw.
  let dateOfBirth = $state("");
  let dateOfDeath = $state("");
  let deceased = $state(false);
  let editingFor = $state<string | null>(null);
  let submitting = $state(false);
  let failure = $state<StatedFailure | null>(null);

  // A different record's dates are a different record's business: the draft follows the record.
  $effect(() => {
    if (editingFor === person.id) return;
    editingFor = person.id;
    dateOfBirth = person.dateOfBirth ?? "";
    dateOfDeath = person.dateOfDeath ?? "";
    deceased = person.deceased;
    failure = null;
  });

  const changed = $derived(
    dateOfBirth !== (person.dateOfBirth ?? "") ||
      dateOfDeath !== (person.dateOfDeath ?? "") ||
      deceased !== person.deceased,
  );

  // A date of death is the stronger statement, so entering one carries the flag with it rather than
  // leaving a record that names the day somebody died and says they are alive.
  $effect(() => {
    if (dateOfDeath !== "") deceased = true;
  });

  async function record(): Promise<void> {
    if (!changed || submitting) return;
    submitting = true;
    failure = null;
    const outcome = await setDirectoryPersonLifeDates(
      fetch,
      person.id,
      {
        dateOfBirth: dateOfBirth === "" ? null : dateOfBirth,
        dateOfDeath: dateOfDeath === "" ? null : dateOfDeath,
        deceased,
      },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      onRecorded();
      return;
    }
    failure = stated(
      outcome.failure,
      "Couldn't save these dates.",
      "Nothing was recorded.",
    );
  }
</script>

<section class="flex flex-col gap-16">
  <h4 class="text-sm font-semibold">Dates</h4>

  <!-- The reason editing is refused sits on the WRAPPER, not on the field: the picker's spread lands
       on a root element that renders no DOM, so a `title` written on it would say nothing to anyone.
       The Record button below carries the same reason, which is where a reader looks first. -->
  <div class="grid max-w-xl grid-cols-2 gap-16">
    <div class="flex flex-col gap-8" title={editDisabledReason}>
      <DatePicker
        label="Date of birth"
        value={civilDateValue(dateOfBirth)}
        onValueChange={(next) => (dateOfBirth = civilDateTextOrEmpty(next))}
        disabled={!mayEdit}
      />
    </div>
    <div class="flex flex-col gap-8" title={editDisabledReason}>
      <DatePicker
        label="Date of death"
        value={civilDateValue(dateOfDeath)}
        onValueChange={(next) => (dateOfDeath = civilDateTextOrEmpty(next))}
        disabled={!mayEdit}
      />
    </div>
  </div>

  <Label class="flex items-center gap-8" for="person-deceased">
    <Checkbox
      id="person-deceased"
      bind:checked={deceased}
      disabled={!mayEdit || dateOfDeath !== ""}
    />
    Known to have died
  </Label>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="Couldn't Save These Dates"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}

  <div class="flex justify-end">
    <Button
      variant="primary"
      disabled={!mayEdit || !changed || submitting}
      title={editDisabledReason}
      onclick={record}
    >
      {submitting ? "Recording" : "Record"}
    </Button>
  </div>
</section>

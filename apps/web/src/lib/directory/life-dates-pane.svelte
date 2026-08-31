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
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
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
  let failure = $state<string | null>(null);

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
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. Nothing was recorded."
        : (outcome.problem.detail ?? "These dates could not be recorded.");
  }
</script>

<section class="flex flex-col gap-16">
  <h3 class="text-sm font-semibold">Dates</h3>

  <div class="grid max-w-xl grid-cols-2 gap-16">
    <div class="flex flex-col gap-8">
      <Label for="person-date-of-birth">Date of birth</Label>
      <Input
        id="person-date-of-birth"
        type="date"
        bind:value={dateOfBirth}
        disabled={!mayEdit}
        title={editDisabledReason}
        placeholder={placeholderOf("Date of birth")}
      />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="person-date-of-death">Date of death</Label>
      <Input
        id="person-date-of-death"
        type="date"
        bind:value={dateOfDeath}
        disabled={!mayEdit}
        title={editDisabledReason}
        placeholder={placeholderOf("Date of death")}
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
    <Alert.Root variant="danger">
      <Alert.Description>{failure}</Alert.Description>
    </Alert.Root>
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

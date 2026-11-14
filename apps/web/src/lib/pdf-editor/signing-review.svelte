<script lang="ts">
  /*
   * The second step of sending a document for signature: the order people sign in, the email they
   * get, and how long the request stays open. Mockup screen 6.
   *
   * Whether the request can be sent is the server's call, and it names what is missing; this step
   * only shows the member what will go out.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Textarea from "@magna-carta/design-system/textarea";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { attributionLabel, fieldCounts, initialsOf, toneOf, type SigningDraft, type SigningOrder } from "./signing-draft.ts";

  let { draft = $bindable(), disabled }: { draft: SigningDraft; disabled: boolean } = $props();

  const REMINDER_ITEMS = [
    { value: "none", label: "No Reminders" },
    { value: "1", label: "Every Day" },
    { value: "2", label: "Every 2 Days" },
    { value: "3", label: "Every 3 Days" },
    { value: "7", label: "Every Week" },
  ];

  const counts = $derived(fieldCounts(draft));
</script>

<div class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-24 overflow-auto p-24">
  <section class="flex flex-col gap-8" aria-labelledby="signing-review-signers">
    <div class="flex flex-wrap items-center gap-16">
      <h2 id="signing-review-signers" class="text-sm font-semibold">Who Signs</h2>
      <RadioGroup.Root
        aria-label="Signing order"
        value={draft.order}
        onValueChange={(next) => (draft = { ...draft, order: next as SigningOrder })}
        {disabled}
        class="flex gap-24"
      >
        <label class="flex items-center gap-8 text-sm">
          <RadioGroup.Item value="in-order" /> In Order
          <span class="text-text-subtle">each signer is sent the request after the one before signs</span>
        </label>
        <label class="flex items-center gap-8 text-sm">
          <RadioGroup.Item value="all-at-once" /> All at Once
        </label>
      </RadioGroup.Root>
    </div>
    <DataTable.Root class="w-full">
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>#</DataTable.Head>
          <DataTable.Head>Signer</DataTable.Head>
          <DataTable.Head>Proves Identity By</DataTable.Head>
          <DataTable.Head>Fields</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each draft.signers as signer, index (signer.key)}
          <DataTable.Row>
            <DataTable.Cell class="tabular-nums">{draft.order === "in-order" ? index + 1 : ""}</DataTable.Cell>
            <DataTable.Cell>
              <span class="flex items-center gap-8">
                <span class="flex size-24 flex-none items-center justify-center rounded-full text-xs font-semibold {toneOf(index).chip}">
                  {initialsOf(signer.name)}
                </span>
                <span class="flex min-w-0 flex-col">
                  <span>{signer.name}</span>
                  {#if signer.attribution !== "firm-authenticated"}
                    <span class="text-xs text-text-muted">{signer.email}</span>
                  {/if}
                </span>
              </span>
            </DataTable.Cell>
            <DataTable.Cell>{attributionLabel(signer.attribution)}</DataTable.Cell>
            <DataTable.Cell class="tabular-nums">{counts.get(signer.key) ?? 0}</DataTable.Cell>
          </DataTable.Row>
        {:else}
          <DataTable.Row>
            <DataTable.Cell colspan={4} class="text-text-muted">No signers yet. Add them on the Fields step.</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </section>

  <section class="grid max-w-3xl gap-16" aria-labelledby="signing-review-email">
    <h2 id="signing-review-email" class="text-sm font-semibold">The Email</h2>
    <LabelledField label="Subject">
      {#snippet children({ props })}
        <Input {...props} {disabled} maxlength={200} value={draft.subject} oninput={(event) => (draft = { ...draft, subject: event.currentTarget.value })} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Message" hint="Optional. Shown to every signer above the link.">
      {#snippet children({ props })}
        <Textarea {...props} {disabled} rows={4} maxlength={4000} value={draft.message} oninput={(event) => (draft = { ...draft, message: event.currentTarget.value })} />
      {/snippet}
    </LabelledField>
    <div class="grid gap-16 sm:grid-cols-2">
      <div class="flex flex-col gap-8">
        <DatePicker
          label="Signable Until"
          value={civilDateValue(draft.expiresOn)}
          onValueChange={(next) => {
            const day = civilDateTextOrEmpty(next);
            if (day !== "") draft = { ...draft, expiresOn: day };
          }}
          {disabled}
        />
      </div>
      <div class="flex flex-col gap-8">
        <Label id="signing-review-reminders">Reminders</Label>
        <Select.Root
          type="single"
          items={REMINDER_ITEMS}
          allowDeselect={false}
          {disabled}
          bind:value={
            () => (draft.remindEveryDays === null ? "none" : String(draft.remindEveryDays)),
            (picked) => (draft = { ...draft, remindEveryDays: picked === "none" || picked === "" ? null : Number(picked) })
          }
        >
          <Select.Trigger aria-labelledby="signing-review-reminders">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each REMINDER_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  </section>
</div>

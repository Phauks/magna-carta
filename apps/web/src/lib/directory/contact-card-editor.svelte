<script lang="ts">
  /*
   * A record's Contact card: its email addresses and its telephone and fax numbers, read as a plain
   * list, and changed all at once.
   *
   * READ FIRST, EDIT ON ASKING (owner ruling 2026-11-14: "there are too many buttons, and once you
   * use preferred you cannot change that"). The list carries no controls of its own, only what each
   * line is: its value, its type, and the Preferred, Do Not Use and Did Not Reach marks. One Edit
   * button turns every line into its fields together. Preferred and Do Not Use become switches that
   * move both ways, a line is taken away with its bin, Add Email, Add Phone and Add Fax add lines,
   * and one Save sends what changed (./contact-edit-plan.ts works out which writes that is). Cancel
   * leaves the record exactly as it was.
   *
   * A number keeps its country: each one is edited in the same country-and-number field it was
   * entered in (./phone-number-field.svelte), so a correction never drops the dial code.
   *
   * A line that cannot be saved is marked by its red edge and nothing else; Save stays available
   * and refuses by marking every line that is not ready.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import Ban from "@lucide/svelte/icons/ban";
  import Mail from "@lucide/svelte/icons/mail";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Phone from "@lucide/svelte/icons/phone";
  import Plus from "@lucide/svelte/icons/plus";
  import Printer from "@lucide/svelte/icons/printer";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import {
    CONTACT_KINDS,
    contactDraftRefusal,
    emptyContactDraft,
    FAX_USES,
    TELEPHONE_USES,
    type ContactDraft,
    type ContactKind,
    type ContactRow,
  } from "./contact-draft.ts";
  import {
    firstRefusedLine,
    isEmptyNewLine,
    lineFromRow,
    newLine,
    planContactEdits,
    withPreferred,
    type ContactEdit,
    type EditedContactLine,
  } from "./contact-edit-plan.ts";
  import type { DirectoryContactUse } from "./directory-api.ts";
  import { EMAIL_USES } from "./directory-vocabulary.ts";
  import PhoneNumberField from "./phone-number-field.svelte";

  let {
    rows,
    canEdit,
    editDisabledReason,
    draftFor,
    onSave,
  }: {
    rows: readonly ContactRow[];
    canEdit: boolean;
    editDisabledReason?: string;
    /** A recorded line, back as the draft its fields edit. */
    draftFor: (row: ContactRow) => ContactDraft;
    /** Sends the writes; resolves true once every one landed, false if one did not. */
    onSave: (edits: readonly ContactEdit[]) => Promise<boolean>;
  } = $props();

  let editing = $state(false);
  let lines = $state<EditedContactLine[]>([]);
  let saving = $state(false);
  /** Set by a refused Save, so the lines that are not ready show it; cleared by the next edit. */
  let showRefusals = $state(false);

  function begin(): void {
    lines = rows.map((row) => lineFromRow(row, draftFor(row)));
    showRefusals = false;
    editing = true;
  }

  function beginWith(kind: ContactKind): void {
    if (!editing) begin();
    add(kind);
  }

  function cancel(): void {
    editing = false;
    lines = [];
  }

  function add(kind: ContactKind): void {
    lines = [...lines, newLine(emptyContactDraft(kind))];
  }

  function patch(index: number, changes: Record<string, string>): void {
    lines = lines.map((line, at) =>
      at === index ? { ...line, draft: { ...line.draft, ...changes } as ContactDraft } : line,
    );
  }

  function setPreferred(index: number, preferred: boolean): void {
    lines = withPreferred(lines, index, preferred);
  }

  function setPermitted(index: number, permitted: boolean): void {
    lines = lines.map((line, at) => (at === index ? { ...line, permitted } : line));
  }

  function takeAway(index: number): void {
    lines = lines.map((line, at) => (at === index ? { ...line, removed: true } : line));
  }

  async function save(): Promise<void> {
    if (saving) return;
    if (firstRefusedLine(lines) !== null) {
      showRefusals = true;
      return;
    }
    const edits = planContactEdits(lines);
    if (edits.length === 0) {
      cancel();
      return;
    }
    saving = true;
    const landed = await onSave(edits);
    saving = false;
    if (landed) cancel();
  }

  function lineError(line: EditedContactLine): string | undefined {
    if (line.removed || isEmptyNewLine(line)) return undefined;
    const refusal = contactDraftRefusal(line.draft);
    if (refusal === null) return undefined;
    // A line the reader is still typing into is not shouted at; a refused Save marks every one.
    return showRefusals || line.row !== null ? refusal : undefined;
  }

  function usesFor(kind: ContactKind) {
    return [...(kind === "email" ? EMAIL_USES : kind === "fax" ? FAX_USES : TELEPHONE_USES)];
  }

  function glyphOf(kind: ContactKind) {
    return kind === "email" ? Mail : kind === "fax" ? Printer : Phone;
  }

  function kindLabel(kind: ContactKind): string {
    return CONTACT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
  }
</script>

<section class="flex flex-col gap-12">
  {#if !editing}
    {#if rows.length === 0}
      <p class="m-0 text-sm text-text-muted">No email addresses or numbers yet.</p>
    {:else}
      <ul class="flex flex-col">
        {#each rows as row (row.id)}
          {@const Glyph = glyphOf(row.kind)}
          <li class="flex min-h-40 items-center gap-8 border-b border-border-default py-4">
            <Glyph class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
            <span class="sr-only">{kindLabel(row.kind)}</span>
            <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
              <span
                class="min-w-0 break-all {row.kind === 'telephone' || row.kind === 'fax'
                  ? 'tabular-nums'
                  : ''}">{row.value}</span
              >
              {#if row.use !== null}
                <span class="text-xs text-text-muted">{row.use}</span>
              {/if}
              {#if row.state.note !== null}
                <span class="text-xs text-text-muted">{row.state.note}</span>
              {/if}
            </span>
            <span class="flex shrink-0 flex-wrap items-center justify-end gap-4">
              {#if row.state.preferred}
                <Badge variant="accent">Preferred</Badge>
              {/if}
              {#if !row.state.permitted}
                <Badge variant="warning">Do not use</Badge>
              {/if}
              {#if row.state.verificationStatus === "failed"}
                <Badge variant="danger">
                  <TriangleAlert class="size-12" aria-hidden="true" />
                  Did not reach
                </Badge>
              {:else if row.state.verificationStatus === "verified"}
                <Badge variant="success">Confirmed</Badge>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex flex-wrap gap-8">
      {#if rows.length > 0}
        <Button
          variant="secondary"
          size="sm"
          disabled={!canEdit}
          title={editDisabledReason}
          onclick={begin}
        >
          <Pencil class="size-16" aria-hidden="true" />
          Edit
        </Button>
      {/if}
      {@render addButtons()}
    </div>
  {:else}
    <ul class="flex flex-col gap-8">
      {#each lines as line, index (index)}
        {#if !line.removed}
          {@const Glyph = glyphOf(line.draft.kind)}
          {@const error = lineError(line)}
          <li class="flex flex-wrap items-end gap-8 rounded-md bg-surface-sunken p-8">
            <span class="flex h-40 shrink-0 items-center" title={kindLabel(line.draft.kind)}>
              <Glyph class="size-16 text-text-muted" aria-hidden="true" />
              <span class="sr-only">{kindLabel(line.draft.kind)}</span>
            </span>
            {#if line.draft.kind === "email"}
              {@const email = line.draft}
              <div class="min-w-0 flex-auto" style="flex-basis: 16rem">
                <LabelledField label="Address" {error}>
                  {#snippet children({ props })}
                    <Input
                      {...props}
                      type="email"
                      autocomplete="off"
                      value={email.address}
                      disabled={saving}
                      placeholder={placeholderOf("Address")}
                      oninput={(event) => patch(index, { address: event.currentTarget.value })}
                    />
                  {/snippet}
                </LabelledField>
              </div>
            {:else if line.draft.kind === "telephone" || line.draft.kind === "fax"}
              {@const number = line.draft}
              <div class="min-w-0 flex-auto" style="flex-basis: 16rem">
                <PhoneNumberField
                  bind:region={() => number.region, (chosen) => patch(index, { region: chosen })}
                  bind:number={() => number.number, (typed) => patch(index, { number: typed })}
                  bind:extension={
                    () => number.extension, (typed) => patch(index, { extension: typed })
                  }
                  disabled={saving}
                  {error}
                />
              </div>
            {/if}
            <div style="width: 8rem">
              <LabelledField label="Type">
                {#snippet children({ props })}
                  <ChoicePicker
                    options={usesFor(line.draft.kind)}
                    inputId={props.id}
                    label="Type"
                    disabled={saving}
                    bind:value={
                      () => line.draft.use,
                      (chosen) => patch(index, { use: chosen as DirectoryContactUse })
                    }
                  />
                {/snippet}
              </LabelledField>
            </div>
            <div class="flex items-center gap-4">
              <Button
                variant={line.preferred ? "accent" : "secondary"}
                size="sm"
                aria-pressed={line.preferred}
                disabled={saving}
                title={line.preferred
                  ? "The way they asked to be reached. Press to take that away."
                  : "Make this the way they asked to be reached"}
                onclick={() => setPreferred(index, !line.preferred)}
              >
                <Star
                  class="size-16 {line.preferred ? 'fill-current' : ''}"
                  aria-hidden="true"
                />
                Preferred
              </Button>
              <Button
                variant={line.permitted ? "secondary" : "accent"}
                size="sm"
                aria-pressed={!line.permitted}
                disabled={saving}
                title={line.permitted
                  ? "Record that the firm should not use this"
                  : "The firm should not use this. Press to allow it again."}
                onclick={() => setPermitted(index, !line.permitted)}
              >
                <Ban class="size-16" aria-hidden="true" />
                Do not use
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={saving}
                title="Remove"
                aria-label="Remove this {kindLabel(line.draft.kind).toLowerCase()}"
                onclick={() => takeAway(index)}
              >
                <Trash2 class="size-16" aria-hidden="true" />
              </Button>
            </div>
          </li>
        {/if}
      {/each}
    </ul>
    <div class="flex flex-wrap items-center gap-8">
      {@render addButtons()}
      <span class="flex-auto"></span>
      <Button variant="ghost" disabled={saving} onclick={cancel}>Cancel</Button>
      <Button variant="primary" disabled={saving} onclick={() => void save()}>
        {saving ? "Saving" : "Save Contact"}
      </Button>
    </div>
  {/if}
</section>

{#snippet addButtons()}
  {#each [["email", "Add Email"], ["telephone", "Add Phone"], ["fax", "Add Fax"]] as const as [kind, label] (kind)}
    <Button
      variant="secondary"
      size="sm"
      disabled={!canEdit || saving}
      title={editDisabledReason}
      onclick={() => beginWith(kind)}
    >
      <Plus class="size-16" aria-hidden="true" />
      {label}
    </Button>
  {/each}
{/snippet}

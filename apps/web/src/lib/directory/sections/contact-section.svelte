<script lang="ts">
  /*
   * How the firm can reach someone: one dense list, and one entry row whose KIND comes first.
   *
   * Every way to reach a person is one line: the kind as a glyph, the value formatted, the use
   * beside it, the record's marks after, and the row's own controls at the end. The entry row asks
   * the kind first — Email, Telephone, Fax — and the kind decides the fields; each kind checks its
   * own shape before the plus is live, by the rule the API applies (contact-draft.ts). A number is
   * entered in the product's one number field (../phone-number-field.svelte), the same one the call
   * log uses, so the country and the digits are one control everywhere; the kind and the use are the
   * product's one typed picker ($lib/components/choice-picker.svelte), because every closed choice
   * takes typing.
   *
   * A POSTAL ADDRESS IS NOT ONE OF THESE, and it used to be. An address is not a field, it is a form
   * of six to nine boxes whose shape is the country's; standing it under the same kind dropdown as a
   * one-line email made the entry row grow a second layout and read as though the four kinds were
   * alike. It has its own section now (address-section.svelte), beside this one.
   *
   * A RECORDED VALUE IS CORRECTED, NOT DELETED AND RETYPED. Pressing a row's pencil loads it back
   * into the entry row it was entered in; the row states that it is being corrected, and the entry
   * row's commit writes the change rather than adding a second one. Delete-and-retype was the only
   * way before, and it is not a correction: the removal is its own fact on the record, and the
   * permission and preference attached to the value go with it.
   *
   * NO BOX AROUND THE ENTRY ROW. It is the last row of the list, not a panel sitting beneath one:
   * the rule above it is the same rule between every other pair of rows, so the eye reads one list
   * that ends in an empty line rather than a list and a form.
   *
   * Data-blind: it lists what it is given and hands a checked draft to whoever owns the record.
   * The New Person dialog keeps the drafts until one commit records them all; the record's Contact
   * pane records each one as it is added. Neither knows the other exists.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import Ban from "@lucide/svelte/icons/ban";
  import Check from "@lucide/svelte/icons/check";
  import Mail from "@lucide/svelte/icons/mail";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Phone from "@lucide/svelte/icons/phone";
  import Plus from "@lucide/svelte/icons/plus";
  import Printer from "@lucide/svelte/icons/printer";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import {
    CONTACT_KINDS,
    REACHABLE_KINDS,
    contactDraftRefusal,
    contactDraftStarted,
    emptyContactDraft,
    FAX_USES,
    TELEPHONE_USES,
    type ContactDraft,
    type ContactKind,
    type ContactRow,
  } from "../contact-draft.ts";
  import type { DirectoryContactUse } from "../directory-api.ts";
  import { EMAIL_USES } from "../directory-vocabulary.ts";
  import PhoneNumberField from "../phone-number-field.svelte";
  import SectionHeading from "./section-heading.svelte";

  let {
    rows,
    canEdit = true,
    editDisabledReason,
    busyId = null,
    onAdd,
    onEdit,
    onChange,
    onRemove,
    onPreferred,
    onPermitted,
  }: {
    rows: readonly ContactRow[];
    canEdit?: boolean;
    editDisabledReason?: string;
    /** The row a write is in flight for; its controls wait. */
    busyId?: string | null;
    /** A checked draft. The owner records it, or keeps it until the record exists. */
    onAdd: (draft: ContactDraft) => void;
    /**
     * The draft that row's value should be corrected into. Offered only where the owner can write a
     * correction; a surface without it shows no pencil, which is the standing rule for a control
     * that cannot act.
     */
    onEdit?: (row: ContactRow) => ContactDraft;
    /** Write the correction. Paired with `onEdit` — a surface offers both or neither. */
    onChange?: (row: ContactRow, draft: ContactDraft) => void;
    onRemove?: (row: ContactRow) => void;
    /** Make this the preferred way to reach them. Offered only where the owner can record it. */
    onPreferred?: (row: ContactRow) => void;
    onPermitted?: (row: ContactRow, permitted: boolean) => void;
  } = $props();


  let draft = $state<ContactDraft>(emptyContactDraft("email"));
  /** The recorded row being corrected, or null while the entry row is adding a new one. */
  let correcting = $state<ContactRow | null>(null);

  const correctable = $derived(onEdit !== undefined && onChange !== undefined);

  function startDraft(kind: ContactKind): void {
    draft = emptyContactDraft(kind);
  }

  /** One patch for every kind: the union's readonly fields are replaced, never mutated. */
  function patch(changes: Record<string, string>): void {
    draft = { ...draft, ...changes } as ContactDraft;
  }

  const refusal = $derived(contactDraftRefusal(draft));
  const started = $derived(contactDraftStarted(draft));
  /** The refusal, on the field it is about, once something has been typed. */
  const fieldError = $derived(started && refusal !== null ? refusal : undefined);
  const kindItems = REACHABLE_KINDS.map((entry) => ({ value: entry.value, label: entry.label }));
  const useItems = $derived([
    ...(draft.kind === "email" ? EMAIL_USES : draft.kind === "fax" ? FAX_USES : TELEPHONE_USES),
  ]);

  function correct(row: ContactRow): void {
    if (onEdit === undefined) return;
    draft = onEdit(row);
    correcting = row;
  }

  function abandonCorrection(): void {
    correcting = null;
    draft = emptyContactDraft("email");
  }

  function commit(): void {
    if (refusal !== null || !canEdit) return;
    if (correcting !== null) {
      onChange?.(correcting, draft);
      abandonCorrection();
      return;
    }
    onAdd(draft);
    draft = emptyContactDraft(draft.kind);
  }

  function glyphOf(kind: ContactKind) {
    switch (kind) {
      case "email":
        return Mail;
      case "telephone":
        return Phone;
      case "fax":
        return Printer;
      case "address":
        // Not reachable from this section — an address is entered and listed on its own — but the
        // row shape is shared, so the kind keeps its own glyph rather than borrowing another's.
        return MapPin;
    }
  }
</script>

<section class="flex flex-col gap-12">
  <SectionHeading label="Ways To Reach Them" count={rows.length} />

  <ul class="flex flex-col">
    {#each rows as row (row.id)}
      {@const Glyph = glyphOf(row.kind)}
      {@const beingCorrected = correcting?.id === row.id}
      <li
        class="flex items-center gap-8 border-b border-border-default py-4"
        class:text-text-muted={beingCorrected}
      >
        <Glyph class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
        <span class="sr-only">{CONTACT_KINDS.find((entry) => entry.value === row.kind)?.label}</span>
        <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
          <span class={row.kind === "telephone" || row.kind === "fax" ? "tabular-nums" : ""}>
            {row.value}
          </span>
          {#if row.use !== null}
            <span class="text-xs text-text-muted">{row.use}</span>
          {/if}
          {#if row.state.note !== null}
            <span class="text-xs text-text-muted">{row.state.note}</span>
          {/if}
          {#if beingCorrected}
            <!-- Where the value went: the row it left is still on screen and says so, so nobody
                 thinks the entry row below is about to add a second copy of it. -->
            <span class="text-xs text-text-muted">Being corrected below</span>
          {/if}
        </span>
        <span class="flex shrink-0 items-center gap-4">
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
        <span class="flex shrink-0 items-center">
          {#if correctable}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canEdit || busyId === row.id || beingCorrected}
              title={editDisabledReason ?? "Correct this"}
              aria-label="Correct {row.value}"
              onclick={() => correct(row)}
            >
              <PenLine class="size-16" aria-hidden="true" />
            </Button>
          {/if}
          {#if onPreferred !== undefined && !row.state.preferred}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canEdit || busyId === row.id}
              title={editDisabledReason ?? "Make this the preferred way to reach them"}
              aria-label="Prefer {row.value}"
              onclick={() => onPreferred?.(row)}
            >
              <Star class="size-16" aria-hidden="true" />
            </Button>
          {/if}
          {#if onPermitted !== undefined}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canEdit || busyId === row.id}
              title={editDisabledReason ??
                (row.state.permitted
                  ? "Record that the firm should not use this"
                  : "Record that the firm may use this again")}
              aria-label={row.state.permitted
                ? `Record do not use for ${row.value}`
                : `Record may be used for ${row.value}`}
              onclick={() => onPermitted?.(row, !row.state.permitted)}
            >
              <Ban class="size-16" aria-hidden="true" />
            </Button>
          {/if}
          {#if onRemove !== undefined}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canEdit || busyId === row.id}
              title={editDisabledReason ?? "Remove"}
              aria-label="Remove {row.value}"
              onclick={() => onRemove?.(row)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </span>
      </li>
    {/each}

    <!-- The entry row: the last line of the same list, under the same rule. The kind first; the
         fields it decides; the commit live once the value fits. -->
    <li class="flex flex-wrap items-end gap-8 py-8">
      <div style="width: 8rem">
        <LabelledField label="Kind">
          {#snippet children({ props })}
            <ChoicePicker
              options={kindItems}
              inputId={props.id}
              label="Kind"
              disabled={!canEdit || correcting !== null}
              title={correcting === null
                ? undefined
                : "A correction changes the value, not what kind of thing it is."}
              bind:value={() => draft.kind, (chosen) => startDraft(chosen as ContactKind)}
            />
          {/snippet}
        </LabelledField>
      </div>

      {#if draft.kind === "email"}
        {@const email = draft}
        <LabelledField label="Address" class="min-w-0 flex-auto" error={fieldError}>
          {#snippet children({ props })}
            <Input
              {...props}
              type="email"
              autocomplete="off"
              value={email.address}
              disabled={!canEdit}
              placeholder={placeholderOf("Address")}
              oninput={(event) => patch({ address: event.currentTarget.value })}
            />
          {/snippet}
        </LabelledField>
      {:else if draft.kind === "telephone" || draft.kind === "fax"}
        {@const number = draft}
        <!-- The country, the digits AND the extension are ONE field, and it is the same one the call
             log enters a number in (../phone-number-field.svelte). Two hand-built copies of this
             pair is how the two came to format a deletion differently; the extension was the last
             half still built here, and building it here is why typing a direct dial onto the end of
             a number stopped the grouping instead of rolling into it. -->
        <div class="min-w-0 flex-auto">
          <PhoneNumberField
            bind:region={() => number.region, (chosen) => patch({ region: chosen })}
            bind:number={() => number.number, (typed) => patch({ number: typed })}
            bind:extension={() => number.extension, (typed) => patch({ extension: typed })}
            disabled={!canEdit}
            error={fieldError}
          />
        </div>
      {/if}

      {#if draft.kind !== "address"}
        {@const chosenUse = draft.use}
        <div style="width: 8rem">
          <LabelledField label="Type">
            {#snippet children({ props })}
              <ChoicePicker
                options={useItems}
                inputId={props.id}
                label="Type"
                disabled={!canEdit}
                bind:value={
                  () => chosenUse, (chosen) => patch({ use: chosen as DirectoryContactUse })
                }
              />
            {/snippet}
          </LabelledField>
        </div>
        {#if correcting !== null}
          <Button
            variant="ghost"
            size="icon"
            title="Leave it as it is"
            aria-label="Leave this way to reach them as it is"
            onclick={abandonCorrection}
          >
            <X class="size-16" aria-hidden="true" />
          </Button>
        {/if}
        <Button
          variant="secondary"
          size="icon"
          disabled={!canEdit || refusal !== null}
          title={editDisabledReason ?? refusal ?? (correcting === null ? "Add" : "Save the correction")}
          aria-label={correcting === null
            ? "Add this way to reach them"
            : "Save this correction"}
          onclick={commit}
        >
          {#if correcting === null}
            <Plus class="size-16" aria-hidden="true" />
          {:else}
            <Check class="size-16" aria-hidden="true" />
          {/if}
        </Button>
      {/if}
    </li>
  </ul>
</section>

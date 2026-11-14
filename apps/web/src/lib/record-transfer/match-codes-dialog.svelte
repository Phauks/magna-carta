<script lang="ts">
  /*
   * Match Types and Match Staff: the source's own codes, each matched to one of the firm's matter
   * types or members.
   *
   * A source file names a matter's type and its lawyer by the source system's codes ("CONV", "AL").
   * The operator adds each code and picks what it stands for here. For staff there is also a member
   * for everyone else, who takes every row whose code is not matched.
   *
   * The codes are typed, not offered: nothing reads a column's distinct values yet. So this panel
   * counts what has been matched and never claims to know what has not.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";

  /** What the Everyone Else field holds when nobody takes the unmatched rows. */
  const NOBODY = "nobody";

  let {
    open = $bindable(false),
    heading,
    fileName,
    targetLabel,
    targets,
    matches,
    otherwise,
    onSave,
  }: {
    open?: boolean;
    /** "Match Types" or "Match Staff". */
    heading: string;
    fileName: string;
    /** What a code is matched to: "Matter Type" or "Member". */
    targetLabel: string;
    /** The firm's matter types or members. */
    targets: readonly ChoiceOption[];
    matches: Readonly<Record<string, string>>;
    /** The member for unmatched rows. Passed only for staff; undefined hides the field. */
    otherwise?: string;
    onSave: (matches: Record<string, string>, otherwise: string) => void;
  } = $props();

  interface MatchRow {
    readonly key: number;
    code: string;
    target: string;
  }

  let rows = $state<MatchRow[]>([]);
  let everyoneElse = $state(NOBODY);
  let attempted = $state(false);
  let nextKey = 0;

  const everyoneElseOptions = $derived<readonly ChoiceOption[]>([
    { value: NOBODY, label: "(None)" },
    ...targets,
  ]);

  function reset(): void {
    rows = Object.entries(matches).map(([code, target]) => ({ key: nextKey++, code, target }));
    everyoneElse = otherwise === undefined || otherwise === "" ? NOBODY : otherwise;
    attempted = false;
  }

  function addRow(): void {
    rows.push({ key: nextKey++, code: "", target: "" });
  }

  function removeRow(key: number): void {
    rows = rows.filter((row) => row.key !== key);
  }

  /** A code is refused when it is empty or an earlier row already has it. */
  function codeRefused(row: MatchRow): boolean {
    const code = row.code.trim();
    return code === "" || rows.some((other) => other !== row && other.code.trim() === code);
  }

  const refused = $derived(rows.some((row) => codeRefused(row) || row.target === ""));
  const changed = $derived(
    JSON.stringify(Object.fromEntries(rows.map((row) => [row.code.trim(), row.target]))) !==
      JSON.stringify(matches) ||
      (otherwise !== undefined && (everyoneElse === NOBODY ? "" : everyoneElse) !== otherwise),
  );

  async function save(): Promise<ActionOutcome> {
    attempted = true;
    if (refused) return "refused";
    onSave(
      Object.fromEntries(rows.map((row) => [row.code.trim(), row.target])),
      everyoneElse === NOBODY ? "" : everyoneElse,
    );
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  {heading}
  subtitle={{ facts: [fileName] }}
  commitLabel="Match"
  unsavedChanges={changed}
  onOpen={reset}
  onCommit={save}
>
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <div class="flex items-center gap-8">
          <FieldLabel class="min-w-0 flex-1">Code in the File</FieldLabel>
          <FieldLabel class="min-w-0 flex-1">{targetLabel}</FieldLabel>
          <span class="size-32 shrink-0" aria-hidden="true"></span>
        </div>
        {#each rows as row (row.key)}
          <div class="flex items-center gap-8">
            <div class="min-w-0 flex-1">
              <Input
                bind:value={row.code}
                aria-label="Code in the File"
                aria-invalid={attempted && codeRefused(row) ? "true" : undefined}
                maxlength={200}
                autocomplete="off"
                spellcheck={false}
              />
            </div>
            <div class="min-w-0 flex-1">
              <ChoicePicker
                label={targetLabel}
                options={targets}
                bind:value={row.target}
                invalid={attempted && row.target === ""}
                fillsCell
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove {row.code.trim() === '' ? 'this code' : row.code.trim()}"
              onclick={() => removeRow(row.key)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </div>
        {/each}
        <div>
          <Button variant="secondary" size="sm" onclick={addRow}>
            <Plus class="size-16" aria-hidden="true" />
            Add Code
          </Button>
        </div>
      </div>
      {#if otherwise !== undefined}
        <LabelledField label="Everyone Else">
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Everyone Else"
              options={everyoneElseOptions}
              bind:value={everyoneElse}
            />
          {/snippet}
        </LabelledField>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

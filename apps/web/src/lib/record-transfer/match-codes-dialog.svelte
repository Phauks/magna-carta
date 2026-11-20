<script lang="ts">
  /*
   * Match Types and Match Staff: the source's own codes, each matched to one of the firm's matter
   * types or members.
   *
   * A source file names a matter's type and its lawyer by the source system's codes ("CONV", "AL").
   * The codes listed here are the ones the file's own column has, most used first, each with the
   * number of rows that use it, so every code is matched by looking at it and none is typed from
   * memory. A code left at Not Matched stays unmatched. For staff there is also a member for
   * everyone else, who takes every row whose code is not matched.
   *
   * A code is typed by hand only where the list cannot be whole: the column has more codes than
   * are listed, or the column could not be read. A code matched earlier that the list does not
   * have stays on the panel under the listed ones, where it can be removed.
   *
   * A value is trimmed and then compared exactly, which is how a pass reads it.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { codeMatchingLabel, codeMatchingOf } from "./column-mapping.ts";
  import type { ColumnCodesRead } from "./record-transfer-api.ts";
  import { formatCount } from "./transfer-run-view.ts";

  /** What the Everyone Else field holds when nobody takes the unmatched rows. */
  const NOBODY = "nobody";
  /** What a code's field holds while the code is not matched. */
  const NOT_MATCHED = "not-matched";
  /** How many of the file's codes show before the rest are asked for. */
  const FIRST_CODES = 100;

  let {
    open = $bindable(false),
    heading,
    fileName,
    targetLabel,
    targets,
    matches,
    otherwise,
    codes,
    onRetryCodes,
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
    /** The codes the file's own column has, as far as they have been read. */
    codes: ColumnCodesRead;
    onRetryCodes: () => void;
    onSave: (matches: Record<string, string>, otherwise: string) => void;
  } = $props();

  interface TypedRow {
    readonly key: number;
    code: string;
    target: string;
  }

  /** What each known code is matched to, by the code. */
  let chosen = $state<Record<string, string>>({});
  /** Codes matched before this opening, which stay listed where the file's list lacks them. */
  let earlier = $state<string[]>([]);
  /** Codes typed by hand in this opening. */
  let typed = $state<TypedRow[]>([]);
  let everyoneElse = $state(NOBODY);
  let attempted = $state(false);
  let showAll = $state(false);
  let nextKey = 0;

  const targetOptions = $derived<readonly ChoiceOption[]>([
    { value: NOT_MATCHED, label: "(Not Matched)" },
    ...targets,
  ]);
  const everyoneElseOptions = $derived<readonly ChoiceOption[]>([
    { value: NOBODY, label: "(None)" },
    ...targets,
  ]);

  /** The file's own codes, trimmed, each once. */
  const listed = $derived.by(() => {
    if (codes.kind !== "read") return [];
    const seen = new Set<string>();
    const found: { code: string; rowCount: number }[] = [];
    for (const entry of codes.codes) {
      const code = entry.value.trim();
      if (code === "" || seen.has(code)) continue;
      seen.add(code);
      found.push({ code, rowCount: entry.rowCount });
    }
    return found;
  });
  const listedCodes = $derived(new Set(listed.map((entry) => entry.code)));
  const shownListed = $derived(showAll ? listed : listed.slice(0, FIRST_CODES));
  /** Codes matched earlier that the file's list does not have. */
  const unlisted = $derived(earlier.filter((code) => !listedCodes.has(code)));
  /** The list cannot be whole, so a code may be typed. */
  const incomplete = $derived(codes.kind === "failed" || (codes.kind === "read" && codes.truncated));

  function targetOf(code: string): string {
    const target = chosen[code];
    return target === undefined || target === "" ? NOT_MATCHED : target;
  }

  function choose(code: string, target: string): void {
    chosen = { ...chosen, [code]: target === NOT_MATCHED ? "" : target };
  }

  function reset(): void {
    chosen = Object.fromEntries(Object.entries(matches).map(([code, target]) => [code.trim(), target]));
    earlier = Object.keys(matches).map((code) => code.trim());
    typed = [];
    everyoneElse = otherwise === undefined || otherwise === "" ? NOBODY : otherwise;
    attempted = false;
    showAll = false;
  }

  function addRow(): void {
    typed.push({ key: nextKey++, code: "", target: "" });
  }

  function removeTyped(key: number): void {
    typed = typed.filter((row) => row.key !== key);
  }

  function removeEarlier(code: string): void {
    earlier = earlier.filter((known) => known !== code);
  }

  /** A typed code is refused when it is empty, or the panel already has it. */
  function codeRefused(row: TypedRow): boolean {
    const code = row.code.trim();
    return (
      code === "" ||
      listedCodes.has(code) ||
      unlisted.includes(code) ||
      typed.some((other) => other !== row && other.code.trim() === code)
    );
  }

  /** The matches as they stand: every code with a match chosen, and nothing else. */
  const result = $derived.by(() => {
    const found: Record<string, string> = {};
    for (const code of [...listed.map((entry) => entry.code), ...unlisted]) {
      const target = chosen[code];
      if (target !== undefined && target !== "") found[code] = target;
    }
    for (const row of typed) {
      const code = row.code.trim();
      if (code !== "" && row.target !== "") found[code] = row.target;
    }
    return found;
  });
  /** What saving nothing would leave: the matches the panel opened on, without the unchosen ones. */
  const opened = $derived(
    Object.fromEntries(
      Object.entries(matches)
        .map(([code, target]): [string, string] => [code.trim(), target])
        .filter(([, target]) => target !== ""),
    ),
  );

  function ordered(record: Readonly<Record<string, string>>): string {
    return JSON.stringify(Object.keys(record).toSorted().map((code) => [code, record[code]]));
  }

  const refused = $derived(typed.some((row) => codeRefused(row) || row.target === ""));
  const changed = $derived(
    typed.length > 0 ||
      ordered(result) !== ordered(opened) ||
      (otherwise !== undefined && (everyoneElse === NOBODY ? "" : everyoneElse) !== otherwise),
  );
  const standing = $derived(
    codes.kind === "read" ? codeMatchingLabel(codeMatchingOf(codes.codes, result)) : null,
  );

  function rowsLabel(rowCount: number): string {
    return `${formatCount(rowCount)} ${rowCount === 1 ? "row" : "rows"}`;
  }

  async function save(): Promise<ActionOutcome> {
    attempted = true;
    if (refused) return "refused";
    onSave({ ...result }, everyoneElse === NOBODY ? "" : everyoneElse);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  {heading}
  subtitle={{ facts: standing === null ? [fileName] : [fileName, standing] }}
  commitLabel="Match"
  unsavedChanges={changed}
  onOpen={reset}
  onCommit={save}
>
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      {#if codes.kind === "failed"}
        <FailureNotice
          failure={codes.failure.failure}
          title="The Codes Were Not Read"
          fallback={codes.failure.fallback}
          whenSilent={codes.failure.whenSilent}
          onRetry={onRetryCodes}
        />
      {:else if codes.kind === "read" && codes.truncated}
        <Alert.Root variant="info">
          <Alert.Description>
            This list is incomplete. The column has more codes than are shown. Add the others by
            hand.
          </Alert.Description>
        </Alert.Root>
      {/if}

      <LoadingRegion
        loading={codes.kind === "reading"}
        label="Reading the codes in the file"
        class="flex flex-col gap-8"
      >
        <div class="flex items-center gap-8">
          <FieldLabel class="min-w-0 flex-1">Code in the File</FieldLabel>
          <FieldLabel class="min-w-0 flex-1">{targetLabel}</FieldLabel>
          <span class="size-32 shrink-0" aria-hidden="true"></span>
        </div>
        {#each shownListed as entry (entry.code)}
          <div class="flex items-center gap-8">
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-mono text-sm break-all">{entry.code}</span>
              <span class="text-sm text-text-muted">{rowsLabel(entry.rowCount)}</span>
            </div>
            <div class="min-w-0 flex-1">
              <ChoicePicker
                label="{targetLabel} for {entry.code}"
                options={targetOptions}
                value={targetOf(entry.code)}
                fillsCell
                onchange={(target) => choose(entry.code, target)}
              />
            </div>
            <span class="size-32 shrink-0" aria-hidden="true"></span>
          </div>
        {/each}
        {#if listed.length > shownListed.length}
          <div>
            <Button variant="secondary" size="sm" onclick={() => (showAll = true)}>
              Show All {formatCount(listed.length)} Codes
            </Button>
          </div>
        {/if}
        {#each unlisted as code (code)}
          <div class="flex items-center gap-8">
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-mono text-sm break-all">{code}</span>
              {#if codes.kind === "read"}
                <span class="text-sm text-text-muted">Not in the list</span>
              {/if}
            </div>
            <div class="min-w-0 flex-1">
              <ChoicePicker
                label="{targetLabel} for {code}"
                options={targetOptions}
                value={targetOf(code)}
                fillsCell
                onchange={(target) => choose(code, target)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove {code}"
              onclick={() => removeEarlier(code)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </div>
        {/each}
        {#each typed as row (row.key)}
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
              onclick={() => removeTyped(row.key)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </div>
        {/each}
        {#if codes.kind === "read" && listed.length === 0 && unlisted.length === 0 && typed.length === 0}
          <p class="text-sm text-text-muted">No codes in this column.</p>
        {/if}
        {#if incomplete}
          <div>
            <Button variant="secondary" size="sm" onclick={addRow}>
              <Plus class="size-16" aria-hidden="true" />
              Add Code
            </Button>
          </div>
        {/if}
      </LoadingRegion>
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

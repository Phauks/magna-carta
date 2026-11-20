<script lang="ts" module>
  import type { BatesLogChoice, BatesLogSummary } from "./bates-api.ts";

  export const NEW_LOG = "new";
  const DEFAULT_DIGITS = 6;

  /** The log a picker opens on: the one named `preferredName`, else the most recent, else a new one. */
  export function openingChoice(
    logs: readonly BatesLogSummary[],
    preferredName: string | null,
    newName: string,
  ): BatesLogChoice {
    const named = preferredName === null ? undefined : logs.find((log) => log.name === preferredName);
    const picked = named ?? (preferredName === null ? logs[0] : undefined);
    if (picked !== undefined) return { kind: "log", log: picked };
    const latest = logs[0];
    return {
      kind: "new",
      name: newName,
      prefix: latest?.prefix ?? "",
      digits: latest?.digits ?? DEFAULT_DIGITS,
    };
  }

  /** What is wrong with a new log before it is sent: a red field, no words. */
  export function newLogProblems(
    choice: BatesLogChoice,
    logs: readonly BatesLogSummary[],
  ): { name?: string; prefix?: string; digits?: string } {
    if (choice.kind !== "new") return {};
    const problems: { name?: string; prefix?: string; digits?: string } = {};
    const name = choice.name.trim();
    if (name.length === 0 || name.length > 120 || logs.some((log) => log.name === name)) {
      problems.name = "Give the log a name no other log on this matter has.";
    }
    if (choice.prefix.length > 40) problems.prefix = "Keep the prefix to 40 characters.";
    if (!Number.isInteger(choice.digits) || choice.digits < 1 || choice.digits > 12) {
      problems.digits = "Use 1 to 12 digits.";
    }
    return problems;
  }
</script>

<script lang="ts">
  /*
   * Which of the matter's Bates logs a stamp takes its numbers from. A matter keeps one log per
   * filing or production that wants numbers of its own; each has a name, a prefix and a padding,
   * and counts from its own start. Picking New Log asks for those three, and the log is started
   * when the stamp is made (resolveBatesLog in bates-api.ts).
   */
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";

  let {
    logs,
    choice = $bindable(),
    disabled = false,
    onchange,
  }: {
    logs: readonly BatesLogSummary[];
    choice: BatesLogChoice;
    disabled?: boolean;
    /** Called after the reader changes anything, so a caller can clear a stale result. */
    onchange?: (choice: BatesLogChoice) => void;
  } = $props();

  const items = $derived([
    ...logs.map((log) => ({ value: log.id, label: log.name })),
    { value: NEW_LOG, label: "New Log" },
  ]);
  const problems = $derived(newLogProblems(choice, logs));
  let lastNewName = $state("");

  function set(next: BatesLogChoice): void {
    choice = next;
    onchange?.(next);
  }

  function pick(value: string): void {
    if (value === NEW_LOG) {
      if (choice.kind === "new") return;
      const latest = choice.log;
      set({ kind: "new", name: lastNewName, prefix: latest.prefix, digits: latest.digits });
      return;
    }
    const log = logs.find((entry) => entry.id === value);
    if (log === undefined) return;
    if (choice.kind === "new") lastNewName = choice.name;
    set({ kind: "log", log });
  }

  function whole(value: string, fallback: number): number {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fallback : parsed;
  }

  function padded(prefix: string, digits: number, number: number): string {
    return `${prefix}${String(number).padStart(Math.max(1, digits), "0")}`;
  }
</script>

<div class="flex flex-col gap-12">
  <LabelledField label="Bates Log">
    {#snippet children({ props })}
      <Select.Root
        type="single"
        {items}
        allowDeselect={false}
        {disabled}
        bind:value={() => (choice.kind === "new" ? NEW_LOG : choice.log.id), (picked) => pick(picked)}
      >
        <Select.Trigger id={props.id} aria-describedby={props["aria-describedby"]}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {#each items as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    {/snippet}
  </LabelledField>

  {#if choice.kind === "new"}
    {@const fresh = choice}
    <LabelledField necessity="required" label="Name" error={problems.name}>
      {#snippet children({ props })}
        <Input
          {...props}
          {disabled}
          value={fresh.name}
          placeholder="Motion for Summary Judgment"
          oninput={(event) => set({ ...fresh, name: event.currentTarget.value })}
        />
      {/snippet}
    </LabelledField>
    <FieldRow columns={2}>
      <LabelledField necessity="optional" label="Prefix" error={problems.prefix}>
        {#snippet children({ props })}
          <Input
            {...props}
            {disabled}
            value={fresh.prefix}
            placeholder="SMITH-"
            oninput={(event) => set({ ...fresh, prefix: event.currentTarget.value })}
          />
        {/snippet}
      </LabelledField>
      <LabelledField necessity="required" label="Digits" hint="Padded with zeros" error={problems.digits}>
        {#snippet children({ props })}
          <Input
            {...props}
            type="number"
            min="1"
            max="12"
            class="tabular-nums"
            {disabled}
            value={String(fresh.digits)}
            oninput={(event) => set({ ...fresh, digits: whole(event.currentTarget.value, fresh.digits) })}
          />
        {/snippet}
      </LabelledField>
    </FieldRow>
    <p class="text-xs text-text-muted">
      A new log counts from <span class="tabular-nums">{padded(fresh.prefix, fresh.digits, 1)}</span>, apart from
      the other logs on this matter.
    </p>
  {:else}
    <p class="text-xs text-text-muted">
      {choice.log.rangeCount === 0
        ? "Nothing stamped yet."
        : `${String(choice.log.pagesStamped)} ${choice.log.pagesStamped === 1 ? "page" : "pages"} stamped.`}
      Next is <span class="tabular-nums">{padded(choice.log.prefix, choice.log.digits, choice.log.nextNumber)}</span>.
    </p>
  {/if}
</div>

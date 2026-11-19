<script lang="ts">
  /*
   * Making a set's exhibit package: the list, then a cover sheet and the pages of each exhibit
   * still in the set, as one PDF saved to the matter's files. Bates numbers are on by default, in
   * the bottom right, and come from the matter's Bates log: the prefix last used on the matter is
   * filled in, and the numbers carry on from the last one stamped under it.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { listBatesPrefixes, type BatesPrefixSummary } from "$lib/bates/bates-api.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import { makeExhibitPackage, type PackageContext, type PackageOutcome } from "./exhibit-package.ts";

  let {
    open = $bindable(false),
    context,
    onMade,
  }: {
    open?: boolean;
    context: PackageContext;
    onMade: (outcome: PackageOutcome) => void;
  } = $props();

  const DEFAULT_DIGITS = 6;

  let stamp = $state(true);
  let prefix = $state("");
  let digits = $state(DEFAULT_DIGITS);
  let prefixes = $state<readonly BatesPrefixSummary[]>([]);
  let failure = $state<StatedFailure | null>(null);
  let failedMessage = $state<string | null>(null);
  let progress = $state<string | null>(null);

  function reset(): void {
    stamp = true;
    prefix = "";
    digits = DEFAULT_DIGITS;
    failure = null;
    failedMessage = null;
    progress = null;
    void listBatesPrefixes(fetch, context.matterId).then((outcome) => {
      if (outcome.kind !== "ok") return;
      prefixes = outcome.value;
      const latest = outcome.value[0];
      if (latest !== undefined && prefix === "") {
        prefix = latest.prefix;
        digits = latest.digits;
      }
    });
  }

  const nextNumber = $derived(prefixes.find((entry) => entry.prefix === prefix)?.nextNumber ?? 1);
  const included = $derived(context.set.members.filter((member) => member.status === "active").length);
  const refusal = $derived.by((): string | undefined => {
    if (included === 0) return "The set has no exhibits to put in a package.";
    if (stamp && (!Number.isInteger(digits) || digits < 1 || digits > 12)) return "Use 1 to 12 digits.";
    if (stamp && prefix.length > 40) return "Keep the prefix to 40 characters.";
    return undefined;
  });

  function whole(value: string, fallback: number): number {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fallback : parsed;
  }

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    failedMessage = null;
    progress = "Reading the exhibits and making the package";
    const outcome = await makeExhibitPackage(context, stamp ? { prefix, digits } : null);
    progress = null;
    if (outcome.kind === "refused") {
      failure = outcome.failure;
      return "refused";
    }
    if (outcome.kind === "failed") {
      failedMessage = outcome.message;
      return "refused";
    }
    onMade(outcome);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Exhibit Package"
  commitLabel="Save Package"
  commitBusyLabel="Making"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={false}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Made"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {:else if failedMessage !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Was Made</Alert.Title>
        <Alert.Description>{failedMessage}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="text-sm">
        One PDF: the exhibit list, then a cover sheet and the pages of each of the {included}
        {included === 1 ? "exhibit" : "exhibits"} in the set. Withdrawn exhibits are on the list but
        not in the package. It is saved to this matter's files.
      </p>
      <div class="flex items-center gap-8">
        <Checkbox
          id="exhibit-package-bates"
          disabled={busy}
          checked={stamp}
          onCheckedChange={(on) => (stamp = on)}
        />
        <Label for="exhibit-package-bates">Stamp Bates Numbers</Label>
      </div>
      {#if stamp}
        <FieldRow columns={2}>
          <LabelledField necessity="optional" label="Prefix">
            {#snippet children({ props })}
              <Input {...props} disabled={busy} bind:value={prefix} placeholder="SMITH-" />
            {/snippet}
          </LabelledField>
          <LabelledField necessity="required" label="Digits">
            {#snippet children({ props })}
              <Input
                {...props}
                type="number"
                min="1"
                max="12"
                class="tabular-nums"
                disabled={busy}
                value={String(digits)}
                oninput={(event) => (digits = whole(event.currentTarget.value, digits))}
              />
            {/snippet}
          </LabelledField>
        </FieldRow>
        <p class="text-xs text-text-muted">
          Every page is numbered in the bottom right, starting at
          <span class="tabular-nums">{prefix}{String(nextNumber).padStart(Math.max(1, digits), "0")}</span>,
          the next number on this matter. The list shows where each exhibit's pages fall.
        </p>
      {/if}
      {#if progress !== null}
        <p class="text-sm text-text-muted" aria-live="polite">{progress}</p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

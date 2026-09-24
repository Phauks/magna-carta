<script lang="ts">
  /*
   * Adding one template to several matters — the panel, over the runner in add-to-matters.ts.
   *
   * ONE FIELD, MANY VALUES. A matter is chosen from the docket through one combobox that searches
   * the server as the reader types, and each pick lands as its own removable row above the field;
   * a matter already chosen is not offered twice. The field is the last row of the list, under the
   * same rule as every other row, rather than a form beneath it.
   *
   * THE LIST NEVER RE-FLOWS WHEN THE ACT BEGINS. The chosen rows stay the chosen rows; what changes
   * is the column that reports, which stands empty until the batch runs and then carries each
   * matter's standing as it moves. A batch never stops at one refusal: every row settles on its own,
   * and the summary counts them.
   *
   * ONE KEY PER MATTER PER INTENT. The idempotency key for a matter's submission is minted the first
   * time that matter is submitted from this opening of the panel and kept for as long as the panel
   * is open, so a retry cannot put a second document on a matter that already got one.
   *
   * A PDF FORM ONLY EVER BUILDS A PDF. Where the template's kind is known, the output choice is
   * locked to it with the reason on the field; where it is not, the choice stands.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Button from "@magna-carta/design-system/button";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import X from "@lucide/svelte/icons/x";
  import { createQuery } from "@tanstack/svelte-query";
  import { mattersListOptions, type TemplateSummary } from "@magna-carta/api-client";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import { chosenMatterLine } from "$lib/conflicts/check-request.ts";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import {
    addTemplateToMatters,
    blankLines,
    isSettled,
    liveAddToMattersPorts,
    standingLine,
    summarizeStandings,
    summarySentence,
    type AssemblyOutputFormat,
    type AssemblyTarget,
    type MatterAssemblyStanding,
  } from "./add-to-matters.ts";
  import type { TemplateKind } from "./register-template.ts";

  let {
    open = $bindable(false),
    template,
    kind,
  }: {
    open?: boolean;
    /** The template being added, or null while nothing is chosen. */
    template: TemplateSummary | null;
    /** The template's kind where the surface has read it, which decides what can be built. */
    kind: TemplateKind | null;
  } = $props();

  const identity = $props.id();

  const OUTPUT_FORMAT_OPTIONS: readonly ChoiceOption[] = [
    { value: "docx", label: "Word document — still editable" },
    { value: "pdf", label: "PDF — ready to sign" },
  ];
  const OUTPUT_FORMAT_HINT =
    "A PDF is converted from the merged document before it is added, so it takes a little longer. Choose it when the document is going out to be signed.";
  const PDF_FORM_ONLY = "A fillable PDF form builds a PDF and nothing else.";

  let query = $state("");
  let settledQuery = $state("");
  let chosen = $state<AssemblyTarget[]>([]);
  let outputFormat = $state<AssemblyOutputFormat>("docx");
  let running = $state(false);
  let standings = $state<Record<string, MatterAssemblyStanding>>({});
  let summary = $state<string | null>(null);
  let landed = $state(0);
  const keys = new Map<string, string>();

  const pdfOnly = $derived(kind === "pdfForm");
  const effectiveFormat = $derived<AssemblyOutputFormat>(pdfOnly ? "pdf" : outputFormat);

  const subtitle = $derived<RecordSubject>(
    template === null
      ? {}
      : { reference: { kind: "Template", number: null }, facts: [template.name] },
  );

  // The docket read leaves the machine, so it waits for typing to pause rather than running per
  // keystroke; and it runs only while the panel is open, so a screen with the panel closed spends
  // nothing on it.
  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (settledQuery = typed.trim()), 250);
    return () => clearTimeout(timer);
  });

  const docketRead = createQuery(() => ({
    ...mattersListOptions(settledQuery === "" ? undefined : { query: { search: settledQuery } }),
    enabled: open,
  }));

  const offered = $derived(
    (docketRead.data?.data ?? [])
      .filter((matter) => !chosen.some((target) => target.matterId === matter.id))
      .map((matter) => ({
        id: matter.id,
        label: chosenMatterLine({
          id: matter.id,
          // The newest number the record has drawn is what a surface shows.
          matterNumber: matter.matterNumber ?? matter.consultationNumber ?? matter.intakeNumber,
          title: matter.title,
        }),
      })),
  );

  function reset(): void {
    query = "";
    settledQuery = "";
    chosen = [];
    outputFormat = "docx";
    running = false;
    standings = {};
    summary = null;
    landed = 0;
    keys.clear();
  }

  function keyFor(matterId: string): string {
    const held = keys.get(matterId);
    if (held !== undefined) return held;
    const minted = crypto.randomUUID();
    keys.set(matterId, minted);
    return minted;
  }

  function pick(picked: string | string[]): void {
    const matterId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (matterId === "") return;
    const found = offered.find((matter) => matter.id === matterId);
    if (found === undefined) return;
    chosen = [...chosen, { matterId: found.id, label: found.label }];
    // The pick lives in the rows, so the field empties for the next one.
    query = "";
  }

  function remove(matterId: string): void {
    chosen = chosen.filter((target) => target.matterId !== matterId);
  }

  const refusal = $derived.by((): string | undefined => {
    if (template === null) return "Choose a template first.";
    if (template.currentVersionId === null) {
      return "This template has no version that cleared its checks.";
    }
    if (chosen.length === 0) return "Choose at least one matter.";
    return undefined;
  });

  async function add(): Promise<ActionOutcome> {
    if (refusal !== undefined || template === null || template.currentVersionId === null) {
      return "refused";
    }
    running = true;
    standings = {};
    const settled = await addTemplateToMatters(
      { templateVersionId: template.currentVersionId, outputFormat: effectiveFormat, targets: chosen },
      {
        ports: liveAddToMattersPorts(),
        keyFor,
        onChange: (matterId, standing) => {
          standings[matterId] = standing;
        },
      },
    );
    running = false;
    const counted = summarizeStandings(settled);
    landed = counted.landed + counted.withBlanks;
    summary = summarySentence(counted);
    // Done even where some matters did not get one: the rows say which, and the batch is over.
    return "done";
  }

  /** Where a built document opens: the editor for a Word document, the viewer for a PDF. */
  function documentHref(standing: MatterAssemblyStanding): string | null {
    if (standing.kind !== "landed" && standing.kind !== "landed-with-blanks") return null;
    if (standing.fileId === "") return null;
    const fileId = encodeURIComponent(standing.fileId);
    return standing.outputFormat === "pdf" ? `/documents/${fileId}/view` : `/documents/${fileId}/edit`;
  }

  function matterFilesHref(target: AssemblyTarget, standing: MatterAssemblyStanding): string | null {
    if (standing.kind !== "landed" && standing.kind !== "landed-with-blanks") return null;
    return matterFilesBack(target.matterId, target.label, standing.fileId || undefined).href;
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Add to Matters"
  {subtitle}
  width="wide"
  commitLabel="Add to Matters"
  commitBusyLabel="Adding"
  commitRefusal={refusal}
  unsavedChanges={chosen.length > 0}
  onOpen={reset}
  onCommit={add}
>
  {#snippet fields({ busy, done })}
    <div class="flex flex-col gap-16">
      {#if done && summary !== null}
        <Alert.Root variant={landed > 0 ? "success" : "warning"}>
          <Alert.Title>{landed > 0 ? "The Document Is on the Matters" : "Nothing Was Added"}</Alert.Title>
          <Alert.Description>{summary}</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- The chosen matters, each its own row, and the field that adds another as the last row.
           The rows are the same rows before, during and after the act; only the reporting column
           changes, so nothing moves under the pointer when the commit is pressed. -->
      <LabelledField label="Matters" id="{identity}-matter">
        {#snippet children({ props })}
          <div class="flex flex-col">
            {#each chosen as target (target.matterId)}
              {@const standing = standings[target.matterId]}
              <!-- The label takes the width and the reporting column takes what it needs; a
                   full-width line beneath wraps under both. Flex rather than a grid with an
                   arbitrary track, which the off-token scan refuses. -->
              <div
                class="flex flex-wrap items-start gap-x-12 gap-y-4 border-b border-border-subtle py-8"
              >
                <span class="min-w-0 flex-1 text-sm tabular-nums">{target.label}</span>
                {#if standing === undefined}
                  {#if !busy && !done}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove {target.label}"
                      title="Remove {target.label}"
                      onclick={() => remove(target.matterId)}
                    >
                      <X class="size-16" aria-hidden="true" />
                    </Button>
                  {:else}
                    <span></span>
                  {/if}
                {:else}
                  <span
                    class="shrink-0 text-sm text-text-muted"
                    role="status"
                    aria-live={isSettled(standing) ? "off" : "polite"}
                  >
                    {standingLine(standing)}
                  </span>
                  {#each blankLines(standing) as line (line)}
                    <span class="basis-full text-xs text-text-muted">{line}</span>
                  {/each}
                  {#if done}
                    {@const openHref = documentHref(standing)}
                    {@const filesHref = matterFilesHref(target, standing)}
                    {#if openHref !== null || filesHref !== null}
                      <span class="flex basis-full flex-wrap gap-12 text-sm">
                        {#if openHref !== null}
                          <a class="underline underline-offset-2" href={openHref}>Open the document</a>
                        {/if}
                        {#if filesHref !== null}
                          <a class="underline underline-offset-2" href={filesHref}>The matter's files</a>
                        {/if}
                      </span>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
            {#if !done}
              <!-- Keyed on the chosen set so each pick remounts a fresh combobox: its internal
                   single-select value is not bindable, and a stale one would read re-picking a
                   removed matter as a deselect. The remount closes the list, which is the wanted
                   rhythm: pick, row lands, search again. -->
              {#key chosen.map((target) => target.matterId).join("|")}
                <Combobox.Root
                  type="single"
                  disabled={busy || running}
                  items={offered.map((matter) => ({ value: matter.id, label: matter.label }))}
                  inputValue={query}
                  onValueChange={pick}
                  onOpenChange={(listboxOpen) => {
                    if (!listboxOpen) query = "";
                  }}
                >
                  <Combobox.Input
                    id={props.id}
                    aria-describedby={props["aria-describedby"]}
                    fieldName="Search the docket"
                    autocomplete="off"
                    spellcheck={false}
                    oninput={(event) => (query = event.currentTarget.value)}
                  />
                  <Combobox.Content>
                    {#each offered as matter (matter.id)}
                      <Combobox.Item value={matter.id} label={matter.label}>
                        <span class="tabular-nums">{matter.label}</span>
                      </Combobox.Item>
                    {/each}
                    {#if offered.length === 0}
                      <Combobox.Group>
                        <Combobox.GroupHeading>
                          {docketRead.isPending
                            ? "Reading the docket…"
                            : settledQuery === ""
                              ? "No matter to offer."
                              : `Nothing matches "${settledQuery}".`}
                        </Combobox.GroupHeading>
                      </Combobox.Group>
                    {/if}
                  </Combobox.Content>
                </Combobox.Root>
              {/key}
            {/if}
          </div>
        {/snippet}
      </LabelledField>

      {#if !done}
        <LabelledField
          label="Build It As"
          id="{identity}-format"
          hint={pdfOnly ? PDF_FORM_ONLY : OUTPUT_FORMAT_HINT}
        >
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Build It As"
              options={OUTPUT_FORMAT_OPTIONS}
              disabled={busy || pdfOnly}
              title={pdfOnly ? PDF_FORM_ONLY : undefined}
              bind:value={
                () => effectiveFormat,
                (next) => (outputFormat = next as AssemblyOutputFormat)
              }
            />
          {/snippet}
        </LabelledField>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

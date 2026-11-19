<script lang="ts">
  /*
   * The PDF Editor's Forms tab: answer a PDF form's fields and save the filled form as the next
   * version of the file, optionally flattened so the answers become part of the page.
   *
   * Saving makes a new VERSION, as arranging pages does, because a filled form is the same
   * document further along; the blank or earlier-answered form stays in the file's history. Choosing
   * a field shows where it sits on its page.
   */
  import { onMount } from "svelte";
  import Save from "@lucide/svelte/icons/save";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import type { FormField } from "@magna-carta/pdf";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { fileMadeDocument, openEditorDocument, type Filed } from "./editor-document.ts";
  import {
    answerOf,
    changedAnswers,
    fieldLabel,
    inPageOrder,
    isAnswerable,
    unansweredRequired,
    type FormAnswers,
  } from "./forms.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";
  import { pointsToScreen } from "./redactions.ts";

  let { file, onSaved }: { file: MatterFile; onSaved: () => void } = $props();

  const PREVIEW_ZOOM = 0.9;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready"; readonly fields: readonly FormField[] };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "saving" }
    | { readonly kind: "done"; readonly filed: Filed }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let sizes = $state<readonly PdfPageSize[]>([]);
  let answers = $state<FormAnswers>({});
  let flatten = $state(false);
  let selected = $state<string | null>(null);
  let result = $state<Result>({ kind: "idle" });
  let canvas = $state<HTMLCanvasElement | null>(null);

  let source: PdfDocumentSource | null = null;
  let original: ArrayBuffer | null = null;
  let gone = false;

  const fields = $derived(phase.kind === "ready" ? inPageOrder(phase.fields) : []);
  const changed = $derived(changedAnswers(fields, answers));
  const changedCount = $derived(Object.keys(changed).length);
  const missing = $derived(new Set(unansweredRequired(fields, answers).map((field) => field.name)));
  const selectedField = $derived(fields.find((field) => field.name === selected) ?? null);
  const shownPage = $derived(selectedField?.page ?? fields[0]?.page ?? 0);
  const canSave = $derived((changedCount > 0 || flatten) && result.kind !== "saving");

  async function paint(target: HTMLCanvasElement | null, index: number): Promise<void> {
    const engine = source;
    if (engine === null || target === null) return;
    const outcome = await engine.render(index, renderDpiFor(PREVIEW_ZOOM, window.devicePixelRatio));
    if (gone || "failure" in outcome) return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = outcome.page.width;
    target.height = outcome.page.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(outcome.page.data), outcome.page.width, outcome.page.height),
      0,
      0,
    );
  }

  async function open(): Promise<void> {
    const opened = await openEditorDocument(
      file,
      "This document has a password. Unlock it in the File Workbench, save the unlocked copy, and fill that.",
    );
    if (gone) {
      if (opened.kind === "ready") opened.source.close();
      return;
    }
    if (opened.kind === "refused") {
      phase = { kind: "refused", message: opened.message };
      return;
    }
    source = opened.source;
    original = opened.original;
    sizes = opened.pages;
    const reply = await runPdfOperation(opened.original.slice(0), { kind: "readForm" });
    if (gone) return;
    if (reply.kind === "failed") {
      phase = { kind: "refused", message: describeOperationFailure(reply.reason, reply.message) };
      return;
    }
    phase = { kind: "ready", fields: reply.fields ?? [] };
  }

  onMount(() => {
    void open();
    return () => {
      gone = true;
      source?.close();
      source = null;
    };
  });

  $effect(() => {
    if (phase.kind !== "ready") return;
    void paint(canvas, shownPage);
  });

  function answer(name: string, value: string | boolean): void {
    answers = { ...answers, [name]: value };
    if (result.kind !== "saving") result = { kind: "idle" };
  }

  function choices(field: FormField): { value: string; label: string }[] {
    return field.options.map((option) => ({ value: option, label: option }));
  }

  async function save(): Promise<void> {
    if (original === null || !canSave) return;
    result = { kind: "saving" };
    const reply = await runPdfOperation(original.slice(0), { kind: "fillForm", values: changed, flatten });
    if (gone) return;
    const made = reply.kind === "done" ? reply.documents[0] : undefined;
    if (reply.kind === "failed" || made === undefined) {
      result = {
        kind: "failed",
        message:
          reply.kind === "failed"
            ? describeOperationFailure(reply.reason, reply.message)
            : describeOperationFailure("refused", ""),
      };
      return;
    }
    const filed = await fileMadeDocument(file, made, file.name, { asVersionOf: file.id });
    if (gone) return;
    result = { kind: "done", filed };
    if (filed.kind === "filed") onSaved();
  }
</script>

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the form</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Form Can't Be Filled Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <div class="mc-scrollbar flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto bg-surface-sunken p-24">
      {#if sizes[shownPage] !== undefined}
        {@const size = sizes[shownPage] as PdfPageSize}
        {@const box = pageDisplaySize(size, PREVIEW_ZOOM)}
        <figure class="flex flex-none flex-col items-center gap-8">
          <div class="relative border border-border-default bg-surface-raised" style="width: {box.width}px; height: {box.height}px">
            <canvas bind:this={canvas} class="block h-full w-full"></canvas>
            {#if selectedField?.rect != null && selectedField.page === shownPage}
              {@const [x0, y0, x1, y1] = selectedField.rect}
              {@const at = pointsToScreen({ x0, y0, x1, y1 }, size, PREVIEW_ZOOM)}
              <div
                class="pointer-events-none absolute rounded-xs ring-2 ring-accent-strong"
                style="left: {at.left}px; top: {at.top}px; width: {at.width}px; height: {at.height}px"
              ></div>
            {/if}
          </div>
          <figcaption class="text-xs text-text-muted">Page {shownPage + 1}</figcaption>
        </figure>
      {/if}
    </div>

    <aside aria-label="Form fields" class="flex min-h-0 w-480 shrink-0 flex-col border-s border-border-default bg-surface-default">
      <div class="flex flex-none items-center gap-8 px-16 pt-16 pb-8">
        <h2 class="text-sm font-semibold">Fields</h2>
        <span class="rounded-full bg-surface-selected px-8 text-xs font-semibold tabular-nums">{fields.length}</span>
        {#if missing.size > 0}
          <span class="ms-auto text-xs text-text-muted">{missing.size} required {missing.size === 1 ? "field is" : "fields are"} empty</span>
        {/if}
      </div>
      <div class="mc-scrollbar min-h-0 flex-1 overflow-auto">
        <DataTable.Root class="w-full">
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Field</DataTable.Head>
              <DataTable.Head>Page</DataTable.Head>
              <DataTable.Head>Answer</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each fields as field (field.name)}
              {@const id = `form-field-${fields.indexOf(field)}`}
              <DataTable.Row data-state={selected === field.name ? "selected" : undefined} onfocusin={() => (selected = field.name)} onclick={() => (selected = field.name)}>
                <DataTable.Cell>
                  <span class="flex items-center gap-8">
                    <Label for={id} title={field.name}>{fieldLabel(field.name)}</Label>
                    {#if missing.has(field.name)}
                      <Badge variant="warning">Required</Badge>
                    {/if}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell class="tabular-nums">{field.page === null ? "" : field.page + 1}</DataTable.Cell>
                <DataTable.Cell>
                  {#if !isAnswerable(field)}
                    <span class="text-sm text-text-muted">
                      {field.kind === "signature" ? "Signature" : field.kind === "pushButton" ? "Button" : field.readOnly ? `${answerOf(field, answers) || "Empty"} (read only)` : "Not fillable"}
                    </span>
                  {:else if field.kind === "checkbox"}
                    <Checkbox {id} checked={answerOf(field, answers) === true} onCheckedChange={(checked) => answer(field.name, checked)} />
                  {:else if (field.kind === "choice" || field.kind === "radio") && field.options.length > 0}
                    <Select.Root
                      type="single"
                      items={choices(field)}
                      bind:value={() => String(answerOf(field, answers)), (picked) => answer(field.name, picked ?? "")}
                    >
                      <Select.Trigger {id}>
                        <Select.Value placeholder="Choose" />
                      </Select.Trigger>
                      <Select.Content>
                        {#each choices(field) as item (item.value)}
                          <Select.Item value={item.value} label={item.label} />
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  {:else}
                    <Input {id} size="sm" value={String(answerOf(field, answers))} oninput={(event) => answer(field.name, event.currentTarget.value)} />
                  {/if}
                </DataTable.Cell>
              </DataTable.Row>
            {:else}
              <DataTable.Row>
                <DataTable.Cell colspan={3} class="text-text-muted">This document has no form fields.</DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      </div>
      <div class="flex flex-none flex-col gap-8 border-t border-border-default p-16">
        <div class="flex items-start gap-8">
          <Checkbox id="forms-flatten" checked={flatten} disabled={fields.length === 0} onCheckedChange={(checked) => (flatten = checked)} />
          <Label for="forms-flatten">Flatten, so answers become part of the page and can't be changed</Label>
        </div>
        {#if result.kind === "done" && result.filed.kind === "filed"}
          <Alert.Root variant="success">
            <Alert.Title>Saved as a New Version</Alert.Title>
            <Alert.Description>The version before it is still in the file's history.</Alert.Description>
          </Alert.Root>
        {:else if result.kind === "done" && result.filed.kind === "notFiled"}
          <Alert.Root variant="warning">
            <Alert.Title>Not Filed</Alert.Title>
            <Alert.Description>The filled form was made but couldn't be saved to the matter. Download it now; nothing was saved.</Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={result.filed.url} download={result.filed.name}>Download</Button>
          </Alert.Root>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Saved</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button disabled={!canSave} onclick={save}>
          <Save class="size-16" aria-hidden="true" />
          {result.kind === "saving" ? "Saving" : changedCount === 1 ? "Save 1 Answer as New Version" : changedCount > 1 ? `Save ${changedCount} Answers as New Version` : "Save as New Version"}
        </Button>
      </div>
    </aside>
  </div>
{/if}

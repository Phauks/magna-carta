<script lang="ts">
  /*
   * The PDF Editor's Secure tab: see what the file carries, then save a protected copy with a
   * password, the permissions a recipient has, and optionally its hidden data removed first.
   *
   * The readings are counts made inside the worker (`secure.ts` says why the words themselves never
   * cross). A password the reader types is held on this screen only, handed to the engine and then
   * forgotten: it is never stored, sent to the server or logged. A permissions password the reader
   * leaves empty is made here and shown once, because without one a recipient's reader is free to
   * ignore the permissions.
   */
  import { onMount } from "svelte";
  import Lock from "@lucide/svelte/icons/lock";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { fileMadeDocument, openEditorDocument, type Filed } from "./editor-document.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";
  import {
    DEFAULT_SECURE,
    madePassword,
    protectedCopyName,
    secureOptions,
    secureProblems,
    type DocumentReadings,
    type RecipientPermissions,
    type SecureSettings,
  } from "./secure.ts";

  let { file }: { file: MatterFile } = $props();

  const PREVIEW_ZOOM = 0.8;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready" };

  type Readings =
    | { readonly kind: "reading" }
    | { readonly kind: "read"; readonly readings: DocumentReadings }
    | { readonly kind: "unread"; readonly message: string };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "protecting" }
    | { readonly kind: "done"; readonly filed: Filed; readonly madePassword: string | null }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let sizes = $state<readonly PdfPageSize[]>([]);
  let readings = $state<Readings>({ kind: "reading" });
  let settings = $state<SecureSettings>({ ...DEFAULT_SECURE });
  let result = $state<Result>({ kind: "idle" });
  let canvas = $state<HTMLCanvasElement | null>(null);

  let source: PdfDocumentSource | null = null;
  let original: ArrayBuffer | null = null;
  let gone = false;

  const problems = $derived(secureProblems(settings));
  const ready = $derived(Object.keys(problems).length === 0 && readings.kind !== "reading");
  /** The readings the table lists, and which of them removing hidden data takes away. */
  const readingRows: readonly {
    key: Exclude<keyof DocumentReadings, "encrypted">;
    label: string;
    scrubbed: boolean;
  }[] = [
    { key: "hiddenText", label: "Hidden or covered text", scrubbed: false },
    { key: "comments", label: "Comments", scrubbed: false },
    { key: "metadata", label: "Metadata", scrubbed: true },
    { key: "hiddenLayers", label: "Hidden layers", scrubbed: true },
    { key: "filledFormFields", label: "Filled-in form fields", scrubbed: true },
  ];
  const permissionRows: readonly { key: keyof RecipientPermissions; label: string }[] = [
    { key: "print", label: "Print" },
    { key: "copy", label: "Copy text" },
    { key: "editAndFill", label: "Edit or fill forms" },
    { key: "comment", label: "Comment" },
  ];

  async function paint(target: HTMLCanvasElement | null): Promise<void> {
    const engine = source;
    if (engine === null || target === null) return;
    const outcome = await engine.render(0, renderDpiFor(PREVIEW_ZOOM, window.devicePixelRatio));
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

  async function read(): Promise<void> {
    if (original === null) return;
    const reply = await runPdfOperation(original.slice(0), { kind: "inspect" });
    if (gone) return;
    readings =
      reply.kind === "done" && reply.readings !== undefined
        ? { kind: "read", readings: reply.readings }
        : {
            kind: "unread",
            message:
              reply.kind === "failed"
                ? describeOperationFailure(reply.reason, reply.message)
                : "The file could not be read for hidden content.",
          };
  }

  async function open(): Promise<void> {
    const opened = await openEditorDocument(
      file,
      "This document is already locked with a password. Unlock it in the File Workbench first if you want to change its protection.",
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
    phase = { kind: "ready" };
    void read();
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
    void paint(canvas);
  });

  function update(change: Partial<SecureSettings>): void {
    settings = { ...settings, ...change };
    if (result.kind !== "protecting") result = { kind: "idle" };
  }

  function allow(key: keyof RecipientPermissions, allowed: boolean): void {
    update({ permissions: { ...settings.permissions, [key]: allowed } });
  }

  async function protect(): Promise<void> {
    if (original === null || !ready || result.kind === "protecting") return;
    result = { kind: "protecting" };
    const made = settings.permissionsPassword === "" ? madePassword() : null;
    const reply = await runPdfOperation(original.slice(0), {
      kind: "secure",
      options: secureOptions(settings, made ?? settings.permissionsPassword),
      scrubFirst: settings.scrubFirst,
    });
    if (gone) return;
    const document = reply.kind === "done" ? reply.documents[0] : undefined;
    if (reply.kind === "failed" || document === undefined) {
      result = {
        kind: "failed",
        message:
          reply.kind === "failed"
            ? describeOperationFailure(reply.reason, reply.message)
            : describeOperationFailure("refused", ""),
      };
      return;
    }
    const filed = await fileMadeDocument(file, document, protectedCopyName(file.name));
    if (gone) return;
    // The passwords leave this screen with the result; nothing keeps them.
    settings = { ...settings, openPassword: "", permissionsPassword: "" };
    result = { kind: "done", filed, madePassword: made };
  }
</script>

{#snippet count(value: number, removed: boolean)}
  <span class="flex items-center gap-8">
    <span class="tabular-nums">{value === 0 ? "None" : value}</span>
    {#if value > 0 && removed}
      <Badge variant="warning">Will Be Removed</Badge>
    {/if}
  </span>
{/snippet}

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Cannot Be Protected Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <div class="mc-scrollbar flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto bg-surface-sunken p-24">
      {#if sizes[0] !== undefined}
        {@const box = pageDisplaySize(sizes[0], PREVIEW_ZOOM)}
        <div class="flex-none border border-border-default bg-surface-raised" style="width: {box.width}px; height: {box.height}px">
          <canvas bind:this={canvas} class="block h-full w-full"></canvas>
        </div>
      {/if}
    </div>

    <aside aria-label="Protection" class="mc-scrollbar flex min-h-0 w-384 shrink-0 flex-col gap-16 overflow-auto border-s border-border-default bg-surface-default p-16">
      <div class="flex flex-col gap-8">
        <h2 class="text-sm font-semibold">What This File Carries</h2>
        <DataTable.Root class="w-full">
          <DataTable.Body>
            {#each readingRows as row (row.key)}
              <DataTable.Row>
                <DataTable.Cell>{row.label}</DataTable.Cell>
                <DataTable.Cell>
                  {#if readings.kind === "read"}
                    {@render count(readings.readings[row.key], row.scrubbed && settings.scrubFirst)}
                  {:else}
                    <span class="text-text-muted">{readings.kind === "reading" ? "Checking" : "Not read"}</span>
                  {/if}
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        {#if readings.kind === "unread"}
          <Alert.Root variant="warning">
            <Alert.Description>{readings.message}</Alert.Description>
          </Alert.Root>
        {:else if readings.kind === "read"}
          {#if readings.readings.hiddenText > 0}
            <Alert.Root variant="warning">
              <Alert.Title>Text Is Hidden Under Something</Alert.Title>
              <Alert.Description>
                Covering text does not remove it, and a password does not either. Use the Redact tab to remove it, then
                protect the redacted copy.
              </Alert.Description>
            </Alert.Root>
          {/if}
          {#if readings.readings.comments > 0}
            <p class="text-xs text-text-muted">Comments stay in the protected copy. Remove them in the reader first if they should not go out.</p>
          {/if}
        {/if}
      </div>

      <LabelledField label="Password to Open" hint="Leave empty for a copy that opens without one" error={problems.openPassword}>
        {#snippet children({ props })}
          <PasswordInput {...props} autocomplete="new-password" bind:value={() => settings.openPassword, (value) => update({ openPassword: value })} />
        {/snippet}
      </LabelledField>
      <LabelledField
        label="Password to Change Permissions"
        hint="Leave empty and one is made for you"
        error={problems.permissionsPassword}
      >
        {#snippet children({ props })}
          <PasswordInput
            {...props}
            autocomplete="new-password"
            bind:value={() => settings.permissionsPassword, (value) => update({ permissionsPassword: value })}
          />
        {/snippet}
      </LabelledField>

      <fieldset class="flex flex-col gap-8">
        <legend class="mb-8 text-sm font-semibold">Recipients May</legend>
        {#each permissionRows as row (row.key)}
          <div class="flex items-center gap-8">
            <Checkbox id="secure-allow-{row.key}" checked={settings.permissions[row.key]} onCheckedChange={(checked) => allow(row.key, checked)} />
            <Label for="secure-allow-{row.key}">{row.label}</Label>
          </div>
        {/each}
      </fieldset>

      <div class="flex flex-col gap-8">
        <Label id="secure-algorithm-label">Encryption</Label>
        <RadioGroup.Root
          aria-labelledby="secure-algorithm-label"
          value={settings.algorithm}
          onValueChange={(value) => update({ algorithm: value === "aes128" ? "aes128" : "aes256" })}
          class="flex flex-col gap-8"
        >
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="aes256" id="secure-algorithm-256" />
            <Label for="secure-algorithm-256">AES-256</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="aes128" id="secure-algorithm-128" />
            <Label for="secure-algorithm-128">AES-128, for older PDF readers</Label>
          </div>
        </RadioGroup.Root>
      </div>

      <div class="flex items-start gap-8">
        <Checkbox id="secure-scrub" checked={settings.scrubFirst} onCheckedChange={(checked) => update({ scrubFirst: checked })} />
        <Label for="secure-scrub">Remove metadata, attachments, form values, bookmarks and layers first</Label>
      </div>

      <div class="mt-auto flex flex-col gap-8">
        {#if result.kind === "done" && result.filed.kind === "filed"}
          <Alert.Root variant="success">
            <Alert.Title>Saved {result.filed.name}</Alert.Title>
            <Alert.Description>The original is unchanged and is not protected.</Alert.Description>
            {#if result.madePassword !== null}
              <Alert.Description>
                The password to change its permissions is <span class="font-mono select-all">{result.madePassword}</span>.
                Keep it somewhere safe. Magna Carta does not keep it, and this is the only time it is shown.
              </Alert.Description>
            {/if}
            <Button variant="secondary" size="sm" class="self-start" href={viewerHref(result.filed.fileId)}>Open the Protected Copy</Button>
          </Alert.Root>
        {:else if result.kind === "done" && result.filed.kind === "notFiled"}
          <Alert.Root variant="warning">
            <Alert.Title>Not Filed</Alert.Title>
            <Alert.Description>The protected copy was made but could not be filed on the matter. Download it now; nothing was saved.</Alert.Description>
            {#if result.madePassword !== null}
              <Alert.Description>
                Its permissions password is <span class="font-mono select-all">{result.madePassword}</span>.
              </Alert.Description>
            {/if}
            <Button variant="secondary" size="sm" class="self-start" href={result.filed.url} download={result.filed.name}>Download</Button>
          </Alert.Root>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Protected</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button disabled={!ready || result.kind === "protecting"} onclick={protect}>
          <Lock class="size-16" aria-hidden="true" />
          {result.kind === "protecting" ? "Protecting" : "Save Protected Copy"}
        </Button>
        <p class="text-center text-xs text-text-muted">Saves a protected copy beside the original, which stays as it is.</p>
      </div>
    </aside>
  </div>
{/if}

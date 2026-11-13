<script lang="ts">
  /*
   * Email Inspector: a message's headers, the servers it passed through, the files it carried, and
   * the message as a PDF.
   *
   * Everything here runs in this browser. The parser is Rust compiled to WebAssembly
   * (`@magna-carta/email`) and the PDF is drawn by the document composer (`@magna-carta/pdf-compose`),
   * both loaded the first time a message is opened here, so the workbench's promise holds: nothing
   * about the file leaves the page.
   *
   * The panel reports what the file says and passes no verdict. A date is the header's own text; an
   * authentication header is shown as present or absent, not as passed or failed.
   */
  import Download from "@lucide/svelte/icons/download";
  import FileText from "@lucide/svelte/icons/file-text";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { ParsedMessage } from "@magna-carta/email";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import {
    attachmentsOf,
    authenticationOf,
    bodyTextOf,
    formatAddresses,
    routeOf,
    type AttachmentRow,
  } from "../email-reading.ts";
  import { formatSize } from "../workbench-file.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onAddFiles }: CapabilityPanelProps = $props();

  type Reading =
    | { readonly kind: "reading" }
    | { readonly kind: "read"; readonly message: ParsedMessage; readonly bytes: Uint8Array }
    | { readonly kind: "failed"; readonly reason: string };

  let reading = $state<Reading>({ kind: "reading" });
  let includeFullHeaders = $state(false);
  let printing = $state(false);
  let printFailure = $state<string | null>(null);
  let busyPart = $state<number | null>(null);

  const FAILURE_REASONS: Readonly<Record<string, string>> = {
    malformed: "This file does not read as an email message. It may be damaged; the Repair tab can look at it.",
    unsupported: "This kind of email file is not one the reader understands yet.",
    limitExceeded: "This message is larger than the reader will open in a browser.",
  };

  $effect(() => {
    const target = file;
    reading = { kind: "reading" };
    printFailure = null;
    includeFullHeaders = false;
    let current = true;
    void (async () => {
      try {
        const bytes = await target.readBytes();
        const { parseMessage, EmailError } = await import("@magna-carta/email");
        try {
          const message = await parseMessage(bytes);
          if (current) reading = { kind: "read", message, bytes };
        } catch (thrown) {
          const code = thrown instanceof EmailError ? thrown.code : "malformed";
          if (current) {
            reading = { kind: "failed", reason: FAILURE_REASONS[code] ?? FAILURE_REASONS["malformed"]! };
          }
        }
      } catch {
        if (current) reading = { kind: "failed", reason: "The file could not be read from the workbench." };
      }
    })();
    return () => {
      current = false;
    };
  });

  const message = $derived(reading.kind === "read" ? reading.message : null);

  const headerFacts = $derived.by((): Fact[] => {
    if (message === null) return [];
    const facts: Fact[] = [];
    const add = (label: string, value: string | null, mono = false): void => {
      if (value !== null && value.trim() !== "") facts.push({ label, value, mono });
    };
    add("From", formatAddresses(message.from));
    add("To", formatAddresses(message.to));
    add("Cc", formatAddresses(message.cc));
    add("Bcc", formatAddresses(message.bcc));
    add("Subject", message.subject);
    add("Sent", message.dateRaw);
    add("Message ID", message.messageIdentifier.value, true);
    const authentication = authenticationOf(message);
    facts.push({
      label: "Signature",
      value: authentication.dkimSigned ? "Signed by the sending domain" : "Not signed",
      note:
        authentication.results.length > 0
          ? `The receiving server recorded: ${authentication.results.join("; ")}`
          : undefined,
    });
    if (message.referencesRemoteContent) {
      facts.push({
        label: "Remote Content",
        value: "Loads pictures or files from the internet when opened in a mail program",
        tone: "warning",
      });
    }
    return facts;
  });

  const route = $derived(message === null ? [] : routeOf(message));
  const attachments = $derived(message === null ? [] : attachmentsOf(message));
  const body = $derived(message === null ? null : bodyTextOf(message));

  async function partFile(row: AttachmentRow): Promise<File | null> {
    if (reading.kind !== "read") return null;
    const { extractPart } = await import("@magna-carta/email");
    const bytes = await extractPart(reading.bytes, row.index);
    return new File([new Uint8Array(bytes)], row.name, { type: row.mediaType ?? "application/octet-stream" });
  }

  async function openInWorkbench(row: AttachmentRow): Promise<void> {
    if (onAddFiles === undefined || busyPart !== null) return;
    busyPart = row.index;
    try {
      const extracted = await partFile(row);
      if (extracted !== null) onAddFiles([extracted]);
    } finally {
      busyPart = null;
    }
  }

  async function saveAttachment(row: AttachmentRow): Promise<void> {
    if (busyPart !== null) return;
    busyPart = row.index;
    try {
      const extracted = await partFile(row);
      if (extracted !== null) await saveToTarget(extracted, row.name, extracted.type);
    } finally {
      busyPart = null;
    }
  }

  function pdfName(source: string): string {
    const stem = source.replace(/\.[^.]+$/, "");
    return `${stem === "" ? "Message" : stem}.pdf`;
  }

  async function saveAsPdf(): Promise<void> {
    if (message === null || printing) return;
    printing = true;
    printFailure = null;
    try {
      const [{ messageDocument }, { composeDocument }] = await Promise.all([
        import("@magna-carta/email/message-document"),
        import("@magna-carta/pdf-compose"),
      ]);
      const composed = await composeDocument(
        messageDocument(message, { includeFullHeaders, sourceName: file.name }),
      );
      const name = pdfName(file.name);
      await saveToTarget(new Blob([new Uint8Array(composed.pdf)], { type: "application/pdf" }), name, "application/pdf");
    } catch {
      printFailure = "The PDF could not be made from this message.";
    } finally {
      printing = false;
    }
  }
</script>

{#if reading.kind === "reading"}
  <Absence kind="not-run" reason="Reading the message." />
{:else if reading.kind === "failed"}
  <Absence kind="failed" reason={reading.reason} />
{:else if message !== null}
  <div class="flex flex-col gap-24">
    <div class="grid gap-16 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-16">
        <FactTable title="Message" facts={headerFacts} />

        {#if attachments.length > 0}
          <DataTable.Root class="w-full">
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Attachment</DataTable.Head>
                <DataTable.Head class="text-right">Size</DataTable.Head>
                <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each attachments as row (row.index)}
                <DataTable.Row>
                  <DataTable.Cell class="break-words">{row.name}</DataTable.Cell>
                  <DataTable.Cell class="text-right whitespace-nowrap tabular-nums">
                    {formatSize(row.sizeBytes)}
                  </DataTable.Cell>
                  <DataTable.Cell class="text-right whitespace-nowrap">
                    {#if onAddFiles !== undefined}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyPart !== null}
                        onclick={() => openInWorkbench(row)}
                      >
                        <FilePlus class="size-16" aria-hidden="true" />
                        Open in Workbench
                      </Button>
                    {/if}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyPart !== null}
                      aria-label={`Save ${row.name}`}
                      onclick={() => saveAttachment(row)}
                    >
                      <Download class="size-16" aria-hidden="true" />
                    </Button>
                  </DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/if}
      </div>

      <div class="flex min-w-0 flex-col gap-16">
        {#if route.length > 0}
          <DataTable.Root class="w-full">
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head colspan={3}>Route, Oldest First</DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each route as hop, position (position)}
                <DataTable.Row>
                  <DataTable.Cell class="w-32 align-top tabular-nums text-text-subtle">{position + 1}</DataTable.Cell>
                  <DataTable.Cell class="align-top break-words">
                    {hop.receivedBy ?? "A server that did not name itself"}
                    {#if hop.receivedFrom !== null || hop.protocol !== null}
                      <span class="mt-4 block text-xs text-text-muted">
                        {[hop.receivedFrom === null ? null : `From ${hop.receivedFrom}`, hop.protocol]
                          .filter((part) => part !== null)
                          .join(", ")}
                      </span>
                    {/if}
                  </DataTable.Cell>
                  <DataTable.Cell class="align-top text-xs text-text-muted">{hop.when ?? ""}</DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/if}

        <DataTable.Root class="w-full">
          <DataTable.Header>
            <DataTable.Row><DataTable.Head>Body</DataTable.Head></DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            <DataTable.Row>
              <DataTable.Cell class="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words">
                {body ?? "This message has no text body."}
              </DataTable.Cell>
            </DataTable.Row>
          </DataTable.Body>
        </DataTable.Root>
      </div>
    </div>

    <div class="flex flex-col gap-8 border-t border-border-default pt-16">
      <SectionHeading>Save as PDF</SectionHeading>
      <div class="flex flex-wrap items-center gap-16">
        <Button variant="primary" size="sm" disabled={printing} onclick={saveAsPdf}>
          <FileText class="size-16" aria-hidden="true" />
          {printing ? "Making the PDF" : "Save as PDF"}
        </Button>
        <div class="flex items-center gap-8">
          <Checkbox id="email-full-headers" bind:checked={includeFullHeaders} disabled={printing} />
          <Label for="email-full-headers" class="text-sm font-normal">Include every header</Label>
        </div>
        {#if printFailure !== null}
          <Badge variant="danger">{printFailure}</Badge>
        {/if}
      </div>
    </div>
  </div>
{/if}

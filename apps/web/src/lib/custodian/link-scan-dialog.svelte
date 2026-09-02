<script lang="ts">
  /*
   * Filing a copy against a packet.
   *
   * A COPY IS AN ORDINARY DOCUMENT, LINKED. It is not a third kind of object with its own storage,
   * its own malware scanning and its own permissions: it is a file in a matter's file store, which
   * already has all three, pointed at from the register. So this form picks a file the firm holds
   * rather than uploading one, and a document that is not filed yet is filed the ordinary way and
   * then linked here.
   *
   * WHICH MATTER'S FILES. The packet's own `filingMatterId`, which is the system holding matter the
   * register files against whatever matter (if any) the packet is linked to. A packet held for
   * somebody with no open matter still has somewhere for its scans to live, which is the whole
   * reason that field exists.
   *
   * A COPY CHANGES NOTHING ABOUT THE ORIGINAL. Scanning a will does not release it, does not make it
   * destructible, and does not stand in for it. The register says so where it lists them; nothing on
   * this form implies otherwise by offering an action that would.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Label from "@magna-carta/design-system/label";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Button from "@magna-carta/design-system/button";
  import X from "@lucide/svelte/icons/x";
  import { parseDate, type DateValue } from "@internationalized/date";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { DocumentSummary } from "$lib/documents/document-api.ts";
  import MatterFilePicker from "$lib/components/matter-file-picker.svelte";
  import { linkCustodyScan, type CustodyItem } from "./custody-api.ts";
  import { SCAN_KINDS, scanKindLabel } from "./custody-vocabulary.ts";
  import {
    scanDraftReady,
    scanDraftRequest,
    scanDraftShortfalls,
    EMPTY_SCAN_DRAFT,
    type ScanDraft,
  } from "./packet-draft.ts";

  let {
    open = $bindable(false),
    packetId,
    filingMatterId,
    items,
    onLinked,
  }: {
    open?: boolean;
    /** The packet the copy is filed against. Null while no packet is open. */
    packetId: string | null;
    /** The matter whose file store this packet's copies live in. Null while it is unread. */
    filingMatterId: string | null;
    /** The packet's described contents, so a copy can name the one item it is of. */
    items: readonly CustodyItem[];
    onLinked: () => void;
  } = $props();

  let draft = $state<ScanDraft>({ ...EMPTY_SCAN_DRAFT });
  /* The chosen file's name, held beside its handle so a filled field can name what it holds. */
  let chosenName = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);

  // The read, the failure wording and what a quarantined file does in the list all belong to the
  // one file picker now: three surfaces had grown their own and had already drifted on the last of
  // those, which is the one that matters.
  const kindItems = SCAN_KINDS.map((kind) => ({ value: kind, label: scanKindLabel(kind) }));
  const WHOLE_PACKET = "packet";
  const itemItems = $derived([
    { value: WHOLE_PACKET, label: "The whole packet" },
    ...items.map((item) => ({ value: item.id, label: `Item ${item.ordinal}: ${item.description}` })),
  ]);
  const shortfalls = $derived(scanDraftShortfalls(draft));

  /*
   * Why the commit is unavailable, or undefined when it is available. The window shows this beside
   * the control it refuses rather than hiding the control, so a reader is told what is missing.
   */
  const refusal = $derived.by((): string | undefined => {
    if (packetId === null) return "No packet is open.";
    if (!scanDraftReady(draft)) return shortfalls[0];
    return undefined;
  });

  /** Whether anything has been picked. Nothing chosen is nothing to lose, so leaving never asks. */
  const started = $derived(draft.fileId !== null || draft.capturedAt !== null);

  /** When the copy was taken, as a calendar date, or undefined while it is empty. */
  const capturedAtValue = $derived.by(() => {
    if (draft.capturedAt === null) return undefined;
    try {
      return parseDate(draft.capturedAt);
    } catch {
      return undefined;
    }
  });

  function recordCapturedAt(next: DateValue | undefined): void {
    draft.capturedAt = next ? next.toString() : null;
  }

  function reset(): void {
    draft = { ...EMPTY_SCAN_DRAFT };
    chosenName = null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    if (packetId === null) return "refused";
    failure = null;
    // A retried submit must not file the same copy twice, so every attempt carries its own key and
    // the server answers the repeat with the first result.
    const outcome = await linkCustodyScan(
      fetch,
      packetId,
      scanDraftRequest(draft),
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onLinked();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The copy could not be linked.",
      "Nothing answered. Nothing was filed against this packet.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="File A Copy"
  commitLabel="File Copy"
  commitBusyLabel="Filing"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet subtitle()}
    A document the firm already holds, linked to this packet. It is never a substitute for the
    original.
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Copy Was Not Filed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="link-scan-file">Document</Label>
        {#if chosenName === null}
          <MatterFilePicker
            matterId={filingMatterId}
            inputId="link-scan-file"
            disabled={busy}
            onPick={(document: DocumentSummary) => {
              draft.fileId = document.id;
              chosenName = document.name;
            }}
          />
        {:else}
          <!-- A filled seat names what is in it rather than showing its ghost text back. -->
          <div class="flex items-center gap-8">
            <span class="min-w-0 flex-1 truncate">{chosenName}</span>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="Clear the chosen document"
              onclick={() => {
                draft.fileId = null;
                chosenName = null;
              }}
            >
              <X class="size-16" aria-hidden="true" />
            </Button>
          </div>
        {/if}
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="link-scan-kind-label">What it is</Label>
          <Select.Root
            type="single"
            items={kindItems}
            value={draft.kind}
            onValueChange={(value) => (draft.kind = value as ScanDraft["kind"])}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="link-scan-kind-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each kindItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8">
          <!-- When the copy was taken, which is not when it is being linked. A photograph of a deed
               taken at a completion meeting is dated that day whenever it reaches the register. -->
          <DatePicker label="Taken on" value={capturedAtValue} onValueChange={recordCapturedAt} />
        </div>
      </div>

      {#if items.length > 0}
        <div class="flex flex-col gap-8">
          <Label id="link-scan-item-label">What it is a copy of</Label>
          <Select.Root
            type="single"
            items={itemItems}
            value={draft.itemId ?? WHOLE_PACKET}
            onValueChange={(value) => (draft.itemId = value === WHOLE_PACKET ? null : value)}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="link-scan-item-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each itemItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

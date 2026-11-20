<script lang="ts">
  /*
   * Pick Up: the entry has left the desk.
   *
   * PICKED UP BY IS A DROPDOWN of the people the entry is To, with Other last (owner, 2026-11-20).
   * Other opens the same picker Drop Off uses, so the person can be tagged as a member or somebody
   * in the Directory, or typed by name when they are neither (a courier sent for it).
   *
   * ID CHECKED CAN CARRY A PICTURE OF THE ID (owner, 2026-11-20). On a tablet or phone the picker
   * offers the camera; on a computer it takes a file from a scanner. The picture is drawn down to a
   * working size and saved as a JPEG here, which also drops what the camera wrote into the file
   * (where it was taken, the device), so only the picture of the card leaves the browser. Who handed
   * it over is whoever is signed in, which the server records.
   */
  import X from "@lucide/svelte/icons/x";
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    MAXIMUM_PHOTO_SOURCE_BYTES,
    PHOTO_ACCEPT,
    isOfferedPhotoFormat,
  } from "$lib/directory/photo-crop.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { pickUp, type InOutEntry, type InOutParty } from "./in-out-log-api.ts";
  import PartyPicker from "./party-picker.svelte";

  const OTHER = "other";
  /** The longest side a scanned ID is kept at: enough to read every line of a card. */
  const SCAN_SIDE = 1_600;

  let {
    open = $bindable(false),
    entry,
    members,
    onPickedUp,
  }: {
    open?: boolean;
    entry: InOutEntry | null;
    /** The firm's roster, for tagging somebody who is not on the To list. */
    members: readonly FirmMemberSummary[];
    onPickedUp: () => void;
  } = $props();

  let chosen = $state("");
  let other = $state<InOutParty | null>(null);
  let identityChecked = $state(false);
  let scan = $state<{ readonly imageBase64: string; readonly previewUrl: string } | null>(null);
  let scanRefused = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const whoItems = $derived([
    ...(entry?.to ?? []).map((person) => ({ value: person.id, label: person.name })),
    { value: OTHER, label: "Other" },
  ]);

  function clearScan(): void {
    if (scan !== null) URL.revokeObjectURL(scan.previewUrl);
    scan = null;
    scanRefused = false;
  }

  function reset(): void {
    chosen = entry?.to.length === 1 ? (entry.to[0]?.id ?? "") : "";
    other = null;
    identityChecked = false;
    clearScan();
    failure = null;
  }

  async function base64Of(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  }

  async function chooseScan(file: File | null): Promise<void> {
    scanRefused = false;
    if (file === null) return;
    if (!isOfferedPhotoFormat(file) || file.size > MAXIMUM_PHOTO_SOURCE_BYTES) {
      scanRefused = true;
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, SCAN_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no canvas");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (blob === null) throw new Error("no picture");
      clearScan();
      scan = { imageBase64: await base64Of(blob), previewUrl: URL.createObjectURL(blob) };
    } catch {
      scanRefused = true;
    }
  }

  const refusal = $derived.by((): string | undefined => {
    if (chosen === "") return "Say who picked it up.";
    if (chosen === OTHER && other === null) return "Choose or type who picked it up.";
    return undefined;
  });

  async function submit(): Promise<ActionOutcome> {
    if (entry === null) return "refused";
    failure = null;
    const proof = {
      identityChecked,
      ...(identityChecked && scan !== null ? { identityScanBase64: scan.imageBase64 } : {}),
    };
    const outcome = await pickUp(
      fetch,
      entry.id,
      chosen === OTHER && other !== null
        ? { collector: other, ...proof }
        : { recipientId: chosen, ...proof },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      clearScan();
      onPickedUp();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The pick up could not be saved.",
      "Couldn't connect. Nothing was saved.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Pick Up"
  subtitle={entry === null ? undefined : { reference: { kind: "", number: entry.number } }}
  commitLabel="Pick Up"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  unsavedChanges={scan !== null}
  onOpen={reset}
  onDismiss={clearScan}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Pick Up Was Not Saved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    {#if entry !== null}
      <div class="flex flex-col gap-16">
        <p>{entry.description}</p>
        <div class="flex flex-col gap-8">
          <Label id="pick-up-who-label" necessity="required">Picked up by</Label>
          <Select.Root
            type="single"
            items={whoItems}
            disabled={busy}
            allowDeselect={false}
            bind:value={() => chosen,
            (picked) => {
              chosen = picked;
              if (picked !== OTHER) other = null;
            }}
          >
            <Select.Trigger aria-labelledby="pick-up-who-label">
              <Select.Value placeholder={placeholderOf("Picked up by")} />
            </Select.Trigger>
            <Select.Content>
              {#each whoItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
          {#if chosen === OTHER}
            {#if other === null}
              <PartyPicker
                inputId="pick-up-other"
                fieldName="Who picked it up"
                {members}
                disabled={busy}
                onPick={(party) => (other = party)}
              />
              <p class="text-xs text-text-muted">
                Search members and the Directory, or type a name for someone who is in neither.
              </p>
            {:else}
              <div class="flex items-center gap-8">
                <span class="min-w-0 flex-1 truncate">{other.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear who picked it up"
                  disabled={busy}
                  onclick={() => (other = null)}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </div>
            {/if}
          {/if}
        </div>

        <div class="flex flex-col gap-8">
          <label class="flex items-center gap-8">
            <Checkbox
              disabled={busy}
              bind:checked={() => identityChecked,
              (checked) => {
                identityChecked = checked;
                if (!checked) clearScan();
              }}
            />
            <span>ID checked</span>
          </label>
          {#if identityChecked}
            {#if scan !== null}
              <div class="flex items-start gap-8">
                <img
                  src={scan.previewUrl}
                  alt="The scanned ID"
                  class="max-h-160 min-w-0 flex-1 rounded-md border border-border object-contain"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove the scanned ID"
                  disabled={busy}
                  onclick={clearScan}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </div>
            {:else}
              <Dropzone
                accept={PHOTO_ACCEPT}
                disabled={busy}
                invalid={scanRefused}
                label="Scan ID"
                prompt="Take a picture of the ID, or choose a scan"
                onFiles={(files) => void chooseScan(files[0] ?? null)}
              >
                {scanRefused ? "That file is not a picture this can read." : "Optional."}
              </Dropzone>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</ActionDialog>

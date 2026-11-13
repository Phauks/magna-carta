<script lang="ts">
  /*
   * File Decryption & Recovery: unlock a file with a password you have, or start a search for one
   * you do not.
   *
   * TWO CONTROLS, ONE ATTESTATION. The checkbox gates both — a person confirms once that they are
   * authorized to open this file, and it stays checked while the file in focus does not change,
   * because asking twice for the same fact about the same file is not a second safeguard.
   *
   * UNLOCK ANSWERS HERE. It is one request; the result is a download, offered the moment it lands.
   * RECOVER HANDS OFF. It is a search that can run for hours, so this panel only starts it and sends
   * the reader to the job's own screen — the job outlives this tab whether or not the reader stays.
   */
  import { goto } from "$app/navigation";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Search from "@lucide/svelte/icons/search";
  import Download from "@lucide/svelte/icons/download";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import { base64ToBytes } from "../base64.ts";
  import { unlockableFormatOf } from "../capabilities/unlock.ts";
  import { startRecovery, unlockFile } from "../decryption-api.ts";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import { describeType } from "../file-facts.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file }: CapabilityPanelProps = $props();

  const format = $derived(unlockableFormatOf(file));

  let attested = $state(false);
  let password = $state("");
  let unlocking = $state(false);
  let recovering = $state(false);
  let errorMessage = $state<string | null>(null);
  let unlocked = $state<{ blob: Blob; filename: string } | null>(null);
  let saving = $state(false);
  let savedTo = $state<"folder" | "browser" | null>(null);

  // A form left standing from the last file in focus reads as an answer about this one.
  $effect(() => {
    void file.id;
    attested = false;
    password = "";
    unlocking = false;
    recovering = false;
    errorMessage = null;
    unlocked = null;
    saving = false;
    savedTo = null;
  });

  function describeFailure(outcome: { kind: "problem" | "transport"; problem?: { detail?: string; title?: string } | null }): string {
    if (outcome.kind === "transport") {
      return "Couldn't connect. Check your connection and try again.";
    }
    return outcome.problem?.detail ?? outcome.problem?.title ?? "The request could not be completed.";
  }

  async function handleUnlock(): Promise<void> {
    if (!attested || password === "") return;
    errorMessage = null;
    unlocked = null;
    savedTo = null;
    unlocking = true;
    try {
      const bytes = await file.readBytes();
      const outcome = await unlockFile(fetch, bytes, password);
      if (outcome.kind === "ok") {
        const decrypted = base64ToBytes(outcome.value.decryptedBase64);
        unlocked = {
          blob: new Blob([decrypted]),
          filename: outcome.value.filenameHint ?? file.name,
        };
        // The password did its job; there is no reason to keep it in the field or in memory
        // longer than the one request it was for.
        password = "";
      } else {
        errorMessage = describeFailure(outcome);
      }
    } catch {
      errorMessage = "The file could not be read from the workbench.";
    } finally {
      unlocking = false;
    }
  }

  async function handleDownload(): Promise<void> {
    if (unlocked === null || saving) return;
    saving = true;
    try {
      savedTo = await saveToTarget(unlocked.blob, unlocked.filename, "application/octet-stream");
    } finally {
      saving = false;
    }
  }

  async function handleRecover(): Promise<void> {
    if (!attested) return;
    errorMessage = null;
    recovering = true;
    try {
      const bytes = await file.readBytes();
      const outcome = await startRecovery(fetch, bytes);
      if (outcome.kind === "ok") {
        await goto(`/file-workbench/recovery/${encodeURIComponent(outcome.value.jobId)}`);
        return;
      }
      errorMessage = describeFailure(outcome);
    } catch {
      errorMessage = "The file could not be read from the workbench.";
    } finally {
      recovering = false;
    }
  }
</script>

{#if format === null}
  <Absence
    kind="not-applicable"
    reason={`${describeType(file)} is not a format this tool decrypts yet. PDF, ZIP, and Word/Excel/PowerPoint (.docx, .xlsx, .pptx) are supported today.`}
  />
{:else}
  <div class="flex flex-col gap-24">
    <div class="flex items-start gap-8">
      <Checkbox id="unlock-attestation" bind:checked={attested} disabled={unlocking || recovering} />
      <Label for="unlock-attestation" class="max-w-prose text-sm font-normal">
        I am authorized to open this file. Each unlock or recovery attempt confirms this.
      </Label>
    </div>

    {#if errorMessage !== null}
      <Alert.Root variant="danger">
        <Alert.Description>{errorMessage}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if unlocked !== null}
      <Alert.Root variant="success">
        <Alert.Title>Unlocked</Alert.Title>
        <Alert.Description>
          {unlocked.filename} opened with the password you gave. Save the unlocked copy below; your original file is unchanged.
        </Alert.Description>
        <div class="mt-8 flex items-center gap-8">
          <Button variant="primary" size="sm" onclick={handleDownload} disabled={saving}>
            <Download class="size-16" aria-hidden="true" />
            {saving ? "Saving" : "Save the Unlocked Copy"}
          </Button>
          {#if savedTo === "folder"}
            <span class="text-sm text-text-muted">Saved to your chosen folder.</span>
          {:else if savedTo === "browser"}
            <span class="text-sm text-text-muted">Sent to your browser's downloads.</span>
          {/if}
        </div>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-8">
      <SectionHeading>Unlock With a Password You Have</SectionHeading>
      <div class="flex max-w-md flex-col gap-4">
        <Label for="unlock-password">Password</Label>
        <PasswordInput
          id="unlock-password"
          bind:value={password}
          autocomplete="off"
          disabled={!attested || unlocking}
          onkeydown={(event) => {
            if (event.key === "Enter") void handleUnlock();
          }}
        />
      </div>
      <div>
        <Button
          variant="primary"
          size="sm"
          disabled={!attested || password === "" || unlocking}
          onclick={handleUnlock}
        >
          <KeyRound class="size-16" aria-hidden="true" />
          {unlocking ? "Unlocking" : "Unlock"}
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-8 border-t border-border-default pt-24">
      <SectionHeading>Recover a Password You Have Lost</SectionHeading>
      <p class="max-w-prose text-sm text-text-muted">
        Tries a large list of likely passwords and variations. This can take from moments to hours. It runs in the background on its own screen, so you can leave and come back.
      </p>
      <div>
        <Button variant="secondary" size="sm" disabled={!attested || recovering} onclick={handleRecover}>
          <Search class="size-16" aria-hidden="true" />
          {recovering ? "Starting" : "Recover Password"}
        </Button>
      </div>
    </div>
  </div>
{/if}

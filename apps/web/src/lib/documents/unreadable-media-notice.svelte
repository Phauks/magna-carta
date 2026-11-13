<script lang="ts">
  /*
   * What a recording that will not play here says, on the watch page and in the details panel's
   * Preview tab alike: "Unreadable Media File", why, and what to do about it.
   *
   * When a copy can cure it (the converter reads the recording's container, and the refusal is about
   * how it is encoded) the notice offers Convert to MP4. The copy is made off the request path and
   * saved as a file of its own beside the original, so the notice asks where it stands on arrival,
   * keeps asking while it is being made, and once it is ready offers to open it. Leaving the page
   * does not stop the conversion: the copy turns up in the folder either way.
   */
  import { onDestroy } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import {
    CANNOT_PLAY_TITLE,
    cannotPlaySentence,
    conversionSentence,
    offersConversion,
    type CannotPlayCause,
  } from "$lib/documents/video-playback.ts";
  import {
    fileDownloadUrl,
    readPlayableCopy,
    requestPlayableCopy,
    type PlayableCopyStatus,
  } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";

  let {
    fileId,
    contentType,
    cause,
    showDownload = true,
  }: {
    fileId: string;
    /** The recording's sniffed content type: what decides whether the converter can read it. */
    contentType: string | null;
    cause: CannotPlayCause;
    /** False where the surface already shows a Download beside the notice. */
    showDownload?: boolean;
  } = $props();

  // A conversion is minutes of engine time, so the page asks where it stands every ten seconds and
  // no faster.
  const POLL_INTERVAL_MILLISECONDS = 10_000;

  const convertible = $derived(offersConversion(cause, contentType));

  let status = $state<PlayableCopyStatus | null>(null);
  let asking = $state(false);
  let refusal = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A newer file supersedes an answer still in flight for the one before it. */
  let ticket = 0;

  function settle(next: PlayableCopyStatus, current: number): void {
    if (current !== ticket) return;
    status = next;
    clearTimeout(timer);
    if (next.state === "pending") {
      timer = setTimeout(() => void look(current), POLL_INTERVAL_MILLISECONDS);
    }
  }

  async function look(current: number): Promise<void> {
    const outcome = await readPlayableCopy(fetch, fileId);
    if (outcome.kind === "ok") settle(outcome.value, current);
  }

  async function convert(): Promise<void> {
    const current = ticket;
    asking = true;
    refusal = null;
    const outcome = await requestPlayableCopy(fetch, fileId);
    asking = false;
    if (current !== ticket) return;
    if (outcome.kind === "ok") {
      settle(outcome.value, current);
      return;
    }
    if (outcome.kind === "problem" && outcome.problem.status === 403) {
      refusal = "Converting a recording needs permission to upload files to this matter.";
    } else if (outcome.kind === "problem" && outcome.problem.detail !== undefined) {
      refusal = outcome.problem.detail;
    } else {
      refusal = "The conversion could not be started. Try again in a moment.";
    }
  }

  $effect(() => {
    const id = fileId;
    ticket += 1;
    const current = ticket;
    status = null;
    refusal = null;
    clearTimeout(timer);
    if (convertible && id !== "") void look(current);
  });

  onDestroy(() => clearTimeout(timer));

  const copyFileId = $derived(status?.state === "ready" ? status.fileId : null);
  const progress = $derived(status === null ? null : conversionSentence(status));
  const canAsk = $derived(
    convertible && (status === null || status.state === "none") && copyFileId === null,
  );
</script>

<Alert.Root variant="info">
  <Alert.Title>{CANNOT_PLAY_TITLE}</Alert.Title>
  <Alert.Description>{cannotPlaySentence(cause, convertible)}</Alert.Description>
  {#if progress !== null}
    <Alert.Description role="status">{progress}</Alert.Description>
  {/if}
  {#if refusal !== null}
    <Alert.Description role="alert">{refusal}</Alert.Description>
  {/if}
  <div class="flex flex-wrap items-center gap-8">
    {#if copyFileId !== null}
      <Button variant="primary" size="sm" href={`/documents/${encodeURIComponent(copyFileId)}/watch`}>
        Open the MP4
      </Button>
    {:else if canAsk}
      <Button variant="primary" size="sm" disabled={asking} onclick={() => void convert()}>
        Convert to MP4
      </Button>
    {/if}
    {#if showDownload}
      <Button variant="secondary" size="sm" href={fileDownloadUrl(fileId)} {...opensBeside("file")}>
        Download
      </Button>
    {/if}
  </div>
</Alert.Root>

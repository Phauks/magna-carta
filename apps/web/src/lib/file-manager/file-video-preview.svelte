<script lang="ts">
  /*
   * A recording in the details panel's Preview tab: the compact player, or the notice saying why
   * it will not play here, with the download and, where a copy can cure it, Convert to MP4. The same question the watch page asks — the
   * preview grant — asked again for the file in the panel, so the panel and the page never disagree
   * about whether a recording plays.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import VideoPlayer from "@magna-carta/design-system/video-player";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import UnreadableMediaNotice from "$lib/documents/unreadable-media-notice.svelte";
  import { type CannotPlayCause } from "$lib/documents/video-playback.ts";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import { fileDownloadUrl, readPreviewGrant, type PreviewGrant } from "./matter-file-api.ts";

  let {
    fileId,
    name,
    contentType = null,
    media = "video",
  }: {
    fileId: string;
    name: string;
    /** The sniffed content type: what decides whether Convert to MP4 is offered. */
    contentType?: string | null;
    media?: "video" | "audio";
  } = $props();

  let asking = $state(true);
  let grant = $state<PreviewGrant | null>(null);
  let grantFailure = $state<StatedFailure | null>(null);
  let browserRefused = $state(false);

  const cannotPlay = $derived.by((): CannotPlayCause | null => {
    if (browserRefused) return "browser-refused";
    if (grant === null) return null;
    if (grant.mode === "inline-media" && grant.streamUrl !== undefined) return null;
    return { verdict: grant.verdict, reason: grant.reason ?? "host-unavailable" };
  });

  /** A newer file in the panel supersedes an answer still in flight for the one before it. */
  let asked = 0;

  async function ask(id: string): Promise<void> {
    const ticket = ++asked;
    asking = true;
    grant = null;
    grantFailure = null;
    browserRefused = false;
    const outcome = await readPreviewGrant(fetch, id);
    if (ticket !== asked) return;
    if (outcome.kind === "ok") grant = outcome.value;
    else
      grantFailure = stated(
        outcome.failure,
        "The recording could not be opened.",
        "Nothing answered when the recording was opened.",
      );
    asking = false;
  }

  $effect(() => {
    void ask(fileId);
  });
</script>

<LoadingRegion
  loading={asking}
  failed={grantFailure !== null}
  label="Opening the recording"
  onRetry={() => ask(fileId)}
>
  {#snippet failure()}
    {#if grantFailure !== null}
      <FailureNotice
        failure={grantFailure.failure}
        subject="The recording"
        fallback={grantFailure.fallback}
        whenSilent={grantFailure.whenSilent}
        onRetry={() => ask(fileId)}
      />
    {/if}
  {/snippet}

  {#snippet fixture()}
    <div class="min-h-96 rounded-md bg-surface-sunken" data-loading-block></div>
  {/snippet}

  {#if cannotPlay !== null}
    <UnreadableMediaNotice {fileId} {contentType} cause={cannotPlay} />
  {:else if grant?.streamUrl !== undefined}
    <VideoPlayer
      variant="compact"
      {media}
      src={grant.streamUrl}
      title={name}
      onDownload={() => openBeside(fileDownloadUrl(fileId), "file")}
      onUnplayable={() => (browserRefused = true)}
    />
  {/if}
</LoadingRegion>

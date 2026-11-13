<script lang="ts">
  /*
   * One recording, open for watching. The reader's twin: the header names the file and the way back
   * to the matter's files, a strip beneath it carries the download, and the player takes the rest.
   *
   * THE SERVER DECIDES WHETHER IT PLAYS, NOT THE FILE'S NAME. A `.mp4` holds whatever its recorder
   * put in it, and the HEVC video most phones record plays in almost no browser. So the page first
   * asks for the preview grant: the server has read the recording's track table and either hands
   * back an address on the cookieless files host or says download-only, with the reason. The
   * browser is the last word, though: if it refuses an address the server allowed, the page says so
   * in the same words and offers the same download, rather than leaving a black box with a spinner.
   *
   * When neither will play it, the page says "Unreadable Media File" and, where a copy can cure it,
   * offers Convert to MP4: the copy is saved as a file of its own beside the original
   * ($lib/documents/unreadable-media-notice.svelte).
   *
   * A moment is an address. "Copy Link at 0:12:41" copies this page's address with `?t=761`, and
   * opening that address starts the player at that second. A still of a frame is FILED into the
   * matter beside the recording, named for the recording and the moment and carrying its provenance
   * inside the PNG ($lib/documents/recording-still.ts), so whoever exports it later knows where it
   * came from.
   *
   * Sound alone opens here too: the player draws it as a panel of controls, set at a reading width
   * rather than stretched over the whole canvas a picture would take.
   */
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { meGetOptions } from "@magna-carta/api-client";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import { toast } from "@magna-carta/design-system/toast";
  import VideoPlayer from "@magna-carta/design-system/video-player";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    formatDocumentSize,
    formatDocumentTimestamp,
  } from "$lib/documents/document-presentation.ts";
  import { viewerKindOf } from "$lib/documents/editable-documents.ts";
  import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
  import { uploadDocument } from "$lib/documents/create-document.ts";
  import { pngWithText, stillTextEntries } from "$lib/documents/recording-still.ts";
  import UnreadableMediaNotice from "$lib/documents/unreadable-media-notice.svelte";
  import {
    momentHref,
    screenshotFileName,
    startSecondOf,
    type CannotPlayCause,
  } from "$lib/documents/video-playback.ts";
  import {
    fileDownloadUrl,
    readPreviewGrant,
    type PreviewGrant,
  } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import type { DocumentViewPageData } from "../view/+page.ts";

  let { data }: { data: DocumentViewPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );
  const startAt = $derived(startSecondOf(page.url.searchParams));
  const media = $derived(file !== null && viewerKindOf(file) === "audio" ? "audio" : "video");

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

  async function ask(): Promise<void> {
    if (file === null) return;
    asking = true;
    grantFailure = null;
    browserRefused = false;
    const outcome = await readPreviewGrant(fetch, file.id);
    if (outcome.kind === "ok") {
      grant = outcome.value;
    } else {
      grant = null;
      grantFailure = stated(
        outcome.failure,
        "The recording could not be opened.",
        "Couldn't connect while opening the recording.",
      );
    }
    asking = false;
  }

  async function copyMoment(seconds: number): Promise<void> {
    if (file === null) return;
    try {
      await navigator.clipboard.writeText(momentHref(page.url.origin, file.id, seconds));
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy the link. Copy the address from the address bar instead.");
    }
  }

  /** Who is taking the still, from the session the shell already holds; null if it cannot say. */
  async function memberName(): Promise<string | null> {
    try {
      const me = await queryClient.ensureQueryData({ ...meGetOptions(), staleTime: SESSION_STABLE });
      return me.user.name;
    } catch {
      return null;
    }
  }

  let filing = $state(false);

  async function saveScreenshot(image: Blob | null, seconds: number): Promise<void> {
    if (file === null) return;
    if (image === null) {
      toast.error("This browser would not hand back the frame. Try again once the video has loaded.");
      return;
    }
    if (filing) return;
    filing = true;
    try {
      const png = pngWithText(
        new Uint8Array(await image.arrayBuffer()),
        stillTextEntries({
          recordingName: file.name,
          versionNumber: file.versionNumber,
          seconds,
          matterTitle: data.matter?.title ?? null,
          takenBy: await memberName(),
          takenAt: new Date().toISOString(),
        }),
      );
      const outcome = await uploadDocument({
        fetchImpl: fetch,
        matterId: file.matterId,
        folderId: file.folderId,
        file: new File([png], screenshotFileName(file.name, seconds), { type: "image/png" }),
      });
      if (outcome.kind === "created" || outcome.kind === "still-settling") {
        toast.success("Screenshot saved beside the recording.");
      } else if (outcome.kind === "rejected") {
        toast.error("The screenshot was refused by the file check, so it was not saved.");
      } else if (outcome.kind === "problem" && outcome.problem.status === 403) {
        toast.error("Saving a screenshot needs permission to upload files to this matter.");
      } else {
        toast.error("The screenshot could not be saved. Try again in a moment.");
      }
    } finally {
      filing = false;
    }
  }

  onMount(() => {
    void ask();
  });
</script>

{#snippet downloadAction(fileId: string)}
  <Button variant="secondary" size="sm" href={fileDownloadUrl(fileId)} {...opensBeside("file")}>
    Download
  </Button>
{/snippet}

{#if data.failure !== undefined}
  <ScreenHeader title="Recording" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The recording"
    fallback="The recording could not be read."
    whenSilent="Couldn't connect while reading the recording."
    onRetry={() => void invalidateAll()}
  />
{:else if file !== null && filesBack !== null}
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={file.name} back={filesBack} class="mb-24 flex-none">
      {#snippet meta()}
        <span>Version {file.versionNumber}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentSize(file.sizeBytes)}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentTimestamp(file.updatedAt)}</span>
      {/snippet}
    </ScreenHeader>

    <FullHeightSection class="-mx-24">
      <div class="flex flex-none items-center justify-end border-b border-border-default px-8 py-4">
        {@render downloadAction(file.id)}
      </div>

      <LoadingRegion
        loading={asking}
        failed={grantFailure !== null}
        label="Opening the recording"
        onRetry={ask}
        class="flex min-h-0 flex-1 flex-col"
      >
        {#snippet failure()}
          {#if grantFailure !== null}
            <div class="p-24">
              <FailureNotice
                failure={grantFailure.failure}
                subject="The recording"
                fallback={grantFailure.fallback}
                whenSilent={grantFailure.whenSilent}
                onRetry={ask}
              />
            </div>
          {/if}
        {/snippet}

        {#snippet fixture()}
          <div class="flex min-h-0 flex-1 flex-col p-16">
            <div class="flex-1 bg-surface-sunken" data-loading-block></div>
          </div>
        {/snippet}

        {#if cannotPlay !== null}
          <div class="p-24">
            <UnreadableMediaNotice
              fileId={file.id}
              contentType={file.sniffedContentType}
              cause={cannotPlay}
              showDownload={false}
            />
          </div>
        {:else if grant?.streamUrl !== undefined}
          {#if media === "audio"}
            <div class="p-24">
              <VideoPlayer
                class="max-w-3xl"
                media="audio"
                src={grant.streamUrl}
                title={file.name}
                {startAt}
                onCopyMoment={copyMoment}
                onUnplayable={() => (browserRefused = true)}
              />
            </div>
          {:else}
            <div class="flex min-h-0 flex-1 flex-col bg-surface-sunken p-16">
              <VideoPlayer
                class="min-h-0 flex-1"
                src={grant.streamUrl}
                title={file.name}
                {startAt}
                onCopyMoment={copyMoment}
                onScreenshot={(image, seconds) => void saveScreenshot(image, seconds)}
                onUnplayable={() => (browserRefused = true)}
              />
            </div>
          {/if}
        {/if}
      </LoadingRegion>
    </FullHeightSection>
  </div>
{/if}
